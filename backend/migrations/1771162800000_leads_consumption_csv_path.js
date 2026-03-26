/**
 * Ajoute leads.consumption_csv_path pour transmettre un chemin CSV au calcul.
 * Quand ce champ est renseigné, solarnextPayloadBuilder l’injecte dans payload.consommation.csv_path
 * afin que loadConsumption() utilise le CSV en priorité (règle métier).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption_csv_path text NULL`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS consumption_csv_path`);
};
