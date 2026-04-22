/**
 * Date de naissance — fiche lead/client + alimentation mandat de représentation (DP).
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS birth_date date NULL`);
  pgm.sql(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date date NULL`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS birth_date`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS birth_date`);
};
