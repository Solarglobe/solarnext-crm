/**
 * Multi-compteurs V2 — Prompt 3/3 : stabilité version / snapshot / non-régression.
 * Usage: cd backend && node scripts/test-multi-meter-final.js
 * Prérequis: DATABASE_URL, migrations lead_meters.
 */

import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { resolveStudyVersionMeterContext } from "../services/solarnextPayloadBuilder.service.js";
import * as studiesService from "../routes/studies/service.js";
import { buildMeterSnapshotRecord } from "../services/studyMeterSnapshot.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.dev") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PREFIX = "MMFIN";

let passed = 0;
let failed = 0;

function ok(msg) {
  passed++;
  console.log(`  ✔ ${msg}`);
}
function fail(msg, err) {
  failed++;
  console.log(`  ✖ ${msg}`, err?.message || err || "");
}

async function getStage(orgId) {
  const r = await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
    [orgId]
  );
  if (r.rows[0]?.id) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO pipeline_stages (organization_id, name, position, is_closed) VALUES ($1, 'Q', 0, false) RETURNING id`,
    [orgId]
  );
  return ins.rows[0].id;
}

async function getOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows[0]) return r.rows[0].id;
  const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [
    `${PREFIX}-org`,
  ]);
  return ins.rows[0].id;
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    if (ids.meterIds?.length) {
      await pool.query("DELETE FROM lead_consumption_monthly WHERE meter_id = ANY($1::uuid[])", [
        ids.meterIds,
      ]);
    }
    if (ids.meterIds?.length) {
      await pool.query("DELETE FROM lead_meters WHERE id = ANY($1::uuid[])", [ids.meterIds]);
    }
    if (ids.versionIds?.length) {
      await pool.query("DELETE FROM study_versions WHERE id = ANY($1::uuid[])", [ids.versionIds]);
    }
    if (ids.studyIds?.length) {
      await pool.query("DELETE FROM studies WHERE id = ANY($1::uuid[])", [ids.studyIds]);
    }
    if (ids.leadId) await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
  } catch (e) {
    console.warn("cleanup", e.message);
  }
}

async function run() {
  console.log("\n=== Multi-compteur final (stabilité) ===\n");
  const orgId = await getOrg();
  const stageId = await getStage(orgId);
  const ids = { meterIds: [], studyIds: [], versionIds: [] };

  try {
    const leadIns = await pool.query(
      `INSERT INTO leads (organization_id, stage_id, full_name, email, consumption_mode, consumption_annual_kwh, meter_power_kva, grid_type)
       VALUES ($1, $2, $3, 'mm@test.local', 'ANNUAL', 9999, 9, 'mono') RETURNING id`,
      [orgId, stageId, `${PREFIX} Lead`]
    );
    ids.leadId = leadIns.rows[0].id;

    const mA = await pool.query(
      `INSERT INTO lead_meters (organization_id, lead_id, name, is_default, sort_order, consumption_mode, consumption_annual_kwh, meter_power_kva, grid_type, equipement_actuel)
       VALUES ($1, $2, 'Compteur A', true, 0, 'ANNUAL', 5000, 6, 'mono', 'VE') RETURNING id`,
      [orgId, ids.leadId]
    );
    const mB = await pool.query(
      `INSERT INTO lead_meters (organization_id, lead_id, name, is_default, sort_order, consumption_mode, consumption_annual_kwh, meter_power_kva, grid_type, equipement_actuel)
       VALUES ($1, $2, 'Compteur B', false, 1, 'ANNUAL', 12000, 12, 'tri', null) RETURNING id`,
      [orgId, ids.leadId]
    );
    const idA = mA.rows[0].id;
    const idB = mB.rows[0].id;
    ids.meterIds.push(idA, idB);

    const study1 = await studiesService.createStudy(orgId, null, {
      lead_id: ids.leadId,
      selected_meter_id: idA,
    });
    const study2 = await studiesService.createStudy(orgId, null, {
      lead_id: ids.leadId,
      selected_meter_id: idB,
    });
    const sid1 = study1.study.id;
    const sid2 = study2.study.id;
    ids.studyIds.push(sid1, sid2);
    const v1 = study1.versions.find((v) => v.version_number === 1);
    const v2 = study2.versions.find((v) => v.version_number === 1);
    if (v1?.id) ids.versionIds.push(v1.id);
    if (v2?.id) ids.versionIds.push(v2.id);

    const d1 = v1?.data?.selected_meter_id;
    const d2 = v2?.data?.selected_meter_id;
    if (d1 === idA && d2 === idB) ok("TEST 1 — deux études, selected_meter_id distinct");
    else fail("TEST 1", new Error(`attendu A/B, reçu ${d1} / ${d2}`));

    const ctxA = await resolveStudyVersionMeterContext(pool, {
      studyId: sid1,
      versionNumber: 1,
      orgId,
    });
    const ctxB = await resolveStudyVersionMeterContext(pool, {
      studyId: sid2,
      versionNumber: 1,
      orgId,
    });
    if (
      ctxA?.energyLead?.consumption_annual_kwh === 5000 &&
      ctxB?.energyLead?.consumption_annual_kwh === 12000
    ) {
      ok("TEST 1 — payloads énergie distincts (kWh annuel)");
    } else fail("TEST 1 kWh", new Error(`${ctxA?.energyLead?.consumption_annual_kwh} / ${ctxB?.energyLead?.consumption_annual_kwh}`));

    if (ctxA?.energyLead?.equipement_actuel === "VE" && (ctxB?.energyLead?.equipement_actuel == null || ctxB?.energyLead?.equipement_actuel === null)) {
      ok("TEST 3 — équipements : A avec VE, B sans");
    } else fail("TEST 3", new Error(String(ctxB?.energyLead?.equipement_actuel)));

    await pool.query(
      `UPDATE lead_meters SET consumption_mode = 'MONTHLY' WHERE id = $1`,
      [idA]
    );
    for (let mo = 1; mo <= 12; mo++) {
      await pool.query(
        `INSERT INTO lead_consumption_monthly (organization_id, lead_id, meter_id, year, month, kwh, updated_at)
         VALUES ($1, $2, $3, extract(year from now())::int, $4, $5, now())
         ON CONFLICT (meter_id, year, month) DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = now()`,
        [orgId, ids.leadId, idA, mo, mo * 10]
      );
    }
    await pool.query(
      `UPDATE lead_meters SET consumption_mode = 'MONTHLY' WHERE id = $1`,
      [idB]
    );
    for (let mo = 1; mo <= 12; mo++) {
      await pool.query(
        `INSERT INTO lead_consumption_monthly (organization_id, lead_id, meter_id, year, month, kwh, updated_at)
         VALUES ($1, $2, $3, extract(year from now())::int, $4, $5, now())
         ON CONFLICT (meter_id, year, month) DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = now()`,
        [orgId, ids.leadId, idB, mo, mo * 100]
      );
    }

    const ctxAm = await resolveStudyVersionMeterContext(pool, {
      studyId: sid1,
      versionNumber: 1,
      orgId,
    });
    const ctxBm = await resolveStudyVersionMeterContext(pool, {
      studyId: sid2,
      versionNumber: 1,
      orgId,
    });
    const poolA = await pool.query(
      `SELECT array_agg(kwh ORDER BY month) AS arr FROM lead_consumption_monthly
       WHERE meter_id = $1 AND year = extract(year from now())::int`,
      [idA]
    );
    const poolB = await pool.query(
      `SELECT array_agg(kwh ORDER BY month) AS arr FROM lead_consumption_monthly
       WHERE meter_id = $1 AND year = extract(year from now())::int`,
      [idB]
    );
    const arrA = poolA.rows[0]?.arr;
    const arrB = poolB.rows[0]?.arr;
    if (
      Array.isArray(arrA) &&
      Array.isArray(arrB) &&
      arrA[0] === 10 &&
      arrB[0] === 100 &&
      ctxAm?.energyLead?.consumption_mode === "MONTHLY" &&
      ctxBm?.energyLead?.consumption_mode === "MONTHLY"
    ) {
      ok("TEST 2 — mensuel séparé par meter_id (profils différents)");
    } else fail("TEST 2", new Error(JSON.stringify({ arrA, arrB })));

    await studiesService.createVersion(sid1, orgId, null, { data: { note_fork: "x" } });
    const afterFork = await studiesService.getStudyById(sid1, orgId);
    const vLast = afterFork.versions[afterFork.versions.length - 1];
    if (vLast?.data?.selected_meter_id === idA && vLast?.data?.note_fork === "x") {
      ok("TEST 4 — nouvelle version conserve selected_meter_id");
    } else fail("TEST 4", new Error(JSON.stringify(vLast?.data)));

    const studyLegacy = await studiesService.createStudy(orgId, null, {
      lead_id: ids.leadId,
      data: {},
    });
    ids.studyIds.push(studyLegacy.study.id);
    const vLeg = studyLegacy.versions[0];
    if (vLeg?.id) ids.versionIds.push(vLeg.id);
    const ctxL = await resolveStudyVersionMeterContext(pool, {
      studyId: studyLegacy.study.id,
      versionNumber: 1,
      orgId,
    });
    if (ctxL?.resolvedSelectedMeterId && ctxL?.energyLead) {
      ok("TEST 5 — étude sans selected explicite → repli compteur défaut, pas de crash");
    } else fail("TEST 5", new Error("ctx null"));

    const snap = buildMeterSnapshotRecord({
      meterRow: ctxA.meterRow,
      energyLead: ctxA.energyLead,
      resolvedSelectedMeterId: ctxA.resolvedSelectedMeterId,
    });
    if (snap.selected_meter_id && snap.consumption_annual_kwh != null) {
      ok("TEST 6 — snapshot sérialisable (fige champs clés)");
    } else fail("TEST 6", new Error(JSON.stringify(snap)));

    await pool.query(
      `UPDATE lead_meters SET consumption_annual_kwh = 7777 WHERE id = $1`,
      [idA]
    );
    const ctxAfterEdit = await resolveStudyVersionMeterContext(pool, {
      studyId: sid1,
      versionNumber: 1,
      orgId,
    });
    if (ctxAfterEdit?.energyLead?.consumption_annual_kwh === 7777) {
      ok("TEST 6b — compteur vivant : recalcul relit la valeur à jour (attendu hors lock)");
    } else fail("TEST 6b", new Error(String(ctxAfterEdit?.energyLead?.consumption_annual_kwh)));

    console.log(`\nRésultat: ${passed} OK, ${failed} échecs\n`);
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await cleanup(ids);
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  pool.end();
});
