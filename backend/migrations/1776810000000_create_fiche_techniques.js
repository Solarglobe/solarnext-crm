/**
 * Fiches techniques PDF (catalogue installation) — stockage local + métadonnées.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("fiche_techniques", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    name: { type: "text", notNull: true },
    reference: { type: "text", notNull: true },
    brand: { type: "text" },
    category: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "active" },
    /** Chemin relatif stockage (même convention que entity_documents.storage_key). */
    file_url: { type: "text", notNull: true },
    file_name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    is_favorite: { type: "boolean", notNull: true, default: false },
    created_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
  });
  pgm.addConstraint("fiche_techniques", "fiche_techniques_status_check", {
    check: "status IN ('active', 'obsolete', 'recommended')",
  });
  pgm.createIndex("fiche_techniques", ["organization_id", "category"], {
    name: "idx_fiche_techniques_org_category",
  });
  pgm.createIndex("fiche_techniques", ["organization_id", "created_at"], {
    name: "idx_fiche_techniques_org_created",
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("fiche_techniques", { ifExists: true });
};
