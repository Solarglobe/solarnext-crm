/**
 * Compteurs lead (lead_meters) + lien conso — alignement pgmigrations.
 * Schéma déjà appliqué sur les bases existantes ; no-op pour cohérence checkOrder.
 * Nouvelle base : exécuter le script reconcile / audit schéma ou compléter le DDL ici.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`SELECT 1`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`SELECT 1`);
};
