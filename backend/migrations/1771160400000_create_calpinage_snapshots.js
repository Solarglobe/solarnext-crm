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

  // snapshot_json : NOT NULL sur la colonne (pas de contrainte CHECK nommée ici) — 1771160500000 ajoute
  // calpinage_snapshots_snapshot_json_not_null en idempotent si besoin (schémas legacy).

  pgm.createIndex("calpinage_snapshots", ["study_id"]);
  pgm.createIndex("calpinage_snapshots", ["study_version_id"]);
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calpinage_snapshots_study_version_unique'
      ) THEN
        ALTER TABLE "calpinage_snapshots"
        ADD CONSTRAINT "calpinage_snapshots_study_version_unique"
        UNIQUE (study_id, version_number);
      END IF;
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.dropTable("calpinage_snapshots");
};
