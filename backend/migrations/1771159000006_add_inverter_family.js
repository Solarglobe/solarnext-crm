/**
 * CP-002 — Ajout colonne inverter_family (CENTRAL | MICRO)
 * Migration additive uniquement. Aucune suppression/modification de colonnes existantes.
 * Toutes les lignes existantes reçoivent automatiquement 'CENTRAL' via DEFAULT.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  pgm.sql(`
    ALTER TABLE pv_inverters
    ADD COLUMN IF NOT EXISTS inverter_family VARCHAR(20) NOT NULL DEFAULT 'CENTRAL'
  `);
  pgm.sql(`
    ALTER TABLE pv_inverters
    DROP CONSTRAINT IF EXISTS pv_inverters_inverter_family_check
  `);
  pgm.sql(`
    ALTER TABLE pv_inverters
    ADD CONSTRAINT pv_inverters_inverter_family_check
    CHECK (inverter_family IN ('CENTRAL', 'MICRO'))
  `);
  pgm.sql(`
    UPDATE pv_inverters SET inverter_family = 'CENTRAL' WHERE inverter_family IS NULL
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  pgm.sql(`ALTER TABLE pv_inverters DROP CONSTRAINT IF EXISTS pv_inverters_inverter_family_check`);
  pgm.sql(`ALTER TABLE pv_inverters DROP COLUMN IF EXISTS inverter_family`);
};
