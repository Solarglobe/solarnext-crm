/**
 * Image de couverture PDF — organisations
 * Stocke le storage_key du fichier dans entity_documents (page 1 PDF SolarNext)
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pdf_cover_image_key TEXT`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE organizations DROP COLUMN IF EXISTS pdf_cover_image_key`);
};
