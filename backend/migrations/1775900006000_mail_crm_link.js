/**
 * CP-074 — Lien CRM mail ↔ client / lead (messages + domaine entreprise).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("clients", {
    company_domain: { type: "text" },
  });

  pgm.addColumn("mail_messages", {
    lead_id: { type: "uuid", references: "leads", onDelete: "SET NULL" },
    client_id: { type: "uuid", references: "clients", onDelete: "SET NULL" },
  });

  pgm.sql(`
    CREATE INDEX idx_mail_messages_lead_id ON mail_messages (lead_id);
  `);
  pgm.sql(`
    CREATE INDEX idx_mail_messages_client_id ON mail_messages (client_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_clients_org_email_lower
    ON clients (organization_id, (LOWER(TRIM(email))))
    WHERE email IS NOT NULL AND TRIM(email) <> '';
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_leads_org_email_lower
    ON leads (organization_id, (LOWER(TRIM(email))))
    WHERE email IS NOT NULL AND TRIM(email) <> '';
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_clients_org_company_domain_lower
    ON clients (organization_id, (LOWER(TRIM(company_domain))))
    WHERE company_domain IS NOT NULL AND TRIM(company_domain) <> '';
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

      IF NEW.client_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM clients c
          WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id
        ) THEN
          RAISE EXCEPTION 'mail_messages: client_id incohérent avec l''organisation';
        END IF;
      END IF;

      IF NEW.lead_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM leads l
          WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id
        ) THEN
          RAISE EXCEPTION 'mail_messages: lead_id incohérent avec l''organisation';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_mail_messages_validate_org ON mail_messages;
    CREATE TRIGGER trg_mail_messages_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_thread_id, mail_account_id, folder_id, client_id, lead_id ON mail_messages
    FOR EACH ROW EXECUTE PROCEDURE sg_mail_messages_validate_org();
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
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

    DROP TRIGGER IF EXISTS trg_mail_messages_validate_org ON mail_messages;
    CREATE TRIGGER trg_mail_messages_validate_org
    BEFORE INSERT OR UPDATE OF organization_id, mail_thread_id, mail_account_id, folder_id ON mail_messages
    FOR EACH ROW EXECUTE PROCEDURE sg_mail_messages_validate_org();
  `);

  pgm.sql(`DROP INDEX IF EXISTS idx_clients_org_company_domain_lower;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_org_email_lower;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_clients_org_email_lower;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_client_id;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_mail_messages_lead_id;`);

  pgm.dropColumns("mail_messages", ["lead_id", "client_id"]);
  pgm.dropColumns("clients", ["company_domain"]);
};
