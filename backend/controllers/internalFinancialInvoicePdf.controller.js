/**
 * GET /api/internal/pdf-financial-invoice/:invoiceId?renderToken=...
 * Payload figé + totaux / paiements à jour pour le PDF facture (Playwright).
 */

import { pool } from "../config/db.js";
import { verifyFinancialInvoiceRenderToken } from "../services/pdfRenderToken.service.js";
import {
  buildInvoicePdfPayloadFromSnapshot,
  clientRowToInvoicePdfAddressShape,
  mergeLiveBillingAddressIntoInvoicePdfPayload,
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
      `SELECT default_invoice_notes, default_invoice_due_days, iban, bic, bank_name FROM organizations WHERE id = $1`,
      [decoded.organizationId]
    );
    const orgRow = orgRes.rows[0] ?? {};
    payload = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, orgRow);

    const linkRes = await pool.query(
      `SELECT client_id, lead_id FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [invoiceId, decoded.organizationId]
    );
    const cid = linkRes.rows[0]?.client_id ?? null;
    const lid = linkRes.rows[0]?.lead_id ?? null;

    let clientRow = null;
    let leadRow = null;
    if (cid) {
      const cr = await pool.query(
        `SELECT address_line_1, address_line_2, postal_code, city, country
         FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [cid, decoded.organizationId]
      );
      clientRow = cr.rows[0] ?? null;
    }
    const hasClientAddr = clientRowToInvoicePdfAddressShape(clientRow) != null;
    if (!hasClientAddr && lid) {
      const lr = await pool.query(
        `SELECT l.address AS legacy_address,
                b.address_line1 AS b_line1,
                b.address_line2 AS b_line2,
                b.postal_code AS b_postal,
                b.city AS b_city,
                b.country_code AS b_country,
                s.address_line1 AS s_line1,
                s.address_line2 AS s_line2,
                s.postal_code AS s_postal,
                s.city AS s_city,
                s.country_code AS s_country
         FROM leads l
         LEFT JOIN addresses b ON b.id = l.billing_address_id AND b.organization_id = l.organization_id
         LEFT JOIN addresses s ON s.id = l.site_address_id AND s.organization_id = l.organization_id
         WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)`,
        [lid, decoded.organizationId]
      );
      leadRow = lr.rows[0] ?? null;
    }
    payload = mergeLiveBillingAddressIntoInvoicePdfPayload(payload, { clientRow, leadRow });

    const defaultInvoiceNotes = orgRow.default_invoice_notes ?? null;
    const rawDueDays = orgRow.default_invoice_due_days;
    const defaultInvoiceDueDays =
      rawDueDays != null && Number.isFinite(Number(rawDueDays)) ? Number(rawDueDays) : 30;

    return res.json({
      ok: true,
      payload,
      organizationId: decoded.organizationId,
      liveTotals,
      payments: payRes.rows,
      defaultInvoiceNotes,
      defaultInvoiceDueDays,
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
