export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DO $$ BEGIN
      CREATE TYPE mail_attachment_scan_status AS ENUM ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'FAILED', 'UNAVAILABLE');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    ALTER TABLE mail_attachments
      ADD COLUMN IF NOT EXISTS scan_status mail_attachment_scan_status NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS scan_checked_at timestamptz,
      ADD COLUMN IF NOT EXISTS scan_attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scan_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS scan_locked_at timestamptz,
      ADD COLUMN IF NOT EXISTS scan_provider varchar(80),
      ADD COLUMN IF NOT EXISTS scan_error_code varchar(80),
      ADD COLUMN IF NOT EXISTS quarantine_reason text;

    ALTER TABLE mail_draft_attachments
      ADD COLUMN IF NOT EXISTS scan_status mail_attachment_scan_status NOT NULL DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS scan_checked_at timestamptz,
      ADD COLUMN IF NOT EXISTS scan_attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scan_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS scan_locked_at timestamptz,
      ADD COLUMN IF NOT EXISTS scan_provider varchar(80),
      ADD COLUMN IF NOT EXISTS scan_error_code varchar(80),
      ADD COLUMN IF NOT EXISTS quarantine_reason text;

    CREATE INDEX IF NOT EXISTS idx_mail_attachments_scan_pending
      ON mail_attachments (organization_id, scan_status, scan_next_attempt_at, created_at)
      WHERE scan_status IN ('PENDING', 'SCANNING', 'FAILED', 'UNAVAILABLE');

    CREATE INDEX IF NOT EXISTS idx_mail_draft_attachments_scan_pending
      ON mail_draft_attachments (organization_id, scan_status, scan_next_attempt_at, created_at)
      WHERE scan_status IN ('PENDING', 'SCANNING', 'FAILED', 'UNAVAILABLE');

    CREATE INDEX IF NOT EXISTS idx_mail_participants_org_email_recent
      ON mail_participants (organization_id, lower(email));

    CREATE INDEX IF NOT EXISTS idx_mail_outbox_queue_age
      ON mail_outbox (organization_id, status, next_attempt_at, created_at);

    CREATE INDEX IF NOT EXISTS idx_mail_draft_sync_jobs_queue_age
      ON mail_draft_sync_jobs (organization_id, status, next_attempt_at, created_at);

    CREATE INDEX IF NOT EXISTS idx_mail_move_mutation_jobs_queue_age
      ON mail_move_mutation_jobs (organization_id, status, next_attempt_at, created_at);

    CREATE INDEX IF NOT EXISTS idx_mail_flag_mutation_jobs_queue_age
      ON mail_flag_mutation_jobs (organization_id, status, next_attempt_at, created_at);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_mail_flag_mutation_jobs_queue_age;
    DROP INDEX IF EXISTS idx_mail_move_mutation_jobs_queue_age;
    DROP INDEX IF EXISTS idx_mail_draft_sync_jobs_queue_age;
    DROP INDEX IF EXISTS idx_mail_outbox_queue_age;
    DROP INDEX IF EXISTS idx_mail_participants_org_email_recent;
    DROP INDEX IF EXISTS idx_mail_draft_attachments_scan_pending;
    DROP INDEX IF EXISTS idx_mail_attachments_scan_pending;

    ALTER TABLE mail_draft_attachments
      DROP COLUMN IF EXISTS quarantine_reason,
      DROP COLUMN IF EXISTS scan_error_code,
      DROP COLUMN IF EXISTS scan_provider,
      DROP COLUMN IF EXISTS scan_locked_at,
      DROP COLUMN IF EXISTS scan_next_attempt_at,
      DROP COLUMN IF EXISTS scan_attempt_count,
      DROP COLUMN IF EXISTS scan_checked_at,
      DROP COLUMN IF EXISTS scan_status;

    ALTER TABLE mail_attachments
      DROP COLUMN IF EXISTS quarantine_reason,
      DROP COLUMN IF EXISTS scan_error_code,
      DROP COLUMN IF EXISTS scan_provider,
      DROP COLUMN IF EXISTS scan_locked_at,
      DROP COLUMN IF EXISTS scan_next_attempt_at,
      DROP COLUMN IF EXISTS scan_attempt_count,
      DROP COLUMN IF EXISTS scan_checked_at,
      DROP COLUMN IF EXISTS scan_status;

    DROP TYPE IF EXISTS mail_attachment_scan_status;
  `);
};
