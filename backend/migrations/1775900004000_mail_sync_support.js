/**
 * CP-072 — Support sync IMAP (état compte, UID dossier, dédup, index).
 * UID IMAP est unique par boîte distante : contrainte (mail_account_id, folder_id, external_uid).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_accounts", {
    last_imap_sync_at: { type: "timestamptz" },
    last_imap_error_at: { type: "timestamptz" },
    last_imap_error_code: { type: "text" },
    last_imap_error_message: { type: "text" },
    sync_status: { type: "text", notNull: true, default: "IDLE" },
  });

  pgm.addColumn("mail_messages", {
    external_uid: { type: "bigint" },
    external_flags: { type: "jsonb" },
    external_internal_date: { type: "timestamptz" },
    raw_headers: { type: "jsonb" },
    sync_source: { type: "text", default: "IMAP" },
  });

  pgm.sql(`
    ALTER TABLE mail_messages
    ALTER COLUMN sync_source SET DEFAULT 'IMAP';
  `);

  pgm.sql(`
    CREATE INDEX idx_mail_accounts_sync_status ON mail_accounts (sync_status);
  `);
  pgm.sql(`
    CREATE INDEX idx_mail_accounts_last_imap_sync_at ON mail_accounts (last_imap_sync_at);
  `);
  pgm.sql(`
    CREATE INDEX idx_mail_messages_account_folder_uid
    ON mail_messages (mail_account_id, folder_id, external_uid)
    WHERE external_uid IS NOT NULL;
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_messages_account_folder_external_uid
    ON mail_messages (mail_account_id, folder_id, external_uid)
    WHERE external_uid IS NOT NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS uq_mail_messages_account_folder_external_uid;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_account_folder_uid;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_accounts_last_imap_sync_at;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_accounts_sync_status;`);

  pgm.dropColumns("mail_messages", [
    "external_uid",
    "external_flags",
    "external_internal_date",
    "raw_headers",
    "sync_source",
  ]);

  pgm.dropColumns("mail_accounts", [
    "last_imap_sync_at",
    "last_imap_error_at",
    "last_imap_error_code",
    "last_imap_error_message",
    "sync_status",
  ]);
};
