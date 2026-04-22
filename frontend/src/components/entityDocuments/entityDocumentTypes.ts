/**
 * Types métier — alignés sur l’API entity_documents (camelCase + snake historique).
 */

export type DocumentCategory =
  | "QUOTE"
  | "INVOICE"
  | "COMMERCIAL_PROPOSAL"
  | "DP"
  | "DP_MAIRIE"
  | "ADMINISTRATIVE"
  | "OTHER";

export type DocumentSourceType = "SYSTEM_GENERATED" | "MANUAL_UPLOAD";

export type DocumentSectionKey = DocumentCategory;

export interface EntityDocument {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  document_type?: string | null;
  documentCategory: DocumentCategory | null;
  sourceType: DocumentSourceType | null;
  isClientVisible: boolean;
  displayName: string | null;
  description: string | null;
}

/** @deprecated utiliser EntityDocument — alias pour compat LeadDetail */
export type Document = EntityDocument;
