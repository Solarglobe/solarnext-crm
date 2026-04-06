/**
 * Tests unitaires merge batterie catalogue (sans DB).
 * node backend/tests/resolveBatteryFromDb.test.js
 */

import { mergeBatteryInputWithCatalogRow } from "../services/pv/resolveBatteryFromDb.service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = {
  enabled: true,
  capacity_kwh: 7,
  roundtrip_efficiency: 0.85,
  max_charge_kw: 3,
  max_discharge_kw: 3,
};

const row = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Test Bat",
  brand: "ACME",
  model_ref: "BAT-10",
  usable_kwh: 10,
  max_charge_kw: 5,
  max_discharge_kw: 4.5,
  roundtrip_efficiency_pct: 92,
  depth_of_discharge_pct: 95,
  cycle_life: 6000,
  chemistry: "LFP",
  nominal_voltage_v: 48,
};

function main() {
  const m = mergeBatteryInputWithCatalogRow(base, row);
  assert(m.battery_id === row.id, "battery_id");
  assert(m.capacity_kwh === 10, "capacity from catalogue");
  assert(Math.abs(m.roundtrip_efficiency - 0.92) < 1e-9, "roundtrip from catalogue");
  assert(m.max_charge_kw === 5, "max_charge from catalogue");
  assert(m.max_discharge_kw === 4.5, "max_discharge from catalogue");
  assert(m.usable_kwh === 10, "usable_kwh alias");
  assert(m.charge_power_kw === 5, "charge_power_kw alias");
  assert(m.discharge_power_kw === 4.5, "discharge_power_kw alias");
  assert(m.roundtrip_efficiency_pct === 92, "roundtrip_efficiency_pct");
  assert(m.brand === "ACME", "brand");
  assert(m.model_ref === "BAT-10", "model_ref");

  const noop = mergeBatteryInputWithCatalogRow(base, null);
  assert(noop.capacity_kwh === 7, "sans ligne catalogue = inchangé");

  console.log("OK resolveBatteryFromDb.mergeBatteryInputWithCatalogRow");
}

main();
