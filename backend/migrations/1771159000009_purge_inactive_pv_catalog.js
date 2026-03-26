/**
 * Purge définitive des produits inactifs du catalogue PV
 * DELETE physique — pas de soft delete
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql("DELETE FROM pv_panels WHERE active = false");
  pgm.sql("DELETE FROM pv_inverters WHERE active = false");
  pgm.sql("DELETE FROM pv_batteries WHERE active = false");
  console.log("Purge inactive PV catalog executed");
};

export const down = (pgm) => {
  // Pas de rollback — les données supprimées ne peuvent pas être restaurées
};
