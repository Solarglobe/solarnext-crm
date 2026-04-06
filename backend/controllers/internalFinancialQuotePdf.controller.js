/**
 * GET /api/internal/pdf-financial-quote/:quoteId?renderToken=...
 * Payload figé pour le renderer Playwright (PDF devis client).
 */

import { pool } from "../config/db.js";
import { verifyFinancialQuoteRenderToken } from "../services/pdfRenderToken.service.js";
import { buildQuotePdfPayloadFromSnapshot } from "../services/financialDocumentPdfPayload.service.js";
import { mergeQuoteOrgDocumentFieldsIntoPayload } from "../services/quoteDocumentOrgSettings.service.js";
import {
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
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
      `SELECT status, document_snapshot_json FROM quotes
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
