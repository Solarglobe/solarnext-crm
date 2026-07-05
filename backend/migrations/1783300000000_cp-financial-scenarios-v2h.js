/**
 * Phase 3B V2H — Élargit la contrainte CHECK de financial_scenarios.scenario_id
 * pour accepter les 4 nouveaux scénarios Voiture V2H (vehicle-to-home).
 * Additif et réversible. Aucune donnée modifiée.
 *
 * Robustesse : on supprime la (les) contrainte(s) CHECK portant sur scenario_id
 * quel que soit leur nom auto-généré, puis on ajoute la contrainte élargie.
 */

export const shorthands = undefined;

const ALL_IDS = [
  "BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL", "BATTERY_HYBRID",
  "VEHICLE_V2H", "VEHICLE_V2H_PHYSICAL", "VEHICLE_V2H_VIRTUAL", "VEHICLE_V2H_PHYSICAL_VIRTUAL",
];
const LEGACY_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL", "BATTERY_HYBRID"];

function inList(ids) {
  return ids.map((s) => `'${s}'`).join(",");
}
function dropScenarioIdChecks() {
  return `
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'financial_scenarios'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%scenario_id%'
      LOOP
        EXECUTE 'ALTER TABLE financial_scenarios DROP CONSTRAINT ' || quote_ident(r.conname);
      END LOOP;
    END $$;
  `;
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(dropScenarioIdChecks());
  pgm.sql(`
    ALTER TABLE financial_scenarios
      ADD CONSTRAINT financial_scenarios_scenario_id_check
      CHECK (scenario_id IN (${inList(ALL_IDS)}));
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  // ⚠️ Échouera s'il existe déjà des lignes VEHICLE_V2H* (à purger avant rollback).
  pgm.sql(dropScenarioIdChecks());
  pgm.sql(`
    ALTER TABLE financial_scenarios
      ADD CONSTRAINT financial_scenarios_scenario_id_check
      CHECK (scenario_id IN (${inList(LEGACY_IDS)}));
  `);
};
