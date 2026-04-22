/**
 * CP-076 — Full-text search sur mail_messages (tsvector + GIN + triggers).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS search_vector tsvector;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION mail_messages_rebuild_search_vector(p_msg_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      subj text;
      btxt text;
      pemails text;
    BEGIN
      SELECT m.subject, m.body_text INTO subj, btxt
      FROM mail_messages m WHERE m.id = p_msg_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;
      SELECT COALESCE(string_agg(lower(mp.email) || ' ' || COALESCE(lower(trim(mp.name)), ''), ' '), '')
      INTO pemails
      FROM mail_participants mp
      WHERE mp.mail_message_id = p_msg_id;

      UPDATE mail_messages
      SET search_vector = to_tsvector(
        'simple',
        coalesce(subj, '') || ' ' ||
        coalesce(btxt, '') || ' ' ||
        coalesce(pemails, '')
      )
      WHERE id = p_msg_id;
    END;
    $$;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION mail_messages_search_vector_biu()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      pemails text;
    BEGIN
      SELECT COALESCE(string_agg(lower(mp.email) || ' ' || COALESCE(lower(trim(mp.name)), ''), ' '), '')
      INTO pemails
      FROM mail_participants mp
      WHERE mp.mail_message_id = NEW.id;

      NEW.search_vector := to_tsvector(
        'simple',
        coalesce(NEW.subject, '') || ' ' ||
        coalesce(NEW.body_text, '') || ' ' ||
        coalesce(pemails, '')
      );
      RETURN NEW;
    END;
    $$;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_messages_search_vector ON mail_messages;
    CREATE TRIGGER trg_mail_messages_search_vector
    BEFORE INSERT OR UPDATE OF subject, body_text ON mail_messages
    FOR EACH ROW
    EXECUTE PROCEDURE mail_messages_search_vector_biu();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION mail_participants_refresh_message_tsv()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      mid uuid;
    BEGIN
      mid := COALESCE(NEW.mail_message_id, OLD.mail_message_id);
      IF mid IS NOT NULL THEN
        PERFORM mail_messages_rebuild_search_vector(mid);
      END IF;
      RETURN NULL;
    END;
    $$;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_participants_refresh_tsv ON mail_participants;
    CREATE TRIGGER trg_mail_participants_refresh_tsv
    AFTER INSERT OR UPDATE OR DELETE ON mail_participants
    FOR EACH ROW
    EXECUTE PROCEDURE mail_participants_refresh_message_tsv();
  `);

  pgm.sql(`
    UPDATE mail_messages m
    SET search_vector = sub.v
    FROM (
      SELECT
        m2.id,
        to_tsvector(
          'simple',
          coalesce(m2.subject, '') || ' ' ||
          coalesce(m2.body_text, '') || ' ' ||
          coalesce(px.pe, '')
        ) AS v
      FROM mail_messages m2
      LEFT JOIN (
        SELECT
          mail_message_id,
          string_agg(lower(email) || ' ' || coalesce(lower(trim(name)), ''), ' ') AS pe
        FROM mail_participants
        GROUP BY mail_message_id
      ) px ON px.mail_message_id = m2.id
    ) sub
    WHERE m.id = sub.id;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_search_vector
    ON mail_messages USING GIN (search_vector);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_search_vector;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_mail_participants_refresh_tsv ON mail_participants;`);
  pgm.sql(`DROP TRIGGER IF EXISTS trg_mail_messages_search_vector ON mail_messages;`);
  pgm.sql(`DROP FUNCTION IF EXISTS mail_participants_refresh_message_tsv();`);
  pgm.sql(`DROP FUNCTION IF EXISTS mail_messages_search_vector_biu();`);
  pgm.sql(`DROP FUNCTION IF EXISTS mail_messages_rebuild_search_vector(uuid);`);
  pgm.dropColumn("mail_messages", "search_vector");
};
