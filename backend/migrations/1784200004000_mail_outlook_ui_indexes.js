/**
 * Phase 5 — Index UI mail Outlook-like.
 *
 * Accelere :
 * - badge global non lu canonique Inbox ;
 * - listes dossier paginees ;
 * - tri recent/ancien sur fils non archives.
 */

export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_mail_threads_org_live_unread_last
      ON mail_threads (organization_id, has_unread, archived_at, last_message_at DESC NULLS LAST)
      WHERE has_unread = true;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_mail_threads_org_live_last_asc
      ON mail_threads (organization_id, archived_at, last_message_at ASC NULLS LAST);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_thread_account_folder_live
      ON mail_messages (organization_id, mail_thread_id, mail_account_id, folder_id)
      WHERE remote_missing_at IS NULL AND remote_deleted_at IS NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_account_folder_read_live
      ON mail_messages (organization_id, mail_account_id, folder_id, is_read)
      WHERE remote_missing_at IS NULL AND remote_deleted_at IS NULL;
  `);
}

export async function down(pgm) {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_account_folder_read_live;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_thread_account_folder_live;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_threads_org_live_last_asc;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_threads_org_live_unread_last;`);
}
