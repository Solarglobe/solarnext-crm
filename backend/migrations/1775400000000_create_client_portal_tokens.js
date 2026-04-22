/**
 * Portail client SolarGlobe — tokens opaques (hash SHA-256 stocké).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  pgm.createTable("client_portal_tokens", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    lead_id: {
      type: "uuid",
      notNull: true,
      references: "leads",
      onDelete: "CASCADE",
    },
    token_hash: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    expires_at: { type: "timestamptz" },
    revoked_at: { type: "timestamptz" },
    last_used_at: { type: "timestamptz" },
  });

  pgm.createIndex("client_portal_tokens", ["lead_id"]);
  pgm.createIndex("client_portal_tokens", ["organization_id"]);

  /* Un seul jeton non révoqué par lead (rotation = révoquer puis recréer). */
  pgm.sql(`
    CREATE UNIQUE INDEX client_portal_tokens_one_active_per_lead
    ON client_portal_tokens (lead_id)
    WHERE revoked_at IS NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS client_portal_tokens_one_active_per_lead`);
  pgm.dropTable("client_portal_tokens");
};
