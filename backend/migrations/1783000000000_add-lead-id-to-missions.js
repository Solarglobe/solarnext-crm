/**
 * RDV sur lead — Ajout missions.lead_id.
 * Permet de rattacher une mission/rendez-vous à un lead non encore converti en client.
 * Additif : la colonne est nullable, les missions existantes (client_id) sont inchangées.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE missions
      ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS missions_lead_id_idx ON missions (lead_id);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS missions_lead_id_idx;`);
  pgm.sql(`ALTER TABLE missions DROP COLUMN IF EXISTS lead_id;`);
};
