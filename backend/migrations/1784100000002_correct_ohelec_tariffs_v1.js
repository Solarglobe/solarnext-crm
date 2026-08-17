/**
 * Correctif idempotent OHELEC HT V1.
 *
 * Le seed initial du module installateurs a pu être appliqué avec une grille
 * provisoire. Cette migration réaligne uniquement le catalogue courant OHELEC ;
 * les snapshots de devis déjà créés restent figés dans quote_installer_cost_snapshots.
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
    target_grids AS (
      SELECT g.organization_id, g.id AS pricing_grid_id, g.code
      FROM installer_pricing_grids g
      JOIN ohelec_versions v
        ON v.organization_id = g.organization_id
       AND v.tariff_version_id = g.tariff_version_id
      WHERE g.code IN ('OHELEC_ROOF_SUPERIMPOSED_GRID', 'OHELEC_FLAT_GROUND_GRID')
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
    ),
    removed_obsolete_rows AS (
      DELETE FROM installer_tariff_rows r
      USING target_grids g
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
    INSERT INTO installer_tariff_rows (organization_id, pricing_grid_id, power_wc, panel_count_hint, amount_ht_cents, sort_order)
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
