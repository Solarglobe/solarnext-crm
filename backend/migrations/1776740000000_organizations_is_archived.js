/**
 * Super admin : archivage d’organisations (liste masquée par défaut).
 */

export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn("organizations", {
    is_archived: { type: "bool", notNull: true, default: false },
    archived_at: { type: "timestamptz" },
  });
  pgm.createIndex("organizations", ["is_archived"], { name: "organizations_is_archived_idx" });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropIndex("organizations", "organizations_is_archived_idx", { ifExists: true });
  pgm.dropColumn("organizations", "archived_at");
  pgm.dropColumn("organizations", "is_archived");
};
