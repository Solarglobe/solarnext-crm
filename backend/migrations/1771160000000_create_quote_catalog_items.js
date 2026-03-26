/**
 * CP-QUOTE-001 — Catalogue devis (modules devis)
 * Table quote_catalog_items + ENUMs category / pricing_mode
 * Multi-tenant par organization_id. Soft delete via is_active.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  // 1) ENUMs
  pgm.createType("quote_catalog_category", [
    "PANEL",
    "INVERTER",
    "MOUNTING",
    "CABLE",
    "INSTALL",
    "SERVICE",
    "BATTERY_PHYSICAL",
    "BATTERY_VIRTUAL",
    "DISCOUNT",
    "OTHER"
  ]);

  pgm.createType("quote_catalog_pricing_mode", ["FIXED", "UNIT", "PERCENT_TOTAL"]);

  // 2) Table (pgcrypto déjà créé dans init / organizations)
  pgm.createTable("quote_catalog_items", {
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
    name: {
      type: "text",
      notNull: true
    },
    description: {
      type: "text",
      notNull: false
    },
    category: {
      type: "quote_catalog_category",
      notNull: true
    },
    pricing_mode: {
      type: "quote_catalog_pricing_mode",
      notNull: true,
      default: "FIXED"
    },
    sale_price_ht_cents: {
      type: "integer",
      notNull: true,
      default: 0
    },
    purchase_price_ht_cents: {
      type: "integer",
      notNull: true,
      default: 0
    },
    default_vat_rate_bps: {
      type: "integer",
      notNull: true,
      default: 2000
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true
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

  pgm.addConstraint("quote_catalog_items", "uq_quote_catalog_items_org_name", {
    unique: ["organization_id", "name"]
  });

  pgm.createIndex("quote_catalog_items", ["organization_id"], {
    name: "idx_quote_catalog_items_org_id"
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("quote_catalog_items");
  pgm.dropType("quote_catalog_pricing_mode");
  pgm.dropType("quote_catalog_category");
};
