/**
 * CP-QUOTE — Garantit la valeur PACK sur quote_catalog_category (idempotent).
 * Ne modifie pas 1775100000800 (référence checksum). Utile si l’ENUM était déjà à jour ou pour réalignements.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
DO $sn_quote_catalog_pack_enum$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    INNER JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'quote_catalog_category'
      AND n.nspname = 'public'
      AND e.enumlabel = 'PACK'
  ) THEN
    ALTER TYPE quote_catalog_category ADD VALUE 'PACK';
  END IF;
END
$sn_quote_catalog_pack_enum$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {
};
