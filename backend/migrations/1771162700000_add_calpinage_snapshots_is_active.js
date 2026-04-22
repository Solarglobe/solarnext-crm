/**
 * Réintroduction de la colonne is_active sur calpinage_snapshots et economic_snapshots.
 * Requise par les tests et scripts (scenariosGenerationFromQuoteConfig, test-full-calc-json, etc.)
 * qui insèrent ou filtrent sur is_active.
 */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE calpinage_snapshots
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
  `);
  pgm.sql(`
    ALTER TABLE economic_snapshots
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
  `);
};

export const down = (pgm) => {
  pgm.sql("ALTER TABLE calpinage_snapshots DROP COLUMN IF EXISTS is_active;");
  pgm.sql("ALTER TABLE economic_snapshots DROP COLUMN IF EXISTS is_active;");
};
