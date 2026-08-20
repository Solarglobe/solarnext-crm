/**
 * Phase 1 mail sync — durable IMAP flag mutations and remote flag cursors.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_folders", {
    uid_validity: { type: "text" },
    highest_modseq: { type: "text" },
    last_flag_sync_at: { type: "timestamptz" },
    flag_sync_error_code: { type: "text" },
    flag_sync_error_message: { type: "text" },
    flag_sync_error_at: { type: "timestamptz" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addColumn("mail_messages", {
    external_uid_validity: { type: "text" },
    external_modseq: { type: "text" },
    read_intent_version: { type: "integer", notNull: true, default: 0 },
    read_sync_status: { type: "text", notNull: true, default: "SYNCED" },
    read_sync_error: { type: "text" },
    read_synced_at: { type: "timestamptz" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createType("mail_flag_mutation_status", [
    "PENDING",
    "PROCESSING",
    "RETRYING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ]);

  pgm.createType("mail_flag_mutation_operation", ["SET_READ"]);

  pgm.createTable("mail_flag_mutations", {
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
    mail_message_id: {
      type: "uuid",
      notNull: true,
      references: "mail_messages",
      onDelete: "CASCADE",
    },
    mail_thread_id: {
      type: "uuid",
      notNull: true,
      references: "mail_threads",
      onDelete: "CASCADE",
    },
    folder_id: {
      type: "uuid",
      references: "mail_folders",
      onDelete: "SET NULL",
    },
    folder_path: { type: "text" },
    external_uid: { type: "bigint" },
    external_uid_validity: { type: "text" },
    operation: { type: "mail_flag_mutation_operation", notNull: true },
    desired_is_read: { type: "boolean", notNull: true },
    intent_version: { type: "integer", notNull: true },
    idempotency_key: { type: "text", notNull: true },
    status: { type: "mail_flag_mutation_status", notNull: true, default: "PENDING" },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    max_attempts: { type: "integer", notNull: true, default: 8 },
    last_attempt_at: { type: "timestamptz" },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_error_code: { type: "text" },
    last_error_message: { type: "text" },
    succeeded_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("mail_folders", ["mail_account_id", "uid_validity"], {
    name: "idx_mail_folders_account_uid_validity",
  });
  pgm.createIndex("mail_messages", ["mail_account_id", "folder_id", "external_uid_validity", "external_uid"], {
    name: "idx_mail_messages_remote_key",
  });
  pgm.createIndex("mail_messages", ["mail_thread_id"], {
    name: "idx_mail_messages_thread_read_sync",
    where: "read_sync_status <> 'SYNCED'",
  });
  pgm.createIndex("mail_flag_mutations", ["organization_id"], { name: "idx_mail_flag_mutations_org" });
  pgm.createIndex("mail_flag_mutations", ["mail_account_id", "status"], {
    name: "idx_mail_flag_mutations_account_status",
  });
  pgm.createIndex("mail_flag_mutations", ["mail_message_id", "intent_version"], {
    name: "idx_mail_flag_mutations_message_version",
  });
  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_flag_mutations_idempotency_key
    ON mail_flag_mutations (idempotency_key);
  `);
  pgm.sql(`
    CREATE INDEX idx_mail_flag_mutations_next_attempt
    ON mail_flag_mutations (next_attempt_at ASC)
    WHERE status IN ('PENDING', 'RETRYING');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_flag_mutations_next_attempt;`);
  pgm.sql(`DROP INDEX IF EXISTS uq_mail_flag_mutations_idempotency_key;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_flag_mutations_message_version;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_flag_mutations_account_status;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_flag_mutations_org;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_thread_read_sync;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_remote_key;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_folders_account_uid_validity;`);
  pgm.dropTable("mail_flag_mutations");
  pgm.dropType("mail_flag_mutation_operation");
  pgm.dropType("mail_flag_mutation_status");
  pgm.dropColumns("mail_messages", [
    "external_uid_validity",
    "external_modseq",
    "read_intent_version",
    "read_sync_status",
    "read_sync_error",
    "read_synced_at",
    "updated_at",
  ]);
  pgm.dropColumns("mail_folders", [
    "uid_validity",
    "highest_modseq",
    "last_flag_sync_at",
    "flag_sync_error_code",
    "flag_sync_error_message",
    "flag_sync_error_at",
    "updated_at",
  ]);
};
