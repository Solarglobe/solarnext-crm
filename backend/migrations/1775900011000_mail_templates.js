/**
 * CP-081 — Templates mail (org + utilisateur), variables dynamiques.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("mail_templates", {
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
      onDelete: "CASCADE",
    },
    name: { type: "text", notNull: true },
    subject_template: { type: "text" },
    body_html_template: { type: "text", notNull: true },
    category: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
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

  pgm.createIndex("mail_templates", ["organization_id"], { name: "idx_mail_templates_org" });
  pgm.createIndex("mail_templates", ["user_id"], { name: "idx_mail_templates_user" });
  pgm.createIndex("mail_templates", ["category"], { name: "idx_mail_templates_category" });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_templates_validate_org()
    RETURNS trigger AS $$
    DECLARE u_org uuid;
    BEGIN
      IF NEW.user_id IS NOT NULL THEN
        SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
        IF u_org IS NULL THEN RAISE EXCEPTION 'mail_templates: user_id invalide'; END IF;
        IF u_org <> NEW.organization_id THEN
          RAISE EXCEPTION 'mail_templates: organization_id ne correspond pas à l''utilisateur';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_templates_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, user_id ON mail_templates
    FOR EACH ROW EXECUTE FUNCTION sg_mail_templates_validate_org();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_templates_validate_org ON mail_templates;
    DROP FUNCTION IF EXISTS sg_mail_templates_validate_org();
  `);
  pgm.dropTable("mail_templates");
};
