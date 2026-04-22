/**
 * CP-002 — Table pv_batteries (catalogue batteries enrichi)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("pv_batteries", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    brand: { type: "text", notNull: true },
    model_ref: { type: "text", notNull: true },
    usable_kwh: { type: "numeric(6,2)", notNull: true },
    nominal_voltage_v: { type: "numeric(6,2)" },
    max_charge_kw: { type: "numeric(6,2)" },
    max_discharge_kw: { type: "numeric(6,2)" },
    roundtrip_efficiency_pct: { type: "numeric(5,2)" },
    depth_of_discharge_pct: { type: "numeric(5,2)" },
    cycle_life: { type: "int" },
    chemistry: { type: "text" },
    scalable: { type: "boolean", notNull: true, default: false },
    max_modules: { type: "int" },
    active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  addConstraintIdempotent(
    pgm,
    "pv_batteries",
    "pv_batteries_brand_model_ref_unique",
    "UNIQUE (brand, model_ref)"
  );
};

export const down = (pgm) => {
  pgm.dropTable("pv_batteries");
};
