/**
 * CP-002 — Synchronisation inverter_family avec type + suppression entrées test
 * - Supprime les onduleurs dont le name contient "test"
 * - type='micro' → inverter_family='MICRO'
 * - type='string' → inverter_family='CENTRAL'
 * Aucune modification de contraintes ou autres colonnes.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  // 1) Suppression des entrées de test AVANT synchronisation
  pgm.sql(`
    DELETE FROM pv_inverters
    WHERE name ILIKE '%test%';
  `);

  // 2) Synchronisation inverter_family avec inverter_type
  pgm.sql(`
    UPDATE pv_inverters
    SET inverter_family = 'MICRO'
    WHERE inverter_type = 'micro';
  `);

  pgm.sql(`
    UPDATE pv_inverters
    SET inverter_family = 'CENTRAL'
    WHERE inverter_type = 'string';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  // rollback neutre (ne pas modifier les données)
};
