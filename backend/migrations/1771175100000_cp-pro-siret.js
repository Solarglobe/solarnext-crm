/**
 * CP-PRO-SIRET — Ajout du champ SIRET sur leads et clients
 * Additive, rétrocompatible — NULL par défaut, aucune contrainte NOT NULL
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS siret varchar(20) NULL`);
  pgm.sql(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS siret varchar(20) NULL`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS siret`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS siret`);
};
