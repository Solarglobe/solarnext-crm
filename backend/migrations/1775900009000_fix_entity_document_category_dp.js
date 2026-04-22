/**
 * Point d’extension après 1775810000000 (enum DP / documents).
 * No-op : toute évolution de schéma liée au DP doit aller dans une migration dédiée ultérieure.
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
