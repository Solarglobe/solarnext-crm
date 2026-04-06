/**
 * CP-QUOTE-001 — Test DB minimal Catalogue devis
 * Prouve: table + contraintes, multi-org (UNIQUE scoped), soft delete.
 * Exécution dans une transaction + ROLLBACK (aucun impact permanent).
 *
 * Usage: node backend/scripts/test-quote-catalog-db.js (depuis backend: node scripts/test-quote-catalog-db.js)
 * Prérequis: DATABASE_URL dans .env.dev, migration create_quote_catalog_items appliquée.
 */

import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.dev") });

function getConnectionString() {
  const url = process.env.DATABASE_URL;
  const hostOverride = process.env.PGHOST;
  if (!hostOverride || !url) return url;
  try {
    const u = new URL(url);
    u.hostname = hostOverride;
    return u.toString();
  } catch {
    return url;
  }
}

const connectionString = getConnectionString();
if (!connectionString) {
  console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
  process.exit(1);
}

const { Client } = pg;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");

    // a) Créer 2 organisations de test
    const orgA = (
      await client.query(
        `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-QUOTE-001 Org A') RETURNING id`
      )
    ).rows[0].id;
    const orgB = (
      await client.query(
        `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-QUOTE-001 Org B') RETURNING id`
      )
    ).rows[0].id;
    console.log("✅ a) 2 organisations de test créées (org A, org B)");

    // b) Insérer un item dans org A
    const ins = await client.query(
      `INSERT INTO quote_catalog_items (
        organization_id, name, description, category, pricing_mode,
        sale_price_ht_cents, purchase_price_ht_cents, default_vat_rate_bps
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, category, pricing_mode, sale_price_ht_cents, is_active`,
      [orgA, "Pack Standard", "Pack de base", "PANEL", "FIXED", 100000, 70000, 2000]
    );
    const row = ins.rows[0];
    assert(row, "Insert org A doit retourner une ligne");
    assert(row.name === "Pack Standard", "name attendu 'Pack Standard'");
    assert(row.category === "PANEL", "category attendu PANEL");
    assert(row.pricing_mode === "FIXED", "pricing_mode attendu FIXED");
    assert(Number(row.sale_price_ht_cents) === 100000, "sale_price_ht_cents attendu 100000");
    assert(row.is_active === true, "is_active attendu true");
    console.log("✅ b) Item 'Pack Standard' inséré dans org A");

    // c) Vérifier insertion (SELECT)
    const sel = await client.query(
      `SELECT id, organization_id, name, category, sale_price_ht_cents FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`,
      [orgA, "Pack Standard"]
    );
    assert(sel.rows.length === 1, "SELECT doit retourner exactement 1 ligne");
    console.log("✅ c) SELECT OK — contraintes / table existent");

    // d) Tenter doublon (org A, même name) => doit ÉCHOUER (contrainte UNIQUE)
    await client.query("SAVEPOINT before_duplicate");
    let uniqueOk = false;
    try {
      await client.query(
        `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode) VALUES ($1, $2, 'INVERTER', 'UNIT')`,
        [orgA, "Pack Standard"]
      );
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      assert(
        msg.includes("unique") || msg.includes("uq_quote_catalog_items_org_name") || msg.includes("duplicate"),
        "Erreur attendue: contrainte UNIQUE (organization_id, name). Reçu: " + e.message
      );
      uniqueOk = true;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT before_duplicate");
    }
    assert(uniqueOk, "L'insert doublon en org A aurait dû échouer (UNIQUE)");
    console.log("✅ d) Doublon (org A, même name) refusé — contrainte uq_quote_catalog_items_org_name OK");

    // e) Même name dans org B => doit RÉUSSIR (unique scoped par org)
    await client.query(
      `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode) VALUES ($1, $2, 'SERVICE', 'FIXED')`,
      [orgB, "Pack Standard"]
    );
    const countB = (
      await client.query(
        `SELECT 1 FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`,
        [orgB, "Pack Standard"]
      )
    ).rows.length;
    assert(countB === 1, "Org B doit avoir exactement 1 item 'Pack Standard'");
    console.log("✅ e) Même name 'Pack Standard' dans org B accepté — multi-org OK");

    // f) Soft delete: is_active = false sur l'item org A
    const idA = (
      await client.query(
        `SELECT id FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`,
        [orgA, "Pack Standard"]
      )
    ).rows[0].id;
    await client.query(
      `UPDATE quote_catalog_items SET is_active = false WHERE id = $1`,
      [idA]
    );
    const updated = (
      await client.query(`SELECT is_active FROM quote_catalog_items WHERE id = $1`, [idA])
    ).rows[0];
    assert(updated && updated.is_active === false, "is_active doit être false après UPDATE");
    console.log("✅ f) Soft delete (is_active=false) OK");

    await client.query("ROLLBACK");
    console.log("✅ ROLLBACK — aucune donnée persistée");
    console.log("\nPASS CP-QUOTE-001");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error("\n❌ FAIL:", e.message || e);
    throw e;
  } finally {
    await client.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Erreur fatale:", e?.message || e);
    process.exit(1);
  });
