/**
 * CP-QUOTE-BILLING-PARTY — Séparation ligne facturée par SolarGlobe vs pose installateur RGE indépendant.
 *
 * Ajoute `billing_party` (SOLARGLOBE | INSTALLER_RGE, défaut SOLARGLOBE) sur :
 *   - quote_lines, quote_catalog_items, invoice_lines
 * Ajoute sur quotes les totaux séparés "estimation pose installateur" (la pose ne gonfle plus total_ht/vat/ttc) :
 *   - total_installer_ht / total_installer_vat / total_installer_ttc
 *
 * NON RÉTROACTIF : défaut SOLARGLOBE => les devis/lignes existants restent strictement identiques.
 * Les snapshots déjà figés (document_snapshot_json) ne sont pas touchés.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      -- billing_party sur quote_lines
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quote_lines' AND column_name='billing_party') THEN
        ALTER TABLE quote_lines ADD COLUMN billing_party text NOT NULL DEFAULT 'SOLARGLOBE';
        ALTER TABLE quote_lines ADD CONSTRAINT quote_lines_billing_party_chk CHECK (billing_party IN ('SOLARGLOBE','INSTALLER_RGE'));
      END IF;

      -- billing_party sur quote_catalog_items (si la table existe)
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='quote_catalog_items') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quote_catalog_items' AND column_name='billing_party') THEN
          ALTER TABLE quote_catalog_items ADD COLUMN billing_party text NOT NULL DEFAULT 'SOLARGLOBE';
          ALTER TABLE quote_catalog_items ADD CONSTRAINT quote_catalog_items_billing_party_chk CHECK (billing_party IN ('SOLARGLOBE','INSTALLER_RGE'));
        END IF;
      END IF;

      -- billing_party sur invoice_lines (cohérence ; les lignes INSTALLER_RGE ne doivent jamais y être copiées)
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='invoice_lines') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoice_lines' AND column_name='billing_party') THEN
          ALTER TABLE invoice_lines ADD COLUMN billing_party text NOT NULL DEFAULT 'SOLARGLOBE';
          ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_billing_party_chk CHECK (billing_party IN ('SOLARGLOBE','INSTALLER_RGE'));
        END IF;
      END IF;

      -- Totaux estimation pose installateur sur quotes (total_ht/vat/ttc restent = SolarGlobe facturable)
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name='total_installer_ht') THEN
        ALTER TABLE quotes ADD COLUMN total_installer_ht  numeric NOT NULL DEFAULT 0;
        ALTER TABLE quotes ADD COLUMN total_installer_vat numeric NOT NULL DEFAULT 0;
        ALTER TABLE quotes ADD COLUMN total_installer_ttc numeric NOT NULL DEFAULT 0;
      END IF;
    END $$;
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS quote_lines_billing_party_idx ON quote_lines (quote_id, billing_party);`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      DROP INDEX IF EXISTS quote_lines_billing_party_idx;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quote_lines' AND column_name='billing_party') THEN
        ALTER TABLE quote_lines DROP CONSTRAINT IF EXISTS quote_lines_billing_party_chk;
        ALTER TABLE quote_lines DROP COLUMN billing_party;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quote_catalog_items' AND column_name='billing_party') THEN
        ALTER TABLE quote_catalog_items DROP CONSTRAINT IF EXISTS quote_catalog_items_billing_party_chk;
        ALTER TABLE quote_catalog_items DROP COLUMN billing_party;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoice_lines' AND column_name='billing_party') THEN
        ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_billing_party_chk;
        ALTER TABLE invoice_lines DROP COLUMN billing_party;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name='total_installer_ht') THEN
        ALTER TABLE quotes DROP COLUMN total_installer_ht;
        ALTER TABLE quotes DROP COLUMN total_installer_vat;
        ALTER TABLE quotes DROP COLUMN total_installer_ttc;
      END IF;
    END $$;
  `);
};
