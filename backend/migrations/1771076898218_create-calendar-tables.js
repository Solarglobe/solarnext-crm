/**
 * CP-022
 * Tables: calendar_events + event_labels
 * Planning V1
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  /*
    TABLE EVENT_LABELS
    (couleur / secteur / type)
  */
  pgm.createTable("event_labels", {
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
      type: "varchar(150)",
      notNull: true,
    },

    color: {
      type: "varchar(20)", // ex: #FFAA00
      notNull: true,
    },

    category: {
      type: "varchar(100)", // secteur / type / statut
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("event_labels", "event_labels_unique_name_per_org", {
    unique: ["organization_id", "name"],
  });

  pgm.createIndex("event_labels", ["organization_id"]);
  pgm.createIndex("event_labels", ["category"]);

  /*
    TABLE CALENDAR_EVENTS
  */
  pgm.createTable("calendar_events", {
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

    title: {
      type: "varchar(255)",
      notNull: true,
    },

    description: {
      type: "text",
    },

    start_at: {
      type: "timestamptz",
      notNull: true,
    },

    end_at: {
      type: "timestamptz",
      notNull: true,
    },

    all_day: {
      type: "boolean",
      notNull: true,
      default: false,
    },

    client_id: {
      type: "uuid",
      references: "clients",
      onDelete: "SET NULL",
    },

    study_version_id: {
      type: "uuid",
      references: "study_versions",
      onDelete: "SET NULL",
    },

    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    label_id: {
      type: "uuid",
      references: "event_labels",
      onDelete: "SET NULL",
    },

    location: {
      type: "varchar(255)",
    },

    metadata_json: {
      type: "jsonb",
      notNull: true,
      default: pgm.func(`'{}'::jsonb`),
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("calendar_events", ["organization_id"]);
  pgm.createIndex("calendar_events", ["start_at"]);
  pgm.createIndex("calendar_events", ["client_id"]);
  pgm.createIndex("calendar_events", ["user_id"]);
  pgm.createIndex("calendar_events", ["label_id"]);
};

export const down = (pgm) => {
  pgm.dropTable("calendar_events");
  pgm.dropTable("event_labels");
};
