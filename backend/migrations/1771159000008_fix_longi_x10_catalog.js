/**
 * Fix catalogue LONGi X10 — UPSERT Explorer & Artist, désactiver anciens LONGi
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // A) LONGi Hi-MO X10 Explorer 485W
  pgm.sql(`
    INSERT INTO pv_panels (name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct, degradation_first_year_pct, degradation_annual_pct, width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years, warranty_performance_years, active)
    VALUES (
      'LONGi Hi-MO X10 Explorer 485W',
      'LONGi',
      'LR7-54HVH-485M',
      'HPBC',
      false,
      485,
      23.5,
      1.0,
      0.4,
      1134,
      1800,
      30,
      21.6,
      25,
      30,
      true
    )
    ON CONFLICT (brand, model_ref) DO UPDATE SET
      name = EXCLUDED.name,
      technology = EXCLUDED.technology,
      power_wc = EXCLUDED.power_wc,
      efficiency_pct = EXCLUDED.efficiency_pct,
      width_mm = EXCLUDED.width_mm,
      height_mm = EXCLUDED.height_mm,
      thickness_mm = EXCLUDED.thickness_mm,
      weight_kg = EXCLUDED.weight_kg,
      warranty_product_years = EXCLUDED.warranty_product_years,
      warranty_performance_years = EXCLUDED.warranty_performance_years,
      active = EXCLUDED.active,
      updated_at = now()
  `);

  // B) LONGi Hi-MO X10 Artist 485W
  pgm.sql(`
    INSERT INTO pv_panels (name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct, degradation_first_year_pct, degradation_annual_pct, width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years, warranty_performance_years, active)
    VALUES (
      'LONGi Hi-MO X10 Artist 485W',
      'LONGi',
      'LR7-54HVB-485M',
      'HPBC',
      false,
      485,
      23.5,
      1.0,
      0.4,
      1134,
      1800,
      30,
      21.6,
      25,
      30,
      true
    )
    ON CONFLICT (brand, model_ref) DO UPDATE SET
      name = EXCLUDED.name,
      technology = EXCLUDED.technology,
      power_wc = EXCLUDED.power_wc,
      efficiency_pct = EXCLUDED.efficiency_pct,
      width_mm = EXCLUDED.width_mm,
      height_mm = EXCLUDED.height_mm,
      thickness_mm = EXCLUDED.thickness_mm,
      weight_kg = EXCLUDED.weight_kg,
      warranty_product_years = EXCLUDED.warranty_product_years,
      warranty_performance_years = EXCLUDED.warranty_performance_years,
      active = EXCLUDED.active,
      updated_at = now()
  `);

  // C) Désactiver les anciens LONGi (Hi-MO6-485, Hi-MO6-500, etc.)
  pgm.sql(`
    UPDATE pv_panels
    SET active = false, updated_at = now()
    WHERE brand = 'LONGi'
      AND model_ref NOT IN ('LR7-54HVH-485M', 'LR7-54HVB-485M')
  `);
};

export const down = (pgm) => {
  // Pas de rollback — les données restent en base
};
