/**
 * PDF V2 — Tests GET /api/studies/:studyId/versions/:versionId/pdf-view-model
 * TEST 1 — Snapshot présent → ok=true, viewModel sections présentes
 * TEST 2 — Snapshot absent → 404 SNAPSHOT_NOT_FOUND
 * TEST 3 — Version inexistante → 404 STUDY_VERSION_NOT_FOUND
 * TEST 4 — Cross organisation → 403 FORBIDDEN_CROSS_ORG
 * TEST 5 — Format stable : 12 sections (meta, client, project, …)
 *
 * Usage: cd backend && node scripts/test-pdf-viewmodel-api.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { getPdfViewModel } from "../controllers/getPdfViewModel.controller.js";

const VIEWMODEL_SECTIONS = [
  "meta",
  "client",
  "project",
  "site",
  "technical",
  "production",
  "economics",
  "financing",
  "savings",
  "selectedScenario",
  "company",
  "disclaimers",
];

function mockReq(studyId, versionId, orgId) {
  return {
    params: { studyId, versionId },
    user: { organizationId: orgId },
  };
}

function mockRes() {
  const captured = { statusCode: null, body: null };
  return {
    captured,
    res: {
      status(code) {
        captured.statusCode = code;
        return this;
      },
      json(data) {
        captured.body = data;
        return this;
      },
    },
  };
}

async function getOrCreateOrg(label = "A") {
  const r = await pool.query(
    "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1"
  );
  if (r.rows.length > 0 && label === "A") return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [`Test PDF ViewModel ${label}-${Date.now()}`]
  );
  return ins.rows[0].id;
}

function buildFullSnapshot() {
  return {
    scenario_type: "BASE",
    created_at: new Date().toISOString(),
    client: { nom: "Dupont", prenom: "Jean", adresse: "12 rue de la Paix", cp: "75001", ville: "Paris" },
    site: { lat: 48.85, lon: 2.35, orientation_deg: 180, tilt_deg: 30, puissance_compteur_kva: 9, type_reseau: "mono" },
    installation: { panneaux_nombre: 12, puissance_kwc: 5.82, production_annuelle_kwh: 7200, surface_panneaux_m2: null },
    equipment: {
      panneau: { marque: "LONGi", modele: "Hi-MO 5", puissance_wc: 485 },
      onduleur: { marque: "ATMOCE", modele: "Micro", quantite: 12 },
      batterie: { capacite_kwh: null, type: null },
    },
    shading: { total_loss_pct: 3.6 },
    energy: { production_kwh: 7200, consumption_kwh: 13000, autoconsumption_kwh: 3500, import_kwh: 9500, independence_pct: 26.9 },
    finance: { capex_ttc: 15000, economie_year_1: 850, roi_years: 12, irr_pct: 5.2, facture_restante: 2200, revenu_surplus: 148 },
    production: { annual_kwh: 7200, monthly_kwh: [320, 480, 620, 680, 720, 750, 740, 700, 580, 420, 350, 330] },
    cashflows: [],
    assumptions: {},
  };
}

async function createStudyWithVersion(orgId, withSnapshot = true) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `PDF-VM-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const snapshotJson = withSnapshot ? JSON.stringify(buildFullSnapshot()) : null;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, selected_scenario_id, selected_scenario_snapshot, is_locked)
     VALUES ($1, $2, 1, '{}'::jsonb, $3, $4::jsonb, $5) RETURNING id`,
    [orgId, studyId, withSnapshot ? "BASE" : null, snapshotJson, withSnapshot]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant (.env ou .env.dev)");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  let studyIdWith, versionIdWith, studyIdNo, versionIdNo, orgIdA, orgIdB, studyIdB, versionIdB;

  try {
    orgIdA = await getOrCreateOrg("A");
    const withSnap = await createStudyWithVersion(orgIdA, true);
    studyIdWith = withSnap.studyId;
    versionIdWith = withSnap.versionId;

    const noSnap = await createStudyWithVersion(orgIdA, false);
    studyIdNo = noSnap.studyId;
    versionIdNo = noSnap.versionId;

    orgIdB = await getOrCreateOrg("B");
    const createdB = await createStudyWithVersion(orgIdB, true);
    studyIdB = createdB.studyId;
    versionIdB = createdB.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 1 — Snapshot présent ———
  try {
    const { res, captured } = mockRes();
    await getPdfViewModel(mockReq(studyIdWith, versionIdWith, orgIdA), res);
    if (
      captured.statusCode === 200 &&
      captured.body?.ok === true &&
      typeof captured.body?.viewModel === "object" &&
      Object.keys(captured.body.viewModel).length > 0
    ) {
      passed++;
      console.log("TEST PASSED — Snapshot présent");
    } else {
      failed++;
      console.log("TEST FAILED — Snapshot présent. Reçu:", captured.statusCode, captured.body?.error ?? Object.keys(captured.body?.viewModel ?? {}));
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — Snapshot présent:", e.message);
  }

  // ——— TEST 2 — Snapshot absent ———
  try {
    const { res, captured } = mockRes();
    await getPdfViewModel(mockReq(studyIdNo, versionIdNo, orgIdA), res);
    if (
      captured.statusCode === 404 &&
      captured.body?.ok === false &&
      captured.body?.error === "SNAPSHOT_NOT_FOUND"
    ) {
      passed++;
      console.log("TEST PASSED — Snapshot absent");
    } else {
      failed++;
      console.log("TEST FAILED — Snapshot absent. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — Snapshot absent:", e.message);
  }

  // ——— TEST 3 — Version inexistante ———
  try {
    const fakeId = randomUUID();
    const { res, captured } = mockRes();
    await getPdfViewModel(mockReq(fakeId, fakeId, orgIdA), res);
    if (
      captured.statusCode === 404 &&
      captured.body?.ok === false &&
      captured.body?.error === "STUDY_VERSION_NOT_FOUND"
    ) {
      passed++;
      console.log("TEST PASSED — Version inexistante");
    } else {
      failed++;
      console.log("TEST FAILED — Version inexistante. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — Version inexistante:", e.message);
  }

  // ——— TEST 4 — Cross organisation ———
  try {
    const { res, captured } = mockRes();
    await getPdfViewModel(mockReq(studyIdB, versionIdB, orgIdA), res);
    if (
      captured.statusCode === 403 &&
      captured.body?.ok === false &&
      captured.body?.error === "FORBIDDEN_CROSS_ORG"
    ) {
      passed++;
      console.log("TEST PASSED — Cross organisation");
    } else {
      failed++;
      console.log("TEST FAILED — Cross organisation. Reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — Cross organisation:", e.message);
  }

  // ——— TEST 5 — Format stable (12 sections) ———
  try {
    const { res, captured } = mockRes();
    await getPdfViewModel(mockReq(studyIdWith, versionIdWith, orgIdA), res);
    const viewModel = captured.body?.viewModel;
    const missing = VIEWMODEL_SECTIONS.filter((s) => !(s in viewModel) || viewModel[s] == null);
    if (
      captured.statusCode === 200 &&
      captured.body?.ok === true &&
      viewModel &&
      missing.length === 0 &&
      Array.isArray(viewModel.production?.monthlyProduction) &&
      viewModel.production.monthlyProduction.length === 12
    ) {
      passed++;
      console.log("TEST PASSED — Format stable");
    } else {
      failed++;
      console.log("TEST FAILED — Format stable. Sections manquantes:", missing, "monthlyProduction length:", viewModel?.production?.monthlyProduction?.length);
    }
  } catch (e) {
    failed++;
    console.log("TEST FAILED — Format stable:", e.message);
  }

  // Nettoyage
  try {
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyIdWith]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyIdWith]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyIdNo]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyIdNo]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyIdB]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyIdB]);
  } catch (_) {}

  console.log("\nRésultat :", passed, "passés,", failed, "échoués");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
