/**
 * CP-026
 * Integrity + defaults + indexes (NON-DESTRUCTIVE)
 * - Enforce cross-org integrity for leads.stage_id and lead_stage_history stages
 * - Auto-recompute invoices.total_paid from payments
 * - Auto-seed default pipeline stages when a new organization is created (if none exist)
 * - Add missing indexes for lead_stage_history
 */

export const shorthands = undefined;

export const up = async (pgm) => {
  // 1) Indexes (safe, additive)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS lead_stage_history_lead_id_index
    ON lead_stage_history (lead_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS lead_stage_history_changed_at_index
    ON lead_stage_history (changed_at);
  `);

  // Optional but helpful for filtering history by stage
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS lead_stage_history_to_stage_id_index
    ON lead_stage_history (to_stage_id);
  `);

  // 2) Cross-org validation for leads.stage_id
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_validate_lead_stage_org()
    RETURNS trigger AS $$
    DECLARE
      stage_org uuid;
    BEGIN
      IF NEW.stage_id IS NULL THEN
        RAISE EXCEPTION 'leads.stage_id cannot be NULL';
      END IF;

      SELECT organization_id INTO stage_org
      FROM pipeline_stages
      WHERE id = NEW.stage_id;

      IF stage_org IS NULL THEN
        RAISE EXCEPTION 'Invalid stage_id: %', NEW.stage_id;
      END IF;

      IF stage_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'Cross-org stage not allowed. lead.org=% stage.org=%', NEW.organization_id, stage_org;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS leads_validate_stage_org ON leads;
  `);

  pgm.sql(`
    CREATE TRIGGER leads_validate_stage_org
    BEFORE INSERT OR UPDATE OF stage_id, organization_id ON leads
    FOR EACH ROW
    EXECUTE FUNCTION sg_validate_lead_stage_org();
  `);

  // 3) Cross-org validation for lead_stage_history stages against the lead org
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_validate_lead_stage_history_org()
    RETURNS trigger AS $$
    DECLARE
      lead_org uuid;
      to_org uuid;
      from_org uuid;
    BEGIN
      SELECT l.organization_id INTO lead_org
      FROM leads l
      WHERE l.id = NEW.lead_id;

      IF lead_org IS NULL THEN
        RAISE EXCEPTION 'Invalid lead_id: %', NEW.lead_id;
      END IF;

      -- to_stage must exist and match lead org
      SELECT organization_id INTO to_org
      FROM pipeline_stages
      WHERE id = NEW.to_stage_id;

      IF to_org IS NULL THEN
        RAISE EXCEPTION 'Invalid to_stage_id: %', NEW.to_stage_id;
      END IF;

      IF to_org <> lead_org THEN
        RAISE EXCEPTION 'Cross-org to_stage not allowed. lead.org=% to_stage.org=%', lead_org, to_org;
      END IF;

      -- from_stage optional but if present must match lead org
      IF NEW.from_stage_id IS NOT NULL THEN
        SELECT organization_id INTO from_org
        FROM pipeline_stages
        WHERE id = NEW.from_stage_id;

        IF from_org IS NULL THEN
          RAISE EXCEPTION 'Invalid from_stage_id: %', NEW.from_stage_id;
        END IF;

        IF from_org <> lead_org THEN
          RAISE EXCEPTION 'Cross-org from_stage not allowed. lead.org=% from_stage.org=%', lead_org, from_org;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS lead_stage_history_validate_org ON lead_stage_history;
  `);

  pgm.sql(`
    CREATE TRIGGER lead_stage_history_validate_org
    BEFORE INSERT ON lead_stage_history
    FOR EACH ROW
    EXECUTE FUNCTION sg_validate_lead_stage_history_org();
  `);

  // 4) Payments -> invoices.total_paid auto-recompute (DB source of truth)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_recompute_invoice_total_paid(p_invoice_id uuid)
    RETURNS void AS $$
    BEGIN
      UPDATE invoices i
      SET total_paid = COALESCE((
        SELECT SUM(p.amount)
        FROM payments p
        WHERE p.invoice_id = p_invoice_id
      ), 0)
      WHERE i.id = p_invoice_id;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_payments_sync_total_paid()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        PERFORM sg_recompute_invoice_total_paid(NEW.invoice_id);
        RETURN NEW;
      ELSIF TG_OP = 'UPDATE' THEN
        -- if invoice_id changed, recompute both
        IF NEW.invoice_id <> OLD.invoice_id THEN
          PERFORM sg_recompute_invoice_total_paid(OLD.invoice_id);
        END IF;
        PERFORM sg_recompute_invoice_total_paid(NEW.invoice_id);
        RETURN NEW;
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM sg_recompute_invoice_total_paid(OLD.invoice_id);
        RETURN OLD;
      END IF;

      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS payments_sync_total_paid ON payments;
  `);

  pgm.sql(`
    CREATE TRIGGER payments_sync_total_paid
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION sg_payments_sync_total_paid();
  `);

  // 5) Auto-seed default pipeline stages for new organizations (if none exist)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_seed_default_pipeline_for_org(p_org_id uuid)
    RETURNS void AS $$
    BEGIN
      -- only seed if organization has zero stages
      IF EXISTS (SELECT 1 FROM pipeline_stages WHERE organization_id = p_org_id) THEN
        RETURN;
      END IF;

      INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed)
      VALUES
        (gen_random_uuid(), p_org_id, 'Nouveau Lead', 1, false),
        (gen_random_uuid(), p_org_id, 'Contacté', 2, false),
        (gen_random_uuid(), p_org_id, 'RDV Planifié', 3, false),
        (gen_random_uuid(), p_org_id, 'Offre Envoyée', 4, false),
        (gen_random_uuid(), p_org_id, 'Signé', 5, false),
        (gen_random_uuid(), p_org_id, 'Perdu', 6, true);
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION sg_organizations_after_insert_seed_pipeline()
    RETURNS trigger AS $$
    BEGIN
      PERFORM sg_seed_default_pipeline_for_org(NEW.id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS organizations_seed_pipeline ON organizations;
  `);

  pgm.sql(`
    CREATE TRIGGER organizations_seed_pipeline
    AFTER INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION sg_organizations_after_insert_seed_pipeline();
  `);
};

export const down = async (pgm) => {
  // Drop triggers first
  pgm.sql(`DROP TRIGGER IF EXISTS organizations_seed_pipeline ON organizations;`);
  pgm.sql(`DROP TRIGGER IF EXISTS payments_sync_total_paid ON payments;`);
  pgm.sql(`DROP TRIGGER IF EXISTS lead_stage_history_validate_org ON lead_stage_history;`);
  pgm.sql(`DROP TRIGGER IF EXISTS leads_validate_stage_org ON leads;`);

  // Drop functions
  pgm.sql(`DROP FUNCTION IF EXISTS sg_organizations_after_insert_seed_pipeline();`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_seed_default_pipeline_for_org(uuid);`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_payments_sync_total_paid();`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_recompute_invoice_total_paid(uuid);`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_validate_lead_stage_history_org();`);
  pgm.sql(`DROP FUNCTION IF EXISTS sg_validate_lead_stage_org();`);

  // Drop indexes
  pgm.sql(`DROP INDEX IF EXISTS lead_stage_history_to_stage_id_index;`);
  pgm.sql(`DROP INDEX IF EXISTS lead_stage_history_changed_at_index;`);
  pgm.sql(`DROP INDEX IF EXISTS lead_stage_history_lead_id_index;`);
};
