/**
 * Ajoute entity_documents.document_type (ex: consumption_csv) pour une détection fiable du CSV conso.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE entity_documents ADD COLUMN IF NOT EXISTS document_type text NULL`);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'entity_documents_document_type_check'
      ) THEN
        ALTER TABLE entity_documents
        ADD CONSTRAINT entity_documents_document_type_check
        CHECK (
          document_type IS NULL
          OR document_type IN (
            'consumption_csv',
            'lead_attachment',
            'study_attachment'
          )
        );
      END IF;
    END $$;
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_entity_documents_type
    ON entity_documents (organization_id, entity_type, entity_id, document_type)
    WHERE archived_at IS NULL
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_entity_documents_type`);
  pgm.sql(`ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check`);
  pgm.sql(`ALTER TABLE entity_documents DROP COLUMN IF EXISTS document_type`);
};
