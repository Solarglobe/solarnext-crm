/**
 * Avoirs (credit notes) — V1, une facture source, pas d’allocation multi-factures.
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import { computeFinancialLineDbFields, sumLineAmounts } from "./finance/financialLine.js";
import { MONEY_EPSILON, roundMoney2, toFiniteNumber } from "./finance/moneyRounding.js";
import { allocateNextDocumentNumber } from "./documentSequence.service.js";
import {
  buildInvoiceIssuerRecipientSnapshots,
  buildSourceInvoiceSnapshot,
} from "./documentSnapshot.service.js";
import { recalculateInvoiceStatusFromAmounts } from "./invoices.service.js";
import { persistCreditNoteOfficialDocumentSnapshot } from "./financialDocumentSnapshot.service.js";
import { buildCreditNotePdfPayloadFromSnapshot } from "./financialDocumentPdfPayload.service.js";
import { registerPendingFinancialPdf } from "./financialPdfDocument.service.js";

function httpError(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

/**
 * @param {import("pg").PoolClient} client
 */
async function replaceCreditNoteLines(client, organizationId, creditNoteId, lines) {
  await client.query("DELETE FROM credit_note_lines WHERE credit_note_id = $1 AND organization_id = $2", [
    creditNoteId,
    organizationId,
  ]);
  const defaultSnap = "{}";
  for (let i = 0; i < lines.length; i++) {
    const it = lines[i];
    const desc = it.description ?? it.label ?? "";
    const label = it.label ?? null;
    const qty = Number(it.quantity) || 0;
    const up = Number(it.unit_price_ht) || 0;
    const dr = Number(it.discount_ht) || 0;
    const vr = Number(it.vat_rate) || 0;
    const db = computeFinancialLineDbFields({
      quantity: qty,
      unit_price_ht: up,
      discount_ht: dr,
      vat_rate: vr,
    });
    await client.query(
      `INSERT INTO credit_note_lines (
        organization_id, credit_note_id, description, label, quantity, unit_price_ht, discount_ht, vat_rate,
        total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13::jsonb, '{}'::jsonb))`,
      [
        organizationId,
        creditNoteId,
        desc,
        label,
        qty,
        up,
        dr,
        vr,
        db.total_line_ht,
        db.total_line_vat,
        db.total_line_ttc,
        i + 1,
        it.snapshot_json != null ? JSON.stringify(it.snapshot_json) : defaultSnap,
      ]
    );
  }
}

/**
 * @param {import("pg").PoolClient} client
 */
async function recalcCreditNoteTotalsFromDb(client, organizationId, creditNoteId) {
  const lr = await client.query(
    "SELECT quantity, unit_price_ht, discount_ht, vat_rate FROM credit_note_lines WHERE credit_note_id = $1 AND organization_id = $2 ORDER BY position",
    [creditNoteId, organizationId]
  );
  let th = 0;
  let tv = 0;
  let tt = 0;
  for (const row of lr.rows) {
    const db = computeFinancialLineDbFields({
      quantity: row.quantity,
      unit_price_ht: row.unit_price_ht,
      discount_ht: row.discount_ht ?? 0,
      vat_rate: row.vat_rate,
    });
    th += db.total_line_ht;
    tv += db.total_line_vat;
    tt += db.total_line_ttc;
  }
  th = roundMoney2(th);
  tv = roundMoney2(tv);
  tt = roundMoney2(tt);

  await client.query(
    `UPDATE credit_notes SET total_ht = $1, total_vat = $2, total_ttc = $3, updated_at = now()
     WHERE id = $4 AND organization_id = $5`,
    [th, tv, tt, creditNoteId, organizationId]
  );
  return { total_ht: th, total_vat: tv, total_ttc: tt };
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 * @param {object} body
 */
export async function createDraftCreditNote(organizationId, invoiceId, body) {
  const { lines = [], reason_code, reason_text } = body || {};

  const invoiceRes = await pool.query(
    `SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (invoiceRes.rows.length === 0) throw httpError("Facture non trouvée", 404);
  const invoice = invoiceRes.rows[0];
  if (String(invoice.status).toUpperCase() === "CANCELLED") {
    throw httpError("Avoir impossible sur une facture annulée");
  }
  if (!invoice.client_id) throw httpError("client_id manquant sur la facture");

  if (!Array.isArray(lines) || lines.length < 1) {
    throw httpError("Au moins une ligne est requise");
  }

  const lineInputs = lines.map((l) => ({
    quantity: l.quantity,
    unit_price_ht: l.unit_price_ht,
    discount_ht: l.discount_ht ?? 0,
    vat_rate: l.vat_rate,
  }));
  const totals = sumLineAmounts(lineInputs);
  if (totals.total_ttc < 0) throw httpError("Le total TTC de l’avoir ne peut pas être négatif");

  const amountDue = roundMoney2(toFiniteNumber(invoice.amount_due));
  if (totals.total_ttc > amountDue + MONEY_EPSILON) {
    throw httpError("Le montant de l’avoir dépasse le reste à payer de la facture");
  }

  const draftNum = `DRAFT-AVR-${Date.now()}`;
  const currency = invoice.currency || "EUR";

  const cnId = await withTx(pool, async (client) => {
    const ins = await client.query(
      `INSERT INTO credit_notes (
        organization_id, client_id, invoice_id, credit_note_number, status, currency,
        total_ht, total_vat, total_ttc, reason_code, reason_text,
        issuer_snapshot, recipient_snapshot, source_invoice_snapshot, metadata_json
      ) VALUES (
        $1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb
      ) RETURNING id`,
      [
        organizationId,
        invoice.client_id,
        invoiceId,
        draftNum,
        currency,
        totals.total_ht,
        totals.total_vat,
        totals.total_ttc,
        reason_code ?? null,
        reason_text ?? null,
      ]
    );
    const id = ins.rows[0].id;
    await replaceCreditNoteLines(client, organizationId, id, lines);
    await recalcCreditNoteTotalsFromDb(client, organizationId, id);
    return id;
  });

  const r = await pool.query(`SELECT * FROM credit_notes WHERE id = $1`, [cnId]);
  return r.rows[0];
}

/**
 * @param {string} organizationId
 * @param {string} creditNoteId
 * @param {string|null} userId
 */
export async function issueCreditNote(organizationId, creditNoteId) {
  await withTx(pool, async (client) => {
    const cnRes = await client.query(
      `SELECT * FROM credit_notes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) FOR UPDATE`,
      [creditNoteId, organizationId]
    );
    if (cnRes.rows.length === 0) throw httpError("Avoir non trouvé", 404);
    const cn = cnRes.rows[0];
    if (String(cn.status).toUpperCase() !== "DRAFT") {
      throw httpError("Seul un avoir en brouillon peut être émis");
    }

    const invRes = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) FOR UPDATE`,
      [cn.invoice_id, organizationId]
    );
    if (invRes.rows.length === 0) throw httpError("Facture source introuvable", 404);
    const invoice = invRes.rows[0];
    if (String(invoice.status).toUpperCase() === "CANCELLED") {
      throw httpError("Émission impossible : facture annulée");
    }

    const cnTtc = roundMoney2(toFiniteNumber(cn.total_ttc));
    const amountDue = roundMoney2(toFiniteNumber(invoice.amount_due));
    if (cnTtc > amountDue + MONEY_EPSILON) {
      throw httpError("Le montant de l’avoir dépasse le reste à payer de la facture");
    }

    const lc = await client.query(
      "SELECT COUNT(*)::int AS n FROM credit_note_lines WHERE credit_note_id = $1 AND organization_id = $2",
      [creditNoteId, organizationId]
    );
    if (lc.rows[0].n < 1) throw httpError("Au moins une ligne est requise pour émettre l’avoir");

    const { fullNumber } = await allocateNextDocumentNumber(client, organizationId, "CREDIT_NOTE");

    const fullInvoice = (await client.query("SELECT * FROM invoices WHERE id = $1", [cn.invoice_id])).rows[0];
    const { issuer_snapshot, recipient_snapshot } = await buildInvoiceIssuerRecipientSnapshots(fullInvoice, organizationId);
    const source_invoice_snapshot = buildSourceInvoiceSnapshot(fullInvoice);

    await client.query(
      `UPDATE credit_notes SET
        status = 'ISSUED',
        credit_note_number = $1,
        issue_date = CURRENT_DATE,
        issuer_snapshot = $2::jsonb,
        recipient_snapshot = $3::jsonb,
        source_invoice_snapshot = $4::jsonb,
        updated_at = now()
      WHERE id = $5 AND organization_id = $6`,
      [
        fullNumber,
        JSON.stringify(issuer_snapshot),
        JSON.stringify(recipient_snapshot),
        JSON.stringify(source_invoice_snapshot),
        creditNoteId,
        organizationId,
      ]
    );

    await persistCreditNoteOfficialDocumentSnapshot(client, creditNoteId, organizationId, {
      frozenBy: null,
      generatedFrom: "POST_CREDIT_NOTE_ISSUE",
    });
  });

  const cnRow = (await pool.query(`SELECT invoice_id FROM credit_notes WHERE id = $1`, [creditNoteId])).rows[0];
  if (cnRow?.invoice_id) {
    await recalculateInvoiceStatusFromAmounts(cnRow.invoice_id, organizationId);
  }

  const r = await pool.query(`SELECT * FROM credit_notes WHERE id = $1`, [creditNoteId]);
  return r.rows[0];
}

/**
 * @param {string} organizationId
 * @param {string} invoiceId
 */
export async function listCreditNotesForInvoice(organizationId, invoiceId) {
  const inv = await pool.query(
    `SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [invoiceId, organizationId]
  );
  if (inv.rows.length === 0) return null;

  const r = await pool.query(
    `SELECT cn.id, cn.credit_note_number, cn.status, cn.total_ht, cn.total_ttc, cn.issue_date, cn.created_at,
            cn.reason_text, cn.reason_code,
            (EXISTS (
              SELECT 1 FROM entity_documents ed
              WHERE ed.organization_id = cn.organization_id
                AND ed.entity_type = 'credit_note' AND ed.entity_id = cn.id
                AND ed.document_type = 'credit_note_pdf'
                AND (ed.archived_at IS NULL)
            )) AS has_pdf
     FROM credit_notes cn
     WHERE cn.invoice_id = $1 AND cn.organization_id = $2 AND (cn.archived_at IS NULL)
     ORDER BY cn.created_at`,
    [invoiceId, organizationId]
  );
  return r.rows;
}

/**
 * @param {string} creditNoteId
 * @param {string} organizationId
 * @param {string|null} userId
 */
export async function generateCreditNotePdfRecord(creditNoteId, organizationId, userId) {
  const r = await pool.query(
    "SELECT credit_note_number, document_snapshot_json, status FROM credit_notes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [creditNoteId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Avoir non trouvé");
    err.statusCode = 404;
    throw err;
  }
  const row = r.rows[0];
  const snapRaw = row.document_snapshot_json;
  if (snapRaw == null || (typeof snapRaw === "object" && snapRaw !== null && Object.keys(snapRaw).length === 0)) {
    const err = new Error(
      "Aucun document figé : le PDF ne peut être généré qu'après émission de l'avoir (statut ISSUED)."
    );
    err.statusCode = 400;
    throw err;
  }
  const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
  const pdfPayload = buildCreditNotePdfPayloadFromSnapshot(snapshot);
  const num = row.credit_note_number || creditNoteId;
  const doc = await registerPendingFinancialPdf({
    organizationId,
    entityType: "credit_note",
    entityId: creditNoteId,
    documentType: "credit_note_pdf",
    fileName: `avoir-${num}.pdf`,
    userId,
    numberForLabel: row.credit_note_number ?? null,
    metadataJson: {
      business_document_type: "CREDIT_NOTE",
      document_number: snapshot.number,
      status: row.status,
      schema_version: snapshot.schema_version,
      snapshot_checksum: snapshot.snapshot_checksum,
      source: "document_snapshot_json",
    },
  });
  return {
    document: doc,
    pdf_payload: pdfPayload,
    message: "Document enregistré — payload PDF dérivé du snapshot figé (rendu à brancher sur le pipeline).",
  };
}

/**
 * Snapshot documentaire officiel (lecture seule).
 */
export async function getCreditNoteDocumentSnapshot(creditNoteId, organizationId) {
  const r = await pool.query(
    `SELECT document_snapshot_json FROM credit_notes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [creditNoteId, organizationId]
  );
  if (r.rows.length === 0) return null;
  const s = r.rows[0].document_snapshot_json;
  if (s == null) return null;
  return typeof s === "string" ? JSON.parse(s) : s;
}
