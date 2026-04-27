/**
 * Index perf liste / recherche fiches techniques (sans toucher aux données).
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createIndex("fiche_techniques", ["organization_id"], {
    name: "idx_fiches_org_search",
    ifNotExists: true,
  });
  pgm.createIndex("fiche_techniques", ["name"], {
    name: "idx_fiches_name",
    ifNotExists: true,
  });
  pgm.createIndex("fiche_techniques", ["reference"], {
    name: "idx_fiches_reference",
    ifNotExists: true,
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropIndex("fiche_techniques", "idx_fiches_reference", { ifExists: true });
  pgm.dropIndex("fiche_techniques", "idx_fiches_name", { ifExists: true });
  pgm.dropIndex("fiche_techniques", "idx_fiches_org_search", { ifExists: true });
};
