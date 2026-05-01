/**
 * La préparation de facture (acompte / standard / solde) doit pouvoir réécrire quotes.billing_total_*
 * quand une base préparée valide est envoyée — le trigger immuable empêchait tout UPDATE après le premier
 * figement et provoquait « billing_total est verrouille et ne peut plus etre modifie » côté API.
 *
 * La cohérence reste assurée par invoices.service.js (resolveOrLockQuoteBillingTotals, plafonds factures).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_quotes_billing_total_immutable ON quotes;`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_quotes_billing_total_immutable();`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
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
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_quotes_billing_total_immutable ON quotes;
    CREATE TRIGGER trg_quotes_billing_total_immutable
    BEFORE UPDATE ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION sg_quotes_billing_total_immutable();
  `);
};
