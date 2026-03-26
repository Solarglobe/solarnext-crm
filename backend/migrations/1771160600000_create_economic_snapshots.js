/**
 * economic_snapshots — Versionné, transactionnel, verrouillé.
 * Préparation devis technique (draft). Ne modifie pas calpinage_snapshots.
 */

export const up = (pgm) => {
  pgm.createTable("economic_snapshots", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    study_id: {
      type: "uuid",
      notNull: true,
      references: "studies",
      onDelete: "CASCADE",
    },
    study_version_id: {
      type: "uuid",
      notNull: true,
      references: "study_versions",
      onDelete: "CASCADE",
    },
    organization_id: {
      type: "uuid",
      notNull: true,
      references: "organizations",
      onDelete: "CASCADE",
    },
    version_number: {
      type: "integer",
      notNull: true,
    },
    status: {
      type: "text",
      notNull: true,
      default: "DRAFT",
    },
    config_json: {
      type: "jsonb",
      notNull: true,
    },
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
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
    created_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
  });

  pgm.addConstraint("economic_snapshots", "economic_snapshots_config_json_not_null", {
    check: "config_json IS NOT NULL",
  });

  pgm.addConstraint("economic_snapshots", "economic_snapshots_study_version_unique", {
    unique: ["study_id", "version_number"],
  });

  pgm.createIndex("economic_snapshots", ["study_id"]);
  pgm.createIndex("economic_snapshots", ["study_version_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("economic_snapshots");
};
