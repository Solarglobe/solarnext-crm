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
  pgm.createTable("roles", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()")
    },

    name: {
      type: "varchar(100)",
      notNull: true,
      unique: true
    },

    description: {
      type: "varchar(255)"
    },

    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });


  pgm.createTable("users", {
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

    email: {
      type: "varchar(255)",
      notNull: true
    },

    password_hash: {
      type: "text",
      notNull: true
    },

    status: {
      type: "varchar(50)",
      notNull: true,
      default: "active"
    },

    last_login: {
      type: "timestamp"
    },

    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp")
    }
  });

  pgm.createIndex("users", ["organization_id", "email"], { unique: true });


  pgm.createTable("user_roles", {
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE"
    },

    role_id: {
      type: "uuid",
      notNull: true,
      references: "roles",
      onDelete: "CASCADE"
    }
  });

  pgm.addConstraint(
    "user_roles",
    "user_roles_pk",
    {
      primaryKey: ["user_id", "role_id"]
    }
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("user_roles");
  pgm.dropTable("users");
  pgm.dropTable("roles");
};
