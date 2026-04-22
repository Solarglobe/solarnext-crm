/**
 * Marketing opt-in explicite (indépendant du RGPD) + horodatage.
 * Backfill : false (strict — pas d’activation auto depuis rgpd_consent).
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    UPDATE leads SET marketing_opt_in = false WHERE marketing_opt_in IS NULL;
  `);
  pgm.sql(`
    ALTER TABLE leads
      ALTER COLUMN marketing_opt_in SET DEFAULT false,
      ALTER COLUMN marketing_opt_in SET NOT NULL;
  `);
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz NULL`);

  pgm.sql(`
    UPDATE clients SET marketing_opt_in = false WHERE marketing_opt_in IS NULL;
  `);
  pgm.sql(`
    ALTER TABLE clients
      ALTER COLUMN marketing_opt_in SET DEFAULT false,
      ALTER COLUMN marketing_opt_in SET NOT NULL;
  `);
  pgm.sql(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz NULL`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS marketing_opt_in_at`);
  pgm.sql(`ALTER TABLE clients DROP COLUMN IF EXISTS marketing_opt_in_at`);
  pgm.sql(`ALTER TABLE leads ALTER COLUMN marketing_opt_in DROP NOT NULL`);
  pgm.sql(`ALTER TABLE clients ALTER COLUMN marketing_opt_in DROP NOT NULL`);
};
