/**
 * Export CSV marketing — consentements / opt-in explicites (nullable = fallback rgpd côté app).
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NULL`);
  pgm.sql(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS rgpd_consent boolean NOT NULL DEFAULT false`);
  pgm.sql(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS rgpd_consent_at timestamptz NULL`);
  pgm.sql(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NULL`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS marketing_opt_in`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS marketing_opt_in`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS rgpd_consent_at`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS rgpd_consent`);
};
