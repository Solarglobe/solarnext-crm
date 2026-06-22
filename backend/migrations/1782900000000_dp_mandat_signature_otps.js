/**
 * OTP de signature du mandat de représentation (module DP) — multi-canal (email | SMS).
 * Calqué sur quote_signature_otps mais clé par lead_id. Seul le hash SHA-256 du code est stocké.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS dp_mandat_signature_otps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      channel text NOT NULL DEFAULT 'email',
      destination text NOT NULL,
      email text,
      code_hash text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      verified_at timestamptz,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS dp_mandat_signature_otps_lead_idx
      ON dp_mandat_signature_otps (organization_id, lead_id, created_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS dp_mandat_signature_otps;`);
};
