/**
 * Phase 6 — historique complet, brouillons IMAP et classement Sent durable.
 */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE mail_folders
      ADD COLUMN IF NOT EXISTS history_backfill_status text NOT NULL DEFAULT 'NOT_STARTED',
      ADD COLUMN IF NOT EXISTS history_backfill_cursor_uid bigint,
      ADD COLUMN IF NOT EXISTS oldest_imported_uid bigint,
      ADD COLUMN IF NOT EXISTS remote_total_count integer,
      ADD COLUMN IF NOT EXISTS local_imported_count integer,
      ADD COLUMN IF NOT EXISTS oldest_imported_at timestamptz,
      ADD COLUMN IF NOT EXISTS history_backfill_started_at timestamptz,
      ADD COLUMN IF NOT EXISTS history_backfill_completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS history_backfill_last_success_at timestamptz,
      ADD COLUMN IF NOT EXISTS history_backfill_last_error text,
      ADD COLUMN IF NOT EXISTS history_backfill_has_more boolean NOT NULL DEFAULT true;

    ALTER TABLE mail_drafts
      ADD COLUMN IF NOT EXISTS body_text text,
      ADD COLUMN IF NOT EXISTS attachments_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS message_id text,
      ADD COLUMN IF NOT EXISTS draft_identity text,
      ADD COLUMN IF NOT EXISTS remote_folder_id uuid REFERENCES mail_folders(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS remote_uid bigint,
      ADD COLUMN IF NOT EXISTS remote_uid_validity text,
      ADD COLUMN IF NOT EXISTS remote_modseq text,
      ADD COLUMN IF NOT EXISTS local_version integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS remote_version text,
      ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'LOCAL_ONLY',
      ADD COLUMN IF NOT EXISTS local_dirty boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS last_local_saved_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS last_remote_saved_at timestamptz,
      ADD COLUMN IF NOT EXISTS sync_error text,
      ADD COLUMN IF NOT EXISTS conflict_of_draft_id uuid REFERENCES mail_drafts(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS conflict_reason text,
      ADD COLUMN IF NOT EXISTS abandoned_at timestamptz,
      ADD COLUMN IF NOT EXISTS sent_at timestamptz;

    CREATE TABLE IF NOT EXISTS mail_draft_sync_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      mail_account_id uuid NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      draft_id uuid REFERENCES mail_drafts(id) ON DELETE SET NULL,
      action text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      idempotency_key text NOT NULL,
      payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      attempt_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 8,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_at timestamptz,
      completed_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mail_draft_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      user_id uuid NOT NULL,
      mail_account_id uuid REFERENCES mail_accounts(id) ON DELETE SET NULL,
      draft_id uuid REFERENCES mail_drafts(id) ON DELETE CASCADE,
      file_name text NOT NULL,
      storage_path text NOT NULL,
      mime_type text,
      size_bytes bigint NOT NULL,
      content_sha256 text NOT NULL,
      upload_status text NOT NULL DEFAULT 'uploaded',
      is_inline boolean NOT NULL DEFAULT false,
      content_id text,
      cleanup_status text NOT NULL DEFAULT 'referenced',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE mail_outbox
      ADD COLUMN IF NOT EXISTS smtp_completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS sent_archive_status text NOT NULL DEFAULT 'not_started',
      ADD COLUMN IF NOT EXISTS sent_archive_attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sent_archive_next_attempt_at timestamptz,
      ADD COLUMN IF NOT EXISTS sent_archive_error text,
      ADD COLUMN IF NOT EXISTS sent_folder_id uuid REFERENCES mail_folders(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS sent_remote_uid bigint,
      ADD COLUMN IF NOT EXISTS sent_remote_uid_validity text,
      ADD COLUMN IF NOT EXISTS stable_message_id text,
      ADD COLUMN IF NOT EXISTS smtp_mime_rfc822 bytea;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_draft_sync_jobs_idempotency
      ON mail_draft_sync_jobs (organization_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_mail_draft_sync_jobs_due
      ON mail_draft_sync_jobs (status, next_attempt_at)
      WHERE status IN ('queued', 'retrying');
    CREATE INDEX IF NOT EXISTS idx_mail_draft_attachments_draft
      ON mail_draft_attachments (organization_id, draft_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_draft_attachments_draft_sha
      ON mail_draft_attachments (draft_id, content_sha256)
      WHERE draft_id IS NOT NULL AND cleanup_status <> 'deleted';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_drafts_org_identity
      ON mail_drafts (organization_id, draft_identity)
      WHERE draft_identity IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mail_folders_history_backfill
      ON mail_folders (organization_id, mail_account_id, history_backfill_status, sync_priority);
    CREATE INDEX IF NOT EXISTS idx_mail_messages_folder_uid_backfill
      ON mail_messages (organization_id, mail_account_id, folder_id, external_uid)
      WHERE external_uid IS NOT NULL AND remote_missing_at IS NULL AND remote_deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_mail_outbox_sent_archive_due
      ON mail_outbox (sent_archive_status, sent_archive_next_attempt_at)
      WHERE sent_archive_status IN ('pending', 'retrying', 'failed');
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_mail_outbox_sent_archive_due;
    DROP INDEX IF EXISTS idx_mail_messages_folder_uid_backfill;
    DROP INDEX IF EXISTS idx_mail_folders_history_backfill;
    DROP INDEX IF EXISTS idx_mail_draft_sync_jobs_due;
    DROP INDEX IF EXISTS idx_mail_draft_attachments_draft;
    DROP INDEX IF EXISTS uq_mail_draft_attachments_draft_sha;
    DROP TABLE IF EXISTS mail_draft_attachments;
    DROP INDEX IF EXISTS uq_mail_drafts_org_identity;
    DROP INDEX IF EXISTS uq_mail_draft_sync_jobs_idempotency;
    DROP TABLE IF EXISTS mail_draft_sync_jobs;

    ALTER TABLE mail_outbox
      DROP COLUMN IF EXISTS stable_message_id,
      DROP COLUMN IF EXISTS smtp_mime_rfc822,
      DROP COLUMN IF EXISTS sent_remote_uid_validity,
      DROP COLUMN IF EXISTS sent_remote_uid,
      DROP COLUMN IF EXISTS sent_folder_id,
      DROP COLUMN IF EXISTS sent_archive_error,
      DROP COLUMN IF EXISTS sent_archive_next_attempt_at,
      DROP COLUMN IF EXISTS sent_archive_attempt_count,
      DROP COLUMN IF EXISTS sent_archive_status,
      DROP COLUMN IF EXISTS smtp_completed_at;

    ALTER TABLE mail_drafts
      DROP COLUMN IF EXISTS sent_at,
      DROP COLUMN IF EXISTS abandoned_at,
      DROP COLUMN IF EXISTS conflict_reason,
      DROP COLUMN IF EXISTS conflict_of_draft_id,
      DROP COLUMN IF EXISTS sync_error,
      DROP COLUMN IF EXISTS last_remote_saved_at,
      DROP COLUMN IF EXISTS last_local_saved_at,
      DROP COLUMN IF EXISTS local_dirty,
      DROP COLUMN IF EXISTS sync_status,
      DROP COLUMN IF EXISTS remote_version,
      DROP COLUMN IF EXISTS local_version,
      DROP COLUMN IF EXISTS remote_modseq,
      DROP COLUMN IF EXISTS remote_uid_validity,
      DROP COLUMN IF EXISTS remote_uid,
      DROP COLUMN IF EXISTS remote_folder_id,
      DROP COLUMN IF EXISTS message_id,
      DROP COLUMN IF EXISTS draft_identity,
      DROP COLUMN IF EXISTS attachments_json,
      DROP COLUMN IF EXISTS body_text;

    ALTER TABLE mail_folders
      DROP COLUMN IF EXISTS history_backfill_has_more,
      DROP COLUMN IF EXISTS history_backfill_last_error,
      DROP COLUMN IF EXISTS history_backfill_last_success_at,
      DROP COLUMN IF EXISTS history_backfill_completed_at,
      DROP COLUMN IF EXISTS history_backfill_started_at,
      DROP COLUMN IF EXISTS oldest_imported_at,
      DROP COLUMN IF EXISTS local_imported_count,
      DROP COLUMN IF EXISTS remote_total_count,
      DROP COLUMN IF EXISTS oldest_imported_uid,
      DROP COLUMN IF EXISTS history_backfill_cursor_uid,
      DROP COLUMN IF EXISTS history_backfill_status;
  `);
};
