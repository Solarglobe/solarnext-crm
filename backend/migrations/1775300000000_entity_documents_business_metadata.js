/**
 * P1 — Métadonnées métier documentaires (catégorie, source, visibilité client, libellés).
 * Prépare filtrage espace client + migration ultérieure des lignes existantes.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createType("entity_document_category", [
    "QUOTE",
    "INVOICE",
    "COMMERCIAL_PROPOSAL",
    "DP_MAIRIE",
    "ADMINISTRATIVE",
    "OTHER",
  ]);
  pgm.createType("entity_document_source_type", ["SYSTEM_GENERATED", "MANUAL_UPLOAD"]);

  pgm.addColumn("entity_documents", {
    document_category: { type: "entity_document_category", notNull: false },
    source_type: { type: "entity_document_source_type", notNull: false },
    is_client_visible: { type: "boolean", notNull: true, default: false },
    display_name: { type: "text", notNull: false },
    description: { type: "text", notNull: false },
  });

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_entity_documents_org_client_visible
    ON entity_documents (organization_id, document_category)
    WHERE archived_at IS NULL AND is_client_visible = true;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_entity_documents_org_client_visible;`);

  pgm.dropColumn("entity_documents", "document_category");
  pgm.dropColumn("entity_documents", "source_type");
  pgm.dropColumn("entity_documents", "is_client_visible");
  pgm.dropColumn("entity_documents", "display_name");
  pgm.dropColumn("entity_documents", "description");

  pgm.dropType("entity_document_source_type");
  pgm.dropType("entity_document_category");
};
