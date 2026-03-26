/**
 * Mission Engine V1 — Tables mission_types, missions, mission_assignments
 * Prérequis: agencies, teams (créés si absents)
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

  // Tables agencies et teams si absentes (multi-agence / multi-équipes)
  const agenciesExists = await pgm.db.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agencies'
  `);
  if (agenciesExists.rows.length === 0) {
    pgm.createTable("agencies", {
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
      name: { type: "varchar(150)", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.createIndex("agencies", ["organization_id"]);
  }

  const teamsExists = await pgm.db.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'teams'
  `);
  if (teamsExists.rows.length === 0) {
    pgm.createTable("teams", {
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
      agency_id: {
        type: "uuid",
        references: "agencies",
        onDelete: "SET NULL",
      },
      name: { type: "varchar(150)", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    });
    pgm.createIndex("teams", ["organization_id"]);
    pgm.createIndex("teams", ["agency_id"]);
  }

  // Colonne agency_id sur clients si absente (pour préremplissage mission)
  const clientsCols = await pgm.db.query(`
    SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'agency_id'
  `);
  if (clientsCols.rows.length === 0) {
    pgm.addColumns("clients", {
      agency_id: {
        type: "uuid",
        references: "agencies",
        onDelete: "SET NULL",
      },
    });
  }

  // Table mission_types
  pgm.createTable("mission_types", {
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
    name: { type: "varchar(120)", notNull: true },
    color: { type: "varchar(20)" },
    default_duration_minutes: { type: "integer" },
    is_system: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("mission_types", ["organization_id"]);

  // Table missions
  pgm.createTable("missions", {
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
    title: { type: "varchar(255)", notNull: true },
    description: { type: "text" },
    mission_type_id: {
      type: "uuid",
      references: "mission_types",
      onDelete: "SET NULL",
    },
    start_at: { type: "timestamptz", notNull: true },
    end_at: { type: "timestamptz", notNull: true },
    status: { type: "varchar(50)", notNull: true, default: "scheduled" },
    client_id: {
      type: "uuid",
      references: "clients",
      onDelete: "SET NULL",
    },
    project_id: {
      type: "uuid",
      references: "studies",
      onDelete: "SET NULL",
    },
    agency_id: {
      type: "uuid",
      references: "agencies",
      onDelete: "SET NULL",
    },
    is_private_block: { type: "boolean", notNull: true, default: false },
    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("missions", ["organization_id"]);
  pgm.createIndex("missions", ["start_at"]);
  pgm.createIndex("missions", ["client_id"]);
  pgm.createIndex("missions", ["agency_id"]);

  // Table mission_assignments
  pgm.createTable("mission_assignments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    mission_id: {
      type: "uuid",
      notNull: true,
      references: "missions",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    team_id: {
      type: "uuid",
      references: "teams",
      onDelete: "SET NULL",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("mission_assignments", ["mission_id"]);
  pgm.createIndex("mission_assignments", ["user_id"]);
  pgm.addConstraint("mission_assignments", "mission_assignments_unique_mission_user", {
    unique: ["mission_id", "user_id"],
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable("mission_assignments");
  pgm.dropTable("missions");
  pgm.dropTable("mission_types");
  // Ne pas supprimer agencies/teams ni agency_id sur clients (peuvent être utilisés ailleurs)
};
