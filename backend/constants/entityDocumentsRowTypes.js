/**
 * Valeurs `entity_documents.document_type` — workflow devis signé (terrain).
 * La contrainte PostgreSQL `entity_documents_document_type_check` doit les inclure
 * (voir migration `1775100000700_entity_documents_quote_signed_document_types.js`).
 */
export const QUOTE_DOC_SIGNATURE_CLIENT = "quote_signature_client";
export const QUOTE_DOC_SIGNATURE_COMPANY = "quote_signature_company";
export const QUOTE_DOC_PDF_SIGNED = "quote_pdf_signed";
