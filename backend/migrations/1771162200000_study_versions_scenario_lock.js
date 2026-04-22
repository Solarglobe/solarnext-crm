/**
 * PROMPT 8 — Persistance + gel du scénario sélectionné.
 * study_versions : selected_scenario_id, selected_scenario_snapshot, is_locked.
 * Ne pas supprimer d'anciennes colonnes.
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumns("study_versions", {
    selected_scenario_id: { type: "text", notNull: false },
    selected_scenario_snapshot: { type: "jsonb", notNull: false },
    is_locked: { type: "boolean", notNull: true, default: false },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumns("study_versions", [
    "selected_scenario_id",
    "selected_scenario_snapshot",
    "is_locked",
  ]);
};
