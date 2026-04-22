/**
 * CP-QUOTE — Catégorie catalogue devis PACK (offres groupées / kits commerciaux).
 * Extension de l'ENUM PostgreSQL quote_catalog_category (ne pas modifier les migrations antérieures).
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`ALTER TYPE quote_catalog_category ADD VALUE 'PACK'`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {
  /* PostgreSQL ne permet pas de retirer une valeur d'ENUM sans recréer le type ; pas de rollback automatique. */
};
