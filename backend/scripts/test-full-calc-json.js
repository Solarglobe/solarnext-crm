/**
 * TEST END-TO-END JSON ENGINE V2
 * Vérifie en conditions réelles :
 * - Moteur retourne un JSON complet
 * - scenarios_v2 généré et persisté dans study_versions.data_json
 * - Structure stable (10 blocs), aucun undefined, cohérence énergie/finance
 *
 * Usage: cd backend && node scripts/test-full-calc-json.js
 * Prérequis: .env.dev (DATABASE_URL), migrations à jour
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
import { runStudy } from "../controllers/runStudy.controller.js";

const TEST_PREFIX = "FULLCALC";
const ENERGY_TOLERANCE = 10;

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
  let stageId = (await pool.query(
    "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
    [orgId]
  )).rows[0]?.id;
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
     VALUES ($1, $2, 'Test', 'FullCalc', 'Test FullCalc', 'fullcalc@test.local', $3, 'ANNUAL', 5000) RETURNING id`,
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

function noUndefined(obj, path = "root") {
  if (obj === undefined) return [path];
  if (obj === null || typeof obj !== "object") return [];
  const out = [];
  for (const k of Object.keys(obj)) {
    out.push(...noUndefined(obj[k], path ? `${path}.${k}` : k));
  }
  return out;
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
  const captured = { statusCode: null, body: null };
  const req = {
    params: { studyId, versionId },
    user: { organizationId: orgId },
  };
  const res = {
    status(code) { captured.statusCode = code; return this; },
    json(data) { captured.body = data; return this; },
  };

  try {
    await runStudy(req, res);
  } catch (e) {
    console.error("❌ run-study:", e.message);
    await cleanup(ids);
    process.exit(1);
  }

  console.log("\n=== ENGINE V2 JSON CHECK ===\n");
  console.log("Status HTTP:", captured.statusCode ?? "(implicite 200)");
  console.log("Response body (keys):", captured.body ? Object.keys(captured.body) : "null");

  const httpOk = captured.statusCode === 200 || (captured.statusCode == null && captured.body?.ok === true);
  if (!httpOk) {
    console.error("❌ Attendu 200, reçu", captured.statusCode, captured.body?.error || "");
    await cleanup(ids);
    process.exit(1);
  }

  assert(captured.body?.ok === true, "body.ok doit être true");
  console.log("  ✔ body.ok === true");
  console.log("  ✔ Présence summary:", !!captured.body?.summary);

  const row = (await pool.query(
    "SELECT data_json FROM study_versions WHERE id = $1",
    [versionId]
  )).rows[0];
  assert(row != null, "study_versions.data_json introuvable après run-study");
  const dataJson = row.data_json || {};
  const scenariosV2 = dataJson.scenarios_v2;

  assert(Array.isArray(scenariosV2), "data_json.scenarios_v2 doit être un tableau");
  assert(scenariosV2.length >= 1, "scenarios_v2.length >= 1");
  console.log("  ✔ scenarios_v2 présent dans data_json");
  console.log("  Scenarios returned:", scenariosV2.length);
  console.log("  Ids:", scenariosV2.map((s) => s.id).join(" | "));

  for (const sc of scenariosV2) {
    assert(sc.id != null, "sc.id manquant");
    assert(sc.label != null, "sc.label manquant");
    assert(sc.energy != null, "sc.energy manquant");
    assert(sc.finance != null, "sc.finance manquant");
    assert(sc.capex != null, "sc.capex manquant");
    assert(sc.hardware != null, "sc.hardware manquant");
    assert(sc.shading != null, "sc.shading manquant");
    assert(sc.production != null, "sc.production manquant");
    assert(sc.assumptions != null, "sc.assumptions manquant");
    assert(sc.computed_at != null, "sc.computed_at manquant");
  }
  console.log("  ✔ Chaque scénario V2 contient les 10 blocs obligatoires");

  const undef = noUndefined(scenariosV2);
  assert(undef.length === 0, "Champs undefined dans scenarios_v2: " + undef.join(", "));
  console.log("  ✔ Aucun champ undefined");

  for (const sc of scenariosV2) {
    const at = sc.computed_at;
    assert(typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(at), "computed_at doit être ISO valide");
  }
  console.log("  ✔ computed_at ISO valide");

  for (const sc of scenariosV2) {
    assert(sc.finance && (sc.finance.roi_years === null || typeof sc.finance.roi_years === "number"), "finance.roi_years présent (ou null)");
    assert(sc.capex && typeof sc.capex === "object", "capex objet");
  }
  console.log("  ✔ roi_years présent (ou null), capex cohérent");

  const dbScenarios = (await pool.query(
    "SELECT data_json->'scenarios_v2' AS scenarios_v2 FROM study_versions WHERE id = $1",
    [versionId]
  )).rows[0]?.scenarios_v2;
  assert(dbScenarios != null, "Persistence: data_json->'scenarios_v2' existe");
  const dbArr = Array.isArray(dbScenarios) ? dbScenarios : (typeof dbScenarios === "object" && dbScenarios !== null ? [dbScenarios] : []);
  assert(dbArr.length === scenariosV2.length, "Persistence: taille identique API vs DB");
  const apiIds = scenariosV2.map((s) => s.id).sort();
  const dbIds = dbArr.map((s) => s?.id).filter(Boolean).sort();
  assert(apiIds.length === dbIds.length && apiIds.every((id, i) => id === dbIds[i]), "Persistence: les ids correspondent");
  console.log("  ✔ Persistence OK (taille et ids)");

  for (const sc of scenariosV2) {
    const prod = sc.energy?.production_kwh;
    const auto = sc.energy?.autoconsumption_kwh;
    const surplus = sc.energy?.surplus_kwh;
    const batteryLosses = sc.energy?.battery_losses_kwh ?? 0;
    if (prod != null && auto != null && surplus != null && Number.isFinite(prod)) {
      const sum = (Number(auto) || 0) + (Number(surplus) || 0) + (Number(batteryLosses) || 0);
      const diff = Math.abs(prod - sum);
      assert(diff < ENERGY_TOLERANCE, `Energy coherence: production_kwh (${prod}) ≠ auto (${auto}) + surplus (${surplus}) + battery_losses (${batteryLosses}), diff=${diff}`);
    }
  }
  console.log("  ✔ Energy coherence OK (tolérance " + ENERGY_TOLERANCE + ")");

  for (const sc of scenariosV2) {
    const capexTtc = sc.capex?.total_ttc;
    const fin = sc.finance || {};
    if (capexTtc !== null && capexTtc !== undefined) {
      assert(typeof fin.roi_years === "number" || fin.roi_years === null, "Si capex non null: roi_years number ou null");
      assert("annual_cashflows" in fin, "Si capex non null: annual_cashflows doit exister");
    } else {
      assert(fin.roi_years == null, "Si capex null: roi_years null");
      assert(fin.annual_cashflows == null || (Array.isArray(fin.annual_cashflows) && fin.annual_cashflows.length === 0), "Si capex null: annual_cashflows null ou vide");
    }
  }
  console.log("  ✔ Finance coherence OK");

  console.log("\nENGINE V2 JSON CHECK — OK");
  console.log("Scenarios returned:", scenariosV2.length);
  console.log("Persistence OK");
  console.log("Energy coherence OK");
  console.log("Finance coherence OK\n");

  await cleanup(ids);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  if (ids) cleanup(ids).catch(() => {});
  process.exit(1);
});
