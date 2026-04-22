/**
 * CP-032 — Table entity_documents
 * Upload documents vers Infomaniak (S3) — métadonnées en DB
 * Lien polymorphique : lead | client | study | quote
 */

export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("entity_documents", {
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

    entity_type: {
      type: "varchar(20)",
      notNull: true
    },

    entity_id: {
      type: "uuid",
      notNull: true
    },

    file_name: {
      type: "varchar(255)",
      notNull: true
    },

    file_size: {
      type: "bigint",
      notNull: true
    },

    mime_type: {
      type: "varchar(100)",
      notNull: true
    },

    storage_key: {
      type: "text",
      notNull: true
    },

    url: {
      type: "text",
      notNull: true
    },

    uploaded_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL"
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  pgm.createIndex("entity_documents", ["organization_id"]);
  pgm.createIndex("entity_documents", ["entity_type"]);
  pgm.createIndex("entity_documents", ["entity_id"]);
  pgm.createIndex("entity_documents", ["organization_id", "entity_type", "entity_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("entity_documents");
};
