/**
 * Métadonnées métier centralisées pour entity_documents (catégorie, source, visibilité client).
 */

import {
  ENTITY_DOCUMENT_CATEGORY,
  ENTITY_DOCUMENT_CATEGORY_VALUES,
  ENTITY_DOCUMENT_SOURCE_TYPE,
} from "../constants/entityDocumentBusiness.js";

export { ENTITY_DOCUMENT_CATEGORY, ENTITY_DOCUMENT_SOURCE_TYPE };

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function stripPdfExtension(name) {
  const t = trimOrNull(name);
  if (!t) return null;
  return t.replace(/\.pdf$/i, "") || null;
}

/**
 * Visibilité client par défaut selon la catégorie métier.
 * @param {string|null} category
 */
export function defaultClientVisibleForCategory(category) {
  if (!category) return false;
  return (
    category === ENTITY_DOCUMENT_CATEGORY.QUOTE ||
    category === ENTITY_DOCUMENT_CATEGORY.INVOICE ||
    category === ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL
  );
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseDocumentCategory(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const s = String(raw).trim().toUpperCase();
  if (!ENTITY_DOCUMENT_CATEGORY_VALUES.has(s)) {
    return { ok: false, error: "INVALID_DOCUMENT_CATEGORY" };
  }
  return { ok: true, value: s };
}

/**
 * Défauts pour un upload manuel selon document_type technique (nullable).
 * @param {string|null} documentType
 */
function manualDefaultsForDocumentType(documentType) {
  const t = documentType ? String(documentType) : "";
  switch (t) {
    case "consumption_csv":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: false,
      };
    case "study_pdf":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: true,
      };
    case "organization_pdf_cover":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: false,
      };
    case "lead_attachment":
    case "study_attachment":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.OTHER,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: false,
      };
    default:
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.OTHER,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: false,
      };
  }
}

/**
 * Fusionne champs multipart / JSON pour un upload manuel (multer : body string).
 * @param {string|null} documentType
 * @param {Record<string, unknown>} body — req.body
 * @returns {{ ok: true, meta: object } | { ok: false, error: string }}
 */
export function resolveManualUploadDocumentMeta(documentType, body) {
  const b = body && typeof body === "object" ? body : {};
  const rawCat = b.document_category ?? b.documentCategory;
  const parsed = parseDocumentCategory(rawCat);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const base = manualDefaultsForDocumentType(documentType);
  const finalCategory = parsed.value ?? base.document_category;

  const rawVis = b.is_client_visible ?? b.isClientVisible;
  let isVisible;
  if (rawVis === undefined || rawVis === null || rawVis === "") {
    isVisible = defaultClientVisibleForCategory(finalCategory);
  } else if (rawVis === false || rawVis === "false" || rawVis === "0") {
    isVisible = false;
  } else {
    isVisible = rawVis === true || rawVis === "true" || rawVis === "1";
  }

  return {
    ok: true,
    meta: {
      document_category: finalCategory,
      source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
      is_client_visible: isVisible,
      display_name: trimOrNull(b.display_name ?? b.displayName),
      description: trimOrNull(b.description),
    },
  };
}

/**
 * Métadonnées pour documents créés par le système (PDF, signatures, CSV auto, etc.).
 * @param {string} documentType — valeur entity_documents.document_type
 * @param {object} [opts]
 * @param {string|null} [opts.numberForLabel] — ex. numéro devis / facture pour display_name
 * @param {string|null} [opts.displayName] — force le libellé métier
 * @param {string|null} [opts.fileName] — nom fichier physique (ex. étude PDF)
 * @param {boolean} [opts.manualConsumptionCsv] — CSV conso uploadé à la main via CRM
 * @param {string|null} [opts.description]
 */
export function resolveSystemDocumentMetadata(documentType, opts = {}) {
  const displayNameOverride = trimOrNull(opts.displayName);
  const description = trimOrNull(opts.description);
  const num = trimOrNull(opts.numberForLabel);

  const dt = documentType ? String(documentType) : "";

  switch (dt) {
    case "quote_pdf":
    case "quote_pdf_signed":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.QUOTE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: true,
        display_name: displayNameOverride || (num ? `Devis ${num}` : null),
        description,
      };
    case "invoice_pdf":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.INVOICE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: true,
        display_name: displayNameOverride || (num ? `Facture ${num}` : null),
        description,
      };
    case "credit_note_pdf":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.INVOICE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: true,
        display_name: displayNameOverride || (num ? `Avoir ${num}` : null),
        description,
      };
    case "study_pdf":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: true,
        display_name: displayNameOverride || stripPdfExtension(opts.fileName) || null,
        description,
      };
    case "quote_signature_client":
    case "quote_signature_company":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: false,
        display_name: displayNameOverride,
        description,
      };
    case "consumption_csv":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE,
        source_type: opts.manualConsumptionCsv
          ? ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD
          : ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: false,
        display_name: displayNameOverride,
        description,
      };
    case "organization_pdf_cover":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: false,
        display_name: displayNameOverride || "Couverture PDF",
        description,
      };
    case "lead_attachment":
    case "study_attachment":
      return {
        document_category: ENTITY_DOCUMENT_CATEGORY.OTHER,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD,
        is_client_visible: false,
        display_name: displayNameOverride,
        description,
      };
    default:
      return {
        document_category: null,
        source_type: ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED,
        is_client_visible: false,
        display_name: displayNameOverride,
        description,
      };
  }
}

/** Alias explicite P1 — défauts métier pour documents créés par le système. */
export const resolveDefaultDocumentMeta = resolveSystemDocumentMetadata;

/**
 * Ajoute les alias camelCase attendus par l’API (sans retirer les colonnes SQL).
 * @param {Record<string, unknown>|null|undefined} row
 */
export function addDocumentApiAliases(row) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    documentCategory: row.document_category ?? null,
    sourceType: row.source_type ?? null,
    isClientVisible: row.is_client_visible === true,
    displayName: row.display_name ?? null,
    description: row.description ?? null,
  };
}
