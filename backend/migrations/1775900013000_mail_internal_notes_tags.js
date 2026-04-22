/**
 * CP-084 — Notes internes équipe + tags métier sur fils mail (hors contenu email).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("mail_thread_tags", {
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
    name: { type: "text", notNull: true },
    color: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_thread_tags_org_name_lower
    ON mail_thread_tags (organization_id, lower(btrim(name)));
  `);

  pgm.createIndex("mail_thread_tags", ["organization_id"], { name: "idx_mail_thread_tags_org" });

  pgm.createTable("mail_thread_notes", {
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
    thread_id: {
      type: "uuid",
      notNull: true,
      references: "mail_threads",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    content: { type: "text", notNull: true },
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
  });

  pgm.createIndex("mail_thread_notes", ["thread_id"], { name: "idx_mail_thread_notes_thread" });

  pgm.createTable("mail_thread_tag_links", {
    thread_id: {
      type: "uuid",
      notNull: true,
      references: "mail_threads",
      onDelete: "CASCADE",
    },
    tag_id: {
      type: "uuid",
      notNull: true,
      references: "mail_thread_tags",
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("mail_thread_tag_links", "mail_thread_tag_links_pkey", {
    primaryKey: ["thread_id", "tag_id"],
  });

  pgm.createIndex("mail_thread_tag_links", ["thread_id"], { name: "idx_mail_thread_tag_links_thread" });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_thread_notes_set_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_thread_notes_updated_at
    BEFORE UPDATE ON mail_thread_notes
    FOR EACH ROW EXECUTE FUNCTION sg_mail_thread_notes_set_updated_at();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_thread_notes_updated_at ON mail_thread_notes;
    DROP FUNCTION IF EXISTS sg_mail_thread_notes_set_updated_at();
  `);
  pgm.dropTable("mail_thread_tag_links");
  pgm.dropTable("mail_thread_notes");
  pgm.sql(`DROP INDEX IF EXISTS uq_mail_thread_tags_org_name_lower;`);
  pgm.dropTable("mail_thread_tags");
};
