/**
 * CP-032C — Service Documents (logique delete pour tests d'intégrité)
 * PDF V2 — saveStudyPdfDocument pour persister les PDF générés par Playwright.
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import {
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
  QUOTE_DOC_PDF_SIGNED,
} from "../constants/entityDocumentsRowTypes.js";
import { deleteFile as localStorageDelete, uploadFile as localStorageUpload } from "./localStorage.service.js";
import { resolveSystemDocumentMetadata } from "./documentMetadata.service.js";

export { QUOTE_DOC_SIGNATURE_CLIENT, QUOTE_DOC_SIGNATURE_COMPANY, QUOTE_DOC_PDF_SIGNED };

/**
 * Supprime les PDF devis précédents (fichier + ligne) avant régénération.
 */
export async function removeInvoicePdfDocuments(organizationId, invoiceId) {
  const r = await pool.query(
    `SELECT id, storage_key FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'invoice' AND entity_id = $2
       AND document_type = 'invoice_pdf' AND (archived_at IS NULL)`,
    [organizationId, invoiceId]
  );
  for (const row of r.rows) {
    await localStorageDelete(row.storage_key);
    await pool.query(`DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`, [row.id, organizationId]);
  }
}

export async function removeQuotePdfDocuments(organizationId, quoteId) {
  const r = await pool.query(
    `SELECT id, storage_key FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
       AND document_type = 'quote_pdf' AND (archived_at IS NULL)`,
    [organizationId, quoteId]
  );
  for (const row of r.rows) {
    await localStorageDelete(row.storage_key);
    await pool.query(`DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`, [row.id, organizationId]);
  }
}

/**
 * Supprime les fichiers signature (client + entreprise) d’un devis.
 */
export async function removeQuoteSignatureDocuments(organizationId, quoteId) {
  const r = await pool.query(
    `SELECT id, storage_key FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
       AND document_type IN ($3, $4) AND (archived_at IS NULL)`,
    [organizationId, quoteId, QUOTE_DOC_SIGNATURE_CLIENT, QUOTE_DOC_SIGNATURE_COMPANY]
  );
  for (const row of r.rows) {
    await localStorageDelete(row.storage_key);
    await pool.query(`DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`, [row.id, organizationId]);
  }
}

/**
 * Supprime les PDF devis signés précédents (garde quote_pdf intact).
 */
export async function removeQuoteSignedPdfDocuments(organizationId, quoteId) {
  const r = await pool.query(
    `SELECT id, storage_key FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
       AND document_type = $3 AND (archived_at IS NULL)`,
    [organizationId, quoteId, QUOTE_DOC_PDF_SIGNED]
  );
  for (const row of r.rows) {
    await localStorageDelete(row.storage_key);
    await pool.query(`DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`, [row.id, organizationId]);
  }
}

/**
 * @param {Buffer} pngBuffer
 * @param {string} documentType — quote_signature_client | quote_signature_company
 */
export async function saveQuoteSignaturePng(pngBuffer, organizationId, quoteId, userId, documentType) {
  const fileName = documentType === QUOTE_DOC_SIGNATURE_CLIENT ? "signature-client.png" : "signature-company.png";
  const { storage_path } = await localStorageUpload(pngBuffer, organizationId, "quote", quoteId, fileName);
  const bm = resolveSystemDocumentMetadata(documentType, {});
  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING id, file_name, storage_key`,
    [
      organizationId,
      "quote",
      quoteId,
      fileName,
      pngBuffer.length,
      "image/png",
      storage_path,
      "local",
      userId || null,
      documentType,
      JSON.stringify({ role: documentType, generated_at: new Date().toISOString() }),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );
  return ins.rows[0];
}

/**
 * PDF devis signé final (ne remplace pas quote_pdf).
 */
export async function saveQuoteSignedPdfDocument(pdfBuffer, organizationId, quoteId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
    const suffix = Math.random().toString(36).slice(2, 8);
    fileName = `solarnext-devis-signe-${quoteId}-${timestamp}-${suffix}.pdf`;
  }
  const { storage_path } = await localStorageUpload(pdfBuffer, organizationId, "quote", quoteId, fileName);
  const metadata =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : {};
  const bm = resolveSystemDocumentMetadata("quote_pdf_signed", {
    numberForLabel: opts.quoteNumber != null ? String(opts.quoteNumber) : null,
    displayName: opts.displayName,
  });
  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING id, file_name, storage_key`,
    [
      organizationId,
      "quote",
      quoteId,
      fileName,
      pdfBuffer.length,
      "application/pdf",
      storage_path,
      "local",
      userId || null,
      QUOTE_DOC_PDF_SIGNED,
      JSON.stringify(metadata),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );
  return ins.rows[0];
}

/**
 * Supprime un document (DB + fichier). Transaction atomique.
 * Si deleteFile échoue → rollback DB, document conservé.
 * @throws 404 si absent ou archivé, 403 si cross-org
 */
export async function deleteDocument(id, organizationId) {
  return withTx(pool, async (client) => {
    const docRes = await client.query(
      `SELECT id, storage_key, organization_id, archived_at FROM entity_documents WHERE id = $1`,
      [id]
    );
    if (docRes.rows.length === 0) {
      const err = new Error("Document non trouvé");
      err.statusCode = 404;
      throw err;
    }
    const doc = docRes.rows[0];
    if (doc.organization_id !== organizationId) {
      const err = new Error("Document n'appartient pas à votre organisation");
      err.statusCode = 403;
      throw err;
    }
    if (doc.archived_at != null) {
      const err = new Error("Document non trouvé");
      err.statusCode = 404;
      throw err;
    }
    const storageKey = doc.storage_key;

    await localStorageDelete(storageKey);

    await client.query(
      `DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
  });
}

/**
 * Mise à jour ciblée (whitelist) — ex. visibilité client.
 * @param {string} organizationId
 * @param {string} documentId
 * @param {object} body
 * @param {boolean|string|undefined} [body.is_client_visible]
 * @returns {Promise<object>} ligne entity_documents (colonnes liste hub)
 */
export async function patchEntityDocument(organizationId, documentId, body) {
  const b = body && typeof body === "object" ? body : {};
  const keys = Object.keys(b).filter((k) => b[k] !== undefined);
  const forbidden = keys.filter((k) => k !== "is_client_visible");
  if (forbidden.length > 0) {
    const err = new Error("Champs non autorisés pour cette opération");
    err.statusCode = 400;
    throw err;
  }
  if (!("is_client_visible" in b)) {
    const err = new Error("is_client_visible requis");
    err.statusCode = 400;
    throw err;
  }
  const raw = b.is_client_visible;
  let isClientVisible;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") {
    isClientVisible = true;
  } else if (raw === false || raw === "false" || raw === 0 || raw === "0") {
    isClientVisible = false;
  } else {
    const err = new Error("is_client_visible invalide (booléen attendu)");
    err.statusCode = 400;
    throw err;
  }

  const exists = await pool.query(
    `SELECT id FROM entity_documents
     WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [documentId, organizationId]
  );
  if (exists.rows.length === 0) {
    const err = new Error("Document non trouvé");
    err.statusCode = 404;
    throw err;
  }

  await pool.query(
    `UPDATE entity_documents SET is_client_visible = $1 WHERE id = $2 AND organization_id = $3`,
    [isClientVisible, documentId, organizationId]
  );

  const out = await pool.query(
    `SELECT id, file_name, file_size, mime_type, created_at, document_type,
            document_category, source_type, is_client_visible, display_name, description
     FROM entity_documents WHERE id = $1 AND organization_id = $2`,
    [documentId, organizationId]
  );
  return out.rows[0];
}

/**
 * PDF V2 — Enregistre un PDF généré dans le système documents.
 * Nom horodaté : solarnext-study-{studyId}-v{versionId}-{timestamp}.pdf
 * @param {Buffer} pdfBuffer
 * @param {string} organizationId
 * @param {string} studyId
 * @param {string} versionId
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.fileName] — nom affiché (ex. Dupont-SGS001-SansBatterie.pdf) ; sinon nom horodaté interne
 * @returns {Promise<{ id: string, file_name: string, storage_key: string }>}
 */
export async function saveStudyPdfDocument(pdfBuffer, organizationId, studyId, versionId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
    const suffix = Math.random().toString(36).slice(2, 8);
    fileName = `solarnext-study-${studyId}-v${versionId}-${timestamp}-${suffix}.pdf`;
  }

  const { storage_path } = await localStorageUpload(
    pdfBuffer,
    organizationId,
    "study_version",
    versionId,
    fileName
  );

  const bm = resolveSystemDocumentMetadata("study_pdf", { fileName });
  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, file_name, storage_key`,
    [
      organizationId,
      "study_version",
      versionId,
      fileName,
      pdfBuffer.length,
      "application/pdf",
      storage_path,
      "local",
      userId || null,
      "study_pdf",
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );

  return ins.rows[0];
}

/**
 * Dédup : une entrée « proposition commerciale » par (lead, étude, version, scénario).
 */
export async function findExistingLeadCommercialProposalForStudyScenario(
  organizationId,
  leadId,
  studyId,
  studyVersionId,
  scenarioKey
) {
  const r = await pool.query(
    `SELECT *
     FROM entity_documents
     WHERE organization_id = $1
       AND entity_type = 'lead'
       AND entity_id = $2
       AND document_type = 'study_pdf'
       AND (archived_at IS NULL)
       AND COALESCE(metadata_json->>'study_id', '') = $3
       AND COALESCE(metadata_json->>'study_version_id', '') = $4
       AND COALESCE(metadata_json->>'scenario_key', '') = $5
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, leadId, String(studyId), String(studyVersionId), String(scenarioKey)]
  );
  return r.rows[0] || null;
}

/**
 * Copie PDF étude/proposition sur le dossier lead (Documents > Propositions commerciales).
 * @param {Buffer} pdfBuffer
 * @param {string} organizationId
 * @param {string} leadId
 * @param {string|null} userId
 * @param {object} opts
 * @param {string} opts.studyId
 * @param {string} opts.studyVersionId
 * @param {string} opts.scenarioKey — BASE | BATTERY_PHYSICAL | BATTERY_VIRTUAL
 * @param {string} opts.displayName — libellé métier (sans extension)
 * @param {string} [opts.fileName] — nom fichier stocké
 * @param {string} [opts.sourceStudyVersionDocumentId] — traçabilité doc study_version source
 */
export async function saveStudyProposalPdfOnLeadDocument(pdfBuffer, organizationId, leadId, userId, opts) {
  const studyId = opts.studyId != null ? String(opts.studyId) : "";
  const studyVersionId = opts.studyVersionId != null ? String(opts.studyVersionId) : "";
  const scenarioKey = opts.scenarioKey != null ? String(opts.scenarioKey) : "";
  if (!studyId || !studyVersionId || !scenarioKey) {
    const err = new Error("studyId, studyVersionId et scenarioKey requis");
    err.statusCode = 400;
    throw err;
  }

  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
    const suffix = Math.random().toString(36).slice(2, 8);
    fileName = `solarnext-proposition-lead-${leadId}-${timestamp}-${suffix}.pdf`;
  }

  const { storage_path } = await localStorageUpload(pdfBuffer, organizationId, "lead", leadId, fileName);

  const metadata = {
    study_id: studyId,
    study_version_id: studyVersionId,
    scenario_key: scenarioKey,
    source: "scenario_selection",
    ...(opts.sourceStudyVersionDocumentId
      ? { source_study_version_document_id: String(opts.sourceStudyVersionDocumentId) }
      : {}),
  };

  const displayName = opts.displayName != null ? String(opts.displayName).trim() : null;
  const bm = resolveSystemDocumentMetadata("study_pdf", {
    displayName: displayName || undefined,
    fileName,
  });

  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING id, file_name, storage_key, display_name, metadata_json`,
    [
      organizationId,
      "lead",
      leadId,
      fileName,
      pdfBuffer.length,
      "application/pdf",
      storage_path,
      "local",
      userId || null,
      "study_pdf",
      JSON.stringify(metadata),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );

  return ins.rows[0];
}

/**
 * @param {object} params
 * @param {Buffer} params.pdfBuffer
 * @param {string} params.organizationId
 * @param {string} params.studyId
 * @param {string} params.studyVersionId
 * @param {string} params.scenarioKey
 * @param {string|null} params.userId
 * @param {string|null|undefined} params.leadId — requis pour créer ; sinon skipped (appelant connaît déjà le lead)
 * @param {string|null|undefined} [params.studyNumber] — suffixe display_name optionnel
 * @param {string} [params.scenarioLabelFr] — ex. Sans batterie
 * @param {string} [params.sourceStudyVersionDocumentId]
 * @returns {Promise<{ ok: true, status: 'created'|'existing', document: object } | { ok: true, status: 'skipped', reason: string }>}
 */
export async function ensureLeadCommercialProposalFromScenarioPdf(params) {
  const {
    pdfBuffer,
    organizationId,
    studyId,
    studyVersionId,
    scenarioKey,
    userId,
    leadId: leadIdParam,
    studyNumber,
    scenarioLabelFr,
    sourceStudyVersionDocumentId,
  } = params;

  const leadId = leadIdParam != null && String(leadIdParam).trim() !== "" ? String(leadIdParam).trim() : null;
  if (!leadId) {
    return { ok: true, status: "skipped", reason: "NO_LEAD" };
  }

  const existing = await findExistingLeadCommercialProposalForStudyScenario(
    organizationId,
    leadId,
    studyId,
    studyVersionId,
    scenarioKey
  );
  if (existing) {
    return { ok: true, status: "existing", document: existing };
  }

  const label = scenarioLabelFr && String(scenarioLabelFr).trim() ? String(scenarioLabelFr).trim() : scenarioKey;
  const num = studyNumber != null && String(studyNumber).trim() ? String(studyNumber).trim() : null;
  const displayName = num
    ? `Proposition commerciale – ${label} · ${num}`
    : `Proposition commerciale – ${label}`;

  const doc = await saveStudyProposalPdfOnLeadDocument(pdfBuffer, organizationId, leadId, userId, {
    studyId,
    studyVersionId,
    scenarioKey,
    displayName,
    sourceStudyVersionDocumentId,
  });

  return { ok: true, status: "created", document: doc };
}

/**
 * PDF devis — stockage local + entity_documents (quote_pdf).
 * @param {Buffer} pdfBuffer
 * @param {string} organizationId
 * @param {string} quoteId
 * @param {string|null} userId
 * @param {object} [opts]
 * @param {string} [opts.fileName]
 * @param {Record<string, unknown>} [opts.metadata] — traçabilité CRM (snapshot_checksum, source, etc.)
 */
export async function saveQuotePdfDocument(pdfBuffer, organizationId, quoteId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
    const suffix = Math.random().toString(36).slice(2, 8);
    fileName = `solarnext-devis-${quoteId}-${timestamp}-${suffix}.pdf`;
  }

  const { storage_path } = await localStorageUpload(
    pdfBuffer,
    organizationId,
    "quote",
    quoteId,
    fileName
  );

  const metadata =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : {};

  const bm = resolveSystemDocumentMetadata("quote_pdf", {
    numberForLabel: opts.quoteNumber != null ? String(opts.quoteNumber) : null,
    displayName: opts.displayName,
  });

  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING id, file_name, storage_key`,
    [
      organizationId,
      "quote",
      quoteId,
      fileName,
      pdfBuffer.length,
      "application/pdf",
      storage_path,
      "local",
      userId || null,
      "quote_pdf",
      JSON.stringify(metadata),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );

  return ins.rows[0];
}

/**
 * PDF facture — stockage local + entity_documents (invoice_pdf).
 * @param {Buffer} pdfBuffer
 * @param {string} organizationId
 * @param {string} invoiceId
 * @param {string|null} userId
 * @param {object} [opts]
 * @param {string} [opts.fileName]
 * @param {Record<string, unknown>} [opts.metadata] — traçabilité CRM
 */
export async function saveInvoicePdfDocument(pdfBuffer, organizationId, invoiceId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
    const suffix = Math.random().toString(36).slice(2, 8);
    fileName = `solarnext-facture-${invoiceId}-${timestamp}-${suffix}.pdf`;
  }

  const { storage_path } = await localStorageUpload(
    pdfBuffer,
    organizationId,
    "invoice",
    invoiceId,
    fileName
  );

  const metadata =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : {};

  const bm = resolveSystemDocumentMetadata("invoice_pdf", {
    numberForLabel: opts.invoiceNumber != null ? String(opts.invoiceNumber) : null,
    displayName: opts.displayName,
  });

  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING id, file_name, storage_key`,
    [
      organizationId,
      "invoice",
      invoiceId,
      fileName,
      pdfBuffer.length,
      "application/pdf",
      storage_path,
      "local",
      userId || null,
      "invoice_pdf",
      JSON.stringify(metadata),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );

  return ins.rows[0];
}

/**
 * Déduplication « un PDF devis par quote » sur le dossier lead (metadata_json.quote_id).
 */
export async function findExistingLeadQuotePdfForQuote(organizationId, leadId, quoteId) {
  const r = await pool.query(
    `SELECT *
     FROM entity_documents
     WHERE organization_id = $1
       AND entity_type = 'lead'
       AND entity_id = $2
       AND document_type = 'quote_pdf'
       AND (archived_at IS NULL)
       AND COALESCE(metadata_json->>'quote_id', '') = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, leadId, String(quoteId)]
  );
  return r.rows[0] || null;
}

/**
 * Copie le PDF devis sur entity_documents du lead (fichier distinct du PDF rattaché au quote).
 * @param {Buffer} pdfBuffer
 * @param {string} organizationId
 * @param {string} leadId
 * @param {string} quoteId
 * @param {string|null} userId
 * @param {object} [opts]
 * @param {string|null} [opts.quoteNumber]
 * @param {string|null} [opts.displayName]
 * @param {string} [opts.fileName]
 * @param {Record<string, unknown>} [opts.metadata]
 */
export async function saveQuotePdfOnLeadDocument(pdfBuffer, organizationId, leadId, quoteId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 17);
    const suffix = Math.random().toString(36).slice(2, 8);
    fileName = `solarnext-devis-lead-${leadId}-${timestamp}-${suffix}.pdf`;
  }

  const { storage_path } = await localStorageUpload(pdfBuffer, organizationId, "lead", leadId, fileName);

  const baseMeta =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : {};
  const metadata = { ...baseMeta, quote_id: String(quoteId) };

  const bm = resolveSystemDocumentMetadata("quote_pdf", {
    numberForLabel: opts.quoteNumber != null ? String(opts.quoteNumber) : null,
    displayName: opts.displayName,
  });

  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      organizationId,
      "lead",
      leadId,
      fileName,
      pdfBuffer.length,
      "application/pdf",
      storage_path,
      "local",
      userId || null,
      "quote_pdf",
      JSON.stringify(metadata),
      bm.document_category,
      bm.source_type,
      bm.is_client_visible,
      bm.display_name,
      bm.description,
    ]
  );

  return ins.rows[0];
}
