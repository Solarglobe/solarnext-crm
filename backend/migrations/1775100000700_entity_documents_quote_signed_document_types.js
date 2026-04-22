/**
 * Autorise les types entity_documents utilisés par finalize-signed :
 * PNG signatures + PDF devis signé (quote_pdf_signed).
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;`);
  addConstraintIdempotent(
    pgm,
    "entity_documents",
    "entity_documents_document_type_check",
    `CHECK (
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
        'credit_note_pdf'
      )
    )`
  );
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;`);
  addConstraintIdempotent(
    pgm,
    "entity_documents",
    "entity_documents_document_type_check",
    `CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover',
        'quote_pdf',
        'invoice_pdf',
        'credit_note_pdf'
      )
    )`
  );
};
