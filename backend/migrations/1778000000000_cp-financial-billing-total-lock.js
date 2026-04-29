/**
 * CP-FIN-BILLING-LOCK
 * Verrouillage du montant global facturable au niveau du devis.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS billing_total_ht numeric;
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS billing_total_vat numeric;
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS billing_total_ttc numeric;
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS billing_locked_at timestamptz;
  `);

  pgm.sql(`
    ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_billing_total_non_negative_check;
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_billing_total_non_negative_check
    CHECK (
      billing_total_ht IS NULL OR billing_total_ht >= 0
    );
  `);
  pgm.sql(`
    ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_billing_total_vat_non_negative_check;
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_billing_total_vat_non_negative_check
    CHECK (
      billing_total_vat IS NULL OR billing_total_vat >= 0
    );
  `);
  pgm.sql(`
    ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_billing_total_ttc_non_negative_check;
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_billing_total_ttc_non_negative_check
    CHECK (
      billing_total_ttc IS NULL OR billing_total_ttc >= 0
    );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_billing_total_ttc_non_negative_check;`);
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_billing_total_vat_non_negative_check;`);
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_billing_total_non_negative_check;`);
  pgm.sql(`ALTER TABLE quotes DROP COLUMN IF EXISTS billing_locked_at;`);
  pgm.sql(`ALTER TABLE quotes DROP COLUMN IF EXISTS billing_total_ttc;`);
  pgm.sql(`ALTER TABLE quotes DROP COLUMN IF EXISTS billing_total_vat;`);
  pgm.sql(`ALTER TABLE quotes DROP COLUMN IF EXISTS billing_total_ht;`);
};
