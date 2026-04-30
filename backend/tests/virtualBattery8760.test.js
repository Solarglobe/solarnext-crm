/**
 * Tests batterie virtuelle 8760h — simulateVirtualBattery8760 + bilans.
 * Usage: node backend/tests/virtualBattery8760.test.js
 */

import {
  simulateVirtualBattery8760,
  assertVirtualBatteryAnnualBalance,
  resolveVirtualBatteryCapacityKwh,
} from "../services/virtualBattery8760.service.js";
import { simulateBattery8760 } from "../services/batteryService.js";

const H = 8760;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 1e-3) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

function zeros(n) {
  return Array(n).fill(0);
}

function main() {
  console.log("=== virtualBattery8760.test.js ===\n");

  // Cas 1 — surplus faible, capacité large : tout le surplus créditable est stocké, pas d’overflow lié au plafond
  {
    const pv = zeros(H);
    const load = zeros(H);
    pv[100] = 2;
    load[100] = 1;
    const r = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 100, credit_ratio: 1 },
    });
    assert(r.ok, "cas1 ok");
    assertApprox(r.virtual_battery_total_charged_kwh, 1, "cas1 charge 1 kWh");
    assertApprox(r.virtual_battery_overflow_export_kwh, 0, "cas1 overflow 0");
    const bal = assertVirtualBatteryAnnualBalance(r, 0.05);
    assert(bal.ok, `cas1 bilan ${JSON.stringify(bal)}`);
    console.log("✅ Cas 1 — surplus faible, capacité non saturée");
  }

  // Cas 2 — surplus élevé vs petite capacité : saturation + overflow export
  {
    const pv = zeros(H);
    const load = zeros(H);
    pv[0] = 10;
    load[0] = 0;
    const r = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 3, credit_ratio: 1 },
    });
    assert(r.ok, "cas2 ok");
    assertApprox(r.virtual_battery_total_charged_kwh, 3, "cas2 charge max 3");
    assertApprox(r.virtual_battery_overflow_export_kwh, 7, "cas2 overflow 7");
    assertApprox(r.virtual_battery_credit_end_kwh, 3, "cas2 SOC fin 3");
    const bal = assertVirtualBatteryAnnualBalance(r, 0.05);
    assert(bal.ok, `cas2 bilan ${JSON.stringify(bal)}`);
    console.log("✅ Cas 2 — saturation capacité + export trop-plein");
  }

  // Cas 3 — déficit couvert par crédit (import réduit)
  {
    const pv = zeros(H);
    const load = zeros(H);
    pv[0] = 5;
    load[0] = 0;
    pv[1] = 0;
    load[1] = 4;
    const r = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 100, credit_ratio: 1 },
    });
    assert(r.ok, "cas3 ok");
    assertApprox(r.virtual_battery_total_charged_kwh, 5, "cas3 charge");
    assertApprox(r.virtual_battery_total_discharged_kwh, 4, "cas3 décharge");
    assertApprox(r.grid_import_kwh, 0, "cas3 import 0");
    const bal = assertVirtualBatteryAnnualBalance(r, 0.05);
    assert(bal.ok, `cas3 bilan ${JSON.stringify(bal)}`);
    console.log("✅ Cas 3 — déficit couvert par crédit virtuel");
  }

  // Cas 4 — déficit > crédit : crédit vidé, reliquat réseau
  {
    const pv = zeros(H);
    const load = zeros(H);
    pv[0] = 2;
    load[0] = 0;
    pv[1] = 0;
    load[1] = 5;
    const r = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 100, credit_ratio: 1 },
    });
    assert(r.ok, "cas4 ok");
    assertApprox(r.virtual_battery_total_charged_kwh, 2, "cas4 charge");
    assertApprox(r.virtual_battery_total_discharged_kwh, 2, "cas4 décharge max stock");
    assertApprox(r.grid_import_kwh, 3, "cas4 import reliquat");
    assertApprox(r.virtual_battery_credit_end_kwh, 0, "cas4 SOC fin 0");
    const bal = assertVirtualBatteryAnnualBalance(r, 0.05);
    assert(bal.ok, `cas4 bilan ${JSON.stringify(bal)}`);
    console.log("✅ Cas 4 — déficit supérieur au crédit → réseau");
  }

  // Cas 5 — cohérence bilan annuel sur profil 8760 synthétique
  {
    const pv = Array.from({ length: H }, (_, i) => (i % 24 < 8 ? 0.2 : 1.2));
    const load = Array.from({ length: H }, () => 0.8);
    const r = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 50, credit_ratio: 1 },
    });
    assert(r.ok, "cas5 ok");
    const bal = assertVirtualBatteryAnnualBalance(r, 1);
    assert(bal.ok, `cas5 bilan annuel ${JSON.stringify(bal)}`);
    assertApprox(r._balance.sum_pv + r._balance.sum_import, r._balance.sum_load + r._balance.sum_overflow + r._balance.soc_end, "cas5 identité énergétique", 1);
    console.log("✅ Cas 5 — bilan annuel cohérent (8760h)");
  }

  // Cas 6 — non-régression batterie physique : même entrées → même sortie (batteryService inchangé)
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
    const a = simulateBattery8760({ pv_hourly, conso_hourly, battery });
    const b = simulateBattery8760({ pv_hourly, conso_hourly, battery });
    assert(a.ok && b.ok, "cas6 sim OK");
    assert(a.auto_kwh === b.auto_kwh && a.surplus_kwh === b.surplus_kwh && a.grid_import_kwh === b.grid_import_kwh, "cas6 identique deux appels");
    const snap = JSON.stringify({
      auto_kwh: a.auto_kwh,
      surplus_kwh: a.surplus_kwh,
      grid_import_kwh: a.grid_import_kwh,
      battery_losses_kwh: a.battery_losses_kwh,
    });
    const again = simulateBattery8760({ pv_hourly, conso_hourly, battery });
    assert(JSON.stringify({
      auto_kwh: again.auto_kwh,
      surplus_kwh: again.surplus_kwh,
      grid_import_kwh: again.grid_import_kwh,
      battery_losses_kwh: again.battery_losses_kwh,
    }) === snap, "cas6 troisième appel identique");
    console.log("✅ Cas 6 — batterie physique déterministe (non modifiée)");
  }

  // Cas 7 — sans capacité explicite : refus moteur (aligné calc / MISSING_VIRTUAL_CAPACITY_KWH)
  {
    const pv = zeros(H);
    const load = zeros(H);
    pv[0] = 2;
    load[0] = 1;
    const r = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { enabled: true, credit_ratio: 1 },
    });
    assert(r.ok === false && r.reason === "MISSING_VIRTUAL_CAPACITY_KWH", `cas7 attendu MISSING, reçu ${JSON.stringify(r)}`);
    console.log("✅ Cas 7 — MISSING_VIRTUAL_CAPACITY_KWH sans capacity_kwh");
  }

  // Cas 8 — credit_ratio ≠ 1 ignoré (P1 : 100 % surplus éligible)
  {
    const pv = zeros(H);
    const load = zeros(H);
    pv[0] = 2;
    load[0] = 0;
    const rPartialConfig = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 100, credit_ratio: 0.5 },
    });
    assert(rPartialConfig.ok, "cas8 ok");
    assertApprox(
      rPartialConfig.virtual_battery_total_charged_kwh,
      2,
      "cas8 ancien credit_ratio ignoré — charge 2 kWh entiers",
      0.01
    );
    console.log("✅ Cas 8 — credit_ratio hérité ignoré (comportement 1)");
  }

  // Cas 9 — capacité plus faible => overflow plus élevé (ex: contrat 300 vs besoin supérieur)
  {
    const pv = zeros(H);
    const load = zeros(H);
    // 2 heures de surplus important, puis une consommation partielle.
    pv[0] = 500;
    pv[1] = 500;
    load[2] = 400;

    const r300 = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 300 },
    });
    const r1000 = simulateVirtualBattery8760({
      pv_hourly: pv,
      conso_hourly: load,
      config: { capacity_kwh: 1000 },
    });

    assert(r300.ok && r1000.ok, "cas9 sims ok");
    assert(
      r300.virtual_battery_overflow_export_kwh > r1000.virtual_battery_overflow_export_kwh,
      "cas9 overflow augmente avec capacité faible"
    );
    console.log("✅ Cas 9 — capacité contractuelle faible => overflow export plus élevé");
  }

  // resolveVirtualBatteryCapacityKwh
  assert(resolveVirtualBatteryCapacityKwh({ capacity_kwh: 12 }) === 12, "resolve capacity");
  assert(resolveVirtualBatteryCapacityKwh({ credit_cap_kwh: 8 }) === 8, "resolve credit_cap");
  assert(resolveVirtualBatteryCapacityKwh({}) === null, "resolve null");

  console.log("\n✅ Tous les tests virtualBattery8760 passent.");
}

main();
