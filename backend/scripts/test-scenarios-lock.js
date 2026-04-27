/**
 * Tests de non-régression — flux Scénarios V2 + lock.
 * TEST 1: GET /scenarios sans scenarios_v2 → 404 SCENARIOS_NOT_GENERATED
 * TEST 2: POST validate-devis-technique → SCENARIOS_GENERATED
 * TEST 3: POST select-scenario → SCENARIO_SELECTED_AND_LOCKED
 * TEST 4: POST validate-devis-technique après lock → 400 LOCKED_VERSION
 * TEST 5: POST select-scenario après lock → 400 LOCKED_VERSION
 *
 * Usage: cd backend && node scripts/test-scenarios-lock.js
 * Prérequis: DATABASE_URL (.env.dev), migrations à jour (dont 1771162300000_study_versions_locked_at)
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.env.SKIP_PDF_IN_SELECT_SCENARIO = "1";

import { pool } from "../config/db.js";
import { getStudyScenarios } from "../controllers/studyScenarios.controller.js";
import { validateDevisTechnique } from "../controllers/validateDevisTechnique.controller.js";
import { selectScenario } from "../controllers/selectScenario.controller.js";

const TEST_PREFIX = "SCNLOCK";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
    [`${TEST_PREFIX}-Org-${Date.now()}`]
  );
  return ins.rows[0].id;
}

function minimalGeometryWithPanels() {
  return {
    roofState: { gps: { lat: 48.8566, lon: 2.3522 } },
    gps: { lat: 48.8566, lon: 2.3522 },
    validatedRoofData: {
      pans: [{ id: "PAN_1", orientationDeg: 180, tiltDeg: 30, panelCount: 6, surfaceM2: 20 }],
      scale: 1,
      north: 0,
    },
    pvParams: { panelSpec: { powerWc: 500 } },
    frozenBlocks: [
      {
        id: "b1",
        panels: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, center: { x: 100, y: 100 }, state: "placed" })),
      },
    ],
    shading: { normalized: { totalLossPct: 5 }, totalLossPct: 5 },
  };
}

async function createFullFixture(orgId) {
  let stageId = (
    await pool.query(
      "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
      [orgId]
    )
  ).rows[0]?.id;
  if (!stageId) {
    const ins = await pool.query(
      `INSERT INTO pipeline_stages (organization_id, name, position, is_closed) VALUES ($1, 'Qualification', 0, false) RETURNING id`,
      [orgId]
    );
    stageId = ins.rows[0].id;
  }

  const addrRes = await pool.query(
    `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'Paris', 48.8566, 2.3522, 'FR') RETURNING id`,
    [orgId]
  );
  const addressId = addrRes.rows[0].id;

  const leadRes = await pool.query(
    `INSERT INTO leads (organization_id, stage_id, first_name, last_name, full_name, email, site_address_id, consumption_mode, consumption_annual_kwh)
     VALUES ($1, $2, 'Test', 'ScenarioLock', 'Test ScenarioLock', 'scnlock@test.local', $3, 'ANNUAL', 5000) RETURNING id`,
    [orgId, stageId, addressId]
  );
  const leadId = leadRes.rows[0].id;

  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status, current_version)
     VALUES ($1, $2, $3, 'draft', 1) RETURNING id`,
    [orgId, leadId, `${TEST_PREFIX}-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;

  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
     VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
    [orgId, studyId]
  );
  const versionId = versionRes.rows[0].id;

  const geometry = minimalGeometryWithPanels();
  await pool.query(
    `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
     VALUES ($1, $2, $3::jsonb, 6, 3, 3500, 5)
     ON CONFLICT (study_version_id) DO UPDATE SET geometry_json = EXCLUDED.geometry_json, total_panels = 6`,
    [orgId, versionId, JSON.stringify(geometry)]
  );

  const snapshotJson = {
    meta: { snapshotSchemaVersion: 1 },
    payload: { ...geometry, gps: { lat: 48.8566, lon: 2.3522 } },
  };
  await pool.query(
    `INSERT INTO calpinage_snapshots (study_id, study_version_id, organization_id, version_number, snapshot_json, is_active)
     VALUES ($1, $2, $3, 1, $4::jsonb, true)`,
    [studyId, versionId, orgId, JSON.stringify(snapshotJson)]
  );

  await pool.query(
    `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, is_active)
     VALUES ($1, $2, $3, 1, 'DRAFT', $4::jsonb, true)`,
    [studyId, versionId, orgId, JSON.stringify({ capex_total_ttc: 18000 })]
  );

  return { orgId, studyId, versionId, leadId, addressId };
}

async function cleanup(ids) {
  if (!ids) return;
  try {
    await pool.query("DELETE FROM economic_snapshots WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM calpinage_snapshots WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM calpinage_data WHERE study_version_id = $1", [ids.versionId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [ids.studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [ids.studyId]);
    await pool.query("DELETE FROM leads WHERE id = $1", [ids.leadId]);
    await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
  } catch (e) {
    console.warn("  ⚠ Cleanup:", e.message);
  }
}

function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
    get captured() {
      return out;
    },
  };
}

let ids = null;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant (.env.dev)");
    process.exit(1);
  }

  try {
    const orgId = await getOrCreateOrg();
    ids = await createFullFixture(orgId);
  } catch (e) {
    console.error("❌ Setup fixtures:", e.message);
    process.exit(1);
  }

  const { studyId, versionId, orgId } = ids;
  const baseReq = {
    params: { studyId, versionId },
    user: { organizationId: orgId },
  };

  console.log("\n=== SCENARIOS LOCK — TESTS DE NON-RÉGRESSION ===\n");

  // —— TEST 1 — Version sans scenarios_v2 → GET /scenarios → 404 SCENARIOS_NOT_GENERATED
  try {
    const res1 = mockRes();
    await getStudyScenarios({ ...baseReq }, res1);
    assert(res1.captured.statusCode === 404, "TEST 1: attendu 404");
    assert(res1.captured.body?.error === "SCENARIOS_NOT_GENERATED", "TEST 1: attendu error SCENARIOS_NOT_GENERATED");
    console.log("TEST 1 OK — GET /scenarios sans scenarios_v2 → 404 SCENARIOS_NOT_GENERATED");
  } catch (e) {
    console.error("TEST 1 FAIL:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  // —— TEST 2 — POST validate-devis-technique → SCENARIOS_GENERATED
  try {
    const res2 = mockRes();
    await validateDevisTechnique({ ...baseReq }, res2);
    const ok2 = (res2.captured.statusCode === 200 || res2.captured.statusCode == null) && res2.captured.body?.status === "SCENARIOS_GENERATED";
    assert(ok2, "TEST 2: attendu 200 et status SCENARIOS_GENERATED, reçu " + res2.captured.statusCode + " / " + JSON.stringify(res2.captured.body?.status));
    console.log("TEST 2 OK — POST validate-devis-technique → SCENARIOS_GENERATED");
  } catch (e) {
    console.error("TEST 2 FAIL:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  // —— TEST 3 — POST select-scenario → SCENARIO_SELECTED_AND_LOCKED
  try {
    const res3 = mockRes();
    await selectScenario(
      { ...baseReq, body: { scenario_id: "BASE" } },
      res3
    );
    const ok3 = (res3.captured.statusCode === 200 || res3.captured.statusCode == null) && res3.captured.body?.status === "SCENARIO_SELECTED_AND_LOCKED";
    assert(ok3, "TEST 3: attendu 200 et status SCENARIO_SELECTED_AND_LOCKED, reçu " + res3.captured.statusCode);
    console.log("TEST 3 OK — POST select-scenario → SCENARIO_SELECTED_AND_LOCKED");
  } catch (e) {
    console.error("TEST 3 FAIL:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  // —— TEST 4 — Tentative recalcul après lock → 400 LOCKED_VERSION
  try {
    const res4 = mockRes();
    await validateDevisTechnique({ ...baseReq }, res4);
    assert(res4.captured.statusCode === 400, "TEST 4: attendu 400, reçu " + res4.captured.statusCode);
    assert(res4.captured.body?.error === "LOCKED_VERSION", "TEST 4: attendu error LOCKED_VERSION");
    console.log("TEST 4 OK — POST validate-devis-technique après lock → 400 LOCKED_VERSION");
  } catch (e) {
    console.error("TEST 4 FAIL:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  // —— TEST 5 — Tentative reselection → 400 LOCKED_VERSION
  try {
    const res5 = mockRes();
    await selectScenario(
      { ...baseReq, body: { scenario_id: "BATTERY_PHYSICAL" } },
      res5
    );
    assert(res5.captured.statusCode === 400, "TEST 5: attendu 400, reçu " + res5.captured.statusCode);
    assert(res5.captured.body?.error === "LOCKED_VERSION", "TEST 5: attendu error LOCKED_VERSION");
    console.log("TEST 5 OK — POST select-scenario après lock → 400 LOCKED_VERSION");
  } catch (e) {
    console.error("TEST 5 FAIL:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  console.log("\nALL SCENARIO LOCK TESTS PASSED\n");
  await cleanup(ids);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  if (ids) cleanup(ids).catch(() => {});
  process.exit(1);
});
