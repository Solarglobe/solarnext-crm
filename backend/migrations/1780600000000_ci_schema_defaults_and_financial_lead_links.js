/**
 * CI / fresh schema hardening.
 *
 * Keeps a freshly migrated database aligned with current service code:
 * - invoices can be linked to a lead without an already materialized client;
 * - quote global discount/deposit legacy columns exist for live financial reads;
 * - minimal fixture inserts for lead_sources/leads get safe acquisition defaults.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;
    ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms text;
    CREATE INDEX IF NOT EXISTS idx_invoices_lead_id ON invoices (lead_id);
  `);

  pgm.sql(`
    ALTER TABLE quotes
      ADD COLUMN IF NOT EXISTS global_discount_percent numeric,
      ADD COLUMN IF NOT EXISTS global_discount_amount_ht numeric,
      ADD COLUMN IF NOT EXISTS deposit_percent numeric,
      ADD COLUMN IF NOT EXISTS deposit jsonb,
      ADD COLUMN IF NOT EXISTS payment_terms text;
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS lead_meters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL DEFAULT 'Compteur principal',
      is_default boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      consumption_pdl varchar(50),
      meter_power_kva integer,
      grid_type varchar(20),
      consumption_mode varchar(50),
      consumption_annual_kwh numeric,
      consumption_annual_calculated_kwh numeric,
      consumption_profile jsonb,
      hp_hc boolean NOT NULL DEFAULT false,
      supplier_name varchar(255),
      tariff_type varchar(50),
      energy_profile jsonb,
      equipement_actuel text,
      equipement_actuel_params jsonb,
      equipements_a_venir jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_lead_meters_org_lead ON lead_meters (organization_id, lead_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_meters_one_default
      ON lead_meters (organization_id, lead_id)
      WHERE is_default = true;
  `);

  pgm.sql(`
    ALTER TABLE lead_sources ALTER COLUMN sort_order SET DEFAULT 99;

    CREATE OR REPLACE FUNCTION sg_slugify_lead_source_name(p_name text)
    RETURNS text AS $$
      SELECT COALESCE(
        NULLIF(
          trim(both '_' from regexp_replace(lower(trim(COALESCE(p_name, 'autre'))), '[^a-z0-9]+', '_', 'g')),
          ''
        ),
        'autre'
      );
    $$ LANGUAGE sql IMMUTABLE;

    CREATE OR REPLACE FUNCTION sg_fill_lead_source_defaults()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
        NEW.slug := sg_slugify_lead_source_name(NEW.name);
      END IF;
      IF NEW.sort_order IS NULL THEN
        NEW.sort_order := 99;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_fill_lead_source_defaults ON lead_sources;
    CREATE TRIGGER trg_fill_lead_source_defaults
      BEFORE INSERT OR UPDATE OF name, slug, sort_order ON lead_sources
      FOR EACH ROW
      EXECUTE FUNCTION sg_fill_lead_source_defaults();

    CREATE OR REPLACE FUNCTION sg_fill_lead_source_id()
    RETURNS trigger AS $$
    DECLARE
      v_source_id uuid;
    BEGIN
      IF NEW.source_id IS NOT NULL THEN
        RETURN NEW;
      END IF;

      INSERT INTO lead_sources (organization_id, name, slug, sort_order)
      VALUES (NEW.organization_id, 'Autre', 'autre', 99)
      ON CONFLICT (organization_id, slug)
      DO UPDATE SET name = COALESCE(lead_sources.name, EXCLUDED.name)
      RETURNING id INTO v_source_id;

      NEW.source_id := v_source_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_fill_lead_source_id ON leads;
    CREATE TRIGGER trg_fill_lead_source_id
      BEFORE INSERT ON leads
      FOR EACH ROW
      EXECUTE FUNCTION sg_fill_lead_source_id();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_fill_lead_source_id ON leads;
    DROP FUNCTION IF EXISTS sg_fill_lead_source_id();
    DROP TRIGGER IF EXISTS trg_fill_lead_source_defaults ON lead_sources;
    DROP FUNCTION IF EXISTS sg_fill_lead_source_defaults();
    DROP FUNCTION IF EXISTS sg_slugify_lead_source_name(text);
    ALTER TABLE lead_sources ALTER COLUMN sort_order DROP DEFAULT;

    ALTER TABLE quotes
      DROP COLUMN IF EXISTS payment_terms,
      DROP COLUMN IF EXISTS deposit,
      DROP COLUMN IF EXISTS deposit_percent,
      DROP COLUMN IF EXISTS global_discount_amount_ht,
      DROP COLUMN IF EXISTS global_discount_percent;

    DROP INDEX IF EXISTS idx_invoices_lead_id;
    ALTER TABLE invoices DROP COLUMN IF EXISTS payment_terms;
    ALTER TABLE invoices DROP COLUMN IF EXISTS lead_id;
    ALTER TABLE invoices ALTER COLUMN client_id SET NOT NULL;
  `);
};
