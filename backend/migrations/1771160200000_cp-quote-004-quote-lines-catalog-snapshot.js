/**
 * CP-QUOTE-004 — Lignes devis : snapshot catalogue (non rétroactif)
 * Ajoute à quote_lines : catalog_item_id, snapshot_json, purchase_unit_price_ht_cents,
 * vat_rate_bps, pricing_mode, is_optional, is_active, updated_at
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  // Idempotent: add columns only if missing (environnement partiellement migré)
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'catalog_item_id') THEN
        ALTER TABLE quote_lines ADD COLUMN catalog_item_id uuid REFERENCES quote_catalog_items ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'snapshot_json') THEN
        ALTER TABLE quote_lines ADD COLUMN snapshot_json jsonb;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'purchase_unit_price_ht_cents') THEN
        ALTER TABLE quote_lines ADD COLUMN purchase_unit_price_ht_cents integer;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'vat_rate_bps') THEN
        ALTER TABLE quote_lines ADD COLUMN vat_rate_bps integer;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'pricing_mode') THEN
        ALTER TABLE quote_lines ADD COLUMN pricing_mode quote_catalog_pricing_mode;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'is_optional') THEN
        ALTER TABLE quote_lines ADD COLUMN is_optional boolean NOT NULL DEFAULT false;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'is_active') THEN
        ALTER TABLE quote_lines ADD COLUMN is_active boolean NOT NULL DEFAULT true;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'updated_at') THEN
        ALTER TABLE quote_lines ADD COLUMN updated_at timestamptz DEFAULT now();
      END IF;
    END $$;
  `);

  pgm.createIndex("quote_lines", ["quote_id"], { ifNotExists: true });
  pgm.createIndex("quote_lines", ["organization_id"], { ifNotExists: true });
  pgm.createIndex("quote_lines", ["catalog_item_id"], { ifNotExists: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex("quote_lines", ["catalog_item_id"], { ifExists: true });
  pgm.dropColumns("quote_lines", [
    "catalog_item_id",
    "snapshot_json",
    "purchase_unit_price_ht_cents",
    "vat_rate_bps",
    "pricing_mode",
    "is_optional",
    "is_active",
    "updated_at"
  ]);
};
