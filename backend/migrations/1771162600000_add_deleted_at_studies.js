/**
 * Soft delete études : colonne deleted_at.
 * Les listages filtrent par deleted_at IS NULL.
 */

export const up = (pgm) => {
  pgm.sql("ALTER TABLE studies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;");
  pgm.sql("CREATE INDEX IF NOT EXISTS idx_studies_deleted ON studies(deleted_at);");
};

export const down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS idx_studies_deleted;");
  pgm.sql("ALTER TABLE studies DROP COLUMN IF EXISTS deleted_at;");
};
