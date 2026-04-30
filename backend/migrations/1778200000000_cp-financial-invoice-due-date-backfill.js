/**
 * CP-FIN-INV-DUE-DATE-BACKFILL
 * - Backfill due_date manquante sur factures existantes
 * - Base: issue_date + organizations.default_invoice_due_days (fallback 30)
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    UPDATE invoices i
    SET due_date = (
      COALESCE(i.issue_date, i.created_at::date)
      + COALESCE(o.default_invoice_due_days, 30) * INTERVAL '1 day'
    )::date,
        updated_at = now()
    FROM organizations o
    WHERE o.id = i.organization_id
      AND i.due_date IS NULL
      AND i.archived_at IS NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    UPDATE invoices
    SET due_date = NULL,
        updated_at = now()
    WHERE archived_at IS NULL;
  `);
};
