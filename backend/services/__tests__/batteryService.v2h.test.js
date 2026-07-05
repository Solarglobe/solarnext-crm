/**
 * Phase 3A — Tests moteur batterie étendu (V2H) + non-régression.
 * - Non-régression : sans `v2h`, sortie IDENTIQUE à l'original figé (fixture git HEAD).
 * - Bilans V2H : conservation batterie véhicule (incl. ev_grid_charge_kwh),
 *   disponibilité, bornes SOC, recharge réseau conditionnelle.
 *
 * Lancement : node --test services/__tests__/batteryService.v2h.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateBattery8760 } from "../batteryService.js";
import { simulateBattery8760 as original } from "./__fixtures__/batteryService.original.js";
import { buildV2hAvailabilityHourly } from "../v2hAvailability.js";

// Profils déterministes 8760.
function makePv(peak) {
  const a = new Array(8760);
  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    a[h] = hod >= 8 && hod <= 16 ? peak * Math.sin(((hod - 8) / 8) * Math.PI) : 0;
  }
  return a;
}
function makeConso(perHour, eveningBoost = 0) {
  const a = new Array(8760);
  for (let h = 0; h < 8760; h++) {
    const hod = h % 24;
    a[h] = perHour + (hod >= 18 || hod < 7 ? eveningBoost : 0);
  }
  return a;
}

const ORIGINAL_KEYS = Object.keys(
  original({ pv_hourly: makePv(4), conso_hourly: makeConso(0.5), battery: { enabled: true, capacity_kwh: 10 } })
);

// ─── Non-régression : sans v2h → identique à l'original ───
const NONREG_CONFIGS = [
  { enabled: true, capacity_kwh: 10, roundtrip_efficiency: 0.9, max_charge_kw: 5, max_discharge_kw: 5 },
  { enabled: true, capacity_kwh: 5 }, // défauts (pas de rendement/puissance)
  { enabled: true, capacity_kwh: 13.5, roundtrip_efficiency: 0.92, max_charge_kw: 3, max_discharge_kw: 3 },
];

for (let i = 0; i < NONREG_CONFIGS.length; i++) {
  test(`non-régression #${i + 1} : sans v2h === original`, () => {
    const pv = makePv(4);
    const conso = makeConso(0.6, 0.4);
    const ref = original({ pv_hourly: pv, conso_hourly: conso, battery: NONREG_CONFIGS[i] });
    const cur = simulateBattery8760({ pv_hourly: pv, conso_hourly: conso, battery: NONREG_CONFIGS[i] });
    for (const k of ORIGINAL_KEYS) {
      assert.deepEqual(cur[k], ref[k], `champ '${k}' diffère de l'original`);
    }
  });
}

test("non-régression : passer un v2h neutre ne change rien vs sans v2h", () => {
  const pv = makePv(4);
  const conso = makeConso(0.6, 0.4);
  const batt = { enabled: true, capacity_kwh: 10, roundtrip_efficiency: 0.9, max_charge_kw: 5, max_discharge_kw: 5 };
  const a = simulateBattery8760({ pv_hourly: pv, conso_hourly: conso, battery: batt });
  const b = simulateBattery8760({
    pv_hourly: pv, conso_hourly: conso, battery: batt,
    v2h: { min_soc_pct: 10, availability_hourly: null, daily_drive_kwh: 0 },
  });
  for (const k of ORIGINAL_KEYS) assert.deepEqual(b[k], a[k], `champ '${k}'`);
});

// ─── Bilans V2H ───
const V2H_BATT = { enabled: true, capacity_kwh: 60, roundtrip_efficiency: 0.85, max_charge_kw: 11, max_discharge_kw: 5 };
const PRESENCE = { weekday_plug_in_hour: 18, weekday_departure_hour: 7, weekend_present: true };
const AVAIL = buildV2hAvailabilityHourly(PRESENCE);

function runV2H(pv, conso, over = {}) {
  return simulateBattery8760({
    pv_hourly: pv, conso_hourly: conso, battery: V2H_BATT,
    v2h: { min_soc_pct: 50, availability_hourly: AVAIL, daily_drive_kwh: 8, daily_drive_hour: 7, ...over },
  });
}

test("réserve exposée = capacité × 50 % = 30 kWh", () => {
  const r = runV2H(makePv(6), makeConso(0.8, 0.6));
  assert.equal(r.ev_reserve_kwh, 30);
});

test("bilan batterie véhicule bouclé (incl. ev_grid_charge_kwh)", () => {
  const r = runV2H(makePv(6), makeConso(0.8, 0.6));
  const dSOC = r.ev_soc_end_kwh - r.ev_soc_start_kwh;
  const lhs = r.ev_solar_charge_kwh + r.ev_grid_charge_kwh;
  const rhs = r.ev_v2h_discharge_kwh + r.ev_trip_consumption_kwh + r.ev_battery_losses_kwh + dSOC;
  assert.ok(Math.abs(lhs - rhs) < 6, `bilan batterie non bouclé : lhs=${lhs} rhs=${rhs.toFixed(1)}`);
});

test("disponibilité respectée : voiture absente → 0 charge et 0 décharge", () => {
  const r = runV2H(makePv(6), makeConso(0.8, 0.6));
  for (let h = 0; h < 8760; h++) {
    if (AVAIL[h] === 0) {
      assert.equal(r.batt_discharge_hourly[h], 0, `décharge non nulle à h=${h} (absent)`);
      assert.equal(r.batt_charge_input_hourly[h], 0, `charge non nulle à h=${h} (absent)`);
    }
  }
});

test("bornes SOC : jamais < 0 ni > capacité", () => {
  const r = runV2H(makePv(6), makeConso(0.8, 0.6));
  for (let h = 0; h < 8760; h++) {
    assert.ok(r.battery_soc_hourly[h] >= -1e-6, `SOC négatif à h=${h}`);
    assert.ok(r.battery_soc_hourly[h] <= 60 + 1e-6, `SOC > capacité à h=${h}`);
  }
});

test("mobilité SÉPARÉE : ev_grid_charge = ev_trip = daily_drive×365, et les trajets ne réduisent PAS l'autoconso maison", () => {
  const allPlugged = new Array(8760).fill(1);
  const noDrive = runV2H(makePv(30), makeConso(0.3), { availability_hourly: allPlugged, daily_drive_kwh: 0 });
  const withDrive = runV2H(makePv(30), makeConso(0.3), { availability_hourly: allPlugged, daily_drive_kwh: 8 });
  // mobilité tracée à part, valeur fixe
  assert.equal(withDrive.ev_grid_charge_kwh, Math.round(8 * 365));
  assert.equal(withDrive.ev_trip_consumption_kwh, Math.round(8 * 365));
  assert.equal(noDrive.ev_grid_charge_kwh, 0);
  // POINT CLÉ : les trajets ne changent pas l'autoconso maison (pas de double peine)
  assert.equal(withDrive.auto_kwh, noDrive.auto_kwh);
});

test("aucun solaire + trajets → recharge réseau nécessaire (ev_grid_charge_kwh > 0), tracée à part", () => {
  const r = runV2H(makePv(0), makeConso(0.5, 0.5), { daily_drive_kwh: 8 });
  assert.ok(r.ev_grid_charge_kwh > 0, "ev_grid_charge_kwh devrait être > 0 sans solaire");
  // et cette énergie n'est PAS de l'autoconsommation solaire
  assert.equal(r.ev_solar_charge_kwh, 0);
});

test("trajets prélevés : ev_trip_consumption_kwh ≈ daily_drive × jours (réserve maintenue)", () => {
  const r = runV2H(makePv(8), makeConso(0.6, 0.5), { daily_drive_kwh: 8 });
  // 365 trajets de 8 kWh = 2920, tolérance (jours où SOC insuffisant très rares grâce à la recharge réseau)
  assert.ok(r.ev_trip_consumption_kwh > 2920 * 0.9, `trajets trop faibles : ${r.ev_trip_consumption_kwh}`);
});

test("V2H augmente l'autoconsommation maison vs sans batterie", () => {
  const pv = makePv(6), conso = makeConso(0.8, 0.6);
  const noBatt = simulateBattery8760({ pv_hourly: pv, conso_hourly: conso, battery: { enabled: false } });
  const withV2H = runV2H(pv, conso);
  assert.ok(withV2H.auto_kwh > noBatt.auto_kwh, "V2H devrait augmenter l'autoconsommation");
});
