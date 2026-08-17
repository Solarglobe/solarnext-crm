/**
 * Etend OHELEC HT V1 a 15 kWc par pas de 0,5 kWc.
 *
 * Migration idempotente et limitee au catalogue courant OHELEC. Les snapshots
 * de devis existants restent figes dans quote_installer_cost_snapshots.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  pgm.sql(`
    WITH ohelec_versions AS (
      SELECT v.organization_id, v.id AS tariff_version_id
      FROM installer_tariff_versions v
      JOIN installers i
        ON i.organization_id = v.organization_id
       AND i.id = v.installer_id
      WHERE i.name = 'OHELEC'
        AND v.version_label = 'OHELEC HT V1'
    ),
    desired_grids AS (
      SELECT v.organization_id, v.tariff_version_id, x.code, x.label
      FROM ohelec_versions v
      CROSS JOIN (VALUES
        ('OHELEC_ROOF_SUPERIMPOSED_GRID', 'OHELEC - toiture surimposee'),
        ('OHELEC_FLAT_ROOF_GRID', 'OHELEC - toit plat'),
        ('OHELEC_GROUND_GRID', 'OHELEC - installation au sol')
      ) AS x(code, label)
    ),
    upserted_grids AS (
      INSERT INTO installer_pricing_grids (organization_id, tariff_version_id, code, label)
      SELECT organization_id, tariff_version_id, code, label
      FROM desired_grids
      ON CONFLICT (organization_id, tariff_version_id, code) DO UPDATE SET
        label = EXCLUDED.label,
        updated_at = now()
      RETURNING organization_id, tariff_version_id, id AS pricing_grid_id, code
    ),
    all_target_grids AS (
      SELECT organization_id, tariff_version_id, pricing_grid_id, code
      FROM upserted_grids
    ),
    desired_mappings AS (
      SELECT v.organization_id, v.tariff_version_id, x.installation_type, g.pricing_grid_id
      FROM ohelec_versions v
      JOIN (VALUES
        ('ROOF_SUPERIMPOSED', 'OHELEC_ROOF_SUPERIMPOSED_GRID'),
        ('FLAT_ROOF', 'OHELEC_FLAT_ROOF_GRID'),
        ('GROUND', 'OHELEC_GROUND_GRID')
      ) AS x(installation_type, grid_code) ON true
      JOIN all_target_grids g
        ON g.organization_id = v.organization_id
       AND g.tariff_version_id = v.tariff_version_id
       AND g.code = x.grid_code
    ),
    upserted_mappings AS (
      INSERT INTO installer_installation_type_mappings (
        organization_id, tariff_version_id, installation_type, pricing_grid_id
      )
      SELECT organization_id, tariff_version_id, installation_type, pricing_grid_id
      FROM desired_mappings
      ON CONFLICT (organization_id, tariff_version_id, installation_type) DO UPDATE SET
        pricing_grid_id = EXCLUDED.pricing_grid_id
      RETURNING organization_id, tariff_version_id, installation_type, pricing_grid_id
    ),
    expected_rows AS (
      SELECT g.organization_id, g.pricing_grid_id, x.power_wc, NULL::integer AS panel_count_hint, x.amount_ht_cents, x.sort_order
      FROM all_target_grids g
      JOIN (VALUES
        (2000, 140000, 10),
        (2500, 150000, 20),
        (3000, 155000, 30),
        (3500, 160000, 40),
        (4000, 170000, 50),
        (4500, 175000, 60),
        (5000, 180000, 70),
        (5500, 190000, 80),
        (6000, 200000, 90),
        (6500, 210000, 100),
        (7000, 220000, 110),
        (7500, 230000, 120),
        (8000, 240000, 130),
        (8500, 250000, 140),
        (9000, 260000, 150),
        (9500, 270000, 160),
        (10000, 280000, 170),
        (10500, 290000, 180),
        (11000, 300000, 190),
        (11500, 310000, 200),
        (12000, 320000, 210),
        (12500, 330000, 220),
        (13000, 340000, 230),
        (13500, 350000, 240),
        (14000, 360000, 250),
        (14500, 370000, 260),
        (15000, 380000, 270)
      ) AS x(power_wc, amount_ht_cents, sort_order) ON true
      WHERE g.code = 'OHELEC_ROOF_SUPERIMPOSED_GRID'

      UNION ALL

      SELECT g.organization_id, g.pricing_grid_id, x.power_wc, NULL::integer AS panel_count_hint, x.amount_ht_cents, x.sort_order
      FROM all_target_grids g
      JOIN (VALUES
        (2000, 160000, 10),
        (2500, 170000, 20),
        (3000, 180000, 30),
        (3500, 190000, 40),
        (4000, 200000, 50),
        (4500, 205000, 60),
        (5000, 210000, 70),
        (5500, 220000, 80),
        (6000, 230000, 90),
        (6500, 235000, 100),
        (7000, 240000, 110),
        (7500, 250000, 120),
        (8000, 260000, 130),
        (8500, 265000, 140),
        (9000, 270000, 150),
        (9500, 280000, 160),
        (10000, 290000, 170),
        (10500, 300000, 180),
        (11000, 310000, 190),
        (11500, 320000, 200),
        (12000, 330000, 210),
        (12500, 340000, 220),
        (13000, 350000, 230),
        (13500, 360000, 240),
        (14000, 370000, 250),
        (14500, 380000, 260),
        (15000, 390000, 270)
      ) AS x(power_wc, amount_ht_cents, sort_order) ON true
      WHERE g.code IN ('OHELEC_FLAT_ROOF_GRID', 'OHELEC_GROUND_GRID')
    ),
    removed_obsolete_target_rows AS (
      DELETE FROM installer_tariff_rows r
      USING all_target_grids g
      WHERE r.organization_id = g.organization_id
        AND r.pricing_grid_id = g.pricing_grid_id
        AND NOT EXISTS (
          SELECT 1
          FROM expected_rows e
          WHERE e.organization_id = r.organization_id
            AND e.pricing_grid_id = r.pricing_grid_id
            AND e.power_wc = r.power_wc
        )
      RETURNING r.id
    )
    INSERT INTO installer_tariff_rows (
      organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order
    )
    SELECT organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order
    FROM expected_rows
    ON CONFLICT (organization_id, pricing_grid_id, power_wc) DO UPDATE SET
      panel_count_hint = EXCLUDED.panel_count_hint,
      amount_ht_cents = EXCLUDED.amount_ht_cents,
      sort_order = EXCLUDED.sort_order,
      updated_at = now();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  pgm.sql("SELECT 1;");
};
