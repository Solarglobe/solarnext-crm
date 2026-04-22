/**
 * CP-024
 * Table: audit_logs
 * Immutable audit trail (SaaS-ready)
 * Non-destructive
 */

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  /*
    TABLE AUDIT_LOGS
    - Immutable
    - No UPDATE allowed
    - No DELETE allowed (except migration rollback)
  */
  pgm.createTable("audit_logs", {
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

    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },

    action: {
      type: "varchar(150)",
      notNull: true,
    },

    entity_type: {
      type: "varchar(150)",
      notNull: true,
    },

    entity_id: {
      type: "uuid",
    },

    before_hash: {
      type: "varchar(128)",
    },

    after_hash: {
      type: "varchar(128)",
    },

    ip_address: {
      type: "varchar(100)",
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

  pgm.createIndex("audit_logs", ["organization_id"]);
  pgm.createIndex("audit_logs", ["user_id"]);
  pgm.createIndex("audit_logs", ["entity_type"]);
  pgm.createIndex("audit_logs", ["entity_id"]);
  pgm.createIndex("audit_logs", ["created_at"]);

  /*
    IMMUTABILITY TRIGGER
    Prevent UPDATE & DELETE
  */

  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_audit_logs_modification()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs table is immutable';
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_logs_modification();
  `);

  pgm.sql(`
    CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_logs_modification();
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;`);
  pgm.sql(`DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;`);
  pgm.sql(`DROP FUNCTION IF EXISTS prevent_audit_logs_modification;`);
  pgm.dropTable("audit_logs");
};
