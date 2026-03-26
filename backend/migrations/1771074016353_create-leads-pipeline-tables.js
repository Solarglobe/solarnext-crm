/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // TABLE LEAD SOURCES
  pgm.createTable("lead_sources", {
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
      type: "varchar(150)",
      notNull: true
    },

    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("lead_sources", ["organization_id", "name"], { unique: true });


  // TABLE PIPELINE STAGES
  pgm.createTable("pipeline_stages", {
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
      type: "varchar(150)",
      notNull: true
    },

    position: {
      type: "integer",
      notNull: true
    },

    is_closed: {
      type: "boolean",
      notNull: true,
      default: false
    },

    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("pipeline_stages", ["organization_id", "position"], { unique: true });


  // TABLE LEADS
  pgm.createTable("leads", {
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

    first_name: {
      type: "varchar(150)"
    },

    last_name: {
      type: "varchar(150)"
    },

    email: {
      type: "varchar(255)"
    },

    phone: {
      type: "varchar(50)"
    },

    address: {
      type: "text"
    },

    source_id: {
      type: "uuid",
      references: "lead_sources",
      onDelete: "SET NULL"
    },

    assigned_to: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL"
    },

    stage_id: {
      type: "uuid",
      notNull: true,
      references: "pipeline_stages",
      onDelete: "RESTRICT"
    },

    notes: {
      type: "text"
    },

    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    },

    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("leads", ["organization_id", "stage_id"]);


  // TABLE LEAD STAGE HISTORY
  pgm.createTable("lead_stage_history", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },

    lead_id: {
      type: "uuid",
      notNull: true,
      references: "leads",
      onDelete: "CASCADE"
    },

    from_stage_id: {
      type: "uuid",
      references: "pipeline_stages",
      onDelete: "SET NULL"
    },

    to_stage_id: {
      type: "uuid",
      notNull: true,
      references: "pipeline_stages",
      onDelete: "RESTRICT"
    },

    changed_by: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL"
    },

    changed_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("lead_stage_history");
  pgm.dropTable("leads");
  pgm.dropTable("pipeline_stages");
  pgm.dropTable("lead_sources");
};
