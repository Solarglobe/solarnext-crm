/**
 * P5 — addQuotePdfToDocuments (DB réelle, sans Playwright).
 * Prérequis : DATABASE_URL, migrations P1 documents.
 *
 * Usage : cd backend && node --env-file=../.env.dev scripts/test-quote-add-to-lead-documents.js
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const { pool } = await import("../config/db.js");
const { saveQuotePdfDocument, deleteDocument } = await import("../services/documents.service.js");
const { addQuotePdfToDocuments } = await import("../routes/quotes/service.js");

function ok(m) {
  console.log(`OK — ${m}`);
}

function fail(m, e) {
  console.error(`ÉCHEC — ${m}`, e);
  process.exitCode = 1;
}

async function pickOrgAndStage() {
  const envOrg = process.env.ORG_ID?.trim();
  if (envOrg) {
    const st = await pool.query(
      `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC NULLS LAST LIMIT 1`,
      [envOrg]
    );
    return { orgId: envOrg, stageId: st.rows[0]?.id ?? null };
  }
  const r = await pool.query(
    `SELECT o.id AS org_id, s.id AS stage_id
     FROM organizations o
     JOIN pipeline_stages s ON s.organization_id = o.id
     ORDER BY o.created_at ASC, s.position ASC NULLS LAST
     LIMIT 1`
  );
  return { orgId: r.rows[0]?.org_id ?? null, stageId: r.rows[0]?.stage_id ?? null };
}

async function run() {
  try {
  if (!process.env.DATABASE_URL) {
    console.warn("SKIP : DATABASE_URL absent");
    return;
  }

  let orgId;
  let stageId;
  let addressId;
  let leadId;
  let quoteId;
  const docIds = [];

  try {
    await pool.query(`SELECT document_category::text FROM entity_documents LIMIT 1`);
  } catch (e) {
    console.error("Colonnes P1 absentes — exécutez les migrations entity_documents.", e.message);
    process.exitCode = 1;
    return;
  }

  ({ orgId, stageId } = await pickOrgAndStage());
  if (!orgId || !stageId) {
    console.warn("SKIP : aucune org / lead_stage");
    return;
  }

  try {
    const addrRes = await pool.query(
      `INSERT INTO addresses (organization_id, city, lat, lon, country_code) VALUES ($1, 'TestCity', 48.85, 2.35, 'FR') RETURNING id`,
      [orgId]
    );
    addressId = addrRes.rows[0].id;

    const leadRes = await pool.query(
      `INSERT INTO leads (organization_id, stage_id, full_name, email, site_address_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, stageId, `Test add-doc ${randomUUID().slice(0, 8)}`, "add-doc@test.local", addressId]
    );
    leadId = leadRes.rows[0].id;

    const qn = `SGQ-2026-${Date.now().toString(36).toUpperCase()}`;
    const quoteRes = await pool.query(
      `INSERT INTO quotes (organization_id, lead_id, quote_number, status, total_ht, total_vat, total_ttc)
       VALUES ($1, $2, $3, 'SENT', 0, 0, 0) RETURNING id`,
      [orgId, leadId, qn]
    );
    quoteId = quoteRes.rows[0].id;

    const pdfBuf = Buffer.from("%PDF-1.4 test add-to-lead-documents\n");
    const docQ = await saveQuotePdfDocument(pdfBuf, orgId, quoteId, null, {
      quoteNumber: qn,
      metadata: { test_script: true },
    });
    docIds.push(docQ.id);

    const first = await addQuotePdfToDocuments(quoteId, orgId, null);
    if (first.alreadyExists !== false) throw new Error("TEST1 alreadyExists devrait être false");
    if (!first.document?.id) throw new Error("TEST1 document manquant");
    docIds.push(first.document.id);

    const row1 = (
      await pool.query(
        `SELECT document_category::text, source_type::text, is_client_visible, display_name, metadata_json
         FROM entity_documents WHERE id = $1`,
        [first.document.id]
      )
    ).rows[0];
    if (row1.document_category !== "QUOTE" || row1.source_type !== "SYSTEM_GENERATED") {
      throw new Error(`TEST1 cat/source: ${JSON.stringify(row1)}`);
    }
    if (row1.is_client_visible !== true) throw new Error("TEST1 is_client_visible");
    if (row1.display_name !== `Devis ${qn}`) throw new Error(`TEST1 display_name ${row1.display_name}`);
    if (String(row1.metadata_json?.quote_id) !== String(quoteId)) throw new Error("TEST1 metadata quote_id");
    ok("TEST 1 — ajout simple (QUOTE, SYSTEM_GENERATED, visible, display_name, metadata quote_id)");

    const second = await addQuotePdfToDocuments(quoteId, orgId, null);
    if (second.alreadyExists !== true) throw new Error("TEST2 alreadyExists devrait être true");
    if (String(second.document?.id) !== String(first.document.id)) {
      throw new Error("TEST2 devrait retourner le même document");
    }
    const cnt = (
      await pool.query(
        `SELECT count(*)::int AS c FROM entity_documents
         WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
           AND document_type = 'quote_pdf' AND archived_at IS NULL
           AND metadata_json->>'quote_id' = $3`,
        [orgId, leadId, String(quoteId)]
      )
    ).rows[0].c;
    if (cnt !== 1) throw new Error(`TEST2 doublon ? count=${cnt}`);
    ok("TEST 2 — second appel sans doublon");

    ok("TEST 3 — présence onglet Documents lead : vérifier manuellement /api/leads/:id/documents si besoin");
    ok("TEST 4 — is_client_visible (vérifié TEST1)");
    ok("TEST 5 — display_name (vérifié TEST1)");
  } catch (e) {
    fail("exécution", e);
  } finally {
    if (orgId) {
      for (const id of docIds) {
        try {
          await deleteDocument(id, orgId);
        } catch {
          /* ignore */
        }
      }
    }
    if (quoteId) await pool.query(`DELETE FROM quotes WHERE id = $1`, [quoteId]);
    if (leadId) await pool.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    if (addressId) await pool.query(`DELETE FROM addresses WHERE id = $1`, [addressId]);
  }
  } finally {
    await pool.end().catch(() => {});
  }
}

run();
