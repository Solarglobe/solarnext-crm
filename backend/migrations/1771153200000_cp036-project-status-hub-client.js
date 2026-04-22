/**
 * CP-036 — Hub Client : project_status + index
 * Colonne project_status pour suivi avancement projet
 * Default : LEAD → PROSPECTION, CLIENT → ETUDE_EN_COURS
 */

export const shorthands = undefined;

const PROJECT_STATUS_VALUES = [
  "PROSPECTION",
  "ETUDE_EN_COURS",
  "DEVIS_ENVOYE",
  "SIGNE",
  "EN_INSTALLATION",
  "RACCORDE",
  "FACTURE",
  "CLOTURE",
];

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_status varchar(50) NULL`);

  // Default selon status existant
  pgm.sql(`
    UPDATE leads SET project_status = CASE
      WHEN status = 'LEAD' THEN 'PROSPECTION'
      WHEN status = 'CLIENT' THEN COALESCE(project_status, 'ETUDE_EN_COURS')
      ELSE COALESCE(project_status, 'PROSPECTION')
    END
    WHERE project_status IS NULL;
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_project_status ON leads(project_status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_estimated_budget ON leads(estimated_budget_eur)`);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_estimated_budget`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_project_status`);
  pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS project_status`);
};
