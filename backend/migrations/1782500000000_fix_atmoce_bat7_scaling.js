/**
 * ATMOCE BAT-7 est une batterie 7 kWh cumulable.
 *
 * L'ancien seed catalogue l'avait creee avec scalable=false par defaut, ce qui
 * doublait bien la capacite en multi-batteries mais bloquait la puissance a
 * 3,5 kW. Le devis doit pouvoir monter a 7 kW avec 2 batteries, puis caper a
 * 10,5 kW a partir de 3 modules.
 */

export const shorthands = undefined;

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    UPDATE pv_batteries
       SET scalable = true,
           max_modules = 3,
           max_charge_kw = COALESCE(NULLIF(max_charge_kw, 0), 3.5),
           max_discharge_kw = COALESCE(NULLIF(max_discharge_kw, 0), 3.5),
           max_system_charge_kw = 10.5,
           max_system_discharge_kw = 10.5,
           updated_at = now()
     WHERE upper(brand) = 'ATMOCE'
       AND upper(model_ref) = 'BAT-7';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    UPDATE pv_batteries
       SET scalable = false,
           max_modules = NULL,
           max_system_charge_kw = NULL,
           max_system_discharge_kw = NULL,
           updated_at = now()
     WHERE upper(brand) = 'ATMOCE'
       AND upper(model_ref) = 'BAT-7';
  `);
};
