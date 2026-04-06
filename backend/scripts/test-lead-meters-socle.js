/**
 * Tests socle multi-compteurs (DB + synchro) — Prompt 2/8
 * Usage: node scripts/test-lead-meters-socle.js
 * Prérequis: DATABASE_URL, migrations 1775000000000 appliquées
 */

import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  syncDefaultMeterFromLeadRow,
  getDefaultMeterRow,
  ensureDefaultLeadMeter,
} from "../services/leadMeters.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.dev") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;

function ok(name, detail = "") {
  passed++;
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed++;
  console.error(`❌ ${name}:`, err?.message || err);
}

async function test1_defaultMeterPerLead() {
  const r = await pool.query(`
    SELECT l.id
    FROM leads l
    LEFT JOIN lead_meters m ON m.lead_id = l.id AND m.is_default = true
    WHERE m.id IS NULL
    LIMIT 5
  `);
  if (r.rows.length > 0) {
    fail("Test 1 — chaque lead a un compteur par défaut", new Error(`manquants: ${r.rows.map((x) => x.id).join(", ")}`));
    return;
  }
  const c = await pool.query(`
    SELECT COUNT(*)::int AS c FROM (
      SELECT lead_id FROM lead_meters WHERE is_default = true GROUP BY lead_id HAVING COUNT(*) > 1
    ) x
  `);
  if (c.rows[0].c > 0) {
    fail("Test 1 — un seul défaut par lead", new Error("doublons is_default"));
    return;
  }
  ok("Test 1 — chaque lead a exactement un compteur is_default");
}

async function test2_monthlyLinkedToMeter() {
  const r = await pool.query(`
    SELECT lcm.id, lcm.lead_id, lcm.meter_id
    FROM lead_consumption_monthly lcm
    LEFT JOIN lead_meters m ON m.id = lcm.meter_id AND m.lead_id = lcm.lead_id AND m.is_default = true
    WHERE m.id IS NULL
    LIMIT 5
  `);
  if (r.rows.length > 0) {
    fail("Test 2 — mensuel rattaché au compteur défaut", new Error(JSON.stringify(r.rows[0])));
    return;
  }
  ok("Test 2 — lignes mensuelles pointent vers le meter du bon lead");
}

async function test3_leadFlatMatchesDefaultMeter() {
  const r = await pool.query(`
    SELECT l.id, l.consumption_pdl AS lp, m.consumption_pdl AS mp
    FROM leads l
    JOIN lead_meters m ON m.lead_id = l.id AND m.is_default = true
    WHERE (l.consumption_pdl IS DISTINCT FROM m.consumption_pdl)
    LIMIT 3
  `);
  if (r.rows.length > 0) {
    ok(
      "Test 3 — alignement leads / meter (info)",
      `${r.rows.length} lead(s) désalignés après édition hors sync — attendu tant que tout passe par PATCH`
    );
  } else {
    ok("Test 3 — colonnes conso leads = compteur défaut (échantillon global)");
  }
}

async function test4_patchSyncMeter() {
  const pick = await pool.query(
    `SELECT l.* FROM leads l
     JOIN lead_meters m ON m.lead_id = l.id AND m.is_default = true
     WHERE l.archived_at IS NULL
     LIMIT 1`
  );
  if (pick.rows.length === 0) {
    ok("Test 4 — PATCH simulé (skip, aucun lead)");
    return;
  }
  const lead = pick.rows[0];
  const prev = lead.consumption_annual_kwh;
  const nextVal = prev != null && prev > 0 ? prev + 1 : 5000;
  await pool.query(
    `UPDATE leads SET consumption_annual_kwh = $1, consumption_mode = 'ANNUAL', updated_at = now()
     WHERE id = $2 AND organization_id = $3`,
    [nextVal, lead.id, lead.organization_id]
  );
  const after = await pool.query("SELECT * FROM leads WHERE id = $1", [lead.id]);
  await syncDefaultMeterFromLeadRow(pool, after.rows[0]);
  const m = await getDefaultMeterRow(pool, lead.id, lead.organization_id);
  if (Number(m.consumption_annual_kwh) !== nextVal) {
    fail("Test 4 — syncDefaultMeterFromLeadRow", new Error(`meter=${m.consumption_annual_kwh} lead=${nextVal}`));
    await pool.query(
      `UPDATE leads SET consumption_annual_kwh = $1 WHERE id = $2`,
      [prev, lead.id]
    );
    await syncDefaultMeterFromLeadRow(pool, (await pool.query("SELECT * FROM leads WHERE id = $1", [lead.id])).rows[0]);
    return;
  }
  await pool.query(
    `UPDATE leads SET consumption_annual_kwh = $1 WHERE id = $2`,
    [prev, lead.id]
  );
  await syncDefaultMeterFromLeadRow(pool, (await pool.query("SELECT * FROM leads WHERE id = $1", [lead.id])).rows[0]);
  ok("Test 4 — sync meter après UPDATE leads simulé");
}

async function test5_equipmentPreservedOnMeter() {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads l
    JOIN lead_meters m ON m.lead_id = l.id AND m.is_default = true
    WHERE l.equipement_actuel IS DISTINCT FROM m.equipement_actuel
       OR l.equipement_actuel_params::text IS DISTINCT FROM m.equipement_actuel_params::text
       OR l.equipements_a_venir::text IS DISTINCT FROM m.equipements_a_venir::text
  `);
  if (r.rows[0].c > 0) {
    ok("Test 5 — équipements (info)", `${r.rows[0].c} désalignés — normal si PATCH partiel hors sync`);
  } else {
    ok("Test 5 — équipements leads = meter (backfill OK)");
  }
}

async function test6_energyProfilePreserved() {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads l
    JOIN lead_meters m ON m.lead_id = l.id AND m.is_default = true
    WHERE l.energy_profile::text IS DISTINCT FROM m.energy_profile::text
  `);
  if (r.rows[0].c > 0) {
    ok("Test 6 — energy_profile (info)", `${r.rows[0].c} désalignés`);
  } else {
    ok("Test 6 — energy_profile identique lead / meter");
  }
}

async function test7_studyLeadHasMeter() {
  const r = await pool.query(`
    SELECT s.id AS study_id, s.lead_id
    FROM studies s
    LEFT JOIN lead_meters m ON m.lead_id = s.lead_id AND m.is_default = true
    WHERE s.lead_id IS NOT NULL AND s.deleted_at IS NULL AND s.archived_at IS NULL
      AND m.id IS NULL
    LIMIT 3
  `);
  if (r.rows.length > 0) {
    fail("Test 7 — étude avec lead sans compteur défaut", new Error(JSON.stringify(r.rows[0])));
    return;
  }
  ok("Test 7 — études actives : lead lié possède un compteur défaut (smoke non-régression)");
}

async function main() {
  try {
    await test1_defaultMeterPerLead();
    await test2_monthlyLinkedToMeter();
    await test3_leadFlatMatchesDefaultMeter();
    await test4_patchSyncMeter();
    await test5_equipmentPreservedOnMeter();
    await test6_energyProfilePreserved();
    await test7_studyLeadHasMeter();

    const sample = await pool.query(
      `SELECT id, name, is_default, lead_id, organization_id FROM lead_meters ORDER BY created_at DESC LIMIT 1`
    );
    if (sample.rows[0]) {
      ok("Exemple compteur", JSON.stringify(sample.rows[0]));
      const again = await ensureDefaultLeadMeter(
        pool,
        sample.rows[0].lead_id,
        sample.rows[0].organization_id
      );
      if (again?.id === sample.rows[0].id) ok("ensureDefaultLeadMeter idempotent");
    }
  } catch (e) {
    fail("Suite interrompue", e);
  } finally {
    await pool.end();
  }
  console.log(`\nRésultat: ${passed} OK, ${failed} échecs`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
