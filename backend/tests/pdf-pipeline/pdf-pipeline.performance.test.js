/**
 * PDF V2 — Performance & Memory Tests
 * TEST 12: Temps génération PDF < 5 secondes
 * TEST 13: Memory leaks (20 générations, pas de zombie)
 */
import "./setup.js";
import { pool } from "../../config/db.js";
import { generatePdf } from "../../controllers/pdfGeneration.controller.js";
import {
  getOrCreateOrg,
  createStudyWithSnapshot,
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

async function runPerformanceTests() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  let orgId, studyId, versionId;

  try {
    orgId = await getOrCreateOrg();
    const created = await createStudyWithSnapshot(orgId);
    studyId = created.studyId;
    versionId = created.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 12 — Performance ———
  try {
    const start = Date.now();
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyId, versionId, orgId), res);
    const elapsed = Date.now() - start;

    if (captured.statusCode === 200 && captured.body?.success && elapsed < 5000) {
      pass(`TEST 12 — Performance (génération ${elapsed}ms < 5s)`);
    } else if (captured.statusCode === 200 && captured.body?.success) {
      fail("TEST 12", `Trop lent: ${elapsed}ms (attendu < 5s)`);
    } else {
      fail("TEST 12", `Échec génération: ${captured.body?.error ?? "unknown"}`);
    }
  } catch (e) {
    fail("TEST 12", e.message);
  }

  // ——— TEST 13 — Memory leaks ———
  try {
    const memBefore = process.memoryUsage().heapUsed;
    const iterations = 20;

    for (let i = 0; i < iterations; i++) {
      const { res, captured } = mockRes();
      await generatePdf(mockReq(studyId, versionId, orgId), res);
      if (captured.statusCode !== 200 || !captured.body?.success) {
        throw new Error(`Génération ${i + 1} échouée`);
      }
    }

    if (typeof global.gc === "function") {
      global.gc();
    }
    const memAfter = process.memoryUsage().heapUsed;
    const growthMB = (memAfter - memBefore) / (1024 * 1024);

    const growthOk = growthMB < 100;
    if (growthOk) {
      pass(`TEST 13 — Memory (20 générations, croissance heap ${growthMB.toFixed(2)} MB)`);
    } else {
      fail("TEST 13", `Croissance heap excessive: ${growthMB.toFixed(2)} MB`);
    }
  } catch (e) {
    fail("TEST 13", e.message);
  }

  await cleanupStudy(studyId);
  return { passed, failed };
}

export { runPerformanceTests };
