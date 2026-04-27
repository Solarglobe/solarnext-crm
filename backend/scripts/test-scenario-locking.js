/**
 * PROMPT 8 — Tests persistance + gel du scénario sélectionné.
 * Test 1 : sélectionner scénario → is_locked === true
 * Test 2 : tenter recalcul → 409
 * Test 3 : fork → nouvelle version créée, ancienne intacte, nouvelle unlocked
 *
 * Usage: cd backend && node scripts/test-scenario-locking.js
 * Prérequis : migration 1771162200000_study_versions_scenario_lock appliquée, DATABASE_URL (.env.dev)
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Évite la génération PDF (Playwright) pendant les tests
process.env.SKIP_PDF_IN_SELECT_SCENARIO = "1";

import { pool } from "../config/db.js";
import { getVersionById } from "../routes/studies/service.js";
import { selectScenario } from "../controllers/selectScenario.controller.js";
import { runStudy } from "../controllers/runStudy.controller.js";
import { forkStudyVersion as forkController } from "../controllers/forkStudyVersion.controller.js";

const SCENARIOS_V2 = [
  { id: "BASE", label: "Sans batterie", energy: {}, finance: {}, capex: {}, hardware: {}, shading: {}, production: {}, assumptions: {}, computed_at: new Date().toISOString() },
];

function mockReq(studyId, versionId, orgId, body = {}) {
  return {
    params: { studyId, versionId },
    body,
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

async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO organizations (name, slug) VALUES ('Test Scenario Lock', 'test-scenario-lock') RETURNING id`
  );
  return ins.rows[0].id;
}

async function createStudyWithScenariosV2(orgId) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `SCLOCK-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const dataJson = { scenarios_v2: SCENARIOS_V2 };
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json)
     VALUES ($1, $2, 1, $3::jsonb) RETURNING id`,
    [orgId, studyId, JSON.stringify(dataJson)]
  );
  return { studyId, versionId: versionRes.rows[0].id };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant (.env.dev)");
    process.exit(1);
  }

  let orgId, studyId, versionId;

  try {
    orgId = await getOrCreateOrg();
    const created = await createStudyWithScenariosV2(orgId);
    studyId = created.studyId;
    versionId = created.versionId;
    console.log("Données de test : orgId, studyId, versionId", orgId, studyId, versionId);
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  // ——— Test 1 : sélectionner scénario → is_locked === true ———
  try {
    const { res } = mockRes();
    await selectScenario(mockReq(studyId, versionId, orgId, { scenario_id: "BASE" }), res);
    const v = await getVersionById(versionId, orgId);
    if (v && v.is_locked === true && v.selected_scenario_id === "BASE") {
      passed++;
      console.log("✔ Test 1 — Sélection scénario → is_locked === true, selected_scenario_id === BASE");
    } else {
      failed++;
      console.log("✖ Test 1 — Attendu is_locked true et selected_scenario_id BASE, reçu:", v);
    }
  } catch (e) {
    failed++;
    console.log("✖ Test 1 —", e.message);
  }

  // ——— Test 2 : tenter recalcul → 409 ———
  try {
    const { res, captured } = mockRes();
    await runStudy(mockReq(studyId, versionId, orgId), res);
    if (captured.statusCode === 409 && captured.body?.error === "STUDY_VERSION_LOCKED") {
      passed++;
      console.log("✔ Test 2 — Recalcul sur version verrouillée → 409 STUDY_VERSION_LOCKED");
    } else {
      failed++;
      console.log("✖ Test 2 — Attendu 409 STUDY_VERSION_LOCKED, reçu:", captured.statusCode, captured.body);
    }
  } catch (e) {
    failed++;
    console.log("✖ Test 2 —", e.message);
  }

  // ——— Test 3 : fork → nouvelle version créée, ancienne intacte, nouvelle unlocked ———
  try {
    const { res, captured } = mockRes();
    await forkController(mockReq(studyId, versionId, orgId), res);
    if (captured.statusCode !== 201 || !captured.body?.id) {
      failed++;
      console.log("✖ Test 3 — Fork attendu 201 + id, reçu:", captured.statusCode, captured.body);
    } else {
      const newVersionId = captured.body.id;
      const oldVersion = await getVersionById(versionId, orgId);
      const newVersion = await getVersionById(newVersionId, orgId);
      if (
        oldVersion?.is_locked === true &&
        newVersion?.is_locked === false &&
        newVersion?.selected_scenario_id == null
      ) {
        passed++;
        console.log("✔ Test 3 — Fork : ancienne version intacte (locked), nouvelle déverrouillée");
      } else {
        failed++;
        console.log("✖ Test 3 — Ancienne locked?", oldVersion?.is_locked, "Nouvelle unlocked?", !newVersion?.is_locked, "Nouvelle selected_scenario_id null?", newVersion?.selected_scenario_id);
      }
    }
  } catch (e) {
    failed++;
    console.log("✖ Test 3 —", e.message);
  }

  // Nettoyage
  try {
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyId]);
  } catch (_) {}

  console.log("\nRésultat :", passed, "passés,", failed, "échoués");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
