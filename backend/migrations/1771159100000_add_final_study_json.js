/**
 * ONE_TRUE_FINAL_STUDY_JSON — Colonne study_versions.final_study_json (JSONB).
 * Consolidation après validation + calcul. Ne supprime rien.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("study_versions", {
    final_study_json: { type: "jsonb", notNull: false },
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumn("study_versions", "final_study_json");
};
