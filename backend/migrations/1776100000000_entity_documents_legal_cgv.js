/**
 * Types entity_documents : valeur court terme `legal_cgv` (avant alignement organization_legal_* en 1776200000000).
 * Fichier reconstitué pour l’historique git et les bases neuves ; l’état appliqué doit correspondre à la contrainte en base.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;
    ALTER TABLE entity_documents ADD CONSTRAINT entity_documents_document_type_check
    CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover',
        'legal_cgv',
        'quote_pdf',
        'quote_pdf_signed',
        'quote_signature_client',
        'quote_signature_company',
        'invoice_pdf',
        'credit_note_pdf',
        'dp_pdf'
      )
    );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;
    ALTER TABLE entity_documents ADD CONSTRAINT entity_documents_document_type_check
    CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover',
        'quote_pdf',
        'quote_pdf_signed',
        'quote_signature_client',
        'quote_signature_company',
        'invoice_pdf',
        'credit_note_pdf',
        'dp_pdf',
        'mail_attachment'
      )
    );
  `);
};
