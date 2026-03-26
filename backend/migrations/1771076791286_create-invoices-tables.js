/**
 * CP-021
 * Tables: invoices + invoice_lines + payments
 * Facturation V1 (paiement simple / acompte)
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  /*
    TABLE INVOICES
  */
  pgm.createTable("invoices", {
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

    quote_id: {
      type: "uuid",
      references: "quotes",
      onDelete: "SET NULL",
    },

    invoice_number: {
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

    total_paid: {
      type: "numeric",
      notNull: true,
      default: 0,
    },

    due_date: {
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

  pgm.addConstraint("invoices", "invoices_unique_number_per_org", {
    unique: ["organization_id", "invoice_number"],
  });

  pgm.createIndex("invoices", ["organization_id"]);
  pgm.createIndex("invoices", ["client_id"]);
  pgm.createIndex("invoices", ["status"]);
  pgm.createIndex("invoices", ["created_at"]);

  /*
    TABLE INVOICE_LINES
  */
  pgm.createTable("invoice_lines", {
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

    invoice_id: {
      type: "uuid",
      notNull: true,
      references: "invoices",
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

  pgm.createIndex("invoice_lines", ["organization_id"]);
  pgm.createIndex("invoice_lines", ["invoice_id"]);
  pgm.createIndex("invoice_lines", ["article_id"]);

  /*
    TABLE PAYMENTS
  */
  pgm.createTable("payments", {
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

    invoice_id: {
      type: "uuid",
      notNull: true,
      references: "invoices",
      onDelete: "CASCADE",
    },

    amount: {
      type: "numeric",
      notNull: true,
    },

    payment_date: {
      type: "date",
      notNull: true,
    },

    payment_method: {
      type: "varchar(100)",
    },

    reference: {
      type: "varchar(255)",
    },

    notes: {
      type: "text",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("payments", ["organization_id"]);
  pgm.createIndex("payments", ["invoice_id"]);
  pgm.createIndex("payments", ["payment_date"]);
};

export const down = (pgm) => {
  pgm.dropTable("payments");
  pgm.dropTable("invoice_lines");
  pgm.dropTable("invoices");
};
