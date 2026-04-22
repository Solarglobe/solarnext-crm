/**
 * CP-080 — Signatures mail (org / utilisateur / compte), HTML riche, défaut par scope.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("mail_signatures", {
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
    mail_account_id: {
      type: "uuid",
      references: "mail_accounts",
      onDelete: "CASCADE",
    },
    name: { type: "text", notNull: true },
    signature_html: { type: "text", notNull: true },
    is_default: { type: "boolean", notNull: true, default: false },
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

  pgm.addConstraint("mail_signatures", "mail_signatures_scope_chk", {
    check: `(
      (mail_account_id IS NOT NULL)
      OR (user_id IS NOT NULL AND mail_account_id IS NULL)
      OR (user_id IS NULL AND mail_account_id IS NULL)
    )`,
  });

  pgm.createIndex("mail_signatures", ["organization_id"], { name: "idx_mail_signatures_org" });
  pgm.createIndex("mail_signatures", ["user_id"], { name: "idx_mail_signatures_user" });
  pgm.createIndex("mail_signatures", ["mail_account_id"], { name: "idx_mail_signatures_account" });

  pgm.sql(`
    CREATE UNIQUE INDEX uq_mail_signatures_default_org
      ON mail_signatures (organization_id)
      WHERE is_default = true AND user_id IS NULL AND mail_account_id IS NULL AND is_active = true;

    CREATE UNIQUE INDEX uq_mail_signatures_default_user
      ON mail_signatures (organization_id, user_id)
      WHERE is_default = true AND user_id IS NOT NULL AND mail_account_id IS NULL AND is_active = true;

    CREATE UNIQUE INDEX uq_mail_signatures_default_account
      ON mail_signatures (mail_account_id)
      WHERE is_default = true AND mail_account_id IS NOT NULL AND is_active = true;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_signatures_validate_org()
    RETURNS trigger AS $$
    DECLARE ma_org uuid; u_org uuid;
    BEGIN
      IF NEW.mail_account_id IS NOT NULL THEN
        SELECT organization_id INTO ma_org FROM mail_accounts WHERE id = NEW.mail_account_id;
        IF ma_org IS NULL THEN RAISE EXCEPTION 'mail_signatures: mail_account_id invalide'; END IF;
        IF ma_org <> NEW.organization_id THEN
          RAISE EXCEPTION 'mail_signatures: organization_id ne correspond pas au compte mail';
        END IF;
      END IF;

      IF NEW.user_id IS NOT NULL THEN
        SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
        IF u_org IS NULL THEN RAISE EXCEPTION 'mail_signatures: user_id invalide'; END IF;
        IF u_org <> NEW.organization_id THEN
          RAISE EXCEPTION 'mail_signatures: organization_id ne correspond pas à l''utilisateur';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_signatures_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, user_id, mail_account_id ON mail_signatures
    FOR EACH ROW EXECUTE FUNCTION sg_mail_signatures_validate_org();
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_signatures_validate_org ON mail_signatures;
    DROP FUNCTION IF EXISTS sg_mail_signatures_validate_org();
  `);
  pgm.dropTable("mail_signatures");
};
