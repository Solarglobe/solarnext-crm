/**
 * CP-029 LEAD/CLIENT RECORD — Migration B : create_lead_consumption_monthly
 * Table pour les consommations mensuelles (12 mois)
 */

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

  pgm.sql(`ALTER TABLE lead_consumption_monthly ADD CONSTRAINT lcm_month_check CHECK (month >= 1 AND month <= 12)`);
  pgm.sql(`ALTER TABLE lead_consumption_monthly ADD CONSTRAINT lcm_kwh_check CHECK (kwh >= 0)`);
  pgm.sql(`ALTER TABLE lead_consumption_monthly ADD CONSTRAINT lcm_lead_year_month_unique UNIQUE (lead_id, year, month)`);
  pgm.createIndex("lead_consumption_monthly", ["organization_id"]);
  pgm.createIndex("lead_consumption_monthly", ["lead_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("lead_consumption_monthly");
};
