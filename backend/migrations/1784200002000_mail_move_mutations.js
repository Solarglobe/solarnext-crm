/**
 * Phase 3 mail sync — durable IMAP move/delete mutations.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_messages", {
    previous_folder_id: { type: "uuid", references: "mail_folders", onDelete: "SET NULL" },
    previous_folder_path: { type: "text" },
    remote_missing_at: { type: "timestamptz" },
    remote_deleted_at: { type: "timestamptz" },
    external_size_bytes: { type: "integer" },
    move_intent_version: { type: "integer", notNull: true, default: 0 },
    move_sync_status: { type: "text", notNull: true, default: "SYNCED" },
    move_sync_error: { type: "text" },
    move_synced_at: { type: "timestamptz" },
  });

  pgm.createType("mail_move_mutation_status", [
    "PENDING",
    "PROCESSING",
    "RETRYING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "RECONCILIATION_REQUIRED",
  ]);
  pgm.createType("mail_move_operation", [
    "MOVE",
    "ARCHIVE",
    "TRASH",
    "RESTORE",
    "JUNK",
    "UNJUNK",
    "HARD_DELETE",
  ]);

  pgm.createTable("mail_move_mutations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: { type: "uuid", notNull: true },
    initiated_by: { type: "uuid" },
    mail_account_id: { type: "uuid", notNull: true, references: "mail_accounts", onDelete: "CASCADE" },
    mail_message_id: { type: "uuid", notNull: true, references: "mail_messages", onDelete: "CASCADE" },
    mail_thread_id: { type: "uuid", notNull: true, references: "mail_threads", onDelete: "CASCADE" },
    source_folder_id: { type: "uuid", references: "mail_folders", onDelete: "SET NULL" },
    source_folder_path: { type: "text", notNull: true },
    source_uid: { type: "bigint", notNull: true },
    source_uid_validity: { type: "text" },
    operation: { type: "mail_move_operation", notNull: true },
    target_folder_id: { type: "uuid", references: "mail_folders", onDelete: "SET NULL" },
    target_folder_path: { type: "text" },
    previous_folder_id: { type: "uuid", references: "mail_folders", onDelete: "SET NULL" },
    previous_folder_path: { type: "text" },
    intent_version: { type: "integer", notNull: true },
    idempotency_key: { type: "text", notNull: true },
    batch_id: { type: "uuid", notNull: true, default: pgm.func("gen_random_uuid()") },
    status: { type: "mail_move_mutation_status", notNull: true, default: "PENDING" },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    max_attempts: { type: "integer", notNull: true, default: 8 },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_attempt_at: { type: "timestamptz" },
    last_error_code: { type: "text" },
    last_error_message: { type: "text" },
    result_uid: { type: "bigint" },
    result_uid_validity: { type: "text" },
    succeeded_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("mail_move_mutations", ["status", "next_attempt_at", "created_at"], {
    name: "idx_mail_move_mutations_claim",
  });
  pgm.createIndex("mail_move_mutations", ["mail_message_id", "intent_version"], {
    name: "idx_mail_move_mutations_message_version",
  });
  pgm.createIndex("mail_move_mutations", ["batch_id"], { name: "idx_mail_move_mutations_batch" });
  pgm.createIndex("mail_move_mutations", ["organization_id", "mail_thread_id"], {
    name: "idx_mail_move_mutations_org_thread",
  });
  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_move_mutations_idempotency
    ON mail_move_mutations (idempotency_key);
  `);
  pgm.createIndex("mail_messages", ["folder_id", "remote_missing_at", "remote_deleted_at"], {
    name: "idx_mail_messages_folder_remote_presence",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex("mail_messages", ["folder_id", "remote_missing_at", "remote_deleted_at"], {
    name: "idx_mail_messages_folder_remote_presence",
    ifExists: true,
  });
  pgm.sql(`DROP INDEX IF EXISTS uq_mail_move_mutations_idempotency;`);
  pgm.dropIndex("mail_move_mutations", ["organization_id", "mail_thread_id"], {
    name: "idx_mail_move_mutations_org_thread",
    ifExists: true,
  });
  pgm.dropIndex("mail_move_mutations", ["batch_id"], {
    name: "idx_mail_move_mutations_batch",
    ifExists: true,
  });
  pgm.dropIndex("mail_move_mutations", ["mail_message_id", "intent_version"], {
    name: "idx_mail_move_mutations_message_version",
    ifExists: true,
  });
  pgm.dropIndex("mail_move_mutations", ["status", "next_attempt_at", "created_at"], {
    name: "idx_mail_move_mutations_claim",
    ifExists: true,
  });
  pgm.dropTable("mail_move_mutations", { ifExists: true });
  pgm.dropType("mail_move_operation", { ifExists: true });
  pgm.dropType("mail_move_mutation_status", { ifExists: true });
  pgm.dropColumn("mail_messages", "move_synced_at", { ifExists: true });
  pgm.dropColumn("mail_messages", "move_sync_error", { ifExists: true });
  pgm.dropColumn("mail_messages", "move_sync_status", { ifExists: true });
  pgm.dropColumn("mail_messages", "move_intent_version", { ifExists: true });
  pgm.dropColumn("mail_messages", "remote_deleted_at", { ifExists: true });
  pgm.dropColumn("mail_messages", "external_size_bytes", { ifExists: true });
  pgm.dropColumn("mail_messages", "remote_missing_at", { ifExists: true });
  pgm.dropColumn("mail_messages", "previous_folder_path", { ifExists: true });
  pgm.dropColumn("mail_messages", "previous_folder_id", { ifExists: true });
};
