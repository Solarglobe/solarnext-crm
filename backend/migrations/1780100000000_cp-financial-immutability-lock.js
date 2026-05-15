/**
 * CP-IMMUT-001 — Verrou contractuel : locked_at + snapshot_v1 + snapshot_hash
 *
 * Ajoute sur quotes et invoices :
 *   - locked_at     TIMESTAMPTZ  : timestamp de verrouillage (signé / émis)
 *   - snapshot_v1   JSONB        : copie figée du document_snapshot_json au moment du verrou
 *   - snapshot_hash TEXT         : SHA-256 de snapshot_v1 pour audit d'intégrité
 *
 * Note : study_versions.locked_at existe déjà (migration 1771162300000).
 * Note : quotes.billing_locked_at existe déjà (migration 1778000000000) — c'est un verrou
 *         différent (totaux facturation), le présent locked_at concerne le document contractuel.
 */

export const up = (pgm) => {
  /* ── QUOTES ─────────────────────────────────────────────────────────────── */
  pgm.sql(`
    ALTER TABLE quotes
      ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS snapshot_v1   JSONB       NULL,
      ADD COLUMN IF NOT EXISTS snapshot_hash TEXT        NULL;
  `);

  /* ── INVOICES ────────────────────────────────────────────────────────────── */
  pgm.sql(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS snapshot_v1   JSONB       NULL,
      ADD COLUMN IF NOT EXISTS snapshot_hash TEXT        NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE quotes
      DROP COLUMN IF EXISTS locked_at,
      DROP COLUMN IF EXISTS snapshot_v1,
      DROP COLUMN IF EXISTS snapshot_hash;
  `);
  pgm.sql(`
    ALTER TABLE invoices
      DROP COLUMN IF EXISTS locked_at,
      DROP COLUMN IF EXISTS snapshot_v1,
      DROP COLUMN IF EXISTS snapshot_hash;
  `);
};
