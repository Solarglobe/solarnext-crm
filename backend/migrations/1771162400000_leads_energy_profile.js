/**
 * Ajoute leads.energy_profile (jsonb) pour stocker le profil énergie CSV (courbe de charge).
 * Exposé par GET /api/leads/:id et GET /api/studies/:studyId (lead.energy_profile).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS energy_profile jsonb NULL`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS energy_profile`);
};
