/**
 * CP-071 — Colonnes retry / diagnostic envoi SMTP sur mail_messages.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_messages", {
    failure_code: { type: "text" },
    failure_reason: { type: "text" },
    retry_count: { type: "integer", notNull: true, default: 0 },
    last_retry_at: { type: "timestamptz" },
    provider_response: { type: "text" },
  });

  pgm.sql(`
    CREATE INDEX idx_mail_messages_status_retry
    ON mail_messages (status, retry_count);
  `);
  pgm.sql(`
    CREATE INDEX idx_mail_messages_status
    ON mail_messages (status);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_status;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_status_retry;`);
  pgm.dropColumns("mail_messages", [
    "failure_code",
    "failure_reason",
    "retry_count",
    "last_retry_at",
    "provider_response",
  ]);
};
