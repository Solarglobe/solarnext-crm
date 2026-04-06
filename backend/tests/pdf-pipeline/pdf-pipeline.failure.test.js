/**
 * PDF V2 — Failure Tests
 * TEST 2: Snapshot absent → 400 SCENARIO_SNAPSHOT_REQUIRED
 * TEST 2b: studyId absent → 400 (CP-PDF-V2-018)
 * TEST 2c: versionId absent → 400 (CP-PDF-V2-018)
 * TEST 3: Auth manquante → 401
 * TEST 4: Version verrouillée → 400 LOCKED_VERSION
 * TEST 5: Timeout renderer → 500 PDF_RENDER_TIMEOUT
 * TEST 6: Erreur Playwright → 500 PDF_RENDER_FAILED
 */
import "./setup.js";
import { pool } from "../../config/db.js";
import { selectScenario } from "../../controllers/selectScenario.controller.js";
import { generatePdf } from "../../controllers/pdfGeneration.controller.js";
import * as pdfGenService from "../../services/pdfGeneration.service.js";
import {
  getOrCreateOrg,
  createStudyWithSnapshot,
  createStudyForSelectScenario,
  createLockedStudy,
  mockReq,
  mockRes,
} from "./fixtures.js";

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`✔ ${name}`);
}

function fail(name, msg) {
  failed++;
  console.log(`✖ ${name} — ${msg}`);
}

async function cleanupStudy(studyId) {
  try {
    const docs = await pool.query(
      `SELECT storage_key FROM entity_documents WHERE entity_type = 'study_version' AND entity_id IN (SELECT id FROM study_versions WHERE study_id = $1)`,
      [studyId]
    );
    const { deleteFile } = await import("../../services/localStorage.service.js");
    for (const d of docs.rows) {
      try {
        await deleteFile(d.storage_key);
      } catch (_) {}
    }
    await pool.query(
      "DELETE FROM entity_documents WHERE entity_id IN (SELECT id FROM study_versions WHERE study_id = $1)",
      [studyId]
    );
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyId]);
  } catch (_) {}
}

async function runFailureTests() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  process.env.SKIP_PDF_IN_SELECT_SCENARIO = "0";
  let orgId, studyIdNoSnap, versionIdNoSnap, studyIdWithSnap, versionIdWithSnap, studyIdLocked, versionIdLocked, studyIdSel, versionIdSel;

  try {
    orgId = await getOrCreateOrg();
    const withSnap = await createStudyWithSnapshot(orgId);
    studyIdWithSnap = withSnap.studyId;
    versionIdWithSnap = withSnap.versionId;

    const studyRes = await pool.query(
      `INSERT INTO studies (organization_id, study_number, status, current_version)
       VALUES ($1, $2, 'draft', 1) RETURNING id`,
      [orgId, `PDF-NOSNAP-${Date.now()}`]
    );
    studyIdNoSnap = studyRes.rows[0].id;
    const versionRes = await pool.query(
      `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, is_locked)
       VALUES ($1, $2, 1, '{}'::jsonb, false) RETURNING id`,
      [orgId, studyIdNoSnap]
    );
    versionIdNoSnap = versionRes.rows[0].id;

    const locked = await createLockedStudy(orgId);
    studyIdLocked = locked.studyId;
    versionIdLocked = locked.versionId;

    const forSel = await createStudyForSelectScenario(orgId);
    studyIdSel = forSel.studyId;
    versionIdSel = forSel.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 2 — Snapshot absent ———
  try {
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyIdNoSnap, versionIdNoSnap, orgId), res);
    if (captured.statusCode === 400 && captured.body?.error === "SCENARIO_SNAPSHOT_REQUIRED") {
      pass("TEST 2 — Snapshot absent → 400 SCENARIO_SNAPSHOT_REQUIRED");
    } else {
      fail("TEST 2", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 2", e.message);
  }

  // ——— TEST 2b — studyId absent (CP-PDF-V2-018) ———
  try {
    const { res, captured } = mockRes();
    await generatePdf(mockReq("", versionIdWithSnap, orgId), res);
    if (captured.statusCode === 400 && captured.body?.error === "studyId et versionId requis") {
      pass("TEST 2b — studyId absent → 400, pas de PDF");
    } else {
      fail("TEST 2b", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 2b", e.message);
  }

  // ——— TEST 2c — versionId absent (CP-PDF-V2-018) ———
  try {
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyIdWithSnap, "", orgId), res);
    if (captured.statusCode === 400 && captured.body?.error === "studyId et versionId requis") {
      pass("TEST 2c — versionId absent → 400, pas de PDF");
    } else {
      fail("TEST 2c", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 2c", e.message);
  }

  // ——— TEST 3 — Auth manquante ———
  try {
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyIdWithSnap, versionIdWithSnap, null), res);
    if (captured.statusCode === 401) {
      pass("TEST 3 — Auth manquante → 401");
    } else {
      fail("TEST 3", `Reçu: ${captured.statusCode}`);
    }
  } catch (e) {
    fail("TEST 3", e.message);
  }

  // ——— TEST 4 — Version verrouillée ———
  try {
    const { res, captured } = mockRes();
    await selectScenario(mockReq(studyIdLocked, versionIdLocked, orgId, { scenario_id: "BASE" }), res);
    if (captured.statusCode === 400 && captured.body?.error === "LOCKED_VERSION") {
      pass("TEST 4 — Version verrouillée → 400 LOCKED_VERSION");
    } else {
      fail("TEST 4", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 4", e.message);
  }

  // ——— TEST 5 — Timeout renderer ———
  try {
    const timeoutErr = new Error("Timeout 30000ms exceeded");
    timeoutErr.code = "PDF_RENDER_TIMEOUT";
    const mockGenerate = () => Promise.reject(timeoutErr);
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyIdWithSnap, versionIdWithSnap, orgId), res, {
      generatePdfFromRendererUrl: mockGenerate,
      getRendererUrl: pdfGenService.getRendererUrl,
    });
    if (captured.statusCode === 500 && captured.body?.error === "PDF_RENDER_TIMEOUT") {
      const vRow = await pool.query(
        `SELECT selected_scenario_snapshot FROM study_versions WHERE id = $1`,
        [versionIdWithSnap]
      );
      const snapshotIntact = vRow.rows[0]?.selected_scenario_snapshot != null;
      if (snapshotIntact) {
        pass("TEST 5 — Timeout renderer → 500 PDF_RENDER_TIMEOUT, snapshot intact");
      } else {
        fail("TEST 5", "Snapshot modifié après timeout");
      }
    } else {
      fail("TEST 5", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 5", e.message);
  }

  // ——— TEST 6 — Erreur Playwright ———
  try {
    const crashErr = new Error("Browser closed");
    crashErr.code = "PDF_RENDER_FAILED";
    const mockGenerate = () => Promise.reject(crashErr);
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyIdWithSnap, versionIdWithSnap, orgId), res, {
      generatePdfFromRendererUrl: mockGenerate,
      getRendererUrl: pdfGenService.getRendererUrl,
    });
    if (captured.statusCode === 500 && captured.body?.error === "PDF_RENDER_FAILED") {
      pass("TEST 6 — Erreur Playwright → 500 PDF_RENDER_FAILED");
    } else {
      fail("TEST 6", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 6", e.message);
  }

  await cleanupStudy(studyIdNoSnap);
  await cleanupStudy(studyIdWithSnap);
  await cleanupStudy(studyIdLocked);
  await cleanupStudy(studyIdSel);
  return { passed, failed };
}

export { runFailureTests };
