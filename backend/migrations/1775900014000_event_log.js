/**
 * CP-085 — Journal d’événements système (audit / automatisations futures).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("system_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      references: "organizations",
      onDelete: "CASCADE",
    },
    type: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("system_events", ["organization_id"], { name: "idx_system_events_org" });
  pgm.createIndex("system_events", ["type"], { name: "idx_system_events_type" });
  pgm.sql(`
    CREATE INDEX idx_system_events_created_at_desc
    ON system_events (created_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_system_events_created_at_desc;`);
  pgm.dropTable("system_events");
};
