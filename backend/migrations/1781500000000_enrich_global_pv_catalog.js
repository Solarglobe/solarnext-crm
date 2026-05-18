/**
 * PV-CATALOG-2026 - Enrichissement catalogue global sans prix.
 *
 * Objectif: stocker une base materiel partagee par toutes les organisations,
 * tracable par source, avec favoris globaux et statut commercial.
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

const commonColumnsSql = (table) => `
  ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS source_name text,
    ADD COLUMN IF NOT EXISTS source_url text,
    ADD COLUMN IF NOT EXISTS datasheet_url text,
    ADD COLUMN IF NOT EXISTS image_url text,
    ADD COLUMN IF NOT EXISTS last_verified_at date,
    ADD COLUMN IF NOT EXISTS data_confidence numeric(4,2) DEFAULT 0.70,
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
`;

export const up = (pgm) => {
  pgm.sql(commonColumnsSql("pv_panels"));
  pgm.sql(commonColumnsSql("pv_inverters"));
  pgm.sql(commonColumnsSql("pv_batteries"));

  pgm.sql(`
    ALTER TABLE pv_panels
      ADD COLUMN IF NOT EXISTS certificate_iec text,
      ADD COLUMN IF NOT EXISTS shading_compatible boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS area_m2 numeric(7,3)
        GENERATED ALWAYS AS ((width_mm::numeric * height_mm::numeric) / 1000000.0) STORED;
  `);

  pgm.sql(`
    ALTER TABLE pv_inverters
      ADD COLUMN IF NOT EXISTS monitoring_integrated boolean NOT NULL DEFAULT false;
  `);

  pgm.sql(`
    ALTER TABLE pv_batteries
      ADD COLUMN IF NOT EXISTS warranty_years int;
  `);

  pgm.createTable(
    "pv_mounting_systems",
    {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      name: { type: "text", notNull: true },
      brand: { type: "text", notNull: true },
      model_ref: { type: "text", notNull: true },
      mounting_type: { type: "text", notNull: true },
      roof_compatibility: { type: "text[]", notNull: true, default: "{}" },
      material: { type: "text" },
      max_panel_width_mm: { type: "int" },
      max_panel_height_mm: { type: "int" },
      certificate_iec: { type: "text" },
      source_name: { type: "text" },
      source_url: { type: "text" },
      datasheet_url: { type: "text" },
      image_url: { type: "text" },
      last_verified_at: { type: "date" },
      data_confidence: { type: "numeric(4,2)", notNull: true, default: 0.65 },
      status: { type: "text", notNull: true, default: "active" },
      is_favorite: { type: "boolean", notNull: true, default: false },
      active: { type: "boolean", notNull: true, default: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { ifNotExists: true }
  );

  addConstraintIdempotent(
    pgm,
    "pv_mounting_systems",
    "pv_mounting_systems_brand_model_ref_unique",
    "UNIQUE (brand, model_ref)"
  );

  for (const table of ["pv_panels", "pv_inverters", "pv_batteries", "pv_mounting_systems"]) {
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_${table}_favorite ON ${table}(is_favorite DESC, brand, model_ref);`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_${table}_status ON ${table}(status);`);
  }
};

export const down = (pgm) => {
  pgm.dropTable("pv_mounting_systems", { ifExists: true });
  pgm.sql("ALTER TABLE pv_batteries DROP COLUMN IF EXISTS warranty_years;");
  pgm.sql("ALTER TABLE pv_inverters DROP COLUMN IF EXISTS monitoring_integrated;");
  pgm.sql("ALTER TABLE pv_panels DROP COLUMN IF EXISTS area_m2;");
  pgm.sql("ALTER TABLE pv_panels DROP COLUMN IF EXISTS shading_compatible;");
  pgm.sql("ALTER TABLE pv_panels DROP COLUMN IF EXISTS certificate_iec;");
  for (const table of ["pv_panels", "pv_inverters", "pv_batteries"]) {
    pgm.sql(`
      ALTER TABLE ${table}
        DROP COLUMN IF EXISTS source_name,
        DROP COLUMN IF EXISTS source_url,
        DROP COLUMN IF EXISTS datasheet_url,
        DROP COLUMN IF EXISTS image_url,
        DROP COLUMN IF EXISTS last_verified_at,
        DROP COLUMN IF EXISTS data_confidence,
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS is_favorite;
    `);
  }
};
