/**
 * PDF V2 — Concurrency Test
 * TEST 7: 5 appels simultanés POST select-scenario → 1 snapshot, 1 PDF, pas de doublons
 */
import "./setup.js";
import { pool } from "../../config/db.js";
import { selectScenario } from "../../controllers/selectScenario.controller.js";
import {
  getOrCreateOrg,
  createStudyForSelectScenario,
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

async function runConcurrentTests() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  process.env.SKIP_PDF_IN_SELECT_SCENARIO = "0";
  let orgId, studyId, versionId;

  try {
    orgId = await getOrCreateOrg();
    const created = await createStudyForSelectScenario(orgId);
    studyId = created.studyId;
    versionId = created.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 7 — Concurrence ———
  try {
    const promises = Array.from({ length: 5 }, () => {
      const { res, captured } = mockRes();
      return selectScenario(mockReq(studyId, versionId, orgId, { scenario_id: "BASE" }), res).then(
        () => ({ ok: captured.statusCode === 200 && captured.body?.success, captured })
      );
    });

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.ok && r.captured.body?.pdfGenerated).length;
    const lockedCount = results.filter((r) => r.captured.body?.error === "LOCKED_VERSION" || (r.captured.statusCode === 400 && r.captured.body?.error === "LOCKED_VERSION")).length;

    const vRow = await pool.query(
      `SELECT selected_scenario_snapshot, selected_scenario_id FROM study_versions WHERE id = $1`,
      [versionId]
    );
    const snapshotCount = vRow.rows[0]?.selected_scenario_snapshot != null ? 1 : 0;

    const docRows = await pool.query(
      `SELECT id FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf'`,
      [versionId]
    );
    const pdfCount = docRows.rows.length;

    const oneSnapshot = snapshotCount === 1;
    const onePdf = pdfCount === 1;
    const noDuplicates = docRows.rows.length === new Set(docRows.rows.map((r) => r.id)).size;

    if (oneSnapshot && onePdf && noDuplicates && successCount === 1) {
      pass("TEST 7 — Concurrence (5 appels → 1 snapshot, 1 PDF, pas de doublons)");
    } else {
      fail(
        "TEST 7",
        `success=${successCount} locked=${lockedCount} snapshots=${snapshotCount} pdfs=${pdfCount} noDup=${noDuplicates}`
      );
    }
  } catch (e) {
    fail("TEST 7", e.message);
  }

  await cleanupStudy(studyId);
  return { passed, failed };
}

export { runConcurrentTests };
