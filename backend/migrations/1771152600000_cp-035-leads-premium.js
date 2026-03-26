/**
 * CP-035 — Leads Premium : score, CA potentiel, inactivité, scoring
 * - score INT DEFAULT 0
 * - potential_revenue NUMERIC DEFAULT 0
 * - inactivity_level VARCHAR(20) DEFAULT 'none'
 * - status : EXISTE DÉJÀ (CP-028) — non ajouté ici
 * - last_activity_at TIMESTAMP
 * - estimated_kw NUMERIC (pour CA potentiel)
 * - Colonnes scoring : is_owner, consumption, surface_m2, project_delay_months, budget_validated, roof_exploitable
 *
 * Migration idempotente : ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // Colonnes à ajouter (status existe déjà via CP-028 — ne pas recréer)
  const columns = [
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS potential_revenue numeric NOT NULL DEFAULT 0`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS inactivity_level varchar(20) NOT NULL DEFAULT 'none'`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at timestamp DEFAULT current_timestamp`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_kw numeric`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_owner boolean DEFAULT false`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS consumption numeric`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS surface_m2 numeric`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_delay_months integer`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS budget_validated boolean DEFAULT false`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS roof_exploitable boolean DEFAULT false`
  ];

  columns.forEach((sql) => pgm.sql(sql));

  // Index idempotents (status et inactivity_level peuvent exister ou non)
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leads_inactivity_level ON leads(inactivity_level)`);
};

export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_status`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_inactivity_level`);
  const cols = [
    "score", "potential_revenue", "inactivity_level", "last_activity_at",
    "estimated_kw", "is_owner", "consumption", "surface_m2",
    "project_delay_months", "budget_validated", "roof_exploitable"
  ];
  cols.forEach((c) => pgm.sql(`ALTER TABLE leads DROP COLUMN IF EXISTS "${c}"`));
};
