/**
 * CP-028 ADDRESS — Migration 1 : create_addresses_table
 * Table addresses avec champs EXACTS (spec V1)
 */

import { addConstraintIdempotent } from "./lib/addConstraintIdempotent.js";

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("addresses", {
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

    label: {
      type: "varchar(80)"
    },

    // Adresse postale
    address_line1: {
      type: "varchar(255)"
    },
    address_line2: {
      type: "varchar(255)"
    },
    postal_code: {
      type: "varchar(20)"
    },
    city: {
      type: "varchar(150)"
    },
    country_code: {
      type: "char(2)",
      notNull: true,
      default: "FR"
    },
    formatted_address: {
      type: "text"
    },

    // Géo
    lat: {
      type: "numeric(10,7)"
    },
    lon: {
      type: "numeric(10,7)"
    },
    geo_provider: {
      type: "varchar(50)"
    },
    geo_place_id: {
      type: "varchar(255)"
    },
    geo_source: {
      type: "varchar(50)"
    },
    geo_precision_level: {
      type: "varchar(50)"
    },
    geo_confidence: {
      type: "smallint"
    },
    geo_bbox: {
      type: "jsonb"
    },
    geo_updated_at: {
      type: "timestamptz"
    },

    // Qualité
    is_geo_verified: {
      type: "boolean",
      notNull: true,
      default: false
    },
    geo_verification_method: {
      type: "varchar(50)"
    },
    geo_notes: {
      type: "text"
    },

    // Timestamps
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

  // Index
  pgm.createIndex("addresses", ["organization_id"]);
  pgm.createIndex("addresses", ["lat", "lon"]);

  // Contraintes CHECK
  addConstraintIdempotent(
    pgm,
    "addresses",
    "addresses_lat_range",
    "CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90))"
  );

  addConstraintIdempotent(
    pgm,
    "addresses",
    "addresses_lon_range",
    "CHECK (lon IS NULL OR (lon >= -180 AND lon <= 180))"
  );

  addConstraintIdempotent(
    pgm,
    "addresses",
    "addresses_geo_confidence_range",
    "CHECK (geo_confidence IS NULL OR (geo_confidence >= 0 AND geo_confidence <= 100))"
  );

  addConstraintIdempotent(
    pgm,
    "addresses",
    "addresses_geo_precision_level_values",
    `CHECK (geo_precision_level IS NULL OR geo_precision_level IN (
      'UNKNOWN', 'COUNTRY', 'CITY', 'POSTAL_CODE', 'STREET',
      'HOUSE_NUMBER_INTERPOLATED', 'ROOFTOP_BUILDING', 'MANUAL_PIN_BUILDING'
    ))`
  );

  addConstraintIdempotent(
    pgm,
    "addresses",
    "addresses_rooftop_pin_requires_coords",
    `CHECK (
      (geo_precision_level NOT IN ('ROOFTOP_BUILDING', 'MANUAL_PIN_BUILDING'))
      OR (lat IS NOT NULL AND lon IS NOT NULL)
    )`
  );
};

export const down = (pgm) => {
  pgm.dropTable("addresses");
};
