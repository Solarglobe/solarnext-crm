/**
 * Alignement pgmigrations — correctif facture / lead / payment_terms.
 * Idempotent : bases déjà migrées ; nouvelle base : no-op (compléter si besoin depuis source de vérité).
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
