/**
 * Reseed OHELEC catalog when an installer row exists without its tariff catalog.
 *
 * The first installer migration can leave an existing OHELEC installer without
 * dependent tariff rows if the catalog CTE does not materialize on a given DB.
 * This migration is intentionally idempotent and only targets the OHELEC HT V1
 * catalog for each organization.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  pgm.sql(`
    INSERT INTO installer_tariff_versions (organization_id, installer_id, version_label, status, effective_from, notes)
    SELECT i.organization_id, i.id, 'OHELEC HT V1', 'ACTIVE', current_date, 'Seed OHELEC - montants HT en centimes'
    FROM installers i
    WHERE i.name = 'OHELEC'
    ON CONFLICT (organization_id, installer_id, version_label) DO UPDATE SET
      status = 'ACTIVE',
      notes = EXCLUDED.notes,
      updated_at = now();

    INSERT INTO installer_pricing_grids (organization_id, tariff_version_id, code, label)
    SELECT v.organization_id, v.id, x.code, x.label
    FROM installer_tariff_versions v
    JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
    CROSS JOIN (VALUES
      ('OHELEC_ROOF_SUPERIMPOSED_GRID', 'OHELEC - toiture surimposée'),
      ('OHELEC_FLAT_GROUND_GRID', 'OHELEC - toit plat / sol')
    ) AS x(code, label)
    WHERE i.name = 'OHELEC'
      AND v.version_label = 'OHELEC HT V1'
    ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
      label = EXCLUDED.label,
      updated_at = now();

    INSERT INTO installer_installation_type_mappings (organization_id, tariff_version_id, installation_type, pricing_grid_id)
    SELECT g.organization_id, g.tariff_version_id, x.installation_type, g.id
    FROM installer_pricing_grids g
    JOIN installer_tariff_versions v ON v.organization_id = g.organization_id AND v.id = g.tariff_version_id
    JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
    JOIN (VALUES
      ('ROOF_SUPERIMPOSED', 'OHELEC_ROOF_SUPERIMPOSED_GRID'),
      ('FLAT_ROOF', 'OHELEC_FLAT_GROUND_GRID'),
      ('GROUND', 'OHELEC_FLAT_GROUND_GRID')
    ) AS x(installation_type, grid_code) ON x.grid_code = g.code
    WHERE i.name = 'OHELEC'
      AND v.version_label = 'OHELEC HT V1'
    ON CONFLICT (organization_id, tariff_version_id, installation_type) DO UPDATE SET
      pricing_grid_id = EXCLUDED.pricing_grid_id;

    WITH target_grids AS (
      SELECT g.organization_id, g.id AS pricing_grid_id, g.code
      FROM installer_pricing_grids g
      JOIN installer_tariff_versions v ON v.organization_id = g.organization_id AND v.id = g.tariff_version_id
      JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
      WHERE i.name = 'OHELEC'
        AND v.version_label = 'OHELEC HT V1'
        AND g.code IN ('OHELEC_ROOF_SUPERIMPOSED_GRID', 'OHELEC_FLAT_GROUND_GRID')
    ),
    expected_rows AS (
      SELECT g.organization_id, g.pricing_grid_id, x.power_wc, x.panel_count_hint, x.amount_ht_cents, x.sort_order
      FROM target_grids g
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

      UNION ALL

      SELECT g.organization_id, g.pricing_grid_id, x.power_wc, x.panel_count_hint, x.amount_ht_cents, x.sort_order
      FROM target_grids g
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
    )
    INSERT INTO installer_tariff_rows (organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order)
    SELECT organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order
    FROM expected_rows
    ON CONFLICT (organization_id, pricing_grid_id, power_wc) DO UPDATE SET
      panel_count_hint = EXCLUDED.panel_count_hint,
      amount_ht_cents = EXCLUDED.amount_ht_cents,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

    INSERT INTO installer_electrical_rules (organization_id, tariff_version_id, electrical_type, rule_type, amount_ht_cents)
    SELECT v.organization_id, v.id, x.electrical_type, x.rule_type, x.amount_ht_cents
    FROM installer_tariff_versions v
    JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
    CROSS JOIN (VALUES
      ('MONO', 'NONE', 0),
      ('TRI', 'FIXED_SURCHARGE', 25000)
    ) AS x(electrical_type, rule_type, amount_ht_cents)
    WHERE i.name = 'OHELEC'
      AND v.version_label = 'OHELEC HT V1'
    ON CONFLICT (organization_id, tariff_version_id, electrical_type) DO UPDATE SET
      rule_type = EXCLUDED.rule_type,
      amount_ht_cents = EXCLUDED.amount_ht_cents,
      updated_at = now();

    INSERT INTO installer_options (
      organization_id, tariff_version_id, code, label, category, amount_ht_cents,
      is_selectable_for_installation, is_amount_overridable, incompatible_group, sort_order
    )
    SELECT v.organization_id, v.id, x.code, x.label, x.category, x.amount_ht_cents,
           x.is_selectable_for_installation, x.is_amount_overridable, x.incompatible_group, x.sort_order
    FROM installer_tariff_versions v
    JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
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
    WHERE i.name = 'OHELEC'
      AND v.version_label = 'OHELEC HT V1'
    ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
      label = EXCLUDED.label,
      category = EXCLUDED.category,
      amount_ht_cents = EXCLUDED.amount_ht_cents,
      is_selectable_for_installation = EXCLUDED.is_selectable_for_installation,
      is_amount_overridable = EXCLUDED.is_amount_overridable,
      incompatible_group = EXCLUDED.incompatible_group,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();

    INSERT INTO installer_ancillary_services (organization_id, tariff_version_id, code, label, category, amount_ht_cents, is_active, sort_order)
    SELECT v.organization_id, v.id, 'DIAGNOSTIC_TROUBLESHOOTING', 'Diagnostic / dépannage', 'ANCILLARY', 40000, true, 10
    FROM installer_tariff_versions v
    JOIN installers i ON i.organization_id = v.organization_id AND i.id = v.installer_id
    WHERE i.name = 'OHELEC'
      AND v.version_label = 'OHELEC HT V1'
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
  pgm.sql("SELECT 1;");
};
