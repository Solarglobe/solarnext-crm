/**
 * Ajout catalogue PV - Francilienne Energy 375 Wc et 500 Wc.
 *
 * Donnees issues des pages produit Francilienne Energy. Les champs electriques
 * detailles restent null tant que la fiche technique complete n'est pas integree.
 */

export const shorthands = undefined;

const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v == null ? "NULL" : Number(v));
const bool = (v) => (v ? "true" : "false");

const VERIFIED = "2026-08-28";
const SOURCE = "Francilienne Energy";

const panels = [
  {
    brand: "Francilienne Energy",
    model_ref: "MONO-PERC-375W",
    name: "Francilienne Energy Mono 375W",
    technology: "Monocristallin PERC",
    power_wc: 375,
    efficiency_pct: 20.58,
    temp_coeff_pct_per_deg: null,
    width_mm: 1755,
    height_mm: 1038,
    thickness_mm: 35,
    weight_kg: null,
    warranty_product_years: null,
    warranty_performance_years: null,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_url: "https://francilienneenergy.fr/panneau-375w/",
    datasheet_url: "https://francilienneenergy.fr/panneau-375w/",
    data_confidence: 0.78,
    is_favorite: true,
  },
  {
    brand: "Francilienne Energy",
    model_ref: "MONO-PERC-500W",
    name: "Francilienne Energy Mono 500W",
    technology: "Monocristallin PERC",
    power_wc: 500,
    efficiency_pct: 21.06,
    temp_coeff_pct_per_deg: -0.33,
    width_mm: 2094,
    height_mm: 1134,
    thickness_mm: 35,
    weight_kg: 24,
    warranty_product_years: 25,
    warranty_performance_years: 30,
    certificate_iec: "IEC 61215 / IEC 61730",
    source_url: "https://francilienneenergy.fr/panneau-500w/",
    datasheet_url: "https://francilienneenergy.fr/panneau-500w/",
    data_confidence: 0.82,
    is_favorite: true,
  },
];

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  for (const p of panels) {
    pgm.sql(`
      INSERT INTO pv_panels (
        name, brand, model_ref, technology, bifacial, power_wc, efficiency_pct,
        temp_coeff_pct_per_deg, degradation_first_year_pct, degradation_annual_pct,
        width_mm, height_mm, thickness_mm, weight_kg, warranty_product_years,
        warranty_performance_years, certificate_iec, shading_compatible,
        source_name, source_url, datasheet_url, last_verified_at, data_confidence,
        status, is_favorite, active
      )
      VALUES (
        ${esc(p.name)}, ${esc(p.brand)}, ${esc(p.model_ref)}, ${esc(p.technology)}, false,
        ${num(p.power_wc)}, ${num(p.efficiency_pct)}, ${num(p.temp_coeff_pct_per_deg)},
        1.0, 0.4, ${num(p.width_mm)}, ${num(p.height_mm)}, ${num(p.thickness_mm)},
        ${num(p.weight_kg)}, ${num(p.warranty_product_years)}, ${num(p.warranty_performance_years)},
        ${esc(p.certificate_iec)}, true, ${esc(SOURCE)}, ${esc(p.source_url)}, ${esc(p.datasheet_url)},
        ${esc(VERIFIED)}, ${num(p.data_confidence)}, 'active', ${bool(p.is_favorite)}, true
      )
      ON CONFLICT (brand, model_ref) DO UPDATE SET
        name = EXCLUDED.name,
        technology = EXCLUDED.technology,
        bifacial = EXCLUDED.bifacial,
        power_wc = EXCLUDED.power_wc,
        efficiency_pct = EXCLUDED.efficiency_pct,
        temp_coeff_pct_per_deg = EXCLUDED.temp_coeff_pct_per_deg,
        width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm,
        thickness_mm = EXCLUDED.thickness_mm,
        weight_kg = EXCLUDED.weight_kg,
        warranty_product_years = EXCLUDED.warranty_product_years,
        warranty_performance_years = EXCLUDED.warranty_performance_years,
        certificate_iec = EXCLUDED.certificate_iec,
        shading_compatible = EXCLUDED.shading_compatible,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        datasheet_url = EXCLUDED.datasheet_url,
        last_verified_at = EXCLUDED.last_verified_at,
        data_confidence = EXCLUDED.data_confidence,
        status = EXCLUDED.status,
        is_favorite = EXCLUDED.is_favorite,
        active = EXCLUDED.active,
        updated_at = now();
    `);
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql("DELETE FROM pv_panels WHERE brand = 'Francilienne Energy' AND model_ref IN ('MONO-PERC-375W', 'MONO-PERC-500W')");
};
