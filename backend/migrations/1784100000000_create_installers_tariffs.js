/**
 * Installateurs + tarification installateur V1.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS installers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL,
      legal_name text,
      siret text,
      contact_name text,
      contact_email text,
      contact_phone text,
      address_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      qualifications_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      is_active boolean NOT NULL DEFAULT true,
      notes text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installers_name_not_blank CHECK (btrim(name) <> ''),
      CONSTRAINT installers_org_name_unique UNIQUE (organization_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_installers_org_active ON installers(organization_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_installers_org_name ON installers(organization_id, lower(name));

    CREATE TABLE IF NOT EXISTS installer_service_zones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      installer_id uuid NOT NULL REFERENCES installers(id) ON DELETE CASCADE,
      zone_type text NOT NULL,
      zone_code text NOT NULL,
      label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_service_zones_type_chk CHECK (zone_type IN ('DEPARTMENT', 'POSTAL_CODE', 'CUSTOM')),
      CONSTRAINT installer_service_zones_code_not_blank CHECK (btrim(zone_code) <> ''),
      CONSTRAINT installer_service_zones_unique UNIQUE (organization_id, installer_id, zone_type, zone_code)
    );

    CREATE INDEX IF NOT EXISTS idx_installer_service_zones_lookup
      ON installer_service_zones(organization_id, zone_type, zone_code);

    CREATE TABLE IF NOT EXISTS installer_tariff_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      installer_id uuid NOT NULL REFERENCES installers(id) ON DELETE CASCADE,
      version_label text NOT NULL,
      status text NOT NULL DEFAULT 'DRAFT',
      effective_from date,
      effective_to date,
      notes text,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_tariff_versions_status_chk CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
      CONSTRAINT installer_tariff_versions_label_not_blank CHECK (btrim(version_label) <> ''),
      CONSTRAINT installer_tariff_versions_org_label_unique UNIQUE (organization_id, installer_id, version_label)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_installer_tariff_versions_active
      ON installer_tariff_versions(organization_id, installer_id)
      WHERE status = 'ACTIVE';
    CREATE INDEX IF NOT EXISTS idx_installer_tariff_versions_installer
      ON installer_tariff_versions(organization_id, installer_id, status);

    CREATE TABLE IF NOT EXISTS installer_pricing_grids (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tariff_version_id uuid NOT NULL REFERENCES installer_tariff_versions(id) ON DELETE CASCADE,
      code text NOT NULL,
      label text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_pricing_grids_code_not_blank CHECK (btrim(code) <> ''),
      CONSTRAINT installer_pricing_grids_unique UNIQUE (organization_id, tariff_version_id, code)
    );

    CREATE TABLE IF NOT EXISTS installer_installation_type_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tariff_version_id uuid NOT NULL REFERENCES installer_tariff_versions(id) ON DELETE CASCADE,
      installation_type text NOT NULL,
      pricing_grid_id uuid NOT NULL REFERENCES installer_pricing_grids(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_installation_type_chk CHECK (installation_type IN ('ROOF_SUPERIMPOSED', 'FLAT_ROOF', 'GROUND')),
      CONSTRAINT installer_installation_type_unique UNIQUE (organization_id, tariff_version_id, installation_type)
    );

    CREATE TABLE IF NOT EXISTS installer_tariff_rows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      pricing_grid_id uuid NOT NULL REFERENCES installer_pricing_grids(id) ON DELETE CASCADE,
      power_wc integer NOT NULL,
      panel_count_hint integer,
      amount_ht_cents integer NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_tariff_rows_power_positive CHECK (power_wc > 0),
      CONSTRAINT installer_tariff_rows_panel_positive CHECK (panel_count_hint IS NULL OR panel_count_hint > 0),
      CONSTRAINT installer_tariff_rows_amount_non_negative CHECK (amount_ht_cents >= 0),
      CONSTRAINT installer_tariff_rows_unique UNIQUE (organization_id, pricing_grid_id, power_wc)
    );

    CREATE INDEX IF NOT EXISTS idx_installer_tariff_rows_grid_power
      ON installer_tariff_rows(organization_id, pricing_grid_id, power_wc);

    CREATE TABLE IF NOT EXISTS installer_electrical_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tariff_version_id uuid NOT NULL REFERENCES installer_tariff_versions(id) ON DELETE CASCADE,
      electrical_type text NOT NULL,
      rule_type text NOT NULL DEFAULT 'NONE',
      amount_ht_cents integer NOT NULL DEFAULT 0,
      pricing_grid_id uuid REFERENCES installer_pricing_grids(id) ON DELETE SET NULL,
      config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_electrical_rules_type_chk CHECK (electrical_type IN ('MONO', 'TRI')),
      CONSTRAINT installer_electrical_rules_rule_chk CHECK (rule_type IN ('NONE', 'FIXED_SURCHARGE', 'SEPARATE_GRID', 'POWER_BASED')),
      CONSTRAINT installer_electrical_rules_amount_non_negative CHECK (amount_ht_cents >= 0),
      CONSTRAINT installer_electrical_rules_unique UNIQUE (organization_id, tariff_version_id, electrical_type)
    );

    CREATE TABLE IF NOT EXISTS installer_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tariff_version_id uuid NOT NULL REFERENCES installer_tariff_versions(id) ON DELETE CASCADE,
      code text NOT NULL,
      label text NOT NULL,
      category text NOT NULL DEFAULT 'GENERAL',
      amount_ht_cents integer NOT NULL DEFAULT 0,
      is_selectable_for_installation boolean NOT NULL DEFAULT true,
      is_amount_overridable boolean NOT NULL DEFAULT false,
      incompatible_group text,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_options_code_not_blank CHECK (btrim(code) <> ''),
      CONSTRAINT installer_options_amount_non_negative CHECK (amount_ht_cents >= 0),
      CONSTRAINT installer_options_unique UNIQUE (organization_id, tariff_version_id, code)
    );

    CREATE INDEX IF NOT EXISTS idx_installer_options_version
      ON installer_options(organization_id, tariff_version_id, is_active);

    CREATE TABLE IF NOT EXISTS installer_ancillary_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      tariff_version_id uuid NOT NULL REFERENCES installer_tariff_versions(id) ON DELETE CASCADE,
      code text NOT NULL,
      label text NOT NULL,
      category text NOT NULL DEFAULT 'GENERAL',
      amount_ht_cents integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT installer_ancillary_code_not_blank CHECK (btrim(code) <> ''),
      CONSTRAINT installer_ancillary_amount_non_negative CHECK (amount_ht_cents >= 0),
      CONSTRAINT installer_ancillary_unique UNIQUE (organization_id, tariff_version_id, code)
    );

    CREATE TABLE IF NOT EXISTS quote_installer_cost_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      study_id uuid REFERENCES studies(id) ON DELETE SET NULL,
      study_version_id uuid REFERENCES study_versions(id) ON DELETE SET NULL,
      installer_id uuid REFERENCES installers(id) ON DELETE SET NULL,
      tariff_version_id uuid REFERENCES installer_tariff_versions(id) ON DELETE SET NULL,
      installer_name_snapshot text NOT NULL,
      requested_power_wc integer NOT NULL,
      matched_power_wc integer NOT NULL,
      installation_type text NOT NULL,
      electrical_type text NOT NULL,
      base_amount_ht_cents integer NOT NULL,
      electrical_adjustments_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      catalog_total_ht_cents integer NOT NULL,
      option_overrides_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      manual_override_ht_cents integer,
      manual_override_reason text,
      overridden_by uuid,
      overridden_at timestamptz,
      final_total_ht_cents integer NOT NULL,
      calculation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT quote_installer_snapshot_installation_type_chk CHECK (installation_type IN ('ROOF_SUPERIMPOSED', 'FLAT_ROOF', 'GROUND')),
      CONSTRAINT quote_installer_snapshot_electrical_type_chk CHECK (electrical_type IN ('MONO', 'TRI')),
      CONSTRAINT quote_installer_snapshot_amounts_non_negative CHECK (
        requested_power_wc > 0
        AND matched_power_wc > 0
        AND base_amount_ht_cents >= 0
        AND catalog_total_ht_cents >= 0
        AND final_total_ht_cents >= 0
        AND (manual_override_ht_cents IS NULL OR manual_override_ht_cents >= 0)
      ),
      CONSTRAINT quote_installer_snapshot_override_reason_chk CHECK (
        manual_override_ht_cents IS NULL OR btrim(coalesce(manual_override_reason, '')) <> ''
      ),
      CONSTRAINT quote_installer_snapshot_unique UNIQUE (organization_id, quote_id)
    );

    CREATE INDEX IF NOT EXISTS idx_quote_installer_snapshots_quote
      ON quote_installer_cost_snapshots(organization_id, quote_id);
  `);

  pgm.sql(`
    WITH orgs AS (
      SELECT id AS organization_id FROM organizations
    ),
    inserted_installers AS (
      INSERT INTO installers (organization_id, name, is_active, notes)
      SELECT organization_id, 'OHELEC', true, 'Installateur seed système - tarification HT V1'
      FROM orgs
      ON CONFLICT (organization_id, name) DO UPDATE SET
        is_active = true,
        updated_at = now()
      RETURNING id, organization_id
    ),
    active_ohelec AS (
      SELECT id, organization_id
      FROM installers
      WHERE name = 'OHELEC'
    ),
    versions AS (
      INSERT INTO installer_tariff_versions (organization_id, installer_id, version_label, status, effective_from, notes)
      SELECT organization_id, id, 'OHELEC HT V1', 'ACTIVE', current_date, 'Seed OHELEC - montants HT en centimes'
      FROM active_ohelec
      ON CONFLICT (organization_id, installer_id, version_label) DO UPDATE SET
        status = 'ACTIVE',
        updated_at = now()
      RETURNING id, organization_id, installer_id
    ),
    grids AS (
      INSERT INTO installer_pricing_grids (organization_id, tariff_version_id, code, label)
      SELECT v.organization_id, v.id, x.code, x.label
      FROM versions v
      CROSS JOIN (VALUES
        ('OHELEC_ROOF_SUPERIMPOSED_GRID', 'OHELEC - toiture surimposée'),
        ('OHELEC_FLAT_GROUND_GRID', 'OHELEC - toit plat / sol')
      ) AS x(code, label)
      ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
        label = EXCLUDED.label,
        updated_at = now()
      RETURNING id, organization_id, tariff_version_id, code
    ),
    mappings AS (
      INSERT INTO installer_installation_type_mappings (organization_id, tariff_version_id, installation_type, pricing_grid_id)
      SELECT g.organization_id, g.tariff_version_id, x.installation_type, g.id
      FROM grids g
      JOIN (VALUES
        ('ROOF_SUPERIMPOSED', 'OHELEC_ROOF_SUPERIMPOSED_GRID'),
        ('FLAT_ROOF', 'OHELEC_FLAT_GROUND_GRID'),
        ('GROUND', 'OHELEC_FLAT_GROUND_GRID')
      ) AS x(installation_type, grid_code) ON x.grid_code = g.code
      ON CONFLICT (organization_id, tariff_version_id, installation_type) DO UPDATE SET
        pricing_grid_id = EXCLUDED.pricing_grid_id
      RETURNING id
    ),
    roof_rows AS (
      INSERT INTO installer_tariff_rows (organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order)
      SELECT g.organization_id, g.id, x.power_wc, x.panel_count_hint, x.amount_ht_cents, x.sort_order
      FROM grids g
      JOIN (VALUES
        (2000, NULL::integer, 140000, 10),
        (2500, NULL::integer, 150000, 20),
        (3500, NULL::integer, 160000, 30),
        (4000, NULL::integer, 170000, 40),
        (5000, NULL::integer, 180000, 50),
        (5500, NULL::integer, 190000, 60),
        (6000, NULL::integer, 200000, 70),
        (7000, NULL::integer, 220000, 80),
        (8000, NULL::integer, 240000, 90),
        (9000, NULL::integer, 260000, 100)
      ) AS x(power_wc, panel_count_hint, amount_ht_cents, sort_order) ON true
      WHERE g.code = 'OHELEC_ROOF_SUPERIMPOSED_GRID'
      ON CONFLICT (organization_id, pricing_grid_id, power_wc) DO UPDATE SET
        panel_count_hint = EXCLUDED.panel_count_hint,
        amount_ht_cents = EXCLUDED.amount_ht_cents,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
      RETURNING id
    ),
    flat_rows AS (
      INSERT INTO installer_tariff_rows (organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order)
      SELECT g.organization_id, g.id, x.power_wc, x.panel_count_hint, x.amount_ht_cents, x.sort_order
      FROM grids g
      JOIN (VALUES
        (2000, NULL::integer, 160000, 10),
        (3000, NULL::integer, 180000, 20),
        (3500, NULL::integer, 190000, 30),
        (4000, NULL::integer, 200000, 40),
        (5000, NULL::integer, 210000, 50),
        (6000, NULL::integer, 230000, 60),
        (7000, NULL::integer, 240000, 70),
        (8000, NULL::integer, 260000, 80),
        (9000, NULL::integer, 270000, 90)
      ) AS x(power_wc, panel_count_hint, amount_ht_cents, sort_order) ON true
      WHERE g.code = 'OHELEC_FLAT_GROUND_GRID'
      ON CONFLICT (organization_id, pricing_grid_id, power_wc) DO UPDATE SET
        panel_count_hint = EXCLUDED.panel_count_hint,
        amount_ht_cents = EXCLUDED.amount_ht_cents,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
      RETURNING id
    ),
    electrical AS (
      INSERT INTO installer_electrical_rules (organization_id, tariff_version_id, electrical_type, rule_type, amount_ht_cents)
      SELECT v.organization_id, v.id, x.electrical_type, x.rule_type, x.amount_ht_cents
      FROM versions v
      CROSS JOIN (VALUES
        ('MONO', 'NONE', 0),
        ('TRI', 'FIXED_SURCHARGE', 25000)
      ) AS x(electrical_type, rule_type, amount_ht_cents)
      ON CONFLICT (organization_id, tariff_version_id, electrical_type) DO UPDATE SET
        rule_type = EXCLUDED.rule_type,
        amount_ht_cents = EXCLUDED.amount_ht_cents,
        updated_at = now()
      RETURNING id
    ),
    opts AS (
      INSERT INTO installer_options (
        organization_id, tariff_version_id, code, label, category, amount_ht_cents,
        is_selectable_for_installation, is_amount_overridable, incompatible_group, sort_order
      )
      SELECT v.organization_id, v.id, x.code, x.label, x.category, x.amount_ht_cents,
             x.is_selectable_for_installation, x.is_amount_overridable, x.incompatible_group, x.sort_order
      FROM versions v
      CROSS JOIN (VALUES
        ('BATTERY_UP_TO_5_KWH', 'Batterie jusqu''à 5 kWh', 'BATTERY', 30000, true, false, 'BATTERY_CAPACITY', 10),
        ('BATTERY_OVER_5_KWH', 'Batterie > 5 kWh', 'BATTERY', 60000, true, false, 'BATTERY_CAPACITY', 20),
        ('EV_CHARGER', 'Borne de recharge', 'ELECTRICAL', 35000, true, false, null, 30),
        ('MULTIPLE_ROOF_SECTIONS', 'Plusieurs pans de toiture', 'INSTALLATION', 25000, true, false, null, 40),
        ('NEW_SLATE_INSTALLATION', 'Pose ardoise neuve', 'INSTALLATION', 30000, true, false, null, 50),
        ('TECHNICAL_VISIT', 'Visite technique', 'SERVICE', 16667, true, false, null, 60),
        ('CABLE_AND_CONNECTION', 'Câble et raccordement', 'ELECTRICAL', 15000, true, true, null, 70),
        ('GRID_CONNECTION_CONSUEL', 'Raccordement et Consuel', 'ELECTRICAL', 35000, true, false, null, 80)
      ) AS x(code, label, category, amount_ht_cents, is_selectable_for_installation, is_amount_overridable, incompatible_group, sort_order)
      ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
        label = EXCLUDED.label,
        category = EXCLUDED.category,
        amount_ht_cents = EXCLUDED.amount_ht_cents,
        is_selectable_for_installation = EXCLUDED.is_selectable_for_installation,
        is_amount_overridable = EXCLUDED.is_amount_overridable,
        incompatible_group = EXCLUDED.incompatible_group,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
      RETURNING id
    )
    INSERT INTO installer_ancillary_services (organization_id, tariff_version_id, code, label, category, amount_ht_cents, is_active, sort_order)
    SELECT v.organization_id, v.id, 'DIAGNOSTIC_TROUBLESHOOTING', 'Diagnostic / dépannage', 'ANCILLARY', 40000, true, 10
    FROM versions v
    ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
      label = EXCLUDED.label,
      category = EXCLUDED.category,
      amount_ht_cents = EXCLUDED.amount_ht_cents,
      is_active = EXCLUDED.is_active,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS quote_installer_cost_snapshots;
    DROP TABLE IF EXISTS installer_ancillary_services;
    DROP TABLE IF EXISTS installer_options;
    DROP TABLE IF EXISTS installer_electrical_rules;
    DROP TABLE IF EXISTS installer_tariff_rows;
    DROP TABLE IF EXISTS installer_installation_type_mappings;
    DROP TABLE IF EXISTS installer_pricing_grids;
    DROP TABLE IF EXISTS installer_tariff_versions;
    DROP TABLE IF EXISTS installer_service_zones;
    DROP TABLE IF EXISTS installers;
  `);
};
