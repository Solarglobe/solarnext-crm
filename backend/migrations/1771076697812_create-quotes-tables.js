/**
 * CP-020
 * Tables: quotes + quote_lines
 * Devis V1 complet
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  /*
    TABLE QUOTES
  */
  pgm.createTable("quotes", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },

    client_id: {
      type: "uuid",
      notNull: true,
      references: "clients",
      onDelete: "RESTRICT",
    },

    study_version_id: {
      type: "uuid",
      references: "study_versions",
      onDelete: "SET NULL",
    },

    quote_number: {
      type: "varchar(100)",
      notNull: true,
    },

    status: {
      type: "varchar(50)",
      notNull: true,
      default: "draft",
    },

    total_ht: {
      type: "numeric",
      notNull: true,
      default: 0,
    },

    total_vat: {
      type: "numeric",
      notNull: true,
      default: 0,
    },

    total_ttc: {
      type: "numeric",
      notNull: true,
      default: 0,
    },

    valid_until: {
      type: "date",
    },

    notes: {
      type: "text",
    },

    metadata_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("quotes", "quotes_unique_number_per_org", {
    unique: ["organization_id", "quote_number"],
  });

  pgm.createIndex("quotes", ["organization_id"]);
  pgm.createIndex("quotes", ["client_id"]);
  pgm.createIndex("quotes", ["status"]);
  pgm.createIndex("quotes", ["created_at"]);

  /*
    TABLE QUOTE_LINES
  */
  pgm.createTable("quote_lines", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },

    quote_id: {
      type: "uuid",
      notNull: true,
      references: "quotes",
      onDelete: "CASCADE",
    },

    article_id: {
      type: "uuid",
      references: "articles",
      onDelete: "SET NULL",
    },

    description: {
      type: "text",
      notNull: true,
    },

    quantity: {
      type: "numeric",
      notNull: true,
      default: 1,
    },

    unit_price_ht: {
      type: "numeric",
      notNull: true,
    },

    vat_rate: {
      type: "numeric",
      notNull: true,
    },

    total_line_ht: {
      type: "numeric",
      notNull: true,
    },

    total_line_vat: {
      type: "numeric",
      notNull: true,
    },

    total_line_ttc: {
      type: "numeric",
      notNull: true,
    },

    position: {
      type: "integer",
      notNull: true,
      default: 1,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("quote_lines", ["organization_id"]);
  pgm.createIndex("quote_lines", ["quote_id"]);
  pgm.createIndex("quote_lines", ["article_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("quote_lines");
  pgm.dropTable("quotes");
};
