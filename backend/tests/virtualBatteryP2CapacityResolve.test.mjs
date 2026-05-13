/**
 * Résolution capacité VB P2 (étude commerciale vs grille fournisseur).
 * node --test backend/tests/virtualBatteryP2CapacityResolve.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveP2VirtualBatterySimulationCapacityKwh } from "../services/virtualBatteryP2CapacityResolve.service.js";
import { resolveVirtualBatteryCapacityKwh } from "../services/virtualBattery8760.service.js";
import { isCommercialUnboundedVirtualBatteryAllowed, markVirtualBatteryCapacityMissing } from "../services/antiOversell.service.js";
import { computeVirtualBatteryP2Finance } from "../services/virtualBatteryP2Finance.service.js";

function mockVbSim({ discharged = 0, capacityKwh = 10 }) {
  const hourly = new Array(8760).fill(0);
  hourly[0] = discharged;
  return {
    virtual_battery_total_discharged_kwh: discharged,
    virtual_battery_overflow_export_kwh: 0,
    grid_import_kwh: 0,
    virtual_battery_hourly_discharge_kwh: hourly,
    virtual_battery_capacity_kwh: capacityKwh,
  };
}

const gridMySmart = {
  providers: {
    MYLIGHT_MYSMARTBATTERY: {
      capacityTiers: [
        { kwh: 6, abonnement_month_ht: 10 },
        { kwh: 11, abonnement_month_ht: 25 },
      ],
      contributionRule: { a: 0.96, b: 0 },
    },
  },
};

test("resolveVirtualBatteryCapacityKwh accepte capacityKwh (camelCase)", () => {
  assert.equal(resolveVirtualBatteryCapacityKwh({ capacityKwh: 12 }), 12);
  assert.equal(resolveVirtualBatteryCapacityKwh({ virtualCapacityKwh: 7 }), 7);
});

test("P2 : capacité explicite prioritaire (contractual_input)", () => {
  const r = resolveP2VirtualBatterySimulationCapacityKwh({
    vbInput: { capacity_kwh: 18 },
    ctx: {},
    providerCodeUpper: "MYLIGHT_MYSMARTBATTERY",
    requiredCapacityKwhFromUnbounded: 999,
    allowPhysicalBatteryFallback: true,
  });
  assert.equal(r.capacity_kwh, 18);
  assert.equal(r.source, "contractual_input");
});

test("P2 : repli capacité batterie physique si pas de capacity_kwh VB", () => {
  const r = resolveP2VirtualBatterySimulationCapacityKwh({
    vbInput: { enabled: true },
    ctx: { battery_input: { enabled: true, capacity_kwh: 9.5 } },
    providerCodeUpper: "URBAN_SOLAR",
    requiredCapacityKwhFromUnbounded: 50,
    allowPhysicalBatteryFallback: true,
  });
  assert.equal(r.capacity_kwh, 9.5);
  assert.equal(r.source, "physical_battery_fallback");
});

test("P2 : palier grille MySmart quand pas de capacity_kwh dans le payload", () => {
  const r = resolveP2VirtualBatterySimulationCapacityKwh({
    vbInput: { enabled: true, provider_code: "MYLIGHT_MYSMARTBATTERY" },
    ctx: { settings: { pv: { virtual_battery: gridMySmart } } },
    providerCodeUpper: "MYLIGHT_MYSMARTBATTERY",
    requiredCapacityKwhFromUnbounded: 8,
    allowPhysicalBatteryFallback: false,
  });
  assert.equal(r.capacity_kwh, 11);
  assert.equal(r.source, "provider_grid_tier");
});

test("P2 : required > max palier → cap simulation au dernier palier (réel fournisseur)", () => {
  const r = resolveP2VirtualBatterySimulationCapacityKwh({
    vbInput: { enabled: true },
    ctx: { settings: { pv: { virtual_battery: gridMySmart } } },
    providerCodeUpper: "MYLIGHT_MYSMARTBATTERY",
    requiredCapacityKwhFromUnbounded: 500,
    allowPhysicalBatteryFallback: false,
  });
  assert.equal(r.capacity_kwh, 11);
  assert.equal(r.source, "provider_grid_tier_capped_at_max");
});

test("P2 : aucune source → null (URBAN sans payload ni physique)", () => {
  const r = resolveP2VirtualBatterySimulationCapacityKwh({
    vbInput: { enabled: true },
    ctx: { settings: { pv: { virtual_battery: {} } }, battery_input: { enabled: false } },
    providerCodeUpper: "URBAN_SOLAR",
    requiredCapacityKwhFromUnbounded: 40,
    allowPhysicalBatteryFallback: true,
  });
  assert.equal(r.capacity_kwh, null);
  assert.equal(r.source, null);
});

test("commercial : _vb_commercial_enforce_no_unbounded force le refus d’unbounded même sous NODE_ENV=test", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    assert.equal(isCommercialUnboundedVirtualBatteryAllowed({}), true);
    assert.equal(
      isCommercialUnboundedVirtualBatteryAllowed({ _vb_commercial_enforce_no_unbounded: true }),
      false
    );
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("markVirtualBatteryCapacityMissing pose VB_CAPACITY_MISSING (pas VB_UNBOUNDED)", () => {
  const sc = markVirtualBatteryCapacityMissing({ name: "BATTERY_VIRTUAL", finance_warnings: [] });
  assert.equal(sc._skipped, true);
  assert.ok(sc.finance_warnings.includes("VB_CAPACITY_MISSING"));
  assert.ok(!sc.finance_warnings.includes("VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE"));
  assert.ok(sc._vb_capacity_missing);
});

test("VB P2 MySmart résolu + computeVirtualBatteryP2Finance : abonnement HT > 0", () => {
  const resolved = resolveP2VirtualBatterySimulationCapacityKwh({
    vbInput: { enabled: true },
    ctx: { settings: { pv: { virtual_battery: gridMySmart } } },
    providerCodeUpper: "MYLIGHT_MYSMARTBATTERY",
    requiredCapacityKwhFromUnbounded: 10,
    allowPhysicalBatteryFallback: false,
  });
  assert.ok(resolved.capacity_kwh > 0);
  const vbSim = mockVbSim({ discharged: 5, capacityKwh: resolved.capacity_kwh });
  const fin = computeVirtualBatteryP2Finance({
    providerCode: "MYLIGHT_MYSMARTBATTERY",
    contractType: "BASE",
    installedKwc: 6,
    meterKva: 9,
    vbSim,
    unboundedRequiredCapacityKwh: 10,
    selectedCapacityKwh: resolved.capacity_kwh,
    hourlyDischargeKwh: vbSim.virtual_battery_hourly_discharge_kwh,
    hphcHourlyIsHp: null,
    tariffElectricityPerKwh: 0.2,
    oaRatePerKwh: 0.05,
    virtual_battery_settings: gridMySmart,
  });
  assert.ok(fin.virtual_battery_finance != null);
  assert.ok(Number(fin.virtual_battery_finance.annual_subscription_ht) > 0);
});
