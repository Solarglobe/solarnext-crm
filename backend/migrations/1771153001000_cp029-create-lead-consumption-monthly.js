/**
 * CP-029 LEAD/CLIENT RECORD — Migration B : create_lead_consumption_monthly
 * Table pour les consommations mensuelles (12 mois)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("lead_consumption_monthly", {
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
    lead_id: {
      type: "uuid",
      notNull: true,
      references: "leads",
      onDelete: "CASCADE"
    },
    year: {
      type: "integer",
      notNull: true
    },
    month: {
      type: "integer",
      notNull: true
    },
    kwh: {
      type: "integer",
      notNull: true
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()")
    }
  });

  addConstraintIdempotent(
    pgm,
    "lead_consumption_monthly",
    "lcm_month_check",
    "CHECK (month >= 1 AND month <= 12)"
  );
  addConstraintIdempotent(
    pgm,
    "lead_consumption_monthly",
    "lcm_kwh_check",
    "CHECK (kwh >= 0)"
  );
  addConstraintIdempotent(
    pgm,
    "lead_consumption_monthly",
    "lcm_lead_year_month_unique",
    "UNIQUE (lead_id, year, month)"
  );
  pgm.createIndex("lead_consumption_monthly", ["organization_id"]);
  pgm.createIndex("lead_consumption_monthly", ["lead_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("lead_consumption_monthly");
};
