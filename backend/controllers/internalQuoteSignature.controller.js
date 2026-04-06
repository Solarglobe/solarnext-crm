/**
 * GET /api/internal/pdf-quote-signature/:quoteId/:role?renderToken=...
 * role = client | company — PNG persisté pour rendu PDF signé (Playwright).
 */

import path from "path";
import { pool } from "../config/db.js";
import { verifyFinancialQuoteRenderToken } from "../services/pdfRenderToken.service.js";
import { getAbsolutePath } from "../services/localStorage.service.js";
import {
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
} from "../services/documents.service.js";

export async function getInternalQuoteSignaturePng(req, res) {
  try {
    const { quoteId, role } = req.params;
    const renderToken = req.query.renderToken;
    if (!quoteId || !role || !["client", "company"].includes(role)) {
      return res.status(400).json({ error: "quoteId et role (client|company) requis" });
    }
    let decoded;
    try {
      decoded = verifyFinancialQuoteRenderToken(renderToken, quoteId);
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        return res.status(401).json({ error: "RENDER_TOKEN_EXPIRED" });
      }
      return res.status(403).json({ error: "RENDER_TOKEN_INVALID" });
    }

    const docType = role === "company" ? QUOTE_DOC_SIGNATURE_COMPANY : QUOTE_DOC_SIGNATURE_CLIENT;
    const r = await pool.query(
      `SELECT storage_key FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
         AND document_type = $3 AND (archived_at IS NULL)
       ORDER BY created_at DESC
       LIMIT 1`,
      [decoded.organizationId, quoteId, docType]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Signature non trouvée" });
    }
    const filePath = path.resolve(getAbsolutePath(r.rows[0].storage_key));
    res.sendFile(filePath);
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }
    res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
