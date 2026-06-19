/**
 * OTP signature devis - multi-canal (email | sms).
 *
 * Ajoute le canal d'envoi et une destination generique (email OU telephone),
 * tout en conservant la colonne `email` historique pour compatibilite avec
 * les lignes existantes.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE quote_signature_otps
      ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS destination text;
  `);

  pgm.sql(`
    UPDATE quote_signature_otps
       SET destination = email
     WHERE destination IS NULL;
  `);

  pgm.sql(`
    ALTER TABLE quote_signature_otps
      ALTER COLUMN email DROP NOT NULL;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'quote_signature_otps_channel_chk'
           AND conrelid = 'quote_signature_otps'::regclass
      ) THEN
        ALTER TABLE quote_signature_otps
          ADD CONSTRAINT quote_signature_otps_channel_chk
          CHECK (channel IN ('email', 'sms'));
      END IF;
    END $$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE quote_signature_otps DROP CONSTRAINT IF EXISTS quote_signature_otps_channel_chk;`);
  pgm.sql(`ALTER TABLE quote_signature_otps DROP COLUMN IF EXISTS destination;`);
  pgm.sql(`ALTER TABLE quote_signature_otps DROP COLUMN IF EXISTS channel;`);
};
