/**
 * study_versions.locked_at — date/heure du verrouillage (sélection scénario).
 * Si la colonne existe déjà, ne pas la recréer.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE study_versions ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumns("study_versions", ["locked_at"], { ifExists: true });
};
