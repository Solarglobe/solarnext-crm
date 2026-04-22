/**
 * File d’envoi mail (queue persistante, retry, statuts).
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      ALTER TYPE mail_message_status ADD VALUE IF NOT EXISTS 'QUEUED';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TYPE mail_message_status ADD VALUE IF NOT EXISTS 'SENDING';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  pgm.createType("mail_outbox_status", [
    "queued",
    "sending",
    "sent",
    "retrying",
    "failed",
    "cancelled",
  ]);

  pgm.createTable("mail_outbox", {
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
    mail_account_id: {
      type: "uuid",
      notNull: true,
      references: "mail_accounts",
      onDelete: "CASCADE",
    },
    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    mail_message_id: {
      type: "uuid",
      notNull: true,
      references: "mail_messages",
      onDelete: "CASCADE",
    },
    mail_thread_id: { type: "uuid", references: "mail_threads", onDelete: "SET NULL" },
    to_json: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    cc_json: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    bcc_json: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    subject: { type: "text" },
    body_html: { type: "text" },
    body_text: { type: "text" },
    from_name: { type: "text" },
    attachments_manifest: { type: "jsonb" },
    in_reply_to: { type: "text" },
    references_json: { type: "jsonb" },
    tracking_enabled: { type: "boolean", notNull: true, default: true },
    status: { type: "mail_outbox_status", notNull: true, default: "queued" },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    max_attempts: { type: "integer", notNull: true, default: 4 },
    last_attempt_at: { type: "timestamptz" },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    sent_at: { type: "timestamptz" },
    last_error: { type: "text" },
    provider_message_id: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  addConstraintIdempotent(
    pgm,
    "mail_outbox",
    "uq_mail_outbox_mail_message_id",
    "UNIQUE (mail_message_id)"
  );

  pgm.createIndex("mail_outbox", ["organization_id"], { name: "idx_mail_outbox_organization_id" });
  pgm.createIndex("mail_outbox", ["mail_account_id"], { name: "idx_mail_outbox_mail_account_id" });
  pgm.createIndex("mail_outbox", ["status"], { name: "idx_mail_outbox_status" });
  pgm.sql(`
    CREATE INDEX idx_mail_outbox_next_attempt
    ON mail_outbox (next_attempt_at ASC)
    WHERE status IN ('queued', 'retrying');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("mail_outbox");
  pgm.dropType("mail_outbox_status");
};
