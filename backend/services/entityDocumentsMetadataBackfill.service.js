/**
 * Backfill P2 — attribution catégorie / source / visibilité / display_name pour entity_documents.
 * Logique pure + exécution batch (idempotente si les règles sont stables).
 */

import {
  QUOTE_DOC_PDF_SIGNED,
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
} from "../constants/entityDocumentsRowTypes.js";
import {
  ENTITY_DOCUMENT_CATEGORY,
  ENTITY_DOCUMENT_SOURCE_TYPE,
} from "../constants/entityDocumentBusiness.js";

/** @param {string|null|undefined} documentType */
export function inferDocumentCategory(documentType) {
  const t = documentType ? String(documentType).trim() : "";
  switch (t) {
    case "quote_pdf":
    case QUOTE_DOC_PDF_SIGNED:
      return ENTITY_DOCUMENT_CATEGORY.QUOTE;
    case "invoice_pdf":
    case "credit_note_pdf":
      return ENTITY_DOCUMENT_CATEGORY.INVOICE;
    case "study_pdf":
      return ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL;
    case "dp_pdf":
      return ENTITY_DOCUMENT_CATEGORY.DP;
    case QUOTE_DOC_SIGNATURE_CLIENT:
    case QUOTE_DOC_SIGNATURE_COMPANY:
      return ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE;
    case "consumption_csv":
      return ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE;
    case "organization_pdf_cover":
      return ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE;
    case "lead_attachment":
    case "study_attachment":
      return ENTITY_DOCUMENT_CATEGORY.OTHER;
    case "dp_mairie":
      return ENTITY_DOCUMENT_CATEGORY.DP_MAIRIE;
    default:
      return ENTITY_DOCUMENT_CATEGORY.OTHER;
  }
}

/**
 * @param {string|null|undefined} documentType
 * @param {{ uploaded_by?: string|null }} row
 */
export function inferSourceType(documentType, row) {
  const t = documentType ? String(documentType).trim() : "";
  const manualTypes = new Set([
    "lead_attachment",
    "study_attachment",
    "organization_pdf_cover",
  ]);
  if (manualTypes.has(t)) {
    return ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD;
  }
  if (t === "consumption_csv") {
    const uid = row?.uploaded_by;
    if (uid != null && String(uid).trim() !== "") {
      return ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD;
    }
    return ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED;
  }
  if (!t) {
    return ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD;
  }
  const systemTypes = new Set([
    "quote_pdf",
    QUOTE_DOC_PDF_SIGNED,
    "invoice_pdf",
    "credit_note_pdf",
    "study_pdf",
    "dp_pdf",
    QUOTE_DOC_SIGNATURE_CLIENT,
    QUOTE_DOC_SIGNATURE_COMPANY,
  ]);
  if (systemTypes.has(t)) {
    return ENTITY_DOCUMENT_SOURCE_TYPE.SYSTEM_GENERATED;
  }
  return ENTITY_DOCUMENT_SOURCE_TYPE.MANUAL_UPLOAD;
}

/** @param {string} category */
export function visibilityForCategory(category) {
  return (
    category === ENTITY_DOCUMENT_CATEGORY.QUOTE ||
    category === ENTITY_DOCUMENT_CATEGORY.INVOICE ||
    category === ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL ||
    category === ENTITY_DOCUMENT_CATEGORY.DP
  );
}

/**
 * Nom de fichier jugé trop « technique » pour servir de libellé UX.
 * @param {string|null|undefined} fileName
 */
export function looksLikeTechnicalFileName(fileName) {
  const raw = fileName != null ? String(fileName).trim() : "";
  if (!raw) return true;
  const base = raw.split(/[/\\]/).pop() || raw;
  if (base.length > 120) return true;
  if (/^file[_-]?\d+\./i.test(base)) return true;
  if (/^doc[_-]?\d+\./i.test(base)) return true;
  if (/^temp[_-]/i.test(base)) return true;
  if (/solarnext-(devis|facture|study|devis-signe)/i.test(base)) return true;
  if (/^devis-signe-/i.test(base)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i.test(base)) return true;
  if (/^[a-z0-9_-]{20,}\.(pdf|png|csv|jpg|jpeg)$/i.test(base) && !/[àâäéèêëïîôùûç\s]/i.test(base)) {
    return true;
  }
  return false;
}

/**
 * @param {object} ctx
 * @param {string} ctx.category
 * @param {string|null|undefined} ctx.documentType
 * @param {string|null|undefined} ctx.fileName
 * @param {string|null|undefined} ctx.entityType
 * @param {string|null|undefined} ctx.quoteNumber
 * @param {string|null|undefined} ctx.invoiceNumber
 * @param {string|null|undefined} ctx.creditNoteNumber
 */
export function buildDisplayName(ctx) {
  const { category, documentType, fileName, entityType, quoteNumber, invoiceNumber, creditNoteNumber } = ctx;
  const dt = documentType ? String(documentType).trim() : "";

  if (category === ENTITY_DOCUMENT_CATEGORY.QUOTE) {
    const n = quoteNumber != null ? String(quoteNumber).trim() : "";
    return n ? `Devis ${n}` : "Devis";
  }

  if (category === ENTITY_DOCUMENT_CATEGORY.INVOICE) {
    if (dt === "credit_note_pdf" || entityType === "credit_note") {
      const n = creditNoteNumber != null ? String(creditNoteNumber).trim() : "";
      return n ? `Avoir ${n}` : "Avoir";
    }
    const n = invoiceNumber != null ? String(invoiceNumber).trim() : "";
    return n ? `Facture ${n}` : "Facture";
  }

  if (category === ENTITY_DOCUMENT_CATEGORY.COMMERCIAL_PROPOSAL) {
    return "Proposition commerciale – Étude solaire";
  }

  if (category === ENTITY_DOCUMENT_CATEGORY.DP) {
    if (!looksLikeTechnicalFileName(fileName)) {
      const t = fileName != null ? String(fileName).trim() : "";
      if (t) return t.replace(/\.[^.]+$/, "") || t;
    }
    return "Document DP";
  }

  if (category === ENTITY_DOCUMENT_CATEGORY.DP_MAIRIE) {
    if (!looksLikeTechnicalFileName(fileName)) {
      const t = fileName != null ? String(fileName).trim() : "";
      if (t) return t.replace(/\.[^.]+$/, "") || t;
    }
    return "Document administratif";
  }

  if (category === ENTITY_DOCUMENT_CATEGORY.ADMINISTRATIVE) {
    if (dt === QUOTE_DOC_SIGNATURE_CLIENT) return "Signature client";
    if (dt === QUOTE_DOC_SIGNATURE_COMPANY) return "Signature entreprise";
    if (dt === "organization_pdf_cover") return "Couverture PDF";
    if (dt === "consumption_csv") {
      if (!looksLikeTechnicalFileName(fileName)) {
        const t = fileName != null ? String(fileName).trim() : "";
        if (t) return t.replace(/\.[^.]+$/, "") || t;
      }
      return "Document administratif";
    }
    return "Document administratif";
  }

  if (category === ENTITY_DOCUMENT_CATEGORY.OTHER) {
    if (!looksLikeTechnicalFileName(fileName)) {
      const t = fileName != null ? String(fileName).trim() : "";
      if (t) {
        const noExt = t.replace(/\.[^.]+$/, "");
        return noExt || t;
      }
    }
    return "Document";
  }

  return "Document";
}

/**
 * @param {Record<string, unknown>} row — ligne entity_documents + jointures optionnelles quote_number, invoice_number, credit_note_number
 */
export function computeBackfillPatch(row) {
  const documentType = row.document_type != null ? String(row.document_type) : null;
  const category = inferDocumentCategory(documentType);
  const source_type = inferSourceType(documentType, { uploaded_by: row.uploaded_by });
  const is_client_visible = visibilityForCategory(category);
  const display_name = buildDisplayName({
    category,
    documentType,
    fileName: row.file_name,
    entityType: row.entity_type,
    quoteNumber: row.quote_number,
    invoiceNumber: row.invoice_number,
    creditNoteNumber: row.credit_note_number,
  });

  return {
    document_category: category,
    source_type,
    is_client_visible,
    display_name,
  };
}
