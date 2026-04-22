/**
 * Alignement pgmigrations — correctif facture / lead / payment_terms (série 1774800000001).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`SELECT 1`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`SELECT 1`);
};
