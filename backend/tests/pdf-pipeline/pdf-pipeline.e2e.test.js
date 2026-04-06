/**
 * PDF V2 — E2E Pipeline Tests
 * TEST 1: Pipeline complet (select-scenario → snapshot → PDF → document)
 * TEST 8: Régénération PDF (2 documents)
 * TEST 9: Validité PDF
 * TEST 10: Intégrité document CRM
 * TEST 11: API documents pour UI CRM
 */
import "./setup.js";
import { pool } from "../../config/db.js";
import fs from "fs/promises";
import { selectScenario } from "../../controllers/selectScenario.controller.js";
import { generatePdf } from "../../controllers/pdfGeneration.controller.js";
import { getAbsolutePath } from "../../services/localStorage.service.js";
import {
  getOrCreateOrg,
  createStudyWithSnapshot,
  createStudyForSelectScenario,
  mockReq,
  mockRes,
  countPdfPages,
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
    await pool.query("DELETE FROM entity_documents WHERE entity_id IN (SELECT id FROM study_versions WHERE study_id = $1)", [studyId]);
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyId]);
  } catch (_) {}
}

async function runE2ETests() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  process.env.SKIP_PDF_IN_SELECT_SCENARIO = "0"; // Force PDF generation
  let orgId, studyId, versionId, studyIdSel, versionIdSel;

  try {
    orgId = await getOrCreateOrg();
    const withSnap = await createStudyWithSnapshot(orgId);
    studyId = withSnap.studyId;
    versionId = withSnap.versionId;
    const forSel = await createStudyForSelectScenario(orgId);
    studyIdSel = forSel.studyId;
    versionIdSel = forSel.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 1 — Pipeline complet ———
  try {
    const { res, captured } = mockRes();
    await selectScenario(mockReq(studyIdSel, versionIdSel, orgId, { scenario_id: "BASE" }), res);
    const body = captured.body;
    const ok =
      captured.statusCode === 200 &&
      body?.success === true &&
      body?.pdfGenerated === true &&
      typeof body?.documentId === "string" &&
      typeof body?.downloadUrl === "string";

    if (ok) {
      const vRow = await pool.query(
        `SELECT selected_scenario_snapshot FROM study_versions WHERE id = $1`,
        [versionIdSel]
      );
      const snapshotOk = vRow.rows[0]?.selected_scenario_snapshot != null;
      const docRow = await pool.query(
        `SELECT document_type FROM entity_documents WHERE id = $1`,
        [body.documentId]
      );
      const docOk = docRow.rows[0]?.document_type === "study_pdf";

      if (snapshotOk && docOk) {
        pass("TEST 1 — Pipeline complet (snapshot + PDF + document)");
      } else {
        fail("TEST 1", `snapshot=${snapshotOk} doc=${docOk}`);
      }
    } else {
      fail("TEST 1", `Réponse: ${JSON.stringify(body)}`);
    }
  } catch (e) {
    fail("TEST 1", e.message);
  }

  // ——— TEST 8 — Régénération PDF ———
  try {
    const { res: r1, captured: c1 } = mockRes();
    await generatePdf(mockReq(studyId, versionId, orgId), r1);
    const { res: r2, captured: c2 } = mockRes();
    await generatePdf(mockReq(studyId, versionId, orgId), r2);

    const id1 = c1.body?.documentId;
    const id2 = c2.body?.documentId;
    const rows = await pool.query(
      `SELECT id, file_name, created_at FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf' ORDER BY created_at DESC`,
      [versionId]
    );

    const twoDocs = rows.rows.length >= 2 && id1 !== id2;
    const namesDifferent = new Set(rows.rows.map((r) => r.file_name)).size >= 2;
    if (twoDocs && namesDifferent) {
      pass("TEST 8 — Régénération PDF (2 documents, noms différents)");
    } else {
      fail("TEST 8", `twoDocs=${twoDocs} namesDiff=${namesDifferent}`);
    }
  } catch (e) {
    fail("TEST 8", e.message);
  }

  // ——— TEST 9 — Validité PDF ———
  try {
    const rows = await pool.query(
      `SELECT storage_key FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf' LIMIT 1`,
      [versionId]
    );
    if (rows.rows.length === 0) {
      fail("TEST 9", "Aucun document");
    } else {
      const buf = await fs.readFile(getAbsolutePath(rows.rows[0].storage_key));
      const hasMagic = buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      const pages = countPdfPages(buf);
      const sizeOk = buf.length > 1000;
      if (hasMagic && sizeOk && pages >= 1) {
        pass(`TEST 9 — Validité PDF (%PDF-, size=${buf.length}, pages=${pages})`);
      } else {
        fail("TEST 9", `magic=${hasMagic} size=${buf.length} pages=${pages}`);
      }
    }
  } catch (e) {
    fail("TEST 9", e.message);
  }

  // ——— TEST 10 — Intégrité document CRM ———
  try {
    const rows = await pool.query(
      `SELECT entity_type, entity_id, document_type, storage_key FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf'`,
      [versionId]
    );
    let allOk = true;
    for (const r of rows.rows) {
      if (r.entity_type !== "study_version" || r.entity_id !== versionId || r.document_type !== "study_pdf") {
        allOk = false;
        break;
      }
      try {
        await fs.access(getAbsolutePath(r.storage_key));
      } catch (_) {
        allOk = false;
        break;
      }
    }
    if (allOk && rows.rows.length >= 1) {
      pass("TEST 10 — Intégrité document CRM (entity_type, entity_id, document_type, storage exists)");
    } else {
      fail("TEST 10", `allOk=${allOk} count=${rows.rows.length}`);
    }
  } catch (e) {
    fail("TEST 10", e.message);
  }

  // ——— TEST 11 — API documents pour UI CRM ———
  try {
    const docsRes = await pool.query(
      `SELECT id, file_name FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf' AND (archived_at IS NULL) ORDER BY created_at DESC`,
      [versionIdSel]
    );
    const hasDocs = docsRes.rows.length >= 1;
    if (hasDocs) {
      pass("TEST 11 — API documents study_version (UI CRM peut afficher Voir/Télécharger/Régénérer)");
    } else {
      fail("TEST 11", "Aucun document pour versionId");
    }
  } catch (e) {
    fail("TEST 11", e.message);
  }

  await cleanupStudy(studyId);
  await cleanupStudy(studyIdSel);
  return { passed, failed };
}

export { runE2ETests };
