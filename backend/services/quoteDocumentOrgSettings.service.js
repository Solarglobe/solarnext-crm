/**
 * Texte réglementaire devis (organizations.settings_json.quote_pdf.regulatory_text)
 * — injecté dans le payload PDF / Présenter (hors snapshot figé).
 */

import { pool } from "../config/db.js";
import { getLegalCgvForPdfRender } from "./legalCgv.service.js";

/**
 * @param {string} organizationId
 * @returns {Promise<string|null>}
 */
export async function getQuoteRegulatoryDocumentText(organizationId) {
  const r = await pool.query(
    `SELECT settings_json->'quote_pdf'->>'regulatory_text' AS t
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const t = r.rows[0]?.t;
  if (t == null || String(t).trim() === "") return null;
  return String(t);
}

/**
 * @param {object} payload
 * @param {string} organizationId
 * @returns {Promise<object>}
 */
export async function mergeQuoteOrgDocumentFieldsIntoPayload(payload, organizationId) {
  const regulatory_document_text = await getQuoteRegulatoryDocumentText(organizationId);
  let legal_cgv = null;
  try {
    legal_cgv = await getLegalCgvForPdfRender(organizationId);
  } catch {
    legal_cgv = null;
  }
  return {
    ...payload,
    regulatory_document_text,
    legal_cgv,
  };
}
