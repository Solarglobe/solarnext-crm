/**
 * Alignement historique node-pg-migrate : ce nom est déjà présent dans la table des migrations
 * sur des environnements où le fichier avait été appliqué sans être versionné ici.
 *
 * - Bases déjà migrées : ligne existante → up n’est pas ré-exécuté ; checkOrder redevient cohérent.
 * - Nouvelle base : no-op explicite (aucun DDL). Si votre schéma attendait un DDL sous ce nom,
 *   complétez depuis votre source de vérité (branche / backup) avant la première prod.
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
