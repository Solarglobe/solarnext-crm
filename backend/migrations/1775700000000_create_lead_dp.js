/**
 * Dossier DP (déclaration préalable) — 1 brouillon max par (organization_id, lead_id)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("lead_dp", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    lead_id: {
      type: "uuid",
      notNull: true,
      references: "leads",
      onDelete: "CASCADE",
    },
    state_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  addConstraintIdempotent(
    pgm,
    "lead_dp",
    "lead_dp_unique_org_lead",
    "UNIQUE (organization_id, lead_id)"
  );

  pgm.createIndex("lead_dp", ["organization_id"]);
  pgm.createIndex("lead_dp", ["lead_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("lead_dp");
};
