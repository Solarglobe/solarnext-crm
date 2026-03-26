/**
 * CP-019
 * Table: articles
 * Catalogue produits/services
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  pgm.createTable("articles", {
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

    name: {
      type: "varchar(255)",
      notNull: true,
    },

    description: {
      type: "text",
    },

    category: {
      type: "varchar(150)",
    },

    buy_price: {
      type: "numeric",
      notNull: true,
    },

    sell_price: {
      type: "numeric",
      notNull: true,
    },

    vat_rate: {
      type: "numeric",
      notNull: true,
      default: 20,
    },

    unit: {
      type: "varchar(50)",
      default: "unit",
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

  pgm.createIndex("articles", ["organization_id"]);
  pgm.createIndex("articles", ["category"]);
  pgm.createIndex("articles", ["created_at"]);
};

export const down = (pgm) => {
  pgm.dropTable("articles");
};
