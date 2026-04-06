/**
 * Catégories / sources métier — colonnes entity_documents (enums PostgreSQL alignés).
 */

export const ENTITY_DOCUMENT_CATEGORY = Object.freeze({
  QUOTE: "QUOTE",
  INVOICE: "INVOICE",
  COMMERCIAL_PROPOSAL: "COMMERCIAL_PROPOSAL",
  DP_MAIRIE: "DP_MAIRIE",
  ADMINISTRATIVE: "ADMINISTRATIVE",
  OTHER: "OTHER",
});

export const ENTITY_DOCUMENT_SOURCE_TYPE = Object.freeze({
  SYSTEM_GENERATED: "SYSTEM_GENERATED",
  MANUAL_UPLOAD: "MANUAL_UPLOAD",
});

/** @type {ReadonlySet<string>} */
export const ENTITY_DOCUMENT_CATEGORY_VALUES = new Set(Object.values(ENTITY_DOCUMENT_CATEGORY));

/** @type {ReadonlySet<string>} */
export const ENTITY_DOCUMENT_SOURCE_TYPE_VALUES = new Set(Object.values(ENTITY_DOCUMENT_SOURCE_TYPE));
