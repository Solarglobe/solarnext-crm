/**
 * GET /api/internal/pdf-financial-invoice/:invoiceId?renderToken=...
 * Payload figé + totaux / paiements à jour pour le PDF facture (Playwright).
 */

import { pool } from "../config/db.js";
import { verifyFinancialInvoiceRenderToken } from "../services/pdfRenderToken.service.js";
import {
  buildInvoicePdfPayloadFromSnapshot,
  mergeLiveOrganizationBankIntoInvoicePdfPayload,
} from "../services/financialDocumentPdfPayload.service.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getInternalFinancialInvoicePdfPayload(req, res) {
  try {
    const { invoiceId } = req.params;
    const renderToken = req.query.renderToken;
    if (!invoiceId) {
      return res.status(400).json({ ok: false, error: "invoiceId requis" });
    }
    let decoded;
    try {
      decoded = verifyFinancialInvoiceRenderToken(renderToken, invoiceId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ ok: false, error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ ok: false, error: "RENDER_TOKEN_INVALID" });
    }

    const r = await pool.query(
      `SELECT document_snapshot_json FROM invoices
       WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [invoiceId, decoded.organizationId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Facture non trouvée" });
    }
    const snapRaw = r.rows[0].document_snapshot_json;
    if (snapRaw == null || (typeof snapRaw === "object" && Object.keys(snapRaw).length === 0)) {
      return res.status(400).json({ ok: false, error: "Aucun snapshot documentaire figé pour cette facture" });
    }
    const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
    let payload;
    try {
      payload = buildInvoicePdfPayloadFromSnapshot(snapshot);
    } catch (pe) {
      return res.status(400).json({ ok: false, error: pe.message || "Snapshot invalide" });
    }

    const liveRes = await pool.query(
      `SELECT status, total_ht, total_vat, total_ttc, total_paid, total_credited, amount_due, payment_terms, issue_date, due_date
       FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [invoiceId, decoded.organizationId]
    );
    const liveRow = liveRes.rows[0];
    const liveTotals = liveRow
      ? {
          status: liveRow.status,
          total_ht: num(liveRow.total_ht),
          total_vat: num(liveRow.total_vat),
          total_ttc: num(liveRow.total_ttc),
          total_paid: num(liveRow.total_paid),
          total_credited: num(liveRow.total_credited),
          amount_due: num(liveRow.amount_due),
          issue_date: liveRow.issue_date ?? null,
          due_date: liveRow.due_date ?? null,
          payment_terms: liveRow.payment_terms ?? null,
        }
      : null;

    const payRes = await pool.query(
      `SELECT payment_date, amount, payment_method, reference
       FROM payments
       WHERE invoice_id = $1 AND organization_id = $2
         AND cancelled_at IS NULL
         AND (status IS NULL OR status = 'RECORDED')
       ORDER BY payment_date ASC, created_at ASC`,
      [invoiceId, decoded.organizationId]
    );

    const orgRes = await pool.query(
      `SELECT default_invoice_notes, iban, bic, bank_name FROM organizations WHERE id = $1`,
      [decoded.organizationId]
    );
    const orgRow = orgRes.rows[0] ?? {};
    payload = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, orgRow);
    const defaultInvoiceNotes = orgRow.default_invoice_notes ?? null;

    return res.json({
      ok: true,
      payload,
      organizationId: decoded.organizationId,
      liveTotals,
      payments: payRes.rows,
      defaultInvoiceNotes,
      /** Contrat documentaire assumé : lignes figées (snapshot) + état financier à jour (live). */
      documentContract: {
        lines_and_line_totals: "snapshot_at_issuance",
        header_amounts_and_balance: "live_at_pdf_generation",
        payments_list: "live_at_pdf_generation",
        issuer_bank_coordinates: "live_at_pdf_generation",
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
