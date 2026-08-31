/**
 * GET /api/internal/pdf-financial-credit-note/:creditNoteId?renderToken=...
 * Payload PDF avoir : rendu depuis le snapshot officiel figé à l'émission.
 */

import { pool } from "../config/db.js";
import { verifyFinancialCreditNoteRenderToken } from "../services/pdfRenderToken.service.js";
import {
  buildCreditNotePdfPayloadFromSnapshot,
  mergeLiveBillingAddressIntoInvoicePdfPayload,
  mergeLiveOrganizationBankIntoInvoicePdfPayload,
  mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload,
} from "../services/financialDocumentPdfPayload.service.js";

export async function getInternalFinancialCreditNotePdfPayload(req, res) {
  try {
    const { creditNoteId } = req.params;
    const renderToken = req.query.renderToken;
    if (!creditNoteId) {
      return res.status(400).json({ ok: false, error: "creditNoteId requis" });
    }
    let decoded;
    try {
      decoded = verifyFinancialCreditNoteRenderToken(renderToken, creditNoteId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ ok: false, error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ ok: false, error: "RENDER_TOKEN_INVALID" });
    }

    const r = await pool.query(
      `SELECT cn.document_snapshot_json, cn.client_id, i.lead_id
       FROM credit_notes cn
       LEFT JOIN invoices i ON i.id = cn.invoice_id AND i.organization_id = cn.organization_id
       WHERE cn.id = $1 AND cn.organization_id = $2 AND (cn.archived_at IS NULL)`,
      [creditNoteId, decoded.organizationId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Avoir non trouvé" });
    }
    const snapRaw = r.rows[0].document_snapshot_json;
    if (snapRaw == null || (typeof snapRaw === "object" && Object.keys(snapRaw).length === 0)) {
      return res.status(400).json({ ok: false, error: "Aucun snapshot documentaire figé pour cet avoir" });
    }
    const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
    let payload;
    try {
      payload = buildCreditNotePdfPayloadFromSnapshot(snapshot);
    } catch (pe) {
      return res.status(400).json({ ok: false, error: pe.message || "Snapshot invalide" });
    }

    const orgRes = await pool.query(
      `SELECT default_invoice_notes, default_invoice_due_days, iban, bic, bank_name FROM organizations WHERE id = $1`,
      [decoded.organizationId]
    );
    const orgRow = orgRes.rows[0] ?? {};
    payload = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, orgRow);

    const cid = r.rows[0]?.client_id ?? null;
    const lid = r.rows[0]?.lead_id ?? null;
    let clientRow = null;
    let leadRow = null;
    if (cid) {
      const cr = await pool.query(
        `SELECT company_name, first_name, last_name, email, phone, siret,
                address_line_1, address_line_2, postal_code, city, country,
                installation_address_line_1, installation_postal_code, installation_city
         FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [cid, decoded.organizationId]
      );
      clientRow = cr.rows[0] ?? null;
    }
    if (lid) {
      const lr = await pool.query(
        `SELECT l.customer_type, l.company_name, l.contact_first_name, l.contact_last_name,
                l.first_name, l.last_name, l.email, l.phone, l.siret,
                l.address AS legacy_address,
                b.address_line1 AS b_line1,
                b.address_line2 AS b_line2,
                b.postal_code AS b_postal,
                b.city AS b_city,
                b.country_code AS b_country,
                b.formatted_address AS b_formatted,
                s.address_line1 AS s_line1,
                s.address_line2 AS s_line2,
                s.postal_code AS s_postal,
                s.city AS s_city,
                s.country_code AS s_country,
                s.formatted_address AS s_formatted
         FROM leads l
         LEFT JOIN addresses b ON b.id = l.billing_address_id AND b.organization_id = l.organization_id
         LEFT JOIN addresses s ON s.id = l.site_address_id AND s.organization_id = l.organization_id
         WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)`,
        [lid, decoded.organizationId]
      );
      leadRow = lr.rows[0] ?? null;
    }
    payload = mergeLiveBillingAddressIntoInvoicePdfPayload(payload, { clientRow, leadRow });
    payload = mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload(payload, { clientRow, leadRow });

    const defaultInvoiceNotes = orgRow.default_invoice_notes ?? null;
    const rawDueDays = orgRow.default_invoice_due_days;
    const defaultInvoiceDueDays =
      rawDueDays != null && Number.isFinite(Number(rawDueDays)) ? Number(rawDueDays) : 30;

    return res.json({
      ok: true,
      payload,
      organizationId: decoded.organizationId,
      defaultInvoiceNotes,
      defaultInvoiceDueDays,
      documentContract: {
        lines_and_line_totals: "snapshot_at_issuance",
        header_amounts_ht_vat_ttc: "snapshot_at_issuance",
        issuer_bank_coordinates: "live_at_pdf_generation",
        billing_address: "live_at_pdf_generation",
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
