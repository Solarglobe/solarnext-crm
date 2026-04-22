/**
 * Normalisation CRM — commercial unique (assigned_user_id) + source acquisition (source_id NOT NULL).
 * - Données : COALESCE(assigned_salesperson_user_id, assigned_to) → assigned_user_id
 * - lead_source texte → meilleure correspondance lead_sources.name (sinon « Autre »)
 * - Garantit une ligne lead_sources « Autre » par organisation
 * - Supprime assigned_to, assigned_salesperson_user_id
 *
 * Logs : NOTICE PostgreSQL (compteurs anomalies).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL;
  `);

  pgm.sql(`
    UPDATE leads
    SET assigned_user_id = COALESCE(assigned_salesperson_user_id, assigned_to)
    WHERE assigned_user_id IS NULL;
  `);

  pgm.sql(`
    INSERT INTO lead_sources (organization_id, name)
    SELECT o.id, 'Autre'
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM lead_sources ls
      WHERE ls.organization_id = o.id AND ls.name = 'Autre'
    );
  `);

  pgm.sql(`
    UPDATE leads l
    SET source_id = ls.id
    FROM lead_sources ls
    WHERE l.source_id IS NULL
      AND l.organization_id = ls.organization_id
      AND lower(trim(COALESCE(l.lead_source, ''))) = lower(trim(ls.name))
      AND trim(COALESCE(l.lead_source, '')) <> '';
  `);

  pgm.sql(`
    UPDATE leads l
    SET source_id = ls.id
    FROM lead_sources ls
    WHERE l.source_id IS NULL
      AND l.organization_id = ls.organization_id
      AND ls.name = 'Autre';
  `);

  pgm.sql(`
    DO $$
    DECLARE
      n_missing int;
      n_no_user int;
    BEGIN
      SELECT count(*)::int INTO n_missing FROM leads WHERE source_id IS NULL;
      IF n_missing > 0 THEN
        RAISE EXCEPTION 'leads_assigned_user_source_normalize: % leads sans source_id après backfill', n_missing;
      END IF;
      SELECT count(*)::int INTO n_no_user FROM leads WHERE assigned_user_id IS NULL;
      RAISE NOTICE 'leads_assigned_user_source_normalize: leads sans commercial (assigned_user_id NULL) = %', n_no_user;
    END $$;
  `);

  pgm.sql(`
    ALTER TABLE leads ALTER COLUMN source_id SET NOT NULL;
  `);

  pgm.sql(`DROP INDEX IF EXISTS idx_leads_assigned;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_assigned_user ON leads(assigned_user_id);`);

  pgm.dropColumns("leads", ["assigned_to", "assigned_salesperson_user_id"], { ifExists: true });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.addColumns(
    "leads",
    {
      assigned_to: { type: "uuid", references: "users", onDelete: "SET NULL" },
      assigned_salesperson_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    },
    { ifNotExists: true }
  );
  pgm.sql(`
    UPDATE leads SET assigned_to = assigned_user_id, assigned_salesperson_user_id = assigned_user_id
    WHERE assigned_user_id IS NOT NULL;
  `);
  pgm.sql(`ALTER TABLE leads ALTER COLUMN source_id DROP NOT NULL;`);
  pgm.dropColumns("leads", ["assigned_user_id"], { ifExists: true });
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_assigned_user;`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);`);
};
