/**
 * CP-076 — Archivage logique des fils (inbox sans suppression physique).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_threads", {
    archived_at: { type: "timestamptz" },
  });
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_mail_threads_org_archived_last
    ON mail_threads (organization_id, archived_at, last_message_at DESC NULLS LAST);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_threads_org_archived_last;`);
  pgm.dropColumns("mail_threads", ["archived_at"]);
};
