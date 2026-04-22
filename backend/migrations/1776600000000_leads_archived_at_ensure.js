/**
 * Garantit archived_at sur leads (déjà présent via cp-032A pour la plupart des bases).
 * Idempotent : ADD COLUMN IF NOT EXISTS.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL`);
};

export const down = () => {
  /* Ne pas DROP : colonne historique (cp-032A et suivantes). */
};
