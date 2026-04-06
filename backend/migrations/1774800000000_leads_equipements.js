/**
 * Colonnes équipements sur leads — alignement pgmigrations + idempotent.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS equipement_actuel varchar(50);`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS equipement_actuel_params jsonb;`);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS equipements_a_venir jsonb;`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS equipements_a_venir;`);
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS equipement_actuel_params;`);
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS equipement_actuel;`);
};
