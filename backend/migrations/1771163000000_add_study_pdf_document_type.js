/**
 * PDF V2 — Ajoute study_pdf au document_type pour les PDF générés par Playwright.
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
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
        'study_pdf'
      )
    )`
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
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
        'study_attachment'
      )
    )`
  );
};
