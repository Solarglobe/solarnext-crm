/**
 * study_versions — status + updated_at pour flux run-study (READY_FOR_CALC).
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumns("study_versions", {
    status: {
      type: "varchar(50)",
      notNull: false,
    },
    updated_at: {
      type: "timestamptz",
      notNull: false,
      default: pgm.func("now()"),
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumns("study_versions", ["status", "updated_at"]);
};
