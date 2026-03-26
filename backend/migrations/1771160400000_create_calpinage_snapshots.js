/**
 * CP-SNAPSHOT — Table calpinage_snapshots (verrouillée, immuable)
 * Snapshots versionnés du calpinage (par étude + study_version).
 */

export const up = (pgm) => {
  pgm.createTable("calpinage_snapshots", {
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
    snapshot_json: {
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
    created_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
  });

  pgm.addConstraint("calpinage_snapshots", "calpinage_snapshots_snapshot_json_not_null", {
    check: "snapshot_json IS NOT NULL",
  });

  pgm.createIndex("calpinage_snapshots", ["study_id"]);
  pgm.createIndex("calpinage_snapshots", ["study_version_id"]);
  pgm.addConstraint("calpinage_snapshots", "calpinage_snapshots_study_version_unique", {
    unique: ["study_id", "version_number"],
  });
};

export const down = (pgm) => {
  pgm.dropTable("calpinage_snapshots");
};
