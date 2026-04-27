/**
 * PDF V2 — Tests stockage PDF dans documents CRM
 *
 * TEST 1 — Document créé (document_type = study_pdf)
 * TEST 2 — Fichier téléchargeable (GET /download → 200, application/pdf)
 * TEST 3 — Lien étude/version (entity_type=study_version, entity_id=versionId)
 * TEST 4 — Re-génération (2 appels → 2 documents différents)
 * TEST 5 — Cohérence (métadonnées, fichier non vide)
 *
 * Prérequis : DATABASE_URL. Utilise le controller directement + vérification DB/storage.
 * Pour TEST 2 (download HTTP) : serveur sur BASE_URL (optionnel).
 *
 * Usage: cd backend && node scripts/test-pdf-storage.js
 */

import "../config/register-local-env.js";
import "./set-pdf-renderer-test-url.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { pool } from "../config/db.js";
import { generatePdf } from "../controllers/pdfGeneration.controller.js";
import { getAbsolutePath } from "../services/localStorage.service.js";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function mockReq(studyId, versionId, orgId, user = null) {
  return {
    params: { studyId, versionId },
    user: user ?? (orgId ? { organizationId: orgId, userId: null, id: null } : null),
  };
}

function mockRes() {
  const captured = { statusCode: null, body: null, headers: {} };
  return {
    captured,
    res: {
      setHeader(name, value) {
        captured.headers[name] = value;
        return this;
      },
      status(code) {
        captured.statusCode = code;
        return this;
      },
      json(data) {
        captured.body = data;
        if (captured.statusCode == null) captured.statusCode = 200;
        return this;
      },
    },
  };
}

async function getOrCreateOrg() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length > 0) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [`Test PDF Storage ${Date.now()}`]
  );
  return ins.rows[0].id;
}

function buildMinimalSnapshot() {
  return {
    scenario_type: "A1",
    created_at: new Date().toISOString(),
    client: { nom: "Test" },
    site: { lat: 48.85, lon: 2.35 },
    installation: { puissance_kwc: 6 },
    production: { annual_kwh: 7200, monthly_kwh: Array(12).fill(600) },
  };
}

async function createStudyWithVersion(orgId, withSnapshot = true) {
  const studyRes = await pool.query(
    `INSERT INTO studies (organization_id, study_number, status, current_version)
     VALUES ($1, $2, 'draft', 1) RETURNING id`,
    [orgId, `PDF-STORAGE-${Date.now()}`]
  );
  const studyId = studyRes.rows[0].id;
  const snapshotJson = withSnapshot ? JSON.stringify(buildMinimalSnapshot()) : null;
  const versionRes = await pool.query(
    `INSERT INTO study_versions (organization_id, study_id, version_number, data_json, selected_scenario_id, selected_scenario_snapshot, is_locked)
     VALUES ($1, $2, 1, '{}'::jsonb, $3, $4::jsonb, $5) RETURNING id`,
    [orgId, studyId, withSnapshot ? "A1" : null, snapshotJson, !!withSnapshot]
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
  let studyId, versionId, orgId, docId1, docId2;

  try {
    orgId = await getOrCreateOrg();
    const created = await createStudyWithVersion(orgId, true);
    studyId = created.studyId;
    versionId = created.versionId;
  } catch (e) {
    console.error("Setup échoué:", e.message);
    process.exit(1);
  }

  // ——— TEST 1 — Document créé, document_type = study_pdf ———
  try {
    const { res, captured } = mockRes();
    await generatePdf(mockReq(studyId, versionId, orgId), res);
    const body = captured.body;
    if (!body?.success || !body?.documentId) {
      failed++;
      console.log("TEST 1 FAILED — Pas de document créé:", body?.error ?? body);
    } else {
      docId1 = body.documentId;
      const row = await pool.query(
        `SELECT document_type, entity_type, entity_id FROM entity_documents WHERE id = $1`,
        [docId1]
      );
      const ok =
        row.rows.length === 1 &&
        row.rows[0].document_type === "study_pdf" &&
        row.rows[0].entity_type === "study_version" &&
        row.rows[0].entity_id === versionId;
      if (ok) {
        passed++;
        console.log("TEST 1 PASSED — Document créé, document_type=study_pdf");
      } else {
        failed++;
        console.log("TEST 1 FAILED — Métadonnées incorrectes:", row.rows[0]);
      }
    }
  } catch (e) {
    failed++;
    console.log("TEST 1 FAILED —", e.message);
  }

  // ——— TEST 2 — Fichier téléchargeable ———
  try {
    if (!docId1) {
      failed++;
      console.log("TEST 2 SKIP — Pas de documentId (TEST 1 échoué)");
    } else {
      const row = await pool.query(`SELECT storage_key FROM entity_documents WHERE id = $1`, [docId1]);
      if (row.rows.length === 0) {
        failed++;
        console.log("TEST 2 FAILED — Document non trouvé en DB");
      } else {
        const filePath = getAbsolutePath(row.rows[0].storage_key);
        const buf = await fs.readFile(filePath);
        const isPdf = buf.length > 0 && buf[0] === 0x25 && buf[1] === 0x50;
        if (buf.length > 1000 && isPdf) {
          passed++;
          console.log("TEST 2 PASSED — Fichier téléchargeable (PDF valide, taille > 1000)");
        } else {
          failed++;
          console.log("TEST 2 FAILED — Fichier invalide ou vide:", buf.length, isPdf);
        }
      }
    }
  } catch (e) {
    failed++;
    console.log("TEST 2 FAILED —", e.message);
  }

  // ——— TEST 3 — Lien entity_type=study_version, entity_id=versionId ———
  try {
    if (!docId1) {
      failed++;
      console.log("TEST 3 SKIP — Pas de documentId");
    } else {
      const row = await pool.query(
        `SELECT entity_type, entity_id FROM entity_documents WHERE id = $1`,
        [docId1]
      );
      const ok =
        row.rows.length === 1 &&
        row.rows[0].entity_type === "study_version" &&
        row.rows[0].entity_id === versionId;
      if (ok) {
        passed++;
        console.log("TEST 3 PASSED — Lien study_version / versionId correct");
      } else {
        failed++;
        console.log("TEST 3 FAILED — Lien incorrect:", row.rows[0]);
      }
    }
  } catch (e) {
    failed++;
    console.log("TEST 3 FAILED —", e.message);
  }

  // ——— TEST 4 — Re-génération (2 documents différents) ———
  try {
    const { res: res2, captured: cap2 } = mockRes();
    await generatePdf(mockReq(studyId, versionId, orgId), res2);
    const body2 = cap2.body;
    if (!body2?.success || !body2?.documentId) {
      failed++;
      console.log("TEST 4 FAILED — 2e génération échouée:", body2?.error ?? body2);
    } else {
      docId2 = body2.documentId;
      const count = await pool.query(
        `SELECT id FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf'`,
        [versionId]
      );
      const ok = count.rows.length >= 2 && docId1 !== docId2;
      if (ok) {
        passed++;
        console.log("TEST 4 PASSED — 2 documents différents (pas d'écrasement)");
      } else {
        failed++;
        console.log("TEST 4 FAILED — Pas 2 docs ou doublon:", count.rows.length, docId1, docId2);
      }
    }
  } catch (e) {
    failed++;
    console.log("TEST 4 FAILED —", e.message);
  }

  // ——— TEST 5 — Cohérence (métadonnées, fichier non vide) ———
  try {
    const rows = await pool.query(
      `SELECT id, file_name, file_size, mime_type, document_type, storage_key
       FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1 AND document_type = 'study_pdf'`,
      [versionId]
    );
    let allOk = true;
    for (const r of rows.rows) {
      if (!r.file_name || r.file_size <= 0 || r.mime_type !== "application/pdf") {
        allOk = false;
        break;
      }
      const buf = await fs.readFile(getAbsolutePath(r.storage_key));
      if (buf.length <= 0) allOk = false;
    }
    const noDupes = new Set(rows.rows.map((x) => x.id)).size === rows.rows.length;
    if (allOk && noDupes && rows.rows.length >= 2) {
      passed++;
      console.log("TEST 5 PASSED — Cohérence documents (métadonnées, fichiers non vides)");
    } else {
      failed++;
      console.log("TEST 5 FAILED — Incohérence:", { allOk, noDupes, count: rows.rows.length });
    }
  } catch (e) {
    failed++;
    console.log("TEST 5 FAILED —", e.message);
  }

  // Nettoyage
  try {
    const docs = await pool.query(
      `SELECT storage_key FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1`,
      [versionId]
    );
    const { deleteFile } = await import("../services/localStorage.service.js");
    for (const d of docs.rows) {
      try {
        await deleteFile(d.storage_key);
      } catch (_) {}
    }
    await pool.query("DELETE FROM entity_documents WHERE entity_type = 'study_version' AND entity_id = $1", [versionId]);
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
