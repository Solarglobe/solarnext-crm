/**
 * CP-080 — Garde-fou : unicité (organization_id, quote_number) sur les devis.
 * Idempotent : n’ajoute la contrainte que si elle est absente (anciennes bases / restauration).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_unique_number_per_org'
      ) THEN
        ALTER TABLE quotes
        ADD CONSTRAINT quotes_unique_number_per_org
        UNIQUE (organization_id, quote_number);
      END IF;
    END $$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {};
