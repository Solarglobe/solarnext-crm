/**
 * Métriques batterie physique — simulateBattery8760 (cohérence charges / throughput / cycles / utilisation).
 * Usage: cd backend && node tests/batteryServicePhysicalMetrics.test.js
 */

import { simulateBattery8760 } from "../services/batteryService.js";

const H = 8760;

function assert(cond, msg) {
  if (!cond)         throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

function zeros(n) {
  return Array(n).fill(0);
}

function sumArr(arr) {
  return arr.reduce((s, v) => s + (Number(v) || 0), 0);
}

function main() {
  console.log("=== batteryServicePhysicalMetrics.test.js ===\n");

  // 1 — Throughput = charge + décharge (kWh arrondis moteur)
  {
    const pv_hourly = Array.from({ length: H }, (i) => (i >= 2000 && i < 4000 ? 2.5 : 0.4));
    const conso_hourly = Array.from({ length: H }, () => 0.5);
    const battery = {
      enabled: true,
      capacity_kwh: 10,
      roundtrip_efficiency: 0.9,
      max_charge_kw: 5,
      max_discharge_kw: 5,
    };
    const r = simulateBattery8760({ pv_hourly, conso_hourly, battery });
    assert(r.ok, "simulation OK");
    const sumCharge = Math.round(sumArr(r.batt_charge_hourly));
    const sumDischarge = Math.round(sumArr(r.batt_discharge_hourly));
    assert(r.annual_charge_kwh === sumCharge, "annual_charge_kwh = Σ batt_charge_hourly (arrondi)");
    assert(r.annual_discharge_kwh === sumDischarge, "annual_discharge_kwh = Σ batt_discharge_hourly (arrondi)");
    assert(
      r.annual_throughput_kwh === r.annual_charge_kwh + r.annual_discharge_kwh,
      "throughput = charge + décharge"
    );
    console.log("✅ Throughput cohérent avec les séries horaires");
  }

  // 2 — Cycles équivalents = décharge / capacité
  {
    const pv_hourly = Array.from({ length: H }, (i) => (i >= 2000 && i < 4000 ? 2.5 : 0.4));
    const conso_hourly = Array.from({ length: H }, () => 0.5);
    const capacity_kwh = 10;
    const r = simulateBattery8760({
      pv_hourly,
      conso_hourly,
      battery: {
        enabled: true,
        capacity_kwh,
        roundtrip_efficiency: 0.9,
        max_charge_kw: 5,
        max_discharge_kw: 5,
      },
    });
    assert(r.ok, "sim2 OK");
    const expectedCycles = r.annual_discharge_kwh / capacity_kwh;
    assertApprox(r.equivalent_cycles, expectedCycles, "equivalent_cycles");
    assertApprox(r.daily_cycles_avg, expectedCycles / 365, "daily_cycles_avg");
    console.log("✅ Cycles équivalents et cycles/jour cohérents");
  }

  // 3 — Taux d’utilisation dans [0, 1] si pas d’activité batterie (PV = charge en permanence)
  {
    const pv_hourly = Array.from({ length: H }, () => 1);
    const conso_hourly = Array.from({ length: H }, () => 1);
    const r = simulateBattery8760({
      pv_hourly,
      conso_hourly,
      battery: {
        enabled: true,
        capacity_kwh: 12,
        roundtrip_efficiency: 0.95,
        max_charge_kw: 5,
        max_discharge_kw: 5,
      },
    });
    assert(r.ok, "sim3 OK");
    assert(r.annual_discharge_kwh === 0 && r.annual_charge_kwh === 0, "pas de flux batterie");
    assert(r.battery_utilization_rate === 0, "utilisation nulle");
    assert(r.battery_utilization_rate >= 0 && r.battery_utilization_rate <= 1, "ratio ∈ [0,1] cas inactif");
    console.log("✅ Utilisation nulle et ratio dans [0, 1] (profil sans cyclage)");
  }

  // 4 — Chemins d’erreur : pas de nouvelles métriques obligatoires (ok: false)
  {
    const r = simulateBattery8760({
      pv_hourly: zeros(100),
      conso_hourly: zeros(H),
      battery: { enabled: true, capacity_kwh: 10 },
    });
    assert(r.ok === false, "profil PV invalide");
    assert(r.annual_charge_kwh === undefined, "pas de métriques si échec");
    console.log("✅ Échec simulation sans champs métriques orphelins");
  }

  console.log("\nPASS batteryServicePhysicalMetrics");
}

main();
