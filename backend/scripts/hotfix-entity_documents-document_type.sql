-- Hotfix: ajouter entity_documents.document_type si la migration n'a pas été appliquée.
-- Exécuter avec: psql $DATABASE_URL -f backend/scripts/hotfix-entity_documents-document_type.sql
-- ou depuis un client SQL connecté à la base.

ALTER TABLE entity_documents
ADD COLUMN IF NOT EXISTS document_type text NULL;

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

CREATE INDEX IF NOT EXISTS idx_entity_documents_type
ON entity_documents (organization_id, entity_type, entity_id, document_type)
WHERE archived_at IS NULL;
