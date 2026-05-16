/**
 * CP-SOFTDEL-001 — Colonne deleted_at sur tables critiques.
 *
 * deleted_at est distinct de archived_at (feature métier "cacher du pipeline").
 * deleted_at = "l'utilisateur a demandé la suppression" :
 *   - PII anonymisées immédiatement (nom, email, téléphone)
 *   - archived_at posé simultanément → disparaît de toutes les listes (259 filtres existants)
 *   - Période de grâce 30 jours : admin peut restaurer depuis la Corbeille
 *   - Après 30 jours : hard DELETE par cron SUPER_ADMIN
 *
 * Note : studies.deleted_at existe déjà (migration 1771162600000) — ADD COLUMN IF NOT EXISTS.
 */

export const up = (pgm) => {
  for (const table of ["leads", "studies", "quotes", "invoices", "entity_documents"]) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS deleted_by   UUID        NULL REFERENCES users(id) ON DELETE SET NULL;
    `);
    pgm.sql(`
      CREATE INDEX IF NOT EXISTS idx_${table}_deleted_at ON ${table}(deleted_at)
        WHERE deleted_at IS NOT NULL;
    `);
  }
};

export const down = (pgm) => {
  for (const table of ["leads", "studies", "quotes", "invoices", "entity_documents"]) {
    pgm.sql(`DROP INDEX IF EXISTS idx_${table}_deleted_at;`);
    pgm.sql(`
      ALTER TABLE ${table}
        DROP COLUMN IF EXISTS deleted_at,
        DROP COLUMN IF EXISTS deleted_by;
    `);
  }
};
