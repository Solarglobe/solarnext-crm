/**
 * GET /api/internal/pdf-financial-quote/:quoteId?renderToken=...
 * Payload figé pour le renderer Playwright (PDF devis client).
 */

import { pool } from "../config/db.js";
import { verifyFinancialQuoteRenderToken } from "../services/pdfRenderToken.service.js";
import {
  buildQuotePdfPayloadFromSnapshot,
  mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload,
} from "../services/financialDocumentPdfPayload.service.js";
import { mergeQuoteOrgDocumentFieldsIntoPayload } from "../services/quoteDocumentOrgSettings.service.js";
import {
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
  fetchQuoteSignatureReadAcceptances,
} from "../services/documents.service.js";

export async function getInternalFinancialQuotePdfPayload(req, res) {
  try {
    const { quoteId } = req.params;
    const renderToken = req.query.renderToken;
    if (!quoteId) {
      return res.status(400).json({ ok: false, error: "quoteId requis" });
    }
    let decoded;
    try {
      decoded = verifyFinancialQuoteRenderToken(renderToken, quoteId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ ok: false, error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ ok: false, error: "RENDER_TOKEN_INVALID" });
    }

    const r = await pool.query(
      `SELECT status, document_snapshot_json, client_id, lead_id FROM quotes
       WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [quoteId, decoded.organizationId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Devis non trouvé" });
    }
    const quoteRowStatus = r.rows[0].status ?? null;
    const snapRaw = r.rows[0].document_snapshot_json;
    if (snapRaw == null || (typeof snapRaw === "object" && Object.keys(snapRaw).length === 0)) {
      return res.status(400).json({ ok: false, error: "Aucun snapshot documentaire figé pour ce devis" });
    }
    const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
    let payload;
    try {
      payload = await mergeQuoteOrgDocumentFieldsIntoPayload(
        buildQuotePdfPayloadFromSnapshot(snapshot),
        decoded.organizationId
      );
    } catch (pe) {
      return res.status(400).json({ ok: false, error: pe.message || "Snapshot invalide" });
    }

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
                l.first_name, l.last_name, l.email, l.phone, l.siret, l.address AS legacy_address,
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
    payload = mergeLiveRecipientBusinessFieldsIntoFinancialPdfPayload(payload, { clientRow, leadRow });

    const wantSigned = req.query.quoteSigned === "1" || req.query.quoteSigned === "true";
    if (wantSigned) {
      const sig = await pool.query(
        `SELECT document_type FROM entity_documents
         WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
           AND document_type IN ($3, $4) AND (archived_at IS NULL)`,
        [decoded.organizationId, quoteId, QUOTE_DOC_SIGNATURE_CLIENT, QUOTE_DOC_SIGNATURE_COMPANY]
      );
      const types = new Set(sig.rows.map((row) => row.document_type));
      if (!types.has(QUOTE_DOC_SIGNATURE_CLIENT) || !types.has(QUOTE_DOC_SIGNATURE_COMPANY)) {
        return res.status(400).json({
          ok: false,
          error: "Signatures client et entreprise requises pour le PDF signé",
        });
      }
      const acc = await fetchQuoteSignatureReadAcceptances(decoded.organizationId, quoteId);
      payload = { ...payload };
      if (acc.client) payload.signature_client_read_acceptance = acc.client;
      if (acc.company) payload.signature_company_read_acceptance = acc.company;
    }

    return res.json({
      ok: true,
      payload,
      organizationId: decoded.organizationId,
      quoteSignedRender: wantSigned,
      quoteStatus: quoteRowStatus,
    });
  } catch (e) {
    if (e.statusCode === 400) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
