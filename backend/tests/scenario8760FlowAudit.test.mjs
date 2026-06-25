import test from "node:test";
import assert from "node:assert/strict";
import { simulateBattery8760 } from "../services/batteryService.js";
import { simulateVirtualBattery8760 } from "../services/virtualBattery8760.service.js";

const HOURS = 8760;

function hourlyProfiles() {
  const pv = [];
  const load = [];
  for (let h = 0; h < HOURS; h++) {
    const hour = h % 24;
    const daylight = hour >= 9 && hour <= 16;
    pv.push(daylight ? 3 : 0);
    load.push(daylight ? 1 : 2);
  }
  return { pv, load };
}

function sum(values) {
  return values.reduce((acc, value) => acc + (Number(value) || 0), 0);
}

test("BATTERY_PHYSICAL: charge uniquement avec surplus réel et respecte puissance/capacité", () => {
  const { pv, load } = hourlyProfiles();
  const battery = {
    enabled: true,
    capacity_kwh: 7,
    roundtrip_efficiency: 0.9,
    max_charge_kw: 3.5,
    max_discharge_kw: 3.5,
  };

  const result = simulateBattery8760({ pv_hourly: pv, conso_hourly: load, battery });
  assert.equal(result.ok, true);

  for (let h = 0; h < HOURS; h++) {
    const direct = Math.min(pv[h], load[h]);
    const grossSurplus = Math.max(0, pv[h] - direct);
    const need = Math.max(0, load[h] - direct);
    assert.ok(result.batt_charge_input_hourly[h] <= grossSurplus + 1e-9);
    assert.ok(result.batt_charge_input_hourly[h] <= battery.max_charge_kw + 1e-9);
    assert.ok(result.batt_discharge_hourly[h] <= need + 1e-9);
    assert.ok(result.batt_discharge_hourly[h] <= battery.max_discharge_kw + 1e-9);
    assert.ok(result.battery_soc_hourly[h] >= battery.capacity_kwh * 0.1 - 1e-9);
    assert.ok(result.battery_soc_hourly[h] <= battery.capacity_kwh + 1e-9);
  }

  assert.ok(result.annual_charge_from_surplus_kwh <= result.surplus_before_battery_kwh);
  assert.equal(result.direct_self_consumption_kwh, Math.round(sum(pv.map((v, h) => Math.min(v, load[h])))));
});

test("BATTERY_PHYSICAL: sans surplus PV, pas de charge artificielle ni cycles quotidiens inventés", () => {
  const pv = Array(HOURS).fill(0);
  const load = Array(HOURS).fill(1);
  const result = simulateBattery8760({
    pv_hourly: pv,
    conso_hourly: load,
    battery: { enabled: true, capacity_kwh: 7, roundtrip_efficiency: 0.9, max_charge_kw: 3.5, max_discharge_kw: 3.5 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.annual_charge_from_surplus_kwh, 0);
  assert.equal(result.surplus_before_battery_kwh, 0);
  assert.ok(result.annual_discharge_kwh <= 4, "seul le SOC initial peut être vidé, pas un cycle par jour");
  assert.ok(result.equivalent_cycles < 1);
});

test("BATTERY_VIRTUAL: crédit uniquement depuis le surplus exportable horaire", () => {
  const { pv, load } = hourlyProfiles();
  const result = simulateVirtualBattery8760({
    pv_hourly: pv,
    conso_hourly: load,
    config: { capacity_kwh: 20 },
  });

  assert.equal(result.ok, true);
  for (let h = 0; h < HOURS; h++) {
    const direct = Math.min(pv[h], load[h]);
    const grossSurplus = Math.max(0, pv[h] - direct);
    const need = Math.max(0, load[h] - direct);
    assert.ok(result.virtual_battery_hourly_charge_kwh[h] <= grossSurplus + 1e-9);
    assert.ok(result.virtual_battery_hourly_discharge_kwh[h] <= need + 1e-9);
  }
  assert.ok(result.virtual_battery_total_charged_kwh <= result.surplus_before_virtual_battery_kwh);
});

test("BATTERY_HYBRID: la virtuelle ne voit que le surplus résiduel après batterie physique", () => {
  const { pv, load } = hourlyProfiles();
  const physical = simulateBattery8760({
    pv_hourly: pv,
    conso_hourly: load,
    battery: { enabled: true, capacity_kwh: 7, roundtrip_efficiency: 0.9, max_charge_kw: 3.5, max_discharge_kw: 3.5 },
  });
  assert.equal(physical.ok, true);

  const importAfterPhysical = load.map((c, h) => Math.max(0, c - (physical.auto_hourly[h] || 0)));
  const hybridVirtual = simulateVirtualBattery8760({
    pv_hourly: physical.surplus_hourly,
    conso_hourly: importAfterPhysical,
    config: { capacity_kwh: 20 },
  });

  assert.equal(hybridVirtual.ok, true);
  assert.ok(hybridVirtual.virtual_battery_total_charged_kwh <= sum(physical.surplus_hourly) + 1e-6);
  assert.ok(hybridVirtual.virtual_battery_total_discharged_kwh <= sum(importAfterPhysical) + 1e-6);
});
