/**
 * OTP email de signature devis — preuve d'identification du signataire (présentiel).
 * Le code 6 chiffres est envoyé à l'email du client ; seul le hash SHA-256 est stocké.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS quote_signature_otps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      email text NOT NULL,
      code_hash text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      verified_at timestamptz,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS quote_signature_otps_quote_idx
      ON quote_signature_otps (organization_id, quote_id, created_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS quote_signature_otps;`);
};
