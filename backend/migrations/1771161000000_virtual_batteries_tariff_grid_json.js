/**
 * pv_virtual_batteries — grille tarifaire JSONB (PDF / Base+HPHC / kVA)
 */

export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumns("pv_virtual_batteries", {
    tariff_grid_json: { type: "jsonb", notNull: false },
    tariff_source_label: { type: "text", notNull: false },
    tariff_effective_date: { type: "date", notNull: false },
  });
  pgm.sql(
    `CREATE INDEX pv_virtual_batteries_tariff_grid_gin ON pv_virtual_batteries USING GIN (tariff_grid_json)`
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS pv_virtual_batteries_tariff_grid_gin`);
  pgm.dropColumns("pv_virtual_batteries", [
    "tariff_grid_json",
    "tariff_source_label",
    "tariff_effective_date",
  ]);
};
