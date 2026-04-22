/**
 * CP-075 — Pièces jointes mail ↔ entity_documents (lien + dédup SHA256).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_attachments", {
    document_id: {
      type: "uuid",
      references: "entity_documents",
      onDelete: "SET NULL",
    },
    content_sha256: { type: "text" },
  });

  pgm.createIndex("mail_attachments", ["document_id"], {
    name: "idx_mail_attachments_document_id",
  });

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_attachments_message_sha
    ON mail_attachments (mail_message_id, content_sha256)
    WHERE content_sha256 IS NOT NULL;
  `);

  pgm.sql(`
    ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;
    ALTER TABLE entity_documents ADD CONSTRAINT entity_documents_document_type_check
    CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover',
        'quote_pdf',
        'quote_pdf_signed',
        'quote_signature_client',
        'quote_signature_company',
        'invoice_pdf',
        'credit_note_pdf',
        'dp_pdf',
        'mail_attachment'
      )
    );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE entity_documents DROP CONSTRAINT IF EXISTS entity_documents_document_type_check;
    ALTER TABLE entity_documents ADD CONSTRAINT entity_documents_document_type_check
    CHECK (
      document_type IS NULL
      OR document_type IN (
        'consumption_csv',
        'lead_attachment',
        'study_attachment',
        'study_pdf',
        'organization_pdf_cover',
        'quote_pdf',
        'quote_pdf_signed',
        'quote_signature_client',
        'quote_signature_company',
        'invoice_pdf',
        'credit_note_pdf',
        'dp_pdf'
      )
    );
  `);

  pgm.sql(`DROP INDEX IF EXISTS uq_mail_attachments_message_sha;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_attachments_document_id;`);
  pgm.dropColumns("mail_attachments", ["document_id", "content_sha256"]);
};
