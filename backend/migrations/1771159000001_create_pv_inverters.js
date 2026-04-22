/**
 * CP-002 — Table pv_inverters (micro + string)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("pv_inverters", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    brand: { type: "text", notNull: true },
    model_ref: { type: "text", notNull: true },
    inverter_type: { type: "text", notNull: true },
    nominal_power_kw: { type: "numeric(6,2)" },
    nominal_va: { type: "int" },
    phases: { type: "text" },
    mppt_count: { type: "int" },
    inputs_per_mppt: { type: "int" },
    mppt_min_v: { type: "numeric(6,2)" },
    mppt_max_v: { type: "numeric(6,2)" },
    max_input_current_a: { type: "numeric(6,2)" },
    max_dc_power_kw: { type: "numeric(6,2)" },
    euro_efficiency_pct: { type: "numeric(5,2)" },
    compatible_battery: { type: "boolean", notNull: true, default: false },
    active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  addConstraintIdempotent(
    pgm,
    "pv_inverters",
    "pv_inverters_brand_model_ref_unique",
    "UNIQUE (brand, model_ref)"
  );
  addConstraintIdempotent(
    pgm,
    "pv_inverters",
    "pv_inverters_inverter_type_check",
    "CHECK (inverter_type IN ('micro', 'string'))"
  );
  addConstraintIdempotent(
    pgm,
    "pv_inverters",
    "pv_inverters_phases_check",
    "CHECK (phases IS NULL OR phases IN ('1P', '3P'))"
  );
};

export const down = (pgm) => {
  pgm.sql("ALTER TABLE pv_inverters DROP CONSTRAINT IF EXISTS pv_inverters_phases_check");
  pgm.sql("ALTER TABLE pv_inverters DROP CONSTRAINT IF EXISTS pv_inverters_inverter_type_check");
  pgm.dropTable("pv_inverters");
};
