/**
 * PROMPT 9 — Snapshots documentaires officiels + PDF figés (services).
 * Usage: cd backend && node scripts/test-prompt9-financial-documents.js
 */

import "../config/load-env.js";

import { pool } from "../config/db.js";
import * as quoteService from "../routes/quotes/service.js";
import * as invoiceService from "../services/invoices.service.js";
import * as creditNotesService from "../services/creditNotes.service.js";
import * as paymentsService from "../services/payments.service.js";
import { buildQuotePdfPayloadFromSnapshot } from "../services/financialDocumentPdfPayload.service.js";
import { FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION } from "../services/financialDocumentSnapshot.service.js";

const PREFIX = `P9-${Date.now()}`;
let passed = 0;
let failed = 0;

function ok(m) {
  passed++;
  console.log(`  ✔ ${m}`);
}
function fail(m, e) {
  failed++;
  console.log(`  ✖ ${m}: ${e?.message || e}`);
}

async function getOrgId() {
  const r = await pool.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
  if (r.rows.length === 0) {
    const ins = await pool.query("INSERT INTO organizations (name) VALUES ($1) RETURNING id", [`${PREFIX}-org`]);
    return ins.rows[0].id;
  }
  return r.rows[0].id;
}

async function createClient(orgId) {
  const r = await pool.query(
    `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
     VALUES ($1, $2, 'Snap', 'Shot', $3) RETURNING id`,
    [orgId, `CLI-${PREFIX}`, `${PREFIX}@test.local`]
  );
  return r.rows[0].id;
}

async function cleanupQuote(quoteId) {
  if (!quoteId) return;
  await pool.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
  await pool.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
}

async function cleanupInvoiceFull(invoiceId) {
  if (!invoiceId) return;
  await pool.query("DELETE FROM payments WHERE invoice_id = $1", [invoiceId]);
  await pool.query(
    "DELETE FROM credit_note_lines WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE invoice_id = $1)",
    [invoiceId]
  );
  await pool.query("DELETE FROM credit_notes WHERE invoice_id = $1", [invoiceId]);
  await pool.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [invoiceId]);
  await pool.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
}

const line120 = [{ label: "L", description: "x", quantity: 1, unit_price_ht: 100, vat_rate: 20 }];

async function main() {
  console.log("\n=== PROMPT 9 — Documents financiers figés ===\n");

  let orgId;
  let clientId;
  const docIds = [];

  try {
    orgId = await getOrgId();
    clientId = await createClient(orgId);
    ok(`org + client`);

    // 1 — Devis SENT → snapshot
    const q = await quoteService.createQuote(orgId, {
      client_id: clientId,
      items: [{ label: "A", description: "", quantity: 1, unit_price_ht: 50, tva_rate: 20 }],
    });
    const quoteId = q.quote.id;
    await quoteService.patchQuoteStatus(quoteId, orgId, "READY_TO_SEND", null);
    await quoteService.patchQuoteStatus(quoteId, orgId, "SENT", null);
    const snapQ = await quoteService.getQuoteDocumentSnapshot(quoteId, orgId);
    if (!snapQ || snapQ.document_type !== "QUOTE" || snapQ.schema_version !== FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION) {
      fail("1) snapshot devis SENT", new Error("structure"));
    } else ok("1) passage SENT → document_snapshot_json figé");

    // 2–3 — PDF depuis snapshot + entity_documents.metadata_json
    const pdfQ = await quoteService.generateQuotePdfRecord(quoteId, orgId, null);
    const payloadQ = buildQuotePdfPayloadFromSnapshot(snapQ);
    if (String(payloadQ.number) !== String(snapQ.number)) fail("2) payload PDF", new Error("numéro"));
    else ok("2) régénération PDF (payload) depuis snapshot uniquement");

    const meta = await pool.query(`SELECT metadata_json FROM entity_documents WHERE id = $1`, [pdfQ.document.id]);
    const mj = meta.rows[0]?.metadata_json;
    if (!mj?.snapshot_checksum || mj?.source !== "document_snapshot_json") fail("3) metadata CRM", new Error(JSON.stringify(mj)));
    else ok("3) entity_documents.metadata_json cohérent");
    docIds.push(pdfQ.document.id);

    // 11 — stabilité après modification live
    const checksumBefore = snapQ.snapshot_checksum;
    await pool.query(`UPDATE clients SET first_name = 'MODIFIÉ' WHERE id = $1`, [clientId]);
    const snapAfter = await quoteService.getQuoteDocumentSnapshot(quoteId, orgId);
    if (snapAfter.snapshot_checksum !== checksumBefore || snapAfter.recipient_snapshot?.first_name === "MODIFIÉ") {
      fail("11) snapshot stable après changement client", new Error("checksum ou recipient live"));
    } else ok("11) snapshot inchangé si données live changent");

    // 4–6 — Facture ISSUED + snapshot + quote source
    const inv = await invoiceService.createInvoice(orgId, {
      client_id: clientId,
      quote_id: quoteId,
      lines: line120,
    });
    await invoiceService.patchInvoiceStatus(inv.id, orgId, "ISSUED", null);
    const snapI = await invoiceService.getInvoiceDocumentSnapshot(inv.id, orgId);
    if (!snapI || snapI.document_type !== "INVOICE") fail("4) snapshot facture", new Error("type"));
    else ok("4) passage ISSUED → document_snapshot_json");

    if (!snapI.source_quote_snapshot || !snapI.refs?.quote_id) fail("6) lien devis", new Error("manquant"));
    else ok("6) quote source figée dans le snapshot facture");

    const pdfI = await invoiceService.generateInvoicePdfRecord(inv.id, orgId, null);
    if (!pdfI.pdf_payload?.number) fail("5) PDF facture", new Error("payload"));
    else ok("5) PDF facture basé sur snapshot");
    docIds.push(pdfI.document.id);

    // 7–9 — Avoir ISSUED
    await paymentsService.recordPayment(orgId, inv.id, {
      amount: 100,
      payment_date: "2025-08-01",
      payment_method: "TRANSFER",
    });
    const cn = await creditNotesService.createDraftCreditNote(orgId, inv.id, {
      lines: [{ label: "R", quantity: 1, unit_price_ht: 10, vat_rate: 20 }],
    });
    await creditNotesService.issueCreditNote(orgId, cn.id);
    const snapCn = await creditNotesService.getCreditNoteDocumentSnapshot(cn.id, orgId);
    if (!snapCn || snapCn.document_type !== "CREDIT_NOTE") fail("7) snapshot avoir", new Error("type"));
    else ok("7) émission avoir → snapshot");

    if (!snapCn.source_invoice_snapshot?.invoice_id || snapCn.refs?.invoice_id !== inv.id) {
      fail("9) lien facture source", new Error("manquant"));
    } else ok("9) facture source figée sur l'avoir");

    const pdfCn = await creditNotesService.generateCreditNotePdfRecord(cn.id, orgId, null);
    if (!pdfCn.pdf_payload?.number) fail("8) PDF avoir", new Error("payload"));
    else ok("8) PDF avoir basé sur snapshot");
    docIds.push(pdfCn.document.id);

    const metaCn = await pool.query(`SELECT metadata_json FROM entity_documents WHERE id = $1`, [pdfCn.document.id]);
    if (!metaCn.rows[0]?.metadata_json?.business_document_type) fail("10) traçabilité", new Error("metadata"));
    else ok("10) traçabilité document (metadata_json)");

    console.log("\n============================================================");
    console.log(`Résumé: ${passed} OK, ${failed} échecs`);
    console.log("============================================================\n");

    await pool.query("DELETE FROM entity_documents WHERE id = ANY($1::uuid[])", [docIds]);
    await cleanupInvoiceFull(inv.id);
    await cleanupQuote(quoteId);
    await pool.query("DELETE FROM clients WHERE id = $1", [clientId]);
  } catch (e) {
    console.error(e);
    failed++;
    if (clientId) await pool.query("DELETE FROM clients WHERE id = $1", [clientId]).catch(() => {});
  }

  if (failed > 0) process.exit(1);
}

main();
