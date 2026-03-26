/**
 * CP-032B — Index & DB Performance Lock
 * Migration additive uniquement. Aucune suppression d'index.
 * Compatible PostgreSQL.
 */

const ORG_ACTIVE_TABLES = [
  "leads",
  "clients",
  "studies",
  "quotes",
  "invoices",
  "calendar_events",
  "entity_documents",
];

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  // 1) Index multi-org + soft delete (partial index)
  for (const table of ORG_ACTIVE_TABLES) {
    pgm.sql(`
      CREATE INDEX IF NOT EXISTS idx_${table}_org_active
      ON ${table}(organization_id)
      WHERE archived_at IS NULL;
    `);
  }

  // 2) Index relationnels — Leads
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);`);

  // 3) Clients
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);`);

  // 4) Studies
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_studies_client ON studies(client_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_studies_current_version ON studies(current_version);`);

  // 5) Study Versions
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_study_versions_study ON study_versions(study_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_study_versions_version ON study_versions(study_id, version_number);`);

  // 6) Quotes
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at DESC);`);

  // 7) Invoices
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);`);

  // 8) Documents (entity_documents)
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_documents_entity ON entity_documents(entity_type, entity_id);`);

  // 9) Contraintes UNIQUE si absentes
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_unique_number_per_org'
      ) THEN
        ALTER TABLE quotes ADD CONSTRAINT quotes_unique_number_per_org UNIQUE (organization_id, quote_number);
      END IF;
    END $$;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'studies_unique_study_number_per_org'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'studies' AND column_name = 'study_number'
      ) THEN
        ALTER TABLE studies ADD CONSTRAINT studies_unique_study_number_per_org UNIQUE (organization_id, study_number);
      END IF;
    END $$;
  `);

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'study_versions_study_id_version_number_unique'
      ) THEN
        ALTER TABLE study_versions ADD CONSTRAINT study_versions_study_id_version_number_unique UNIQUE (study_id, version_number);
      END IF;
    END $$;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  // Drop indexes only (constraints left as-is per spec: migration additive)
  for (const table of ORG_ACTIVE_TABLES) {
    pgm.sql(`DROP INDEX IF EXISTS idx_${table}_org_active;`);
  }
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_stage;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_assigned;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_created_at;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_clients_name;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_clients_email;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_studies_client;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_studies_current_version;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_study_versions_study;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_study_versions_version;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_quotes_client;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_quotes_status;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_quotes_created_at;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_invoices_client;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_invoices_status;`);
  pgm.sql(`DROP INDEX IF EXISTS idx_documents_entity;`);
};
