/**
 * CP-068+ — Améliorations schéma mail (threading, CRM, perf, tracking).
 * Uniquement ADD / ALTER — pas de suppression ni renommage.
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("mail_messages", {
    references_ids: { type: "text[]" },
    tracking_id: { type: "uuid" },
    opened_at: { type: "timestamptz" },
    clicked_at: { type: "timestamptz" },
  });

  pgm.addColumn("mail_participants", {
    email_normalized: { type: "text" },
  });

  pgm.addColumn("mail_attachments", {
    is_inline: { type: "boolean", notNull: true, default: false },
    content_id: { type: "text" },
  });

  pgm.addColumn("mail_threads", {
    lead_id: { type: "uuid" },
    client_id: { type: "uuid" },
    message_count: { type: "integer", notNull: true, default: 0 },
    has_unread: { type: "boolean", notNull: true, default: true },
    last_message_id: { type: "uuid" },
  });

  pgm.sql(`
    UPDATE mail_participants
    SET email_normalized = LOWER(TRIM(email))
    WHERE email IS NOT NULL;
  `);

  pgm.sql(`
    UPDATE mail_threads t
    SET message_count = sub.count
    FROM (
      SELECT mail_thread_id, COUNT(*)::int AS count
      FROM mail_messages
      GROUP BY mail_thread_id
    ) sub
    WHERE sub.mail_thread_id = t.id;
  `);

  pgm.sql(`
    UPDATE mail_threads t
    SET has_unread = EXISTS (
      SELECT 1 FROM mail_messages m
      WHERE m.mail_thread_id = t.id AND m.is_read = false
    );
  `);

  pgm.sql(`
    UPDATE mail_threads t
    SET last_message_id = lm.id
    FROM (
      SELECT DISTINCT ON (mail_thread_id) mail_thread_id, id
      FROM mail_messages
      ORDER BY mail_thread_id, COALESCE(sent_at, received_at, created_at) DESC NULLS LAST
    ) lm
    WHERE t.id = lm.mail_thread_id;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_participants_set_email_normalized()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.email IS NOT NULL THEN
        NEW.email_normalized := LOWER(TRIM(NEW.email));
      ELSE
        NEW.email_normalized := NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_mail_participants_email_normalized ON mail_participants;
    CREATE TRIGGER trg_mail_participants_email_normalized
    BEFORE INSERT OR UPDATE OF email ON mail_participants
    FOR EACH ROW EXECUTE PROCEDURE sg_mail_participants_set_email_normalized();
  `);

  addConstraintIdempotent(
    pgm,
    "mail_threads",
    "fk_mail_threads_lead_id",
    "FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL"
  );

  addConstraintIdempotent(
    pgm,
    "mail_threads",
    "fk_mail_threads_client_id",
    "FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL"
  );

  addConstraintIdempotent(
    pgm,
    "mail_threads",
    "fk_mail_threads_last_message_id",
    "FOREIGN KEY (last_message_id) REFERENCES mail_messages(id) ON DELETE SET NULL"
  );

  pgm.sql(`
    CREATE INDEX idx_mail_messages_references_ids ON mail_messages USING GIN (references_ids);
  `);

  pgm.sql(`
    CREATE INDEX idx_mail_participants_email_normalized ON mail_participants (email_normalized);
  `);

  pgm.sql(`
    CREATE INDEX idx_mail_threads_lead_id ON mail_threads (lead_id);
  `);

  pgm.sql(`
    CREATE INDEX idx_mail_threads_client_id ON mail_threads (client_id);
  `);

  pgm.sql(`
    CREATE INDEX idx_mail_messages_tracking_id ON mail_messages (tracking_id);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_tracking_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_threads_client_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_threads_lead_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_participants_email_normalized;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_references_ids;`);

  pgm.sql(`
    ALTER TABLE mail_threads DROP CONSTRAINT IF EXISTS fk_mail_threads_last_message_id;
    ALTER TABLE mail_threads DROP CONSTRAINT IF EXISTS fk_mail_threads_client_id;
    ALTER TABLE mail_threads DROP CONSTRAINT IF EXISTS fk_mail_threads_lead_id;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_participants_email_normalized ON mail_participants;
    DROP FUNCTION IF EXISTS sg_mail_participants_set_email_normalized();
  `);

  pgm.dropColumns("mail_threads", [
    "lead_id",
    "client_id",
    "message_count",
    "has_unread",
    "last_message_id",
  ]);

  pgm.dropColumns("mail_attachments", ["is_inline", "content_id"]);

  pgm.dropColumns("mail_participants", ["email_normalized"]);

  pgm.dropColumns("mail_messages", [
    "references_ids",
    "tracking_id",
    "opened_at",
    "clicked_at",
  ]);
};
