/**
 * Documents légaux d'organisation (RGE, décennale) — entity_documents, un actif par type.
 */

import { pool } from "../config/db.js";
import {
  ORGANIZATION_LEGAL_DOC_KIND,
  resolveOrganizationLegalDocumentType,
} from "../constants/organizationLegalDocumentTypes.js";

/**
 * @param {string} organizationId
 * @param {string} kind — 'legal_rge' | 'legal_decennale' ou document_type PostgreSQL
 * @returns {Promise<{ id: string, storage_key: string, file_name: string, mime_type: string|null, created_at: Date }|null>}
 */
export async function getOrganizationLegalDocument(organizationId, kind) {
  const documentType = resolveOrganizationLegalDocumentType(kind);
  if (!documentType) return null;
  const r = await pool.query(
    `SELECT id, storage_key, file_name, mime_type, created_at
     FROM entity_documents
     WHERE organization_id = $1
       AND entity_type = 'organization'
       AND entity_id = $1
       AND document_type = $2
       AND (archived_at IS NULL)
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, documentType]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {string} organizationId
 * @returns {Promise<{ rge: { configured: boolean, file_name: string|null }, decennale: { configured: boolean, file_name: string|null } }>}
 */
export async function getComplementaryLegalDocsStatus(organizationId) {
  const rge = await getOrganizationLegalDocument(organizationId, ORGANIZATION_LEGAL_DOC_KIND.RGE);
  const dec = await getOrganizationLegalDocument(organizationId, ORGANIZATION_LEGAL_DOC_KIND.DECENNALE);
  return {
    rge: { configured: Boolean(rge), file_name: rge?.file_name ?? null },
    decennale: { configured: Boolean(dec), file_name: dec?.file_name ?? null },
  };
}

/**
 * @param {string} organizationId
 * @param {{ include_rge?: boolean, include_decennale?: boolean }|null|undefined} legal_documents
 */
export async function assertQuoteLegalDocumentsConfiguredOrThrow(organizationId, legal_documents) {
  const ld = legal_documents && typeof legal_documents === "object" ? legal_documents : {};
  const include_rge = Boolean(ld.include_rge);
  const include_decennale = Boolean(ld.include_decennale);
  if (include_rge) {
    const doc = await getOrganizationLegalDocument(organizationId, ORGANIZATION_LEGAL_DOC_KIND.RGE);
    if (!doc) {
      const e = new Error("Document RGE non configuré pour cette organisation.");
      e.statusCode = 400;
      throw e;
    }
  }
  if (include_decennale) {
    const doc = await getOrganizationLegalDocument(organizationId, ORGANIZATION_LEGAL_DOC_KIND.DECENNALE);
    if (!doc) {
      const e = new Error("Document assurance décennale non configuré pour cette organisation.");
      e.statusCode = 400;
      throw e;
    }
  }
}
