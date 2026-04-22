/**
 * Identité affichable des comptes CRM (portail client, listes admin).
 * Colonnes nullable : rétrocompatibilité totale avec les utilisateurs existants.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("users", {
    first_name: { type: "text" },
    last_name: { type: "text" },
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumn("users", ["first_name", "last_name"]);
};
