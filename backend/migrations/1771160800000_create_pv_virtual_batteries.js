/**
 * Paramètres PV — Batteries virtuelles (fournisseurs UrbanSolar, MyLight, etc.)
 * Table pv_virtual_batteries, multi-tenant par organization_id.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("pv_virtual_batteries", {
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
    name: {
      type: "text",
      notNull: true,
    },
    provider_code: {
      type: "text",
      notNull: true,
    },
    pricing_model: {
      type: "text",
      notNull: true,
    },
    monthly_subscription_ht: {
      type: "numeric(10,4)",
      notNull: false,
    },
    cost_per_kwh_ht: {
      type: "numeric(10,6)",
      notNull: false,
    },
    activation_fee_ht: {
      type: "numeric(10,2)",
      notNull: false,
    },
    contribution_autoproducteur_ht: {
      type: "numeric(10,2)",
      notNull: false,
    },
    includes_network_fees: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    indexed_on_trv: {
      type: "boolean",
      notNull: true,
      default: false,
    },
    capacity_table: {
      type: "jsonb",
      notNull: false,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.sql(
    `ALTER TABLE pv_virtual_batteries ADD CONSTRAINT pv_virtual_batteries_pricing_model_check CHECK (pricing_model IN ('per_kwc', 'per_capacity', 'per_kwc_with_variable', 'custom'))`
  );

  pgm.createIndex("pv_virtual_batteries", ["organization_id"], {
    name: "idx_virtual_batteries_org",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("pv_virtual_batteries");
};
