/**
 * CP-082 — Événements tracking ouverture / clic.
 * Les colonnes mail_messages (tracking_id, opened_at, clicked_at) viennent de 1775900001000.
 * Ici : table d’événements + index unique sur tracking_id (non nul).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_mail_messages_tracking_id;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_messages_tracking_id
      ON mail_messages (tracking_id)
      WHERE tracking_id IS NOT NULL;
  `);

  pgm.createTable("mail_tracking_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    mail_message_id: {
      type: "uuid",
      notNull: true,
      references: "mail_messages",
      onDelete: "CASCADE",
    },
    type: { type: "text", notNull: true },
    ip: { type: "text" },
    user_agent: { type: "text" },
    url: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("mail_tracking_events", "mail_tracking_events_type_chk", {
    check: "type IN ('OPEN', 'CLICK')",
  });

  pgm.createIndex("mail_tracking_events", ["mail_message_id"], { name: "idx_mail_tracking_events_message" });
  pgm.createIndex("mail_tracking_events", ["type"], { name: "idx_mail_tracking_events_type" });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_tracking_events_validate_org()
    RETURNS trigger AS $$
    DECLARE m_org uuid;
    BEGIN
      SELECT organization_id INTO m_org FROM mail_messages WHERE id = NEW.mail_message_id;
      IF m_org IS NULL THEN RAISE EXCEPTION 'mail_tracking_events: mail_message_id invalide'; END IF;
      IF m_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_tracking_events: organization_id incohérent';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_tracking_events_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_message_id ON mail_tracking_events
    FOR EACH ROW EXECUTE FUNCTION sg_mail_tracking_events_validate_org();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_tracking_events_validate_org ON mail_tracking_events;
    DROP FUNCTION IF EXISTS sg_mail_tracking_events_validate_org();
  `);
  pgm.dropTable("mail_tracking_events");
  pgm.sql(`
    DROP INDEX IF EXISTS uq_mail_messages_tracking_id;
    CREATE INDEX IF NOT EXISTS idx_mail_messages_tracking_id ON mail_messages (tracking_id);
  `);
};
