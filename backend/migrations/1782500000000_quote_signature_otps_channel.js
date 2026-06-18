/**
 * OTP signature devis — multi-canal (email | sms).
 * Ajoute le canal d'envoi et une destination générique (email OU téléphone),
 * tout en conservant la colonne `email` historique (back-compat / NOT NULL).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE quote_signature_otps
      ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS destination text;
  `);
  // Backfill : les lignes existantes sont des envois email.
  pgm.sql(`
    UPDATE quote_signature_otps
      SET destination = email
      WHERE destination IS NULL;
  `);
  // L'email historique n'est plus obligatoire (un SMS n'a pas d'email).
  pgm.sql(`
    ALTER TABLE quote_signature_otps
      ALTER COLUMN email DROP NOT NULL;
  `);
  pgm.sql(`
    ALTER TABLE quote_signature_otps
      ADD CONSTRAINT quote_signature_otps_channel_chk
      CHECK (channel IN ('email', 'sms'));
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE quote_signature_otps DROP CONSTRAINT IF EXISTS quote_signature_otps_channel_chk;`);
  pgm.sql(`ALTER TABLE quote_signature_otps DROP COLUMN IF EXISTS destination;`);
  pgm.sql(`ALTER TABLE quote_signature_otps DROP COLUMN IF EXISTS channel;`);
};
