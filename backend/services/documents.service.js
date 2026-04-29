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
import { assertOrgOwnership } from "./security/assertOrgOwnership.js";
import { getDpPdfFileName, normalizeDpPieceKey } from "../constants/dpPdfFileNames.js";
import { SIGNATURE_READ_ACCEPTANCE_LABEL_FR } from "../constants/signatureReadAcceptance.js";
import { buildQuoteSignedPdfFileName, buildQuoteUnsignedPdfFileName } from "./quotePdfStorageName.js";

export { QUOTE_DOC_SIGNATURE_CLIENT, QUOTE_DOC_SIGNATURE_COMPANY, QUOTE_DOC_PDF_SIGNED };

/**
 * @param {unknown} metadataJson
 * @returns {{ accepted: true, acceptedLabel: string, recordedAt: string | null, signedAtServer: string | null } | null}
 */
export function parseQuoteSignatureMetadataAcceptance(metadataJson) {
  if (metadataJson == null || metadataJson === "") return null;
  let m;
  try {
    m = typeof metadataJson === "string" ? JSON.parse(metadataJson) : metadataJson;
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || m.accepted !== true) return null;
  const labelRaw = typeof m.acceptedLabel === "string" ? m.acceptedLabel.trim() : "";
  const signedAtServer =
    typeof m.signedAtServer === "string" && m.signedAtServer.trim() ? m.signedAtServer.trim() : null;
  const generatedAt = typeof m.generated_at === "string" ? m.generated_at : null;
  return {
    accepted: true,
    acceptedLabel: labelRaw || SIGNATURE_READ_ACCEPTANCE_LABEL_FR,
    signedAtServer,
    recordedAt: signedAtServer || generatedAt,
  };
}

/**
 * Dernières métadonnées de lecture/acceptation par rôle (signatures déjà persistées).
 * @returns {Promise<{ client: ReturnType<typeof parseQuoteSignatureMetadataAcceptance>, company: ReturnType<typeof parseQuoteSignatureMetadataAcceptance> }>}
 */
export async function fetchQuoteSignatureReadAcceptances(organizationId, quoteId) {
  const r = await pool.query(
    `SELECT document_type, metadata_json FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
       AND document_type IN ($3, $4) AND (archived_at IS NULL)
     ORDER BY created_at DESC`,
    [organizationId, quoteId, QUOTE_DOC_SIGNATURE_CLIENT, QUOTE_DOC_SIGNATURE_COMPANY]
  );
  let client = null;
  let company = null;
  for (const row of r.rows) {
    const parsed = parseQuoteSignatureMetadataAcceptance(row.metadata_json);
    if (row.document_type === QUOTE_DOC_SIGNATURE_CLIENT && !client) client = parsed;
    if (row.document_type === QUOTE_DOC_SIGNATURE_COMPANY && !company) company = parsed;
    if (client && company) break;
  }
  return { client, company };
}

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

/**
 * Trouve le PDF facture principal rattaché à l'entité invoice.
 */
export async function findExistingInvoicePdfForInvoiceEntity(organizationId, invoiceId) {
  const r = await pool.query(
    `SELECT *
     FROM entity_documents
     WHERE organization_id = $1
       AND entity_type = 'invoice'
       AND entity_id = $2
       AND document_type = 'invoice_pdf'
       AND (archived_at IS NULL)
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, invoiceId]
  );
  return r.rows[0] || null;
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
 * @param {{ accepted?: boolean, acceptedLabel?: string|null }} [readAcceptance] — preuve « lu et accepté » (pad)
 */
export async function saveQuoteSignaturePng(pngBuffer, organizationId, quoteId, userId, documentType, readAcceptance = null) {
  const fileName = documentType === QUOTE_DOC_SIGNATURE_CLIENT ? "signature-client.png" : "signature-company.png";
  const { storage_path } = await localStorageUpload(pngBuffer, organizationId, "quote", quoteId, fileName);
  const bm = resolveSystemDocumentMetadata(documentType, {});
  const signedAtServer = new Date().toISOString();
  const meta = { role: documentType, generated_at: signedAtServer, signedAtServer };
  if (readAcceptance && readAcceptance.accepted === true) {
    meta.accepted = true;
    const lbl =
      typeof readAcceptance.acceptedLabel === "string" && readAcceptance.acceptedLabel.trim()
        ? readAcceptance.acceptedLabel.trim()
        : SIGNATURE_READ_ACCEPTANCE_LABEL_FR;
    meta.acceptedLabel = lbl;
  }
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
      JSON.stringify(meta),
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
 * @param {object} [opts]
 * @param {string|null} [opts.quotePdfClientSlug] — segment client (voir quotePdfStorageName)
 */
export async function saveQuoteSignedPdfDocument(pdfBuffer, organizationId, quoteId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    fileName = buildQuoteSignedPdfFileName(opts.quoteNumber, quoteId, opts.quotePdfClientSlug ?? null);
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
    assertOrgOwnership(doc.organization_id, organizationId);
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
 * @param {string|null|undefined} [params.studyNumber] — ex. SGS-… ; repli côté service sur studyId si vide
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

  const scenarioLabelFrResolved =
    scenarioLabelFr && String(scenarioLabelFr).trim()
      ? String(scenarioLabelFr).trim()
      : String(scenarioKey ?? "");
  const studyNumberResolved =
    studyNumber != null && String(studyNumber).trim()
      ? String(studyNumber).trim()
      : String(studyId ?? "");
  const displayName = `Proposition commerciale – ${scenarioLabelFrResolved} · ${studyNumberResolved}`;

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
 * @param {string|null} [opts.quotePdfClientSlug] — segment client (voir quotePdfStorageName)
 * @param {Record<string, unknown>} [opts.metadata] — traçabilité CRM (snapshot_checksum, source, etc.)
 */
export async function saveQuotePdfDocument(pdfBuffer, organizationId, quoteId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    fileName = buildQuoteUnsignedPdfFileName(opts.quoteNumber, quoteId, opts.quotePdfClientSlug ?? null);
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
 * Trouve un PDF facture déjà copié sur une entité client/lead pour une facture donnée.
 */
export async function findExistingOwnerInvoicePdfForInvoice(organizationId, entityType, entityId, invoiceId) {
  const r = await pool.query(
    `SELECT *
     FROM entity_documents
     WHERE organization_id = $1
       AND entity_type = $2
       AND entity_id = $3
       AND document_type = 'invoice_pdf'
       AND (archived_at IS NULL)
       AND COALESCE(metadata_json->>'invoice_id', '') = $4
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, entityType, entityId, String(invoiceId)]
  );
  return r.rows[0] || null;
}

/**
 * Copie le PDF facture sur entity_documents du client/lead (Documents > Factures).
 * Déduplication par invoice_id via metadata_json.
 */
export async function saveInvoicePdfOnOwnerDocument(
  pdfBuffer,
  organizationId,
  entityType,
  entityId,
  invoiceId,
  userId,
  opts = {}
) {
  if (!["client", "lead"].includes(String(entityType))) {
    const err = new Error("entityType invalide pour saveInvoicePdfOnOwnerDocument");
    err.statusCode = 400;
    throw err;
  }

  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    fileName = `facture-${invoiceId}.pdf`;
  }

  const existing = await findExistingOwnerInvoicePdfForInvoice(
    organizationId,
    entityType,
    entityId,
    invoiceId
  );
  const replaced = Boolean(existing);
  if (existing?.storage_key) {
    try {
      await localStorageDelete(existing.storage_key);
    } catch (_) {}
    await pool.query(`DELETE FROM entity_documents WHERE id = $1 AND organization_id = $2`, [
      existing.id,
      organizationId,
    ]);
  }

  const { storage_path } = await localStorageUpload(pdfBuffer, organizationId, entityType, entityId, fileName);
  const metadataBase =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : {};
  const metadata = { ...metadataBase, invoice_id: String(invoiceId) };
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
      entityType,
      entityId,
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
  return { ...ins.rows[0], replaced };
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
 * @param {string|null} [opts.quotePdfClientSlug]
 * @param {Record<string, unknown>} [opts.metadata]
 */
export async function saveQuotePdfOnLeadDocument(pdfBuffer, organizationId, leadId, quoteId, userId, opts = {}) {
  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    fileName = buildQuoteUnsignedPdfFileName(opts.quoteNumber, quoteId, opts.quotePdfClientSlug ?? null);
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

/**
 * Vérifie qu’un lead existe pour l’organisation (non archivé).
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function assertLeadBelongsToOrganization(leadId, organizationId) {
  const r = await pool.query(
    `SELECT id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [leadId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Lead non trouvé ou accès refusé");
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Un seul PDF DP par (lead, pièce) — repère metadata_json.dp_piece (clé canonique).
 * @returns {Promise<{ id: string, file_name: string } | null>}
 */
export async function findExistingLeadDpDocumentByPiece(organizationId, leadId, pieceKey) {
  const key = normalizeDpPieceKey(pieceKey);
  const r = await pool.query(
    `SELECT id, file_name FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
       AND document_type = 'dp_pdf' AND (archived_at IS NULL)
       AND COALESCE(metadata_json->>'dp_piece', '') = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, leadId, key]
  );
  return r.rows[0] || null;
}

/**
 * PDF généré dossier DP (mandat, DP1–DP8, etc.) — rangé sur le lead, catégorie DP.
 * @param {Buffer} pdfBuffer
 * @param {string} organizationId
 * @param {string} leadId
 * @param {string|null} userId
 * @param {object} [opts]
 * @param {string} [opts.dpPiece] — ex. mandat, DP1, DP7, CERFA
 * @param {string} [opts.fileName] — nom fichier stocké
 * @param {string} [opts.displayName] — libellé hub documents
 */
export async function saveLeadDpGeneratedPdfDocument(pdfBuffer, organizationId, leadId, userId, opts = {}) {
  const pieceKey = normalizeDpPieceKey(opts.dpPiece);

  let fileName;
  const preferred = opts.fileName && String(opts.fileName).trim();
  if (preferred) {
    const base = String(opts.fileName).trim();
    fileName = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  } else {
    fileName = getDpPdfFileName(pieceKey, leadId);
  }

  const { storage_path } = await localStorageUpload(pdfBuffer, organizationId, "lead", leadId, fileName);

  const metadata = {
    dp_piece: pieceKey,
    generated_at: new Date().toISOString(),
    ...(opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata) ? opts.metadata : {}),
  };

  const bm = resolveSystemDocumentMetadata("dp_pdf", {
    dpPiece: pieceKey,
    displayName: opts.displayName,
    fileName,
  });

  const ins = await pool.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
     RETURNING id, file_name, storage_key`,
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
      "dp_pdf",
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
 * Liste globale des documents CRM pour une organisation (Document Center).
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string} [p.search]
 * @param {string} [p.type] all | quote | invoice | study | dp | admin | other
 * @param {number} [p.limit]
 * @param {number} [p.offset]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listOrganizationDocuments({
  organizationId,
  search = "",
  type = "all",
  limit = 50,
  offset = 0,
}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);

  try {
  const searchTrim = String(search || "").trim();
  const typeNorm = String(type || "all").toLowerCase();
  const allowedTypes = new Set(["all", "quote", "invoice", "study", "dp", "admin", "other"]);
  const t = allowedTypes.has(typeNorm) ? typeNorm : "all";

  let typeClause = "TRUE";
  if (t === "quote") {
    typeClause = `(ed.document_category = 'QUOTE' OR (ed.document_type IS NOT NULL AND ed.document_type LIKE 'quote%'))`;
  } else if (t === "invoice") {
    typeClause = `(ed.document_category = 'INVOICE' OR ed.entity_type = 'invoice' OR (ed.document_type IS NOT NULL AND ed.document_type LIKE 'invoice%'))`;
  } else if (t === "study") {
    typeClause = `(
      ed.document_category = 'COMMERCIAL_PROPOSAL'
      OR ed.document_type IN ('study_pdf', 'study_attachment')
      OR ed.entity_type IN ('study', 'study_version')
    )`;
  } else if (t === "dp") {
    typeClause = `(ed.document_category IN ('DP', 'DP_MAIRIE') OR ed.document_type = 'dp_pdf')`;
  } else if (t === "admin") {
    typeClause = `(ed.document_category = 'ADMINISTRATIVE')`;
  } else if (t === "other") {
    typeClause = `(
      ed.document_category IS NULL
      OR ed.document_category NOT IN ('QUOTE', 'INVOICE', 'COMMERCIAL_PROPOSAL', 'DP', 'DP_MAIRIE', 'ADMINISTRATIVE')
    )`;
  }

  const params = [organizationId];
  let searchClause = "";
  if (searchTrim) {
    const like = `%${searchTrim}%`;
    params.push(like);
    const sp = `$${params.length}`;
    searchClause = `AND (
      ed.file_name ILIKE ${sp}
      OR COALESCE(ed.display_name, '') ILIKE ${sp}
      OR COALESCE(ed.document_type, '') ILIKE ${sp}
      OR NULLIF(TRIM(CONCAT(COALESCE(lr.first_name, ''), ' ', COALESCE(lr.last_name, ''))), '') ILIKE ${sp}
      OR NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), '') ILIKE ${sp}
      OR COALESCE(c.company_name, '') ILIKE ${sp}
      OR NULLIF(TRIM(CONCAT(COALESCE(inv_cl.first_name, ''), ' ', COALESCE(inv_cl.last_name, ''))), '') ILIKE ${sp}
      OR COALESCE(inv_cl.company_name, '') ILIKE ${sp}
    )`;
  }

  params.push(lim, off);
  const limIdx = params.length - 1;
  const offIdx = params.length;

  const fromSql = `
    FROM entity_documents ed
    LEFT JOIN quotes q
      ON ed.entity_type = 'quote' AND q.id = ed.entity_id AND q.organization_id = ed.organization_id
    LEFT JOIN studies st
      ON ed.entity_type = 'study' AND st.id = ed.entity_id AND st.organization_id = ed.organization_id
    LEFT JOIN study_versions sv
      ON ed.entity_type = 'study_version' AND sv.id = ed.entity_id AND sv.organization_id = ed.organization_id
    LEFT JOIN studies st_sv
      ON st_sv.id = sv.study_id AND st_sv.organization_id = ed.organization_id
    LEFT JOIN invoices inv
      ON ed.entity_type = 'invoice' AND inv.id = ed.entity_id AND inv.organization_id = ed.organization_id
    LEFT JOIN quotes inv_q
      ON inv.quote_id IS NOT NULL AND inv_q.id = inv.quote_id AND inv_q.organization_id = ed.organization_id
    LEFT JOIN clients c
      ON ed.entity_type = 'client' AND c.id = ed.entity_id AND c.organization_id = ed.organization_id
    LEFT JOIN clients inv_cl
      ON inv.client_id IS NOT NULL AND inv_cl.id = inv.client_id AND inv_cl.organization_id = ed.organization_id
    LEFT JOIN leads lr
      ON lr.id = COALESCE(
        CASE WHEN ed.entity_type = 'lead' THEN ed.entity_id END,
        q.lead_id,
        st.lead_id,
        st_sv.lead_id,
        inv_q.lead_id
      )
      AND lr.organization_id = ed.organization_id
  `;

  const selectCore = `
    SELECT
      ed.id,
      ed.entity_type,
      ed.entity_id,
      ed.document_type,
      ed.document_category,
      ed.display_name,
      ed.file_name,
      ed.mime_type,
      ed.created_at,
      ed.is_client_visible,
      lr.id AS lead_id,
      NULLIF(TRIM(CONCAT(COALESCE(lr.first_name, ''), ' ', COALESCE(lr.last_name, ''))), '') AS lead_name,
      CASE
        WHEN ed.entity_type = 'client' THEN
          COALESCE(
            NULLIF(TRIM(c.company_name), ''),
            NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), '')
          )
        WHEN ed.entity_type = 'invoice' THEN
          COALESCE(
            NULLIF(TRIM(inv_cl.company_name), ''),
            NULLIF(TRIM(CONCAT(COALESCE(inv_cl.first_name, ''), ' ', COALESCE(inv_cl.last_name, ''))), '')
          )
        ELSE NULL
      END AS client_name
    ${fromSql}
    WHERE ed.organization_id = $1
      AND (ed.archived_at IS NULL)
      AND (${typeClause})
      ${searchClause}
  `;

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM (${selectCore}) AS sub`,
    params.slice(0, params.length - 2)
  );
  const total = countRes.rows[0]?.c ?? 0;

  const dataRes = await pool.query(
    `${selectCore}
     ORDER BY ed.created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );

  return { rows: dataRes.rows, total };
  } catch (err) {
    console.error("DOCUMENTS LIST ERROR:", err);
    return { rows: [], total: 0, limit: lim, offset: off, success: false };
  }
}
