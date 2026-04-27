/**
 * CP-026 — Tests des triggers et contraintes en conditions réelles
 * Exécution dans une transaction ROLLBACK — AUCUN impact permanent
 *
 * Usage: node scripts/test-cp026-triggers.js
 * Prérequis: DATABASE_URL dans .env.dev
 */

import "../config/register-local-env.js";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
  process.exit(1);
}

const { Client } = pg;

const results = { passed: [], failed: [] };

function ok(name, detail = "") {
  results.passed.push({ name, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  results.failed.push({ name, error });
  console.log(`❌ ${name}`);
  console.log(`   Erreur: ${error.message || error}`);
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    // Setup: orgs A et B (nécessaires pour tests 1, 2)
    const orgA = (
      await client.query(
        `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test Org A') RETURNING id`
      )
    ).rows[0].id;
    const orgB = (
      await client.query(
        `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test Org B') RETURNING id`
      )
    ).rows[0].id;

    // ========== TEST 1: CROSS-ORG LEAD.STAGE_ID ==========
    await client.query("SAVEPOINT test1");
    try {
      const stageA = (
        await client.query(
          `SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1`,
          [orgA]
        )
      ).rows[0].id;
      const stageB = (
        await client.query(
          `SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1`,
          [orgB]
        )
      ).rows[0].id;

      const leadB = (
        await client.query(
          `INSERT INTO leads (organization_id, stage_id) VALUES ($1, $2) RETURNING id`,
          [orgB, stageB]
        )
      ).rows[0].id;

      await client.query(
        `UPDATE leads SET stage_id = $1 WHERE id = $2`,
        [stageA, leadB]
      );
      fail(
        "TEST 1: Cross-org lead.stage_id",
        new Error("Exception attendue non levée — l'UPDATE aurait dû échouer")
      );
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("Cross-org stage not allowed") ||
          e.message.includes("Cross-org"))
      ) {
        ok("TEST 1: Cross-org lead.stage_id", `Exception: ${e.message}`);
      } else {
        fail("TEST 1: Cross-org lead.stage_id", e);
      }
    }
    await client.query("ROLLBACK TO SAVEPOINT test1");

    // ========== TEST 2: CROSS-ORG LEAD_STAGE_HISTORY ==========
    await client.query("SAVEPOINT test2");
    try {
      const stageA = (
        await client.query(
          `SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1`,
          [orgA]
        )
      ).rows[0].id;
      const stageB = (
        await client.query(
          `SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1`,
          [orgB]
        )
      ).rows[0].id;

      const leadA = (
        await client.query(
          `INSERT INTO leads (organization_id, stage_id) VALUES ($1, $2) RETURNING id`,
          [orgA, stageA]
        )
      ).rows[0].id;

      await client.query(
        `INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id)
         VALUES ($1, $2, $3)`,
        [leadA, stageA, stageB]
      );
      fail(
        "TEST 2: Cross-org lead_stage_history",
        new Error("Exception attendue non levée — l'INSERT aurait dû échouer")
      );
    } catch (e) {
      if (
        e.message &&
        (e.message.includes("Cross-org") || e.message.includes("to_stage"))
      ) {
        ok("TEST 2: Cross-org lead_stage_history", `Exception: ${e.message}`);
      } else {
        fail("TEST 2: Cross-org lead_stage_history", e);
      }
    }
    await client.query("ROLLBACK TO SAVEPOINT test2");

    // ========== TEST 3: RECALCUL AUTOMATIQUE total_paid ==========
    await client.query("SAVEPOINT test3");
    try {
      const orgId = orgA;
      const clientId = (
        await client.query(
          `INSERT INTO clients (organization_id, client_number) VALUES ($1, 'TEST-CP026') RETURNING id`,
          [orgId]
        )
      ).rows[0].id;

      const inv = (
        await client.query(
          `INSERT INTO invoices (organization_id, client_id, invoice_number, total_ht, total_vat, total_ttc)
           VALUES ($1, $2, 'INV-TEST-001', 1000, 200, 1200) RETURNING id`,
          [orgId, clientId]
        )
      ).rows[0].id;

      let totalPaid = (
        await client.query(
          `SELECT total_paid FROM invoices WHERE id = $1`,
          [inv]
        )
      ).rows[0].total_paid;
      if (Number(totalPaid) !== 0) throw new Error(`total_paid attendu 0, got ${totalPaid}`);

      const payId = (
        await client.query(
          `INSERT INTO payments (organization_id, invoice_id, amount, payment_date)
           VALUES ($1, $2, 100, CURRENT_DATE) RETURNING id`,
          [orgId, inv]
        )
      ).rows[0].id;

      totalPaid = (
        await client.query(
          `SELECT total_paid FROM invoices WHERE id = $1`,
          [inv]
        )
      ).rows[0].total_paid;
      if (Number(totalPaid) !== 100) throw new Error(`total_paid attendu 100, got ${totalPaid}`);

      await client.query(
        `UPDATE payments SET amount = 200 WHERE id = $1`,
        [payId]
      );
      totalPaid = (
        await client.query(
          `SELECT total_paid FROM invoices WHERE id = $1`,
          [inv]
        )
      ).rows[0].total_paid;
      if (Number(totalPaid) !== 200) throw new Error(`total_paid attendu 200, got ${totalPaid}`);

      await client.query(`DELETE FROM payments WHERE id = $1`, [payId]);
      totalPaid = (
        await client.query(
          `SELECT total_paid FROM invoices WHERE id = $1`,
          [inv]
        )
      ).rows[0].total_paid;
      if (Number(totalPaid) !== 0) throw new Error(`total_paid attendu 0 après DELETE, got ${totalPaid}`);

      ok("TEST 3: Recalcul auto total_paid", "0 → 100 → 200 → 0");
    } catch (e) {
      fail("TEST 3: Recalcul auto total_paid", e);
    }
    await client.query("ROLLBACK TO SAVEPOINT test3");

    // ========== TEST 4: AUTO-SEED PIPELINE ==========
    await client.query("SAVEPOINT test4");
    try {
      const orgNew = (
        await client.query(
          `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test Org Pipeline Seed') RETURNING id`
        )
      ).rows[0].id;

      const stages = (
        await client.query(
          `SELECT name, position, is_closed FROM pipeline_stages WHERE organization_id = $1 ORDER BY position`,
          [orgNew]
        )
      ).rows;

      if (stages.length !== 6) throw new Error(`6 stages attendus, got ${stages.length}`);
      const positions = stages.map((s) => s.position);
      const expectedPos = [1, 2, 3, 4, 5, 6];
      if (JSON.stringify(positions) !== JSON.stringify(expectedPos))
        throw new Error(`positions attendues 1..6, got ${positions.join(",")}`);

      const perdu = stages.find((s) => s.name === "Perdu");
      if (!perdu) throw new Error("Stage 'Perdu' introuvable");
      if (!perdu.is_closed) throw new Error("Perdu doit avoir is_closed = true");

      ok("TEST 4: Auto-seed pipeline", "6 stages, positions 1..6, Perdu is_closed=true");
    } catch (e) {
      fail("TEST 4: Auto-seed pipeline", e);
    }
    await client.query("ROLLBACK TO SAVEPOINT test4");

    // ========== TEST 5: INDEX lead_stage_history_lead_id ==========
    await client.query("SAVEPOINT test5");
    try {
      const stageA = (
        await client.query(
          `SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1`,
          [orgA]
        )
      ).rows[0].id;
      const leadForExplain = (
        await client.query(
          `INSERT INTO leads (organization_id, stage_id) VALUES ($1, $2) RETURNING id`,
          [orgA, stageA]
        )
      ).rows[0].id;

      const explainRes = await client.query(
        `EXPLAIN (ANALYZE, COSTS, FORMAT TEXT) SELECT * FROM lead_stage_history WHERE lead_id = $1`,
        [leadForExplain]
      );
      const plan = explainRes.rows.map((r) => r["QUERY PLAN"]).join("\n");

      if (
        plan.includes("lead_stage_history_lead_id_index") ||
        plan.includes("Index Scan") ||
        plan.includes("Index Only Scan")
      ) {
        ok("TEST 5: Index lead_stage_history_lead_id", "Index utilisé");
        console.log("   Plan:\n" + plan.split("\n").map((l) => "   " + l).join("\n"));
      } else {
        fail(
          "TEST 5: Index lead_stage_history_lead_id",
          new Error("Index non détecté dans le plan:\n" + plan)
        );
        console.log("   Plan:\n" + plan.split("\n").map((l) => "   " + l).join("\n"));
      }
    } catch (e) {
      fail("TEST 5: Index lead_stage_history_lead_id", e);
    }
    await client.query("ROLLBACK TO SAVEPOINT test5");

    // ========== TEST 6: ABSENCE DE BOUCLE TRIGGER ==========
    try {
      const triggerRes = await client.query(`
        SELECT tgname, tgrelid::regclass AS table_name
        FROM pg_trigger t
        JOIN pg_proc p ON t.tgfoid = p.oid
        WHERE p.proname IN ('sg_payments_sync_total_paid', 'sg_recompute_invoice_total_paid')
        AND NOT tgisinternal
      `);

      const invTriggers = await client.query(`
        SELECT tgname FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = 'invoices' AND NOT t.tgisinternal
      `);

      const payTriggers = await client.query(`
        SELECT tgname FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = 'payments' AND NOT t.tgisinternal
      `);

      const hasPaymentsSync = payTriggers.rows.some(
        (r) => r.tgname === "payments_sync_total_paid"
      );
      const invoicesHasNoPaymentsTrigger =
        !invTriggers.rows.some((r) => r.tgname && r.tgname.includes("payment"));

      if (hasPaymentsSync && invoicesHasNoPaymentsTrigger) {
        ok(
          "TEST 6: Absence boucle trigger",
          "payments_sync_total_paid existe; invoices n'a pas de trigger vers payments"
        );
      } else {
        fail(
          "TEST 6: Absence boucle trigger",
          new Error(
            `payments_sync: ${hasPaymentsSync}, invoices sans trigger payment: ${invoicesHasNoPaymentsTrigger}`
          )
        );
      }
    } catch (e) {
      fail("TEST 6: Absence boucle trigger", e);
    }

    await client.query("ROLLBACK");
    ok("TEST 7: ROLLBACK global", "Transaction annulée — aucune donnée persistée");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    fail("Transaction globale", e);
  } finally {
    await client.end();
  }

  // ========== RÉSUMÉ ==========
  console.log("\n" + "=".repeat(60));
  console.log("RÉSUMÉ CP-026");
  console.log("=".repeat(60));
  console.log(`✅ Tests réussis: ${results.passed.length}`);
  console.log(`❌ Tests échoués: ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log("\nDétails des échecs:");
    results.failed.forEach(({ name, error }) => {
      console.log(`  - ${name}: ${error.message || error}`);
    });
  }
  process.exit(results.failed.length > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
