/**
 * GET /api/internal/pdf-financial-invoice/:invoiceId?renderToken=...
 * Payload PDF facture : lignes + montants + métadonnées issues uniquement du snapshot officiel.
 * Banque / adresse facturation : enrichissement live optionnel (RIB à jour, adresse client).
 */

import { pool } from "../config/db.js";
import { verifyFinancialInvoiceRenderToken } from "../services/pdfRenderToken.service.js";
import {
  buildInvoicePdfPayloadFromSnapshot,
  mergeLiveBillingAddressIntoInvoicePdfPayload,
  mergeLiveOrganizationBankIntoInvoicePdfPayload,
} from "../services/financialDocumentPdfPayload.service.js";

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

    const orgRes = await pool.query(
      `SELECT default_invoice_notes, default_invoice_due_days, iban, bic, bank_name FROM organizations WHERE id = $1`,
      [decoded.organizationId]
    );
    const orgRow = orgRes.rows[0] ?? {};
    payload = mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, orgRow);

    const linkRes = await pool.query(
      `SELECT client_id, lead_id, total_paid, total_credited, amount_due, status
       FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [invoiceId, decoded.organizationId]
    );
    const cid = linkRes.rows[0]?.client_id ?? null;
    const lid = linkRes.rows[0]?.lead_id ?? null;

    let clientRow = null;
    let leadRow = null;
    if (cid) {
      const cr = await pool.query(
        `SELECT address_line_1, address_line_2, postal_code, city, country,
                installation_address_line_1, installation_postal_code, installation_city
         FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [cid, decoded.organizationId]
      );
      clientRow = cr.rows[0] ?? null;
    }
    if (lid) {
      const lr = await pool.query(
        `SELECT l.address AS legacy_address,
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

    // Merge live payment data — total_paid / amount_due doivent toujours refléter
    // les paiements réels, pas le snapshot figé à l'émission (qui avait total_paid=0).
    const liveRow = linkRes.rows[0] ?? {};
    const liveTotalPaid = liveRow.total_paid != null ? Number(liveRow.total_paid) : 0;
    const liveTotalCredited = liveRow.total_credited != null ? Number(liveRow.total_credited) : 0;
    const liveAmountDue = liveRow.amount_due != null ? Number(liveRow.amount_due) : null;
    const liveStatus = liveRow.status ?? null;

    const snapTotals = payload.totals && typeof payload.totals === "object" ? payload.totals : {};
    payload = {
      ...payload,
      // Statut live : reflète PAID / PARTIALLY_PAID après paiements
      ...(liveStatus != null ? { status: liveStatus } : {}),
      totals: {
        ...snapTotals,
        total_paid: liveTotalPaid,
        total_credited: liveTotalCredited,
        // amount_due live calculé DB (= total_ttc - total_paid - total_credited)
        ...(liveAmountDue != null ? { amount_due: liveAmountDue } : {}),
      },
    };

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
        payment_balance_total_paid_amount_due: "live_at_pdf_generation",
        invoice_status: "live_at_pdf_generation",
        issuer_bank_coordinates: "live_at_pdf_generation",
        billing_address: "live_at_pdf_generation",
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
