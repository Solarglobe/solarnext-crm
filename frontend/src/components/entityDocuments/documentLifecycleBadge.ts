/**
 * Statut documentaire strictement dérivé de document_type (pas d’heuristique).
 * Obligatoire métier : devis PDF vs devis signé.
 */

export type DocumentLifecycleVariant = "draft" | "signed";

export interface DocumentLifecycleInfo {
  label: string;
  variant: DocumentLifecycleVariant;
}

/** Types connus en base (contrainte entity_documents_document_type_check) — on n’affiche un badge cycle que là où c’est clair. */
export function resolveDocumentLifecycleBadge(
  documentType: string | null | undefined
): DocumentLifecycleInfo | null {
  const t = documentType != null ? String(documentType).trim() : "";
  if (t === "quote_pdf") {
    return { label: "Brouillon", variant: "draft" };
  }
  if (t === "quote_pdf_signed") {
    return { label: "Signé", variant: "signed" };
  }
  return null;
}
