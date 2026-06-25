import assert from "node:assert/strict";

import { repairVirtualScenarioDisplayKpis } from "../services/scenarioV2DisplayRepair.service.js";

const current8760Virtual = {
  id: "BATTERY_VIRTUAL",
  energy: {
    production_kwh: 8809,
    consumption_kwh: 16000,
    energy_solar_used_kwh: 8809,
    autoconsumption_kwh: 8809,
    import_kwh: 7191,
    billable_import_kwh: 7191,
    grid_import_kwh: 7191,
    credited_kwh: 4242,
    used_credit_kwh: 4242,
    restored_kwh: 4242,
  },
  virtual_battery_8760: {
    virtual_battery_total_charged_kwh: 4242,
    virtual_battery_total_discharged_kwh: 4242,
  },
  finance: {
    economie_year_1: 1290,
    estimated_annual_bill_eur: 1768,
    residual_bill_eur: 1768,
  },
};

const repaired = repairVirtualScenarioDisplayKpis(current8760Virtual);

assert.equal(
  repaired.energy.billable_import_kwh,
  7191,
  "current 8760 virtual snapshots must keep their authoritative billable import"
);
assert.equal(
  repaired.finance.economie_year_1,
  1290,
  "current 8760 virtual snapshots must not receive legacy display finance inflation"
);

console.log("OK scenarioV2DisplayRepairCurrent8760");
