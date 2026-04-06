/**
 * Vérifie la migration add_lead_status_and_lost_reason (contraintes + statuts).
 * Usage: node --env-file=./.env scripts/test-lead-status-migration.js
 *        (depuis backend/)
 *
 * Prérequis : DATABASE_URL, migrations appliquées
 */

import { pool } from "../config/db.js";

let testOrgId;
let testStageId;
const createdLeadIds = [];

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function fail(msg, err) {
  console.error(`❌ ${msg}`);
  if (err) console.error(err.message || err);
  process.exitCode = 1;
}

async function getOrgAndStage() {
  const org = await pool.query(`SELECT id FROM organizations LIMIT 1`);
  if (!org.rows.length) {
    throw new Error("Aucune organization — impossible de tester INSERT leads");
  }
  testOrgId = org.rows[0].id;
  const st = await pool.query(
    `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position LIMIT 1`,
    [testOrgId]
  );
  if (!st.rows.length) {
    throw new Error("Aucun pipeline_stages pour cette org");
  }
  testStageId = st.rows[0].id;
}

async function cleanup() {
  if (createdLeadIds.length === 0) return;
  await pool.query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [createdLeadIds]);
}

async function main() {
  await getOrgAndStage();

  // 1) IN_REFLECTION — OK
  const ins1 = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name)
     VALUES ($1, $2, 'IN_REFLECTION', 'Test migration status')
     RETURNING id`,
    [testOrgId, testStageId]
  );
  createdLeadIds.push(ins1.rows[0].id);
  ok("INSERT status = IN_REFLECTION");

  // 2) LOST sans raison — doit échouer
  try {
    await pool.query(
      `INSERT INTO leads (organization_id, stage_id, status, full_name)
       VALUES ($1, $2, 'LOST', 'Lost no reason')`,
      [testOrgId, testStageId]
    );
    fail("INSERT LOST sans lost_reason aurait dû échouer");
  } catch (e) {
    if (e.code === "23514" || /check_lost_reason|violates check constraint/i.test(e.message)) {
      ok("INSERT LOST sans lost_reason → rejet (check_lost_reason)");
    } else {
      throw e;
    }
  }

  // 3) LOST avec raison — OK
  const ins3 = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name, lost_reason)
     VALUES ($1, $2, 'LOST', 'Lost ok', 'Too expensive')
     RETURNING id`,
    [testOrgId, testStageId]
  );
  createdLeadIds.push(ins3.rows[0].id);
  ok("INSERT LOST avec lost_reason");

  // 4) UPDATE vers LOST avec raison — OK
  await pool.query(
    `UPDATE leads SET status = 'LOST', lost_reason = 'Competitor' WHERE id = $1`,
    [ins1.rows[0].id]
  );
  ok("UPDATE → LOST avec lost_reason");

  // 5) ARCHIVED — archived_at peut rester NULL
  const ins5 = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, status, full_name)
     VALUES ($1, $2, 'ARCHIVED', 'Archived row')
     RETURNING id, archived_at`,
    [testOrgId, testStageId]
  );
  createdLeadIds.push(ins5.rows[0].id);
  if (ins5.rows[0].archived_at != null) {
    fail("ARCHIVED sans toucher archived_at devrait laisser NULL");
  } else {
    ok("INSERT ARCHIVED, archived_at nullable (NULL)");
  }

  await cleanup();
  createdLeadIds.length = 0;
  ok("Nettoyage des lignes de test");

  console.log("\n=== test-lead-status-migration : terminé ===");
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await cleanup();
  } catch (_) {
    /* ignore */
  }
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
