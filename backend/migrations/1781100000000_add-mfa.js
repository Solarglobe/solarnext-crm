export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS mfa_secret text NULL,
      ADD COLUMN IF NOT EXISTS mfa_setup_secret text NULL,
      ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamp NULL;

    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;
  `);

  pgm.createTable(
    "mfa_recovery_codes",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      user_id: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "CASCADE",
      },
      code_hash: {
        type: "varchar(64)",
        notNull: true,
      },
      used_at: {
        type: "timestamp",
      },
      created_at: {
        type: "timestamp",
        notNull: true,
        default: pgm.func("current_timestamp"),
      },
    },
    { ifNotExists: true }
  );

  pgm.createIndex("mfa_recovery_codes", ["user_id", "code_hash"], {
    name: "idx_mfa_recovery_codes_user_hash",
    unique: true,
    ifNotExists: true,
  });
};

export const down = (pgm) => {
  pgm.dropIndex("mfa_recovery_codes", ["user_id", "code_hash"], {
    name: "idx_mfa_recovery_codes_user_hash",
    ifExists: true,
  });
  pgm.dropTable("mfa_recovery_codes", { ifExists: true });
  pgm.sql(`
    ALTER TABLE organizations DROP COLUMN IF EXISTS require_mfa;
    ALTER TABLE users
      DROP COLUMN IF EXISTS mfa_enabled_at,
      DROP COLUMN IF EXISTS mfa_setup_secret,
      DROP COLUMN IF EXISTS mfa_secret,
      DROP COLUMN IF EXISTS mfa_enabled;
  `);
};
