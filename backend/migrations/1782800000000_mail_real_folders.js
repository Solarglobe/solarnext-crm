/**
 * Phase 2 mail sync — real IMAP folders and remote identity fixes.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      ALTER TYPE mail_folder_type ADD VALUE IF NOT EXISTS 'ARCHIVE';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  pgm.sql(`
    DO $$ BEGIN
      ALTER TYPE mail_folder_type ADD VALUE IF NOT EXISTS 'JUNK';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  pgm.addColumn("mail_folders", {
    parent_id: { type: "uuid", references: "mail_folders", onDelete: "SET NULL" },
    parent_path: { type: "text" },
    delimiter: { type: "text" },
    depth: { type: "integer", notNull: true, default: 0 },
    attributes_json: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    special_use: { type: "text" },
    selectable: { type: "boolean", notNull: true, default: true },
    subscribed: { type: "boolean" },
    is_active: { type: "boolean", notNull: true, default: true },
    last_discovered_at: { type: "timestamptz" },
    remote_message_count: { type: "integer" },
    remote_unread_count: { type: "integer" },
    message_sync_status: { type: "text", notNull: true, default: "NEVER_SYNCED" },
    history_sync_status: { type: "text", notNull: true, default: "PARTIAL" },
    sync_priority: { type: "integer", notNull: true, default: 50 },
    last_message_sync_at: { type: "timestamptz" },
    last_message_sync_error_at: { type: "timestamptz" },
    last_message_sync_error_code: { type: "text" },
    last_message_sync_error_message: { type: "text" },
  });

  pgm.sql(`
    UPDATE mail_folders SET
      is_active = true,
      selectable = true,
      last_discovered_at = COALESCE(last_discovered_at, now()),
      message_sync_status = CASE WHEN last_flag_sync_at IS NULL THEN 'NEVER_SYNCED' ELSE 'SYNCED' END,
      history_sync_status = 'PARTIAL',
      sync_priority = CASE
        WHEN type IN ('INBOX'::mail_folder_type, 'SENT'::mail_folder_type, 'DRAFT'::mail_folder_type) THEN 10
        WHEN type IN ('TRASH'::mail_folder_type) THEN 80
        ELSE 50
      END;
  `);

  pgm.sql(`DROP INDEX IF EXISTS uq_mail_messages_account_folder_external_uid;`);
  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_messages_account_folder_uid_validity_uid
    ON mail_messages (mail_account_id, folder_id, COALESCE(external_uid_validity, ''), external_uid)
    WHERE external_uid IS NOT NULL;
  `);

  pgm.createIndex("mail_folders", ["organization_id", "mail_account_id", "is_active"], {
    name: "idx_mail_folders_org_account_active",
  });
  pgm.createIndex("mail_folders", ["mail_account_id", "external_id"], {
    name: "idx_mail_folders_account_external_id",
  });
  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_folders_account_external_id
    ON mail_folders (mail_account_id, external_id)
    WHERE external_id IS NOT NULL;
  `);
  pgm.createIndex("mail_folders", ["mail_account_id", "type", "special_use"], {
    name: "idx_mail_folders_account_type_special",
  });
  pgm.createIndex("mail_folders", ["parent_id"], { name: "idx_mail_folders_parent_id" });
  pgm.createIndex("mail_messages", ["folder_id", "is_read"], {
    name: "idx_mail_messages_folder_unread",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_folder_unread;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_folders_parent_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_folders_account_type_special;`);
  pgm.sql(`DROP INDEX IF EXISTS uq_mail_folders_account_external_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_folders_account_external_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_folders_org_account_active;`);
  pgm.sql(`DROP INDEX IF EXISTS uq_mail_messages_account_folder_uid_validity_uid;`);
  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_messages_account_folder_external_uid
    ON mail_messages (mail_account_id, folder_id, external_uid)
    WHERE external_uid IS NOT NULL;
  `);
  pgm.sql(`
    UPDATE mail_folders
    SET type = 'CUSTOM'::mail_folder_type
    WHERE type IN ('ARCHIVE'::mail_folder_type, 'JUNK'::mail_folder_type);

    ALTER TYPE mail_folder_type RENAME TO mail_folder_type_with_real_folders;
    CREATE TYPE mail_folder_type AS ENUM ('INBOX', 'SENT', 'DRAFT', 'TRASH', 'CUSTOM');
    ALTER TABLE mail_folders
      ALTER COLUMN type TYPE mail_folder_type
      USING type::text::mail_folder_type;
    DROP TYPE mail_folder_type_with_real_folders;
  `);
  pgm.dropColumns("mail_folders", [
    "parent_id",
    "parent_path",
    "delimiter",
    "depth",
    "attributes_json",
    "special_use",
    "selectable",
    "subscribed",
    "is_active",
    "last_discovered_at",
    "remote_message_count",
    "remote_unread_count",
    "message_sync_status",
    "history_sync_status",
    "sync_priority",
    "last_message_sync_at",
    "last_message_sync_error_at",
    "last_message_sync_error_code",
    "last_message_sync_error_message",
  ]);
};
