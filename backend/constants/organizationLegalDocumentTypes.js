/**
 * PDFs légaux d'organisation (entity_documents.document_type) — annexes devis optionnelles.
 */
export const ORGANIZATION_LEGAL_DOCUMENT_TYPE = {
  CGV_PDF: "organization_legal_cgv",
  RGE: "organization_legal_rge",
  DECENNALE: "organization_legal_decennale",
};

/** Clés métier pour getOrganizationLegalDocument(orgId, kind) */
export const ORGANIZATION_LEGAL_DOC_KIND = {
  RGE: "legal_rge",
  DECENNALE: "legal_decennale",
};

const KIND_TO_DB = {
  [ORGANIZATION_LEGAL_DOC_KIND.RGE]: ORGANIZATION_LEGAL_DOCUMENT_TYPE.RGE,
  [ORGANIZATION_LEGAL_DOC_KIND.DECENNALE]: ORGANIZATION_LEGAL_DOCUMENT_TYPE.DECENNALE,
};

/**
 * @param {string} kind — 'legal_rge' | 'legal_decennale' (ou document_type complet)
 * @returns {string|null}
 */
export function resolveOrganizationLegalDocumentType(kind) {
  if (!kind || typeof kind !== "string") return null;
  if (KIND_TO_DB[kind]) return KIND_TO_DB[kind];
  if (Object.values(ORGANIZATION_LEGAL_DOCUMENT_TYPE).includes(kind)) return kind;
  return null;
}
