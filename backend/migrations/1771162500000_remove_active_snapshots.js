/**
 * Version-scope : suppression de la logique "snapshot actif par étude".
 * - calpinage_snapshots : suppression colonne is_active
 * - economic_snapshots : suppression colonne is_active
 * - Index nommés sur study_version_id pour les requêtes version-based
 */

export const up = (pgm) => {
  pgm.sql("ALTER TABLE calpinage_snapshots DROP COLUMN IF EXISTS is_active;");
  pgm.sql("ALTER TABLE economic_snapshots DROP COLUMN IF EXISTS is_active;");
  pgm.sql("CREATE INDEX IF NOT EXISTS idx_calpinage_version ON calpinage_data(study_version_id);");
  pgm.sql("CREATE INDEX IF NOT EXISTS idx_economic_version ON economic_snapshots(study_version_id);");
};

export const down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS idx_economic_version;");
  pgm.sql("DROP INDEX IF EXISTS idx_calpinage_version;");
  pgm.sql(`
    ALTER TABLE calpinage_snapshots
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
  `);
  pgm.sql(`
    ALTER TABLE economic_snapshots
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
  `);
};
