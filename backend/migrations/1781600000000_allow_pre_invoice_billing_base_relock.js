/**
 * Allows a prepared billing base to replace a previously stored quote base
 * until the first non-cancelled invoice is created for the quote.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_quotes_billing_total_immutable()
    RETURNS trigger AS $$
    DECLARE
      active_invoice_count integer := 0;
    BEGIN
      IF OLD.billing_total_ttc IS NOT NULL THEN
        IF NEW.billing_total_ht IS DISTINCT FROM OLD.billing_total_ht
           OR NEW.billing_total_vat IS DISTINCT FROM OLD.billing_total_vat
           OR NEW.billing_total_ttc IS DISTINCT FROM OLD.billing_total_ttc
           OR NEW.billing_locked_at IS DISTINCT FROM OLD.billing_locked_at THEN
          SELECT COUNT(*) INTO active_invoice_count
          FROM invoices
          WHERE quote_id = OLD.id
            AND organization_id = OLD.organization_id
            AND UPPER(COALESCE(status, '')) != 'CANCELLED';

          IF active_invoice_count > 0 THEN
            RAISE EXCEPTION 'billing_total est verrouille et ne peut plus etre modifie'
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

export const down = (pgm) => {
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
  `);
};
