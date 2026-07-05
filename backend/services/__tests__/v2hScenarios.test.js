/**
 * Phase 3B — Tests du helper de génération énergie des scénarios V2H.
 * Vérifie : non-génération sans voiture ; combos selon actifs ; bilan maison
 * bouclé (auto + import = conso) ; ev_grid_charge_kwh séparé de l'import maison.
 *
 * Lancement : node --test services/__tests__/v2hScenarios.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildV2hEnergyScenarios } from "../v2hScenarios.service.js";

function makePv(peak) {
  const a = new Array(8760);
  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    a[h] = hod >= 8 && hod <= 16 ? peak * Math.sin(((hod - 8) / 8) * Math.PI) : 0;
  }
  return a;
}
function makeConso(perHour, boost = 0) {
  const a = new Array(8760);
  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    a[h] = perHour + (hod >= 18 || hod < 7 ? boost : 0);
  }
  return a;
}

const PV = makePv(6);
const CONSO = makeConso(0.8, 0.6);
const CONSO_TOTAL = Math.round(CONSO.reduce((a, b) => a + b, 0));

const VEHICLE = {
  enabled: true, capacity_kwh: 60, min_reserve_pct: 50, roundtrip_efficiency: 0.85,
  max_charge_kw: 11, max_discharge_kw: 5,
  weekday_plug_in_hour: 18, weekday_departure_hour: 7, weekend_present: true, daily_drive_kwh: 8,
};
const PHYS = { enabled: true, capacity_kwh: 10, roundtrip_efficiency: 0.9, max_charge_kw: 5, max_discharge_kw: 5 };
const VIRT = { enabled: true, provider_code: "URBAN_SOLAR", contract_type: "BASE" };

const call = (over = {}) => buildV2hEnergyScenarios({
  pv_hourly: PV, conso_hourly: CONSO, physicalBattery: null, virtualConfig: null,
  virtualCapacityKwh: 10, vehicle: VEHICLE, simulationYear: 2026, ...over,
});

test("combos virtuels V2H exposent la simulation virtuelle residuelle pour la finance", () => {
  const all = call({ physicalBattery: PHYS, virtualConfig: VIRT });
  for (const id of ["VEHICLE_V2H_VIRTUAL", "VEHICLE_V2H_PHYSICAL_VIRTUAL"]) {
    const s = all[id];
    assert.ok(s._virtualBattery8760?.ok, `${id}: simulation virtuelle complete attendue`);
    assert.equal(s.billable_import_kwh, s._virtualBattery8760.grid_import_kwh);
    assert.equal(s.virtual_discharged_kwh, s._virtualBattery8760.virtual_battery_total_discharged_kwh);
    assert.ok(Number.isFinite(Number(s.virtual_required_capacity_kwh)), `${id}: capacite requise attendue`);
  }
});

test("voiture désactivée → aucun scénario V2H (non-régression)", () => {
  assert.deepEqual(buildV2hEnergyScenarios({ pv_hourly: PV, conso_hourly: CONSO, vehicle: { enabled: false } }), {});
  assert.deepEqual(buildV2hEnergyScenarios({ pv_hourly: PV, conso_hourly: CONSO, vehicle: undefined }), {});
});

test("voiture activée mais capacité manquante → combos _skipped", () => {
  const r = call({ vehicle: { enabled: true } });
  assert.equal(r.VEHICLE_V2H._skipped, true);
  assert.equal(r.VEHICLE_V2H.reason, "vehicle_incomplete");
});

test("voiture seule → 1 combo", () => {
  const r = call();
  assert.deepEqual(Object.keys(r), ["VEHICLE_V2H"]);
});

test("voiture + physique → 2 combos ; + virtuel → 2 ; + les deux → 4", () => {
  assert.deepEqual(Object.keys(call({ physicalBattery: PHYS })).sort(), ["VEHICLE_V2H", "VEHICLE_V2H_PHYSICAL"].sort());
  assert.deepEqual(Object.keys(call({ virtualConfig: VIRT })).sort(), ["VEHICLE_V2H", "VEHICLE_V2H_VIRTUAL"].sort());
  const all = call({ physicalBattery: PHYS, virtualConfig: VIRT });
  assert.deepEqual(Object.keys(all).sort(),
    ["VEHICLE_V2H", "VEHICLE_V2H_PHYSICAL", "VEHICLE_V2H_VIRTUAL", "VEHICLE_V2H_PHYSICAL_VIRTUAL"].sort());
});

test("bilan maison bouclé (auto + import = conso) pour les 4 combos", () => {
  const r = call({ physicalBattery: PHYS, virtualConfig: VIRT });
  for (const id of Object.keys(r)) {
    const s = r[id];
    assert.ok(Math.abs((s.auto_kwh + s.grid_import_kwh) - CONSO_TOTAL) <= 3,
      `${id} : auto(${s.auto_kwh}) + import(${s.grid_import_kwh}) ≠ conso(${CONSO_TOTAL})`);
    assert.equal(s.consumption_kwh, CONSO_TOTAL);
  }
});

test("ev_grid_charge_kwh séparé : n'entre PAS dans le bilan maison", () => {
  // Sans solaire → forte recharge réseau mobilité, mais le bilan maison reste bouclé.
  const r = buildV2hEnergyScenarios({
    pv_hourly: makePv(0), conso_hourly: CONSO, virtualCapacityKwh: 10,
    vehicle: VEHICLE, simulationYear: 2026,
  });
  const s = r.VEHICLE_V2H;
  assert.ok(s.ev_grid_charge_kwh > 0, "recharge réseau mobilité attendue sans solaire");
  assert.ok(Math.abs((s.auto_kwh + s.grid_import_kwh) - CONSO_TOTAL) <= 3,
    "le bilan maison reste bouclé, ev_grid_charge exclu");
});

test("combos virtuels : simulation VB réussie", () => {
  const all = call({ physicalBattery: PHYS, virtualConfig: VIRT });
  assert.equal(all.VEHICLE_V2H_VIRTUAL._virtual_sim_ok, true);
  assert.equal(all.VEHICLE_V2H_PHYSICAL_VIRTUAL._virtual_sim_ok, true);
});
