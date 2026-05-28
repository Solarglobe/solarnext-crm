/**
 * Keep study version maintenance queries compatible with fresh and existing DBs.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE study_versions
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_study_versions_deleted_at
      ON study_versions(deleted_at)
      WHERE deleted_at IS NOT NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_study_versions_deleted_at;

    ALTER TABLE study_versions
      DROP COLUMN IF EXISTS deleted_at,
      DROP COLUMN IF EXISTS deleted_by;
  `);
};
