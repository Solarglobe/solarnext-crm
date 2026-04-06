/**
 * CP-QUOTE — Catégorie catalogue « coffret de protection » (idempotent).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
DO $sn_quote_catalog_protection_box$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    INNER JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'quote_catalog_category'
      AND n.nspname = 'public'
      AND e.enumlabel = 'PROTECTION_BOX'
  ) THEN
    ALTER TYPE quote_catalog_category ADD VALUE 'PROTECTION_BOX';
  END IF;
END
$sn_quote_catalog_protection_box$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {};
