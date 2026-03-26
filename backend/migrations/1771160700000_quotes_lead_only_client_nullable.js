/**
 * CP-QUOTE-LEAD-ONLY — Devis sans Client (Lead-only)
 * - quotes.client_id nullable : client requis uniquement après signature
 * - Contrainte : au moins un de (client_id, lead_id) doit être renseigné
 * Préserve le flux "convert to client after signature" (client_id rempli plus tard).
 */

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE quotes ALTER COLUMN client_id DROP NOT NULL`);
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_client_id_fkey`);
  pgm.sql(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  `);
  pgm.sql(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_client_or_lead_check
    CHECK (client_id IS NOT NULL OR lead_id IS NOT NULL)
  `);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_client_or_lead_check`);
  pgm.sql(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_client_id_fkey`);
  pgm.sql(`ALTER TABLE quotes ALTER COLUMN client_id SET NOT NULL`);
  pgm.sql(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT
  `);
};
