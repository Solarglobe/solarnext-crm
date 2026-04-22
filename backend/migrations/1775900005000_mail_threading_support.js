/**
 * CP-073 — Sujet normalisé pour fallback threading + index.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_threads", {
    normalized_subject: { type: "text" },
  });

  pgm.sql(`
    UPDATE mail_threads
    SET normalized_subject = LOWER(TRIM(COALESCE(subject, '')))
    WHERE normalized_subject IS NULL;
  `);

  pgm.sql(`
    CREATE INDEX idx_mail_threads_org_normalized_subject
    ON mail_threads (organization_id, normalized_subject)
    WHERE normalized_subject IS NOT NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_threads_org_normalized_subject;`);
  pgm.dropColumns("mail_threads", ["normalized_subject"]);
};
