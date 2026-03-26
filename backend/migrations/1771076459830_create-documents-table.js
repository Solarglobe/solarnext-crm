/**
 * CP-018
 * Table: documents
 * Document library (Infomaniak storage)
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("documents", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },

    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE"
    },

    study_version_id: {
      type: "uuid",
      references: "study_versions",
      onDelete: "CASCADE"
    },

    client_id: {
      type: "uuid",
      references: "clients",
      onDelete: "SET NULL"
    },

    document_type: {
      type: "varchar(100)",
      notNull: true
    },

    storage_provider: {
      type: "varchar(50)",
      notNull: true,
      default: "infomaniak"
    },

    file_name: {
      type: "varchar(255)",
      notNull: true
    },

    file_url: {
      type: "text",
      notNull: true
    },

    file_path: {
      type: "text"
    },

    version_number: {
      type: "integer",
      default: 1
    },

    tags: {
      type: "jsonb",
      default: pgm.func("'[]'::jsonb")
    },

    metadata_json: {
      type: "jsonb",
      default: pgm.func("'{}'::jsonb")
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.createIndex("documents", ["organization_id"]);
  pgm.createIndex("documents", ["study_version_id"]);
  pgm.createIndex("documents", ["client_id"]);
  pgm.createIndex("documents", ["document_type"]);
  pgm.createIndex("documents", ["created_at"]);
};

export const down = (pgm) => {
  pgm.dropTable("documents");
};
