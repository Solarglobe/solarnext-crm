/**
 * Brouillons mail persistés côté serveur (par utilisateur).
 * Un mail non terminé fermé depuis le compositeur est enregistré ici,
 * et listé dans le dossier « Brouillons » de la page Mail.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createTable("mail_drafts", {
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
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    mail_account_id: {
      type: "uuid",
      references: "mail_accounts",
      onDelete: "SET NULL",
    },
    to_recipients: { type: "text", notNull: true, default: "" },
    cc_recipients: { type: "text", notNull: true, default: "" },
    bcc_recipients: { type: "text", notNull: true, default: "" },
    subject: { type: "text", notNull: true, default: "" },
    body_html: { type: "text", notNull: true, default: "" },
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

  pgm.createIndex("mail_drafts", ["organization_id", "user_id", "updated_at"], {
    name: "idx_mail_drafts_org_user_updated",
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex("mail_drafts", ["organization_id", "user_id", "updated_at"], {
    name: "idx_mail_drafts_org_user_updated",
    ifExists: true,
  });
  pgm.dropTable("mail_drafts");
};
