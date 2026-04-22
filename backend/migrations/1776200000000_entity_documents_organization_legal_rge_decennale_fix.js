/**
 * Types entity_documents : organization_legal_cgv, organization_legal_rge, organization_legal_decennale,
 * et réintroduction de mail_attachment dans la contrainte CHECK.
 *
 * Remplace l’ancien fichier 1776000000000 (retiré) : un timestamp inférieur à 1776100000000 aurait créé
 * une migration pendante avant une migration déjà exécutée — interdit par node-pg-migrate.
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

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
        'organization_legal_cgv',
        'organization_legal_rge',
        'organization_legal_decennale',
        'quote_pdf',
        'quote_pdf_signed',
        'quote_signature_client',
        'quote_signature_company',
        'invoice_pdf',
        'credit_note_pdf',
        'dp_pdf',
        'mail_attachment'
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
        'legal_cgv',
        'quote_pdf',
        'quote_pdf_signed',
        'quote_signature_client',
        'quote_signature_company',
        'invoice_pdf',
        'credit_note_pdf',
        'dp_pdf'
      )
    )`
  );
};
