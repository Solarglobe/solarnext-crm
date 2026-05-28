/**
 * Reinstates DB-level protection for prepared billing totals after the
 * application service has been aligned to preserve the first locked base.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_quotes_billing_total_immutable()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.billing_total_ttc IS NOT NULL THEN
        IF NEW.billing_total_ht IS DISTINCT FROM OLD.billing_total_ht
           OR NEW.billing_total_vat IS DISTINCT FROM OLD.billing_total_vat
           OR NEW.billing_total_ttc IS DISTINCT FROM OLD.billing_total_ttc
           OR NEW.billing_locked_at IS DISTINCT FROM OLD.billing_locked_at THEN
          RAISE EXCEPTION 'billing_total est verrouille et ne peut plus etre modifie'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_quotes_billing_total_immutable ON quotes;
    CREATE TRIGGER trg_quotes_billing_total_immutable
    BEFORE UPDATE OF billing_total_ht, billing_total_vat, billing_total_ttc, billing_locked_at ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION sg_quotes_billing_total_immutable();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_quotes_billing_total_immutable ON quotes;
    DROP FUNCTION IF EXISTS sg_quotes_billing_total_immutable();
  `);
};
