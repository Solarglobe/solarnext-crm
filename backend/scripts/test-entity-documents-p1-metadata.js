/**
 * P1 — Tests ciblés entity_documents (DB réelle).
 * Prérequis : migrations appliquées, DATABASE_URL.
 * Optionnel : ORG_ID (UUID org existante). Sinon utilise la première org.
 *
 * Usage : cd backend && node --env-file=../.env.dev scripts/test-entity-documents-p1-metadata.js
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const { pool } = await import("../config/db.js");
const {
  saveQuotePdfDocument,
  saveInvoicePdfDocument,
  deleteDocument,
} = await import("../services/documents.service.js");
const { addDocumentApiAliases } = await import("../services/documentMetadata.service.js");

function ok(m) {
  console.log(`OK — ${m}`);
}

function fail(m, e) {
  console.error(`ÉCHEC — ${m}`, e);
  process.exitCode = 1;
}

async function pickOrgId() {
  const env = process.env.ORG_ID?.trim();
  if (env) return env;
  const r = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  return r.rows[0]?.id ?? null;
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.warn("SKIP : DATABASE_URL absent");
    return;
  }

  let orgId;
  try {
    await pool.query(`SELECT document_category::text FROM entity_documents LIMIT 1`);
  } catch (e) {
    console.error("Colonnes P1 absentes — exécutez npm run migrate:up (migration 1775300000000).", e.message);
    process.exitCode = 1;
    return;
  }

  orgId = await pickOrgId();
  if (!orgId) {
    console.warn("SKIP : aucune organization (ORG_ID ou table organizations vide)");
    return;
  }

  const leadId = randomUUID();
  const quoteId = randomUUID();
  const invoiceId = randomUUID();
  const idsToDelete = [];

  try {
    // TEST 1 — Upload manuel équivalent (INSERT avec métadonnées)
    const ins1 = await pool.query(
      `INSERT INTO entity_documents
       (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type,
        document_category, source_type, is_client_visible, display_name, description)
       VALUES ($1, 'lead', $2, 'x.txt', 1, 'text/plain', $3, 'local', NULL, 'lead_attachment',
        'DP_MAIRIE', 'MANUAL_UPLOAD', true, 'Libellé mairie', 'Desc admin')
       RETURNING *`,
      [orgId, leadId, `${orgId}/lead/${leadId}/x-${randomUUID()}.txt`]
    );
    idsToDelete.push(ins1.rows[0].id);
    const r1 = await pool.query(`SELECT * FROM entity_documents WHERE id = $1`, [ins1.rows[0].id]);
    const a1 = addDocumentApiAliases(r1.rows[0]);
    if (a1.documentCategory !== "DP_MAIRIE" || a1.sourceType !== "MANUAL_UPLOAD" || a1.isClientVisible !== true) {
      throw new Error(`TEST1 relu: ${JSON.stringify(a1)}`);
    }
    if (a1.displayName !== "Libellé mairie" || a1.description !== "Desc admin") throw new Error("TEST1 display/description");
    ok("TEST 1 — insert manuel + métadonnées persistées et relues");

    // TEST 2 — Insert minimal (colonnes métier omises → défauts DB / NULL)
    const sk2 = `${orgId}/lead/${leadId}/min-${randomUUID()}.txt`;
    const storageRoot = path.join(__dirname, "..", "storage");
    const abs2 = path.join(storageRoot, sk2.replace(/\//g, path.sep));
    await fs.promises.mkdir(path.dirname(abs2), { recursive: true });
    await fs.promises.writeFile(abs2, "m", "utf8");

    const ins2 = await pool.query(
      `INSERT INTO entity_documents
       (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type)
       VALUES ($1, 'lead', $2, 'minimal.txt', 1, 'text/plain', $3, 'local', NULL, 'lead_attachment')
       RETURNING id, is_client_visible, document_category, source_type`,
      [orgId, leadId, sk2]
    );
    idsToDelete.push(ins2.rows[0].id);
    if (ins2.rows[0].is_client_visible !== false) throw new Error("TEST2 is_client_visible default");
    if (ins2.rows[0].document_category != null || ins2.rows[0].source_type != null) {
      throw new Error("TEST2 category/source devraient être NULL");
    }
    ok("TEST 2 — insert minimal sans colonnes métier (compatible)");

    // TEST 3 — PDF devis système
    const pdfBuf = Buffer.from("%PDF-1.4 test solarnext\n");
    const docQ = await saveQuotePdfDocument(pdfBuf, orgId, quoteId, null, {
      quoteNumber: "TST-Q-42",
      metadata: { test: true },
    });
    idsToDelete.push(docQ.id);
    const rq = await pool.query(
      `SELECT document_category::text, source_type::text, is_client_visible, display_name FROM entity_documents WHERE id = $1`,
      [docQ.id]
    );
    const qrow = rq.rows[0];
    if (qrow.document_category !== "QUOTE" || qrow.source_type !== "SYSTEM_GENERATED" || qrow.is_client_visible !== true) {
      throw new Error(`TEST3 ${JSON.stringify(qrow)}`);
    }
    if (qrow.display_name !== "Devis TST-Q-42") throw new Error(`TEST3 display_name ${qrow.display_name}`);
    ok("TEST 3 — création auto devis (QUOTE, SYSTEM_GENERATED, visible)");

    // TEST 4 — PDF facture système
    const docI = await saveInvoicePdfDocument(pdfBuf, orgId, invoiceId, null, {
      invoiceNumber: "TST-F-7",
      metadata: { test: true },
    });
    idsToDelete.push(docI.id);
    const ri = await pool.query(
      `SELECT document_category::text, source_type::text, is_client_visible FROM entity_documents WHERE id = $1`,
      [docI.id]
    );
    const irow = ri.rows[0];
    if (irow.document_category !== "INVOICE" || irow.source_type !== "SYSTEM_GENERATED" || irow.is_client_visible !== true) {
      throw new Error(`TEST4 ${JSON.stringify(irow)}`);
    }
    ok("TEST 4 — création auto facture (INVOICE, SYSTEM_GENERATED, visible)");

    // TEST 5 — Listing (forme API)
    const list = await pool.query(
      `SELECT id, file_name, document_type, document_category, source_type, is_client_visible, display_name, description
       FROM entity_documents WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2 ORDER BY created_at DESC`,
      [orgId, leadId]
    );
    if (list.rows.length < 2) throw new Error("TEST5 liste vide/incomplète");
    const mapped = list.rows.map((row) => addDocumentApiAliases(row));
    const first = mapped[0];
    if (
      !("documentCategory" in first) ||
      !("sourceType" in first) ||
      !("isClientVisible" in first) ||
      !("displayName" in first) ||
      !("description" in first)
    ) {
      throw new Error(`TEST5 alias manquants ${JSON.stringify(first)}`);
    }
    ok("TEST 5 — listing : champs camelCase présents");
  } catch (e) {
    fail("suite P1", e);
  } finally {
    for (const id of idsToDelete) {
      try {
        await deleteDocument(id, orgId);
      } catch (_) {
        await pool.query(`DELETE FROM entity_documents WHERE id = $1`, [id]).catch(() => {});
      }
    }
    await pool.end().catch(() => {});
  }
}

run();
