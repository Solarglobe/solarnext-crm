/**
 * CP-068 — Schéma mail SaaS (comptes IMAP/SMTP, threads, messages, pièces jointes, permissions).
 * Multi-tenant strict (organization_id + triggers anti cross-org).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  pgm.createType("mail_folder_type", ["INBOX", "SENT", "DRAFT", "TRASH", "CUSTOM"]);
  pgm.createType("mail_message_direction", ["INBOUND", "OUTBOUND"]);
  pgm.createType("mail_message_status", ["RECEIVED", "SENT", "FAILED", "DRAFT"]);
  pgm.createType("mail_participant_type", ["FROM", "TO", "CC", "BCC"]);

  pgm.createTable("mail_accounts", {
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
    email: { type: "text", notNull: true },
    display_name: { type: "text" },
    imap_host: { type: "text" },
    imap_port: { type: "integer" },
    imap_secure: { type: "boolean" },
    smtp_host: { type: "text" },
    smtp_port: { type: "integer" },
    smtp_secure: { type: "boolean" },
    encrypted_credentials: { type: "jsonb" },
    is_shared: { type: "boolean", notNull: true, default: false },
    is_active: { type: "boolean", notNull: true, default: true },
    last_sync_at: { type: "timestamptz" },
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

  pgm.addConstraint("mail_accounts", "uq_mail_accounts_org_email", {
    unique: ["organization_id", "email"],
  });
  pgm.createIndex("mail_accounts", ["organization_id"], { name: "idx_mail_accounts_organization_id" });
  pgm.createIndex("mail_accounts", ["user_id"], { name: "idx_mail_accounts_user_id" });

  pgm.createTable("mail_folders", {
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
    mail_account_id: {
      type: "uuid",
      notNull: true,
      references: "mail_accounts",
      onDelete: "CASCADE",
    },
    name: { type: "text", notNull: true },
    type: { type: "mail_folder_type", notNull: true },
    external_id: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("mail_folders", ["mail_account_id"], { name: "idx_mail_folders_mail_account_id" });

  pgm.createTable("mail_threads", {
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
    subject: { type: "text" },
    snippet: { type: "text" },
    last_message_at: { type: "timestamptz" },
    is_read: { type: "boolean", notNull: true, default: false },
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

  pgm.createIndex("mail_threads", ["organization_id"], { name: "idx_mail_threads_organization_id" });
  pgm.sql(`
    CREATE INDEX idx_mail_threads_last_message_at_desc
    ON mail_threads (last_message_at DESC NULLS LAST);
  `);

  pgm.createTable("mail_messages", {
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
    mail_thread_id: {
      type: "uuid",
      notNull: true,
      references: "mail_threads",
      onDelete: "CASCADE",
    },
    mail_account_id: {
      type: "uuid",
      notNull: true,
      references: "mail_accounts",
      onDelete: "CASCADE",
    },
    folder_id: {
      type: "uuid",
      references: "mail_folders",
      onDelete: "SET NULL",
    },
    message_id: { type: "text" },
    in_reply_to: { type: "text" },
    subject: { type: "text" },
    body_text: { type: "text" },
    body_html: { type: "text" },
    direction: { type: "mail_message_direction", notNull: true },
    status: { type: "mail_message_status", notNull: true },
    sent_at: { type: "timestamptz" },
    received_at: { type: "timestamptz" },
    is_read: { type: "boolean", notNull: true, default: false },
    has_attachments: { type: "boolean", notNull: true, default: false },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("mail_messages", "uq_mail_messages_account_message_id", {
    unique: ["mail_account_id", "message_id"],
  });
  pgm.createIndex("mail_messages", ["mail_thread_id"], { name: "idx_mail_messages_mail_thread_id" });
  pgm.createIndex("mail_messages", ["mail_account_id"], { name: "idx_mail_messages_mail_account_id" });
  pgm.sql(`
    CREATE INDEX idx_mail_messages_sent_at_desc
    ON mail_messages (sent_at DESC NULLS LAST);
  `);
  pgm.sql(`
    CREATE INDEX idx_mail_messages_received_at_desc
    ON mail_messages (received_at DESC NULLS LAST);
  `);

  pgm.createTable("mail_participants", {
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
    mail_message_id: {
      type: "uuid",
      notNull: true,
      references: "mail_messages",
      onDelete: "CASCADE",
    },
    type: { type: "mail_participant_type", notNull: true },
    email: { type: "text", notNull: true },
    name: { type: "text" },
  });

  pgm.createIndex("mail_participants", ["mail_message_id"], { name: "idx_mail_participants_mail_message_id" });
  pgm.createIndex("mail_participants", ["email"], { name: "idx_mail_participants_email" });

  pgm.createTable("mail_attachments", {
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
    mail_message_id: {
      type: "uuid",
      notNull: true,
      references: "mail_messages",
      onDelete: "CASCADE",
    },
    file_name: { type: "text", notNull: true },
    mime_type: { type: "text" },
    size_bytes: { type: "integer" },
    storage_path: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("mail_attachments", ["mail_message_id"], { name: "idx_mail_attachments_mail_message_id" });

  pgm.createTable("mail_account_permissions", {
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
    mail_account_id: {
      type: "uuid",
      notNull: true,
      references: "mail_accounts",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    can_read: { type: "boolean", notNull: true, default: true },
    can_send: { type: "boolean", notNull: true, default: false },
    can_manage: { type: "boolean", notNull: true, default: false },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("mail_account_permissions", "uq_mail_account_permissions_account_user", {
    unique: ["mail_account_id", "user_id"],
  });
  pgm.createIndex("mail_account_permissions", ["user_id"], { name: "idx_mail_account_permissions_user_id" });
  pgm.createIndex("mail_account_permissions", ["mail_account_id"], {
    name: "idx_mail_account_permissions_mail_account_id",
  });

  // Intégrité multi-org (évite les incohérences organization_id vs entités liées)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_folders_validate_org()
    RETURNS trigger AS $$
    DECLARE acc_org uuid;
    BEGIN
      SELECT organization_id INTO acc_org FROM mail_accounts WHERE id = NEW.mail_account_id;
      IF acc_org IS NULL THEN RAISE EXCEPTION 'mail_folders: mail_account_id invalide'; END IF;
      IF acc_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_folders: organization_id ne correspond pas au compte mail';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_folders_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_account_id ON mail_folders
    FOR EACH ROW EXECUTE FUNCTION sg_mail_folders_validate_org();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_messages_validate_org()
    RETURNS trigger AS $$
    DECLARE t_org uuid; a_org uuid;
    BEGIN
      SELECT organization_id INTO t_org FROM mail_threads WHERE id = NEW.mail_thread_id;
      IF t_org IS NULL THEN RAISE EXCEPTION 'mail_messages: mail_thread_id invalide'; END IF;
      IF t_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_messages: organization_id ne correspond pas au fil';
      END IF;

      SELECT organization_id INTO a_org FROM mail_accounts WHERE id = NEW.mail_account_id;
      IF a_org IS NULL THEN RAISE EXCEPTION 'mail_messages: mail_account_id invalide'; END IF;
      IF a_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_messages: organization_id ne correspond pas au compte mail';
      END IF;

      IF NEW.folder_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM mail_folders f
          WHERE f.id = NEW.folder_id
            AND f.organization_id = NEW.organization_id
            AND f.mail_account_id = NEW.mail_account_id
        ) THEN
          RAISE EXCEPTION 'mail_messages: dossier incohérent avec compte ou organisation';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_messages_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_thread_id, mail_account_id, folder_id ON mail_messages
    FOR EACH ROW EXECUTE FUNCTION sg_mail_messages_validate_org();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_participants_validate_org()
    RETURNS trigger AS $$
    DECLARE m_org uuid;
    BEGIN
      SELECT organization_id INTO m_org FROM mail_messages WHERE id = NEW.mail_message_id;
      IF m_org IS NULL THEN RAISE EXCEPTION 'mail_participants: mail_message_id invalide'; END IF;
      IF m_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_participants: organization_id ne correspond pas au message';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_participants_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_message_id ON mail_participants
    FOR EACH ROW EXECUTE FUNCTION sg_mail_participants_validate_org();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_attachments_validate_org()
    RETURNS trigger AS $$
    DECLARE m_org uuid;
    BEGIN
      SELECT organization_id INTO m_org FROM mail_messages WHERE id = NEW.mail_message_id;
      IF m_org IS NULL THEN RAISE EXCEPTION 'mail_attachments: mail_message_id invalide'; END IF;
      IF m_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_attachments: organization_id ne correspond pas au message';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_attachments_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_message_id ON mail_attachments
    FOR EACH ROW EXECUTE FUNCTION sg_mail_attachments_validate_org();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_mail_account_permissions_validate_org()
    RETURNS trigger AS $$
    DECLARE acc_org uuid; u_org uuid;
    BEGIN
      SELECT organization_id INTO acc_org FROM mail_accounts WHERE id = NEW.mail_account_id;
      IF acc_org IS NULL THEN RAISE EXCEPTION 'mail_account_permissions: mail_account_id invalide'; END IF;
      IF acc_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_account_permissions: organization_id ne correspond pas au compte mail';
      END IF;

      SELECT organization_id INTO u_org FROM users WHERE id = NEW.user_id;
      IF u_org IS NULL THEN RAISE EXCEPTION 'mail_account_permissions: user_id invalide'; END IF;
      IF u_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'mail_account_permissions: user hors organisation';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_mail_account_permissions_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_account_id, user_id ON mail_account_permissions
    FOR EACH ROW EXECUTE FUNCTION sg_mail_account_permissions_validate_org();
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_mail_account_permissions_validate_org ON mail_account_permissions;
    DROP FUNCTION IF EXISTS sg_mail_account_permissions_validate_org();
    DROP TRIGGER IF EXISTS trg_mail_attachments_validate_org ON mail_attachments;
    DROP FUNCTION IF EXISTS sg_mail_attachments_validate_org();
    DROP TRIGGER IF EXISTS trg_mail_participants_validate_org ON mail_participants;
    DROP FUNCTION IF EXISTS sg_mail_participants_validate_org();
    DROP TRIGGER IF EXISTS trg_mail_messages_validate_org ON mail_messages;
    DROP FUNCTION IF EXISTS sg_mail_messages_validate_org();
    DROP TRIGGER IF EXISTS trg_mail_folders_validate_org ON mail_folders;
    DROP FUNCTION IF EXISTS sg_mail_folders_validate_org();
  `);

  pgm.dropTable("mail_account_permissions", { cascade: true });
  pgm.dropTable("mail_attachments", { cascade: true });
  pgm.dropTable("mail_participants", { cascade: true });
  pgm.dropTable("mail_messages", { cascade: true });
  pgm.dropTable("mail_folders", { cascade: true });
  pgm.dropTable("mail_threads", { cascade: true });
  pgm.dropTable("mail_accounts", { cascade: true });

  pgm.dropType("mail_participant_type");
  pgm.dropType("mail_message_status");
  pgm.dropType("mail_message_direction");
  pgm.dropType("mail_folder_type");
};
