/**
 * Script de nettoyage — données de test orphelines catalogue devis.
 *
 * Supprime les entrées laissées par test-quote-snapshot-hardening.js
 * si le script a été interrompu avant son bloc finally.
 *
 * USAGE (dry-run par défaut) :
 *   node scripts/cleanup-test-catalog-data.js
 *
 * USAGE (suppression réelle) :
 *   DRY_RUN=false node scripts/cleanup-test-catalog-data.js
 */

import "../config/register-local-env.js";
import { pool } from "../config/db.js";

const DRY_RUN = process.env.DRY_RUN !== "false";

const TEST_PATTERNS = {
  quote_catalog_items: ["Cat CP005-%"],
  clients: ["CLI-CP005-%"],
  // Les organisations de test ont un nom fixe
  organizations: ["Test CP-005 Org B"],
};

async function main() {
  console.log(`\n🔍 Cleanup test data — mode: ${DRY_RUN ? "DRY RUN (lecture seule)" : "⚠️  SUPPRESSION RÉELLE"}\n`);

  const client = await pool.connect();
  try {
    // ── 1) Lister les items de catalogue de test ──────────────────
    const catalogRows = await client.query(
      `SELECT id, organization_id, name, created_at
       FROM quote_catalog_items
       WHERE name LIKE $1
       ORDER BY created_at DESC`,
      [TEST_PATTERNS.quote_catalog_items[0]]
    );
    console.log(`quote_catalog_items correspondants : ${catalogRows.rowCount}`);
    for (const r of catalogRows.rows) {
      console.log(`  • [${r.id}] "${r.name}" — créé ${r.created_at.toISOString()}`);
    }

    // ── 2) Lister les clients de test ─────────────────────────────
    const clientRows = await client.query(
      `SELECT id, organization_id, client_number, created_at
       FROM clients
       WHERE client_number LIKE $1
       ORDER BY created_at DESC`,
      [TEST_PATTERNS.clients[0]]
    );
    console.log(`\nclients correspondants : ${clientRows.rowCount}`);
    for (const r of clientRows.rows) {
      console.log(`  • [${r.id}] "${r.client_number}" — créé ${r.created_at.toISOString()}`);
    }

    // ── 3) Lister les organisations de test ───────────────────────
    const orgRows = await client.query(
      `SELECT id, name, created_at
       FROM organizations
       WHERE name = $1
       ORDER BY created_at DESC`,
      [TEST_PATTERNS.organizations[0]]
    );
    console.log(`\norganizations correspondantes : ${orgRows.rowCount}`);
    for (const r of orgRows.rows) {
      console.log(`  • [${r.id}] "${r.name}" — créé ${r.created_at.toISOString()}`);
    }

    if (DRY_RUN) {
      console.log("\n✅ Dry run terminé. Rien n'a été supprimé.");
      console.log("   Pour supprimer : DRY_RUN=false node scripts/cleanup-test-catalog-data.js\n");
      return;
    }

    // ── 4) Suppression en cascade (order matters : FK) ────────────
    await client.query("BEGIN");

    // Lignes de devis liées aux catalog items de test
    if (catalogRows.rowCount > 0) {
      const ids = catalogRows.rows.map((r) => r.id);
      const del1 = await client.query(
        `DELETE FROM quote_lines WHERE catalog_item_id = ANY($1)`,
        [ids]
      );
      console.log(`\nquote_lines supprimées : ${del1.rowCount}`);

      const del2 = await client.query(
        `DELETE FROM quote_catalog_items WHERE id = ANY($1)`,
        [ids]
      );
      console.log(`quote_catalog_items supprimés : ${del2.rowCount}`);
    }

    // Clients de test
    if (clientRows.rowCount > 0) {
      const del3 = await client.query(
        `DELETE FROM clients WHERE client_number LIKE $1`,
        [TEST_PATTERNS.clients[0]]
      );
      console.log(`clients supprimés : ${del3.rowCount}`);
    }

    // Organisations de test (en cascade, tout ce qui y est lié)
    for (const org of orgRows.rows) {
      await client.query(`DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)`, [org.id]);
      await client.query(`DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)`, [org.id]);
      await client.query(`DELETE FROM pipeline_stages WHERE organization_id = $1`, [org.id]);
      await client.query(`DELETE FROM rbac_roles WHERE organization_id = $1`, [org.id]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [org.id]);
      console.log(`organisation "${org.name}" [${org.id}] supprimée`);
    }

    await client.query("COMMIT");
    console.log("\n✅ Nettoyage terminé avec succès.\n");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n❌ Erreur — rollback effectué :", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
