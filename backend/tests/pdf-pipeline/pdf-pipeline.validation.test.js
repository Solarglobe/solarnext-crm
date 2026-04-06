/**
 * CP-PDF-V2-018 — Validation industrielle E2E du pipeline PDF V2 final
 *
 * TEST 5: Snapshot partiel → PDF généré, comportement stable, champs manquants cohérents
 * TEST 6: Preuve absence legacy — aucun /api/view/p*, aucun fichier legacy requis
 * TEST 7: Vérification document généré — taille, magic, contenu exploitable
 */
import "./setup.js";
import fs from "fs/promises";
import { pool } from "../../config/db.js";
import { generatePdf } from "../../controllers/pdfGeneration.controller.js";
import { getAbsolutePath } from "../../services/localStorage.service.js";
import {
  getOrCreateOrg,
  createStudyWithPartialSnapshot,
  createStudyWithSnapshot,
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
    await pool.query(
      "DELETE FROM entity_documents WHERE entity_id IN (SELECT id FROM study_versions WHERE study_id = $1)",
      [studyId]
    );
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyId]);
  } catch (_) {}
}

async function runValidationTests() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  process.env.SKIP_PDF_IN_SELECT_SCENARIO = "0";
  let orgId, studyIdPartial, versionIdPartial, studyIdFull, versionIdFull;

  try {
    orgId = await getOrCreateOrg();
    const partial = await createStudyWithPartialSnapshot(orgId);
    studyIdPartial = partial.studyId;
    versionIdPartial = partial.versionId;
    const full = await createStudyWithSnapshot(orgId);
    studyIdFull = full.studyId;
    versionIdFull = full.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 5 — Snapshot partiel : PDF généré, stable ———
  try {
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyIdPartial, versionIdPartial, orgId), res);
    const ok =
      captured.statusCode === 200 &&
      captured.body?.success === true &&
      typeof captured.body?.documentId === "string";

    if (ok) {
      const docRow = await pool.query(
        `SELECT storage_key FROM entity_documents WHERE id = $1`,
        [captured.body.documentId]
      );
      if (docRow.rows.length > 0) {
        const buf = await fs.readFile(getAbsolutePath(docRow.rows[0].storage_key));
        const hasMagic = buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
        const pages = countPdfPages(buf);
        const sizeOk = buf.length > 500;
        if (hasMagic && sizeOk && pages >= 1) {
          pass("TEST 5 — Snapshot partiel : PDF généré, stable, exploitable");
        } else {
          fail("TEST 5", `magic=${hasMagic} size=${buf.length} pages=${pages}`);
        }
      } else {
        fail("TEST 5", "Document non trouvé en base");
      }
    } else {
      fail("TEST 5", `Reçu: ${captured.statusCode} ${JSON.stringify(captured.body)}`);
    }
  } catch (e) {
    fail("TEST 5", e.message);
  }

  // ——— TEST 6 — Preuve absence legacy ———
  try {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const serverPath = join(__dirname, "server.js");
    const serverContent = readFileSync(serverPath, "utf-8");
    const hasLegacyView = /\/api\/view\/p\d|view\.routes|view\.controller|view-p\d\.js/.test(serverContent);

    const studiesRoutesPath = join(__dirname, "routes", "studies.routes.js");
    const studiesContent = readFileSync(studiesRoutesPath, "utf-8");
    const hasViewP = /\/api\/view\/p\d/.test(studiesContent);

    if (!hasLegacyView && !hasViewP) {
      pass("TEST 6 — Absence legacy : aucun /api/view/p*, aucun fichier legacy requis");
    } else {
      fail("TEST 6", `hasLegacyView=${hasLegacyView} hasViewP=${hasViewP}`);
    }
  } catch (e) {
    fail("TEST 6", e.message);
  }

  // ——— TEST 7 — Vérification document généré (données complètes) ———
  try {
    const { res: res7, captured: cap7 } = mockRes();
    await generatePdf(mockReq(studyIdFull, versionIdFull, orgId), res7);
    if (cap7.statusCode !== 200 || !cap7.body?.documentId) {
      fail("TEST 7", `Génération PDF échouée: ${cap7.statusCode} ${JSON.stringify(cap7.body)}`);
    } else {
    const rows = await pool.query(
      `SELECT storage_key FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf' ORDER BY created_at DESC LIMIT 1`,
      [versionIdFull]
    );
    if (rows.rows.length === 0) {
      fail("TEST 7", "Aucun document pour version complète");
    } else {
      const buf = await fs.readFile(getAbsolutePath(rows.rows[0].storage_key));
      const hasMagic = buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      const pages = countPdfPages(buf);
      const sizeOk = buf.length > 1000;
      const contentStr = buf.toString("utf-8", 0, Math.min(buf.length, 50000));
      const hasTestPipeline = contentStr.includes("Test") || contentStr.includes("Pipeline") || contentStr.includes("SolarNext");
      const noMojibake = !contentStr.includes("�") && !contentStr.includes("â€");

      if (hasMagic && sizeOk && pages >= 1 && (hasTestPipeline || !contentStr.includes("Saisissez"))) {
        if (noMojibake) {
          pass(`TEST 7 — Document exploitable (size=${buf.length}, pages=${pages}, pas de mojibake)`);
        } else {
          pass(`TEST 7 — Document exploitable (size=${buf.length}, pages=${pages}) — mojibake possible en données`);
        }
      } else {
        fail("TEST 7", `magic=${hasMagic} size=${buf.length} pages=${pages} hasContent=${hasTestPipeline}`);
      }
    }
    }
  } catch (e) {
    fail("TEST 7", e.message);
  }

  await cleanupStudy(studyIdPartial);
  await cleanupStudy(studyIdFull);
  return { passed, failed };
}

export { runValidationTests };
