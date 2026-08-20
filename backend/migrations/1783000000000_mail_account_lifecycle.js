/**
 * Phase 4 — Lifecycle sécurisé des comptes mail, OAuth Microsoft et purge locale.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createType("mail_account_lifecycle_state", [
    "CONNECTED",
    "DEGRADED",
    "AUTH_REQUIRED",
    "DISABLED",
    "DISCONNECTED",
    "REMOVED",
    "DELETION_PENDING",
    "DELETED",
  ]);
  pgm.createType("mail_account_provider", ["IMAP_SMTP", "MICROSOFT"]);
  pgm.createType("mail_account_auth_method", ["PASSWORD", "MICROSOFT_OAUTH"]);
  pgm.createType("mail_account_deletion_job_status", ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"]);

  pgm.addColumns("mail_accounts", {
    lifecycle_state: {
      type: "mail_account_lifecycle_state",
      notNull: true,
      default: "CONNECTED",
    },
    provider: {
      type: "mail_account_provider",
      notNull: true,
      default: "IMAP_SMTP",
    },
    auth_method: {
      type: "mail_account_auth_method",
      notNull: true,
      default: "PASSWORD",
    },
    sync_enabled: { type: "boolean", notNull: true, default: true },
    is_default_send_account: { type: "boolean", notNull: true, default: false },
    display_color: { type: "text" },
    sort_order: { type: "integer", notNull: true, default: 0 },
    connected_at: { type: "timestamptz" },
    disconnected_at: { type: "timestamptz" },
    removed_at: { type: "timestamptz" },
    deletion_requested_at: { type: "timestamptz" },
    deleted_at: { type: "timestamptz" },
    last_successful_sync_at: { type: "timestamptz" },
    last_sync_attempt_at: { type: "timestamptz" },
    next_sync_attempt_at: { type: "timestamptz" },
    last_error_code: { type: "text" },
    last_error_message: { type: "text" },
    imap_status: { type: "text" },
    smtp_status: { type: "text" },
    token_expires_at: { type: "timestamptz" },
    reconnect_required: { type: "boolean", notNull: true, default: false },
  });

  pgm.sql(`
    ALTER TABLE mail_accounts
      ALTER COLUMN connected_at SET DEFAULT now();
    UPDATE mail_accounts
       SET lifecycle_state = CASE WHEN is_active THEN 'CONNECTED'::mail_account_lifecycle_state
                                  ELSE 'DISABLED'::mail_account_lifecycle_state END,
           sync_enabled = is_active,
           connected_at = COALESCE(connected_at, created_at, now());

    ALTER TABLE mail_accounts DROP CONSTRAINT IF EXISTS uq_mail_accounts_org_email;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_accounts_org_email_provider_live
      ON mail_accounts (organization_id, lower(email), provider)
      WHERE lifecycle_state <> 'DELETED';

    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_accounts_org_default_send_live
      ON mail_accounts (organization_id)
      WHERE is_default_send_account = true
        AND lifecycle_state IN ('CONNECTED', 'DEGRADED');

    CREATE INDEX IF NOT EXISTS idx_mail_accounts_lifecycle_sync
      ON mail_accounts (organization_id, lifecycle_state, sync_enabled, next_sync_attempt_at);
  `);

  pgm.createTable("mail_account_oauth_states", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: { type: "uuid", notNull: true, references: "organizations", onDelete: "CASCADE" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    mail_account_id: { type: "uuid", references: "mail_accounts", onDelete: "CASCADE" },
    provider: { type: "mail_account_provider", notNull: true },
    state_hash: { type: "text", notNull: true, unique: true },
    code_verifier_encrypted: { type: "jsonb", notNull: true },
    redirect_uri: { type: "text", notNull: true },
    requested_email: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("mail_account_oauth_states", ["organization_id", "user_id"], {
    name: "idx_mail_account_oauth_states_owner",
  });
  pgm.createIndex("mail_account_oauth_states", ["expires_at"], {
    name: "idx_mail_account_oauth_states_expires",
  });

  pgm.createTable("mail_account_deletion_jobs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_id: { type: "uuid", notNull: true, references: "organizations", onDelete: "CASCADE" },
    mail_account_id: { type: "uuid", notNull: true, references: "mail_accounts", onDelete: "CASCADE" },
    requested_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    confirmation_email: { type: "text", notNull: true },
    status: { type: "mail_account_deletion_job_status", notNull: true, default: "PENDING" },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    next_attempt_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    started_at: { type: "timestamptz" },
    finished_at: { type: "timestamptz" },
    last_error_code: { type: "text" },
    last_error_message: { type: "text" },
    stats: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_account_deletion_jobs_pending
      ON mail_account_deletion_jobs (mail_account_id)
      WHERE status IN ('PENDING', 'PROCESSING');
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("mail_account_deletion_jobs", { ifExists: true });
  pgm.dropTable("mail_account_oauth_states", { ifExists: true });
  pgm.sql(`
    DROP INDEX IF EXISTS idx_mail_accounts_lifecycle_sync;
    DROP INDEX IF EXISTS uq_mail_accounts_org_default_send_live;
    DROP INDEX IF EXISTS uq_mail_accounts_org_email_provider_live;
    ALTER TABLE mail_accounts ADD CONSTRAINT uq_mail_accounts_org_email UNIQUE (organization_id, email);
  `);
  pgm.dropColumns("mail_accounts", [
    "lifecycle_state",
    "provider",
    "auth_method",
    "sync_enabled",
    "is_default_send_account",
    "display_color",
    "sort_order",
    "connected_at",
    "disconnected_at",
    "removed_at",
    "deletion_requested_at",
    "deleted_at",
    "last_successful_sync_at",
    "last_sync_attempt_at",
    "next_sync_attempt_at",
    "last_error_code",
    "last_error_message",
    "imap_status",
    "smtp_status",
    "token_expires_at",
    "reconnect_required",
  ]);
  pgm.dropType("mail_account_deletion_job_status");
  pgm.dropType("mail_account_auth_method");
  pgm.dropType("mail_account_provider");
  pgm.dropType("mail_account_lifecycle_state");
};
