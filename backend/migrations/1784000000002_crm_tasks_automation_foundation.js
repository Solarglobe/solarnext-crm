/**
 * CRM Tasks V1 — fondations automatisations.
 * - Historise les transitions project_status avec une vraie date d'événement.
 * - Lie optionnellement les activités CRM aux missions pour détecter un compte rendu RDV fiable.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  pgm.createTable("lead_project_status_transitions", {
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
    from_project_status: {
      type: "varchar(50)",
    },
    to_project_status: {
      type: "varchar(50)",
      notNull: true,
    },
    changed_by_user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    changed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("lead_project_status_transitions", ["organization_id", "lead_id", "changed_at"], {
    name: "idx_project_status_transitions_org_lead_changed",
  });
  pgm.createIndex("lead_project_status_transitions", ["organization_id", "to_project_status", "changed_at"], {
    name: "idx_project_status_transitions_org_status_changed",
  });

  pgm.sql(`
    ALTER TABLE lead_activities
      ADD COLUMN IF NOT EXISTS mission_id uuid NULL REFERENCES missions(id) ON DELETE SET NULL;
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_lead_activities_mission ON lead_activities(mission_id);`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_lead_activities_mission;`);
  pgm.sql(`ALTER TABLE lead_activities DROP COLUMN IF EXISTS mission_id;`);
  pgm.dropTable("lead_project_status_transitions", { ifExists: true });
};
