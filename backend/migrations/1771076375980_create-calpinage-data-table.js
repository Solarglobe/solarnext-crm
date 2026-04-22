/**
 * CP-017
 * Table: calpinage_data
 * 1 study_version = 1 calpinage snapshot
 * Non-destructive
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("calpinage_data", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },

    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE"
    },

    study_version_id: {
      type: "uuid",
      notNull: true,
      references: "study_versions",
      onDelete: "CASCADE"
    },

    /*
      JSON COMPLET CALPINAGE :
      - roof geometry
      - pans
      - obstacles
      - shadow volumes
      - shading results
      - panels layout
    */
    geometry_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb")
    },

    /*
      Résumé technique rapide (lecture rapide sans parser JSON)
    */
    total_panels: {
      type: "integer"
    },

    total_power_kwc: {
      type: "numeric"
    },

    annual_production_kwh: {
      type: "numeric"
    },

    total_loss_pct: {
      type: "numeric"
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  /*
    1 version = 1 calpinage
  */
  addConstraintIdempotent(
    pgm,
    "calpinage_data",
    "calpinage_data_unique_version",
    "UNIQUE (study_version_id)"
  );

  pgm.createIndex("calpinage_data", ["organization_id"]);
  pgm.createIndex("calpinage_data", ["study_version_id"]);
  pgm.createIndex("calpinage_data", ["created_at"]);
};

export const down = (pgm) => {
  pgm.dropTable("calpinage_data");
};
