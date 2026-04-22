/**
 * CP-SNAPSHOT — Alter : ajout study_version_id + CHECK si table créée avec ancienne migration.
 */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'calpinage_snapshots' AND column_name = 'study_version_id'
      ) THEN
        ALTER TABLE calpinage_snapshots
          ADD COLUMN study_version_id UUID REFERENCES study_versions(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS calpinage_snapshots_study_version_id_idx
    ON calpinage_snapshots(study_version_id);
  `);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calpinage_snapshots_snapshot_json_not_null'
      ) THEN
        ALTER TABLE "calpinage_snapshots"
        ADD CONSTRAINT "calpinage_snapshots_snapshot_json_not_null"
        CHECK (snapshot_json IS NOT NULL);
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE calpinage_snapshots DROP CONSTRAINT IF EXISTS calpinage_snapshots_snapshot_json_not_null;`);
  pgm.sql(`DROP INDEX IF EXISTS calpinage_snapshots_study_version_id_idx;`);
  pgm.sql(`ALTER TABLE calpinage_snapshots DROP COLUMN IF EXISTS study_version_id;`);
};
