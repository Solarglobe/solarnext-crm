/**
 * CP-FIN-DOC — Snapshot documentaire officiel (quotes / invoices / credit_notes)
 * + metadata_json sur entity_documents pour traçabilité PDF CRM.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn(
    "quotes",
    {
      document_snapshot_json: { type: "jsonb", notNull: false },
    },
    { ifNotExists: true }
  );
  pgm.addColumn(
    "invoices",
    {
      document_snapshot_json: { type: "jsonb", notNull: false },
    },
    { ifNotExists: true }
  );
  pgm.addColumn(
    "credit_notes",
    {
      document_snapshot_json: { type: "jsonb", notNull: false },
    },
    { ifNotExists: true }
  );
  pgm.sql(`
    ALTER TABLE entity_documents ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE entity_documents DROP COLUMN IF EXISTS metadata_json;`);
  pgm.dropColumn("credit_notes", "document_snapshot_json", { ifExists: true });
  pgm.dropColumn("invoices", "document_snapshot_json", { ifExists: true });
  pgm.dropColumn("quotes", "document_snapshot_json", { ifExists: true });
};
