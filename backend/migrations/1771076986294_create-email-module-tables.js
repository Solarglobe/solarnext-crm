/**
 * CP-023
 * Tables: email_accounts + emails + email_attachments
 * IMAP sync module V1
 * Non-destructive
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  /*
    TABLE EMAIL_ACCOUNTS
    (IMAP / SMTP configuration)
  */
  pgm.createTable("email_accounts", {
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

    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    email_address: {
      type: "varchar(255)",
      notNull: true,
    },

    imap_host: {
      type: "varchar(255)",
      notNull: true,
    },

    imap_port: {
      type: "integer",
      notNull: true,
    },

    imap_secure: {
      type: "boolean",
      notNull: true,
      default: true,
    },

    smtp_host: {
      type: "varchar(255)",
    },

    smtp_port: {
      type: "integer",
    },

    smtp_secure: {
      type: "boolean",
      default: true,
    },

    encrypted_password: {
      type: "text",
      notNull: true,
    },

    last_sync_at: {
      type: "timestamptz",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  addConstraintIdempotent(
    pgm,
    "email_accounts",
    "email_accounts_unique_per_org",
    "UNIQUE (organization_id, email_address)"
  );

  pgm.createIndex("email_accounts", ["organization_id"]);
  pgm.createIndex("email_accounts", ["user_id"]);

  /*
    TABLE EMAILS
  */
  pgm.createTable("emails", {
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

    email_account_id: {
      type: "uuid",
      notNull: true,
      references: "email_accounts",
      onDelete: "CASCADE",
    },

    client_id: {
      type: "uuid",
      references: "clients",
      onDelete: "SET NULL",
    },

    message_id: {
      type: "varchar(500)",
    },

    subject: {
      type: "varchar(500)",
    },

    from_address: {
      type: "varchar(255)",
    },

    to_addresses: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'[]'::jsonb`),
    },

    cc_addresses: {
      type: "jsonb",
      default: pgm.func(`'[]'::jsonb`),
    },

    bcc_addresses: {
      type: "jsonb",
      default: pgm.func(`'[]'::jsonb`),
    },

    body_text: {
      type: "text",
    },

    body_html: {
      type: "text",
    },

    direction: {
      type: "varchar(20)", // inbound / outbound
      notNull: true,
    },

    status: {
      type: "varchar(50)", // sent / received / failed
    },

    sent_at: {
      type: "timestamptz",
    },

    received_at: {
      type: "timestamptz",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("emails", ["organization_id"]);
  pgm.createIndex("emails", ["email_account_id"]);
  pgm.createIndex("emails", ["client_id"]);
  pgm.createIndex("emails", ["direction"]);
  pgm.createIndex("emails", ["sent_at"]);
  pgm.createIndex("emails", ["received_at"]);

  /*
    TABLE EMAIL_ATTACHMENTS
  */
  pgm.createTable("email_attachments", {
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

    email_id: {
      type: "uuid",
      notNull: true,
      references: "emails",
      onDelete: "CASCADE",
    },

    file_name: {
      type: "varchar(255)",
      notNull: true,
    },

    file_size: {
      type: "integer",
    },

    mime_type: {
      type: "varchar(255)",
    },

    storage_url: {
      type: "text",
      notNull: true,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("email_attachments", ["organization_id"]);
  pgm.createIndex("email_attachments", ["email_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("email_attachments");
  pgm.dropTable("emails");
  pgm.dropTable("email_accounts");
};
