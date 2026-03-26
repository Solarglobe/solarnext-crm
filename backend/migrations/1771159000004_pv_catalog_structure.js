/**
 * CP-002 — Structure catalogue PV prête (phase 1)
 * - modules_per_inverter pour micro-onduleurs
 * - Index performance sur active
 * - Contrainte inverter_type (si absente)
 * Aucune suppression de données. Migration additive uniquement.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  // A) Colonne modules_per_inverter (nullable, pas de NOT NULL)
  pgm.sql(`
    ALTER TABLE pv_inverters
    ADD COLUMN IF NOT EXISTS modules_per_inverter INT;
  `);

  // B) Index performance sur active
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pv_panels_active ON pv_panels(active);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pv_inverters_active ON pv_inverters(active);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pv_batteries_active ON pv_batteries(active);`);

  // C) Contrainte inverter_type — ajout seulement si absente
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inverter_type_check'
          AND conrelid = 'pv_inverters'::regclass
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pv_inverters_inverter_type_check'
          AND conrelid = 'pv_inverters'::regclass
      ) THEN
        ALTER TABLE pv_inverters
        ADD CONSTRAINT inverter_type_check
        CHECK (inverter_type IN ('micro', 'string'));
      END IF;
    END $$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_pv_batteries_active;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_pv_inverters_active;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_pv_panels_active;`);
  pgm.sql(`ALTER TABLE pv_inverters DROP COLUMN IF EXISTS modules_per_inverter;`);
  pgm.sql(`ALTER TABLE pv_inverters DROP CONSTRAINT IF EXISTS inverter_type_check;`);
};
