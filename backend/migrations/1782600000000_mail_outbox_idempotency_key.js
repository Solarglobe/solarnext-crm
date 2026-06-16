/**
 * Idempotence d'envoi mail : clé unique par organisation pour éviter les doublons d'envoi
 * (double-clic, retry réseau, réémission après réponse perdue).
 * Colonne nullable + index unique partiel (n'impacte pas les anciens envois sans clé).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS idempotency_key text;`);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS mail_outbox_org_idempotency_key_uniq
      ON mail_outbox (organization_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS mail_outbox_org_idempotency_key_uniq;`);
  pgm.sql(`ALTER TABLE mail_outbox DROP COLUMN IF EXISTS idempotency_key;`);
};
