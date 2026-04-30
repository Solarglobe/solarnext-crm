/**
 * CP-FIN-INV-CANCELLED-AT
 * Ajoute la date d'annulation sur les factures.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("invoices", {
    cancelled_at: { type: "timestamptz" },
  }, { ifNotExists: true });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumn("invoices", "cancelled_at", { ifExists: true });
};
