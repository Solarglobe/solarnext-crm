/**
 * D1 — Test automatisé : scenarios_v2 doit contenir exactement 3 scénarios (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL).
 * 1) Crée une study + version + calpinage + economic_snapshot avec config batterie physique + virtuelle activées.
 * 2) Appelle validate-devis-technique.
 * 3) Vérifie en DB que data_json.scenarios_v2.length === 3 et ids = BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL.
 * 4) exit(1) si pas 3.
 *
 * Usage: cd backend && node scripts/test-scenarios-3.js
 */

import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../.env"), override: false });

import { pool } from "../config/db.js";
import { validateDevisTechnique } from "../controllers/validateDevisTechnique.controller.js";

const PREFIX = "SCN3";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
    [`${PREFIX}-Org-${Date.now()}`]
  );
  return ins.rows[0].id;
}

async function createFixtureWithBatteries(orgId) {
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
     VALUES ($1, $2, 'Test', 'Scenarios3', 'Test Scenarios3', 'scn3@test.local', $3, 'ANNUAL', 5000) RETURNING id`,
    [orgId, stageId, addressId]
  );
  const leadId = leadRes.rows[0].id;

  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, lead_id, study_number, status, current_version)
     VALUES ($1, $2, $3, 'draft', 1) RETURNING id`,
    [orgId, leadId, `${PREFIX}-${Date.now()}`]
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

  const economicConfig = {
    capex_total_ttc: 18000,
    battery: {
      capacity_kwh: 10,
      roundtrip_efficiency: 0.9,
      max_charge_kw: 5,
      max_discharge_kw: 5,
    },
    virtual_battery: {
      enabled: true,
      annual_subscription_ttc: 480,
    },
  };

  await pool.query(
    `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, is_active)
     VALUES ($1, $2, $3, 1, 'DRAFT', $4::jsonb, true)`,
    [studyId, versionId, orgId, JSON.stringify(economicConfig)]
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
    if (ids.addressId) await pool.query("DELETE FROM addresses WHERE id = $1", [ids.addressId]);
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

const EXPECTED_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  let ids = null;
  try {
    const orgId = await getOrCreateOrg();
    ids = await createFixtureWithBatteries(orgId);
  } catch (e) {
    console.error("❌ Setup fixture:", e.message);
    process.exit(1);
  }

  const { studyId, versionId, orgId } = ids;
  const res = mockRes();
  try {
    await validateDevisTechnique(
      { params: { studyId, versionId }, user: { organizationId: orgId } },
      res
    );
  } catch (e) {
    console.error("❌ validate-devis-technique:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  if (res.captured.statusCode >= 400) {
    console.error("❌ validate-devis-technique a répondu", res.captured.statusCode, res.captured.body);
    await cleanup(ids);
    process.exit(1);
  }

  const row = await pool.query(
    "SELECT data_json FROM study_versions WHERE id = $1",
    [versionId]
  );
  const dataJson = row.rows[0]?.data_json ?? {};
  const scenariosV2 = dataJson.scenarios_v2;

  if (!Array.isArray(scenariosV2)) {
    console.error("FAIL: scenarios_v2 absent ou non-tableau");
    await cleanup(ids);
    process.exit(1);
  }

  const actualIds = scenariosV2.map((s) => s?.id).filter(Boolean);
  const hasAllThree = EXPECTED_IDS.every((id) => actualIds.includes(id));
  const countOk = scenariosV2.length === 3;

  if (!countOk || !hasAllThree) {
    console.error("FAIL: expected 3 scenarios with ids BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL");
    console.error("  got length:", scenariosV2.length, "ids:", actualIds);
    await cleanup(ids);
    process.exit(1);
  }

  console.log("PASS: 3 scenarios present (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL)");
  await cleanup(ids);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
