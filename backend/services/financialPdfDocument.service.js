/**
 * Enregistrement métadonnées PDF financier (entity_documents) — sans moteur de rendu.
 * Prépare le rattachement ; le rendu Playwright / pipeline existant pourra remplacer storage_key plus tard.
 */

import { pool } from "../config/db.js";
import { addDocumentApiAliases, resolveSystemDocumentMetadata } from "./documentMetadata.service.js";

const PLACEHOLDER_URL = "https://placeholder.solarnext.local/pdf-pending";

/**
 * @param {object} opts
 * @param {string} opts.organizationId
 * @param {'quote'|'invoice'|'credit_note'} opts.entityType
 * @param {string} opts.entityId
 * @param {string} opts.documentType — quote_pdf | invoice_pdf | credit_note_pdf
 * @param {string} opts.fileName
 * @param {string|null} opts.userId
 * @param {Record<string, unknown>} [opts.metadataJson] — traçabilité CRM (numéro, schema_version, checksum…)
 * @param {string|null} [opts.numberForLabel] — numéro métier (ex. avoir) pour display_name
 */
export async function registerPendingFinancialPdf(opts) {
  const {
    organizationId,
    entityType,
    entityId,
    documentType,
    fileName,
    userId,
    metadataJson = {},
    numberForLabel = null,
  } = opts;
  const storageKey = `pending/${entityType}/${entityId}/${documentType}-${Date.now()}.pdf`;
  const meta = {
    ...metadataJson,
    generated_at: new Date().toISOString(),
  };
  const bm = resolveSystemDocumentMetadata(documentType, {
    numberForLabel: numberForLabel != null ? String(numberForLabel) : null,
    displayName: opts.displayName,
  });
  const r = await pool.query(
    `INSERT INTO entity_documents
      (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
       document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '{}'::jsonb), $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      organizationId,
      entityType,
      entityId,
      fileName,
      0,
      "application/pdf",
      storageKey,
      PLACEHOLDER_URL,
      userId ?? null,
      documentType,
      JSON.stringify(meta),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );
  return r.rows[0];
}

/**
 * Liste des documents financiers pour une entité.
 */
export async function listFinancialDocumentsForEntity(organizationId, entityType, entityId) {
  const r = await pool.query(
    `SELECT id, file_name, file_size, mime_type, storage_key, url, document_type, metadata_json, created_at, uploaded_by,
            document_category, source_type, is_client_visible, display_name, description
     FROM entity_documents
     WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND (archived_at IS NULL)
     ORDER BY created_at DESC`,
    [organizationId, entityType, entityId]
  );
  return r.rows.map((row) => addDocumentApiAliases(row));
}
