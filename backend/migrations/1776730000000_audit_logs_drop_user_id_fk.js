/**
 * AUDIT-LOGS-FIX — Suppression user bloquée par immutabilité audit_logs
 *
 * La FK `audit_logs.user_id → users` était en ON DELETE SET NULL, ce qui force un
 * UPDATE sur audit_logs à la suppression d’un user — rejeté par
 * `prevent_audit_logs_modification`.
 *
 * On supprime la contrainte FK uniquement : la colonne `user_id` reste (référence
 * historique / UUID éventuellement orphelin).
 *
 * Idempotent : cherche toute FK sur la colonne `user_id` (nom de contrainte variable
 * selon l’historique des migrations), sans toucher aux autres migrations déjà appliquées.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      IF to_regclass('audit_logs') IS NULL THEN
        RETURN;
      END IF;
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'audit_logs'::regclass
          AND c.contype = 'f'
          AND EXISTS (
            SELECT 1
            FROM unnest(c.conkey) AS ck(attnum)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
            WHERE a.attname = 'user_id'
          )
      LOOP
        EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', r.conname);
      END LOOP;
    END
    $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('audit_logs') IS NULL THEN
        RETURN;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'audit_logs'::regclass
          AND c.contype = 'f'
          AND EXISTS (
            SELECT 1
            FROM unnest(c.conkey) AS ck(attnum)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck.attnum
            WHERE a.attname = 'user_id'
          )
      ) THEN
        RETURN;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_fkey'
      ) THEN
        ALTER TABLE audit_logs
          ADD CONSTRAINT audit_logs_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE NO ACTION;
      END IF;
    END
    $$;
  `);
};
