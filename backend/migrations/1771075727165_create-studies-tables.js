/**
 * CP-015
 * Tables: studies + study_versions
 * Versioning rule:
 * - New study => new row in studies
 * - Edit => new row in study_versions
 * Non-destructive
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  // Dependencies
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  // Main table: studies (stable entity)
  pgm.createTable("studies", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: { type: "uuid", notNull: true, references: "organizations", onDelete: "CASCADE" },

    // Optional links (future-proof)
    client_id: { type: "uuid", references: "clients", onDelete: "SET NULL" },
    lead_id: { type: "uuid", references: "leads", onDelete: "SET NULL" },

    // Human refs
    study_number: { type: "varchar(50)", notNull: true },

    // Status/workflow (light V1)
    status: { type: "varchar(50)", notNull: true, default: "draft" },

    // Audit
    created_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Indexes studies
  pgm.createIndex("studies", ["organization_id"]);
  pgm.createIndex("studies", ["study_number"]);
  pgm.createIndex("studies", ["client_id"]);
  pgm.createIndex("studies", ["lead_id"]);
  pgm.createIndex("studies", ["status"]);

  // Version table: study_versions (append-only snapshots)
  pgm.createTable("study_versions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: { type: "uuid", notNull: true, references: "organizations", onDelete: "CASCADE" },

    study_id: { type: "uuid", notNull: true, references: "studies", onDelete: "CASCADE" },

    // Strict versioning
    version_number: { type: "integer", notNull: true },

    // Snapshot payload (V1)
    title: { type: "varchar(255)" },
    summary: { type: "text" },
    data_json: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },

    // Audit
    created_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Enforce unique version per study (and per org)
  pgm.addConstraint(
    "study_versions",
    "study_versions_study_id_version_number_unique",
    {
      unique: ["study_id", "version_number"],
    }
  );

  // Indexes study_versions
  pgm.createIndex("study_versions", ["organization_id"]);
  pgm.createIndex("study_versions", ["study_id"]);
  pgm.createIndex("study_versions", ["study_id", "version_number"]);
  pgm.createIndex("study_versions", ["created_at"]);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  // Reverse order (child then parent)
  pgm.dropTable("study_versions");
  pgm.dropTable("studies");
};
