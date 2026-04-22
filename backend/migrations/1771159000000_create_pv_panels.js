/**
 * CP-002 — Table pv_panels (catalogue panneaux enrichi)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("pv_panels", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    brand: { type: "text", notNull: true },
    model_ref: { type: "text", notNull: true },
    technology: { type: "text" },
    bifacial: { type: "boolean", notNull: true, default: false },
    power_wc: { type: "int", notNull: true },
    efficiency_pct: { type: "numeric(5,2)", notNull: true },
    temp_coeff_pct_per_deg: { type: "numeric(6,3)" },
    degradation_first_year_pct: { type: "numeric(5,2)", notNull: true, default: 1.0 },
    degradation_annual_pct: { type: "numeric(5,2)", notNull: true, default: 0.4 },
    voc_v: { type: "numeric(6,2)" },
    isc_a: { type: "numeric(6,2)" },
    vmp_v: { type: "numeric(6,2)" },
    imp_a: { type: "numeric(6,2)" },
    width_mm: { type: "int", notNull: true },
    height_mm: { type: "int", notNull: true },
    thickness_mm: { type: "int" },
    weight_kg: { type: "numeric(6,2)" },
    warranty_product_years: { type: "int" },
    warranty_performance_years: { type: "int" },
    active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  addConstraintIdempotent(
    pgm,
    "pv_panels",
    "pv_panels_brand_model_ref_unique",
    "UNIQUE (brand, model_ref)"
  );
};

export const down = (pgm) => {
  pgm.dropTable("pv_panels");
};
