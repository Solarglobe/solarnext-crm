import assert from "node:assert/strict";
import test from "node:test";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";

test("verified BATTERY_VIRTUALpreserves monthly virtual discharge for PDF charts", () => {
  const virtualUsed = Array.from({ length: 12 }, (_, i) => 10 + i);
  const totalVirtualUsed = virtualUsed.reduce((a, b) => a + b, 0);

  const scenario = {
    id: "BATTERY_VIRTUAL",
    name: "BATTERY_VIRTUAL",
    _v2: true,
    energy: {
      production_kwh: 6000,
      consumption_kwh: 8000,
      direct_self_consumption_kwh: 1800,
      autoconsumption_kwh: 1800,
      surplus_kwh: 4200,
      import_kwh: 2000,
      billable_import_kwh: 2000,
      grid_import_kwh: 2000,
      used_credit_kwh: totalVirtualUsed,
      restored_kwh: totalVirtualUsed,
      monthly: Array.from({ length: 12 }, (_, i) => ({
        prod_kwh: 500,
        conso_kwh: 666,
        auto_kwh: 150 + virtualUsed[i],
        surplus_kwh: 350,
        import_kwh: 166,
        batt_kwh: virtualUsed[i],
        batt: virtualUsed[i],
        used_credit_kwh: virtualUsed[i],
        virtual_battery_discharge_kwh: virtualUsed[i],
      })),
      reference: {
        validation: { status: "verified" },
        annual: {
          production_kwh: 6000,
          consumption_kwh: 8000,
          direct_kwh: 1800,
          battery_discharge_solar_kwh: 0,
          grid_to_load_kwh: 6200,
          physical_export_kwh: 4200,
        },
        ratios: {
          useful_pv_utilization: 0.3,
          solar_coverage: 0.225,
        },
        monthly: Array.from({ length: 12 }, () => ({
          production_kwh: 500,
          consumption_kwh: 666,
          direct_kwh: 150,
          battery_discharge_solar_kwh: 0,
          grid_to_load_kwh: 516,
          physical_export_kwh: 350,
          storage_losses_kwh: 0,
        })),
        virtual_credit: {
          used_kwh: totalVirtualUsed,
          monthly: virtualUsed.map((used_credit, month) => ({ month, used_credit })),
        },
      },
    },
    battery_virtual: {
      enabled: true,
      restored_kwh: totalVirtualUsed,
      annual_discharge_kwh: totalVirtualUsed,
    },
    finance: {},
    metadata: { kwc: 6 },
  };

  const out = mapScenarioToV2(scenario, { form: {}, meta: {} });

  assert.equal(out.energy.monthly.length, 12);
  for (let i = 0; i < 12; i++) {
    assert.equal(out.energy.monthly[i].virtual_battery_discharge_kwh, virtualUsed[i]);
    assert.equal(out.energy.monthly[i].batt_kwh, virtualUsed[i]);
    assert.equal(out.energy.monthly[i].batt, virtualUsed[i]);
  }
});
