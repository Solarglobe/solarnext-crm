/**
 * CP-032 / P3 — Point d’entrée documentaire fiches (lead, client, …).
 * Implémentation : EntityDocumentsHub (sections métier + upload enrichi).
 */

export { default } from "./entityDocuments/EntityDocumentsHub";
export type {
  Document,
  DocumentCategory,
  EntityDocument,
} from "./entityDocuments/entityDocumentTypes";
export { normalizeEntityDocument } from "./entityDocuments/normalizeEntityDocument";
