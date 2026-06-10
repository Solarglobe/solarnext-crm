/**
 * KPIs normalisés — attachNormalizedEnergyKpiFields
 * Usage: node backend/tests/energyKpisNormalize.test.js
 */

import { attachNormalizedEnergyKpiFields } from "../services/energyKpisNormalize.service.js";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  console.log("=== energyKpisNormalize.test.js ===\n");

  const base = {
    name: "BASE",
    _skipped: false,
    energy: { prod: 10000, conso: 12000, auto: 4000, surplus: 6000, import: 8000 },
    prod_kwh: 10000,
    conso_kwh: 12000,
    auto_kwh: 4000,
    surplus_kwh: 6000,
    import_kwh: 8000,
  };
  attachNormalizedEnergyKpiFields(base);
  assert(base.energy.site_autonomy_pct != null && base.energy.site_autonomy_pct < 100, "BASE autonomie < 100 si import > 0");
  assert(base.energy.pv_self_consumption_pct === 40, "BASE pv_self = 4000/10000");
  assert(base.energy.autoconsumption_kwh === 4000, "BASE autoconsumption_kwh = total utilisé");

  const phys = {
    name: "BATTERY_PHYSICAL",
    _skipped: false,
    battery: { annual_discharge_kwh: 1500 },
    energy: { prod: 10000, conso: 12000, auto: 5500, surplus: 5000, import: 6500 },
    auto_kwh: 5500,
    conso_kwh: 12000,
    prod_kwh: 10000,
  };
  attachNormalizedEnergyKpiFields(phys);
  assert(phys.energy.direct_self_consumption_kwh === 4000, "physique direct = auto - décharge");
  assert(phys.energy.battery_discharge_kwh === 1500, "physique décharge");

  const virt = {
    name: "BATTERY_VIRTUAL",
    _skipped: false,
    energy: {
      prod: 13457,
      conso: 15500,
      import: 6266,
      auto: 9200,
      production_kwh: 13457,
      consumption_kwh: 15500,
      import_kwh: 6266,
      total_pv_used_on_site_kwh: 9200,
      direct_self_consumption_kwh: 5000,
      battery_discharge_kwh: 4200,
      exported_kwh: 7000,
    },
    auto_kwh: 9200,
    conso_kwh: 15500,
    prod_kwh: 13457,
  };
  attachNormalizedEnergyKpiFields(virt);
  assert(virt.energy.site_autonomy_pct < 100, "BV autonomie site jamais 100 % si import réseau > 0");
  assert(virt.energy.pv_self_consumption_pct < 100, "BV autoconsommation PV < 100 % si surplus exporté");
  assert(virt.energy.export_pct != null && virt.energy.export_pct < 100, "BV export_pct");

  const virtRolloverAudit = {
    name: "BATTERY_VIRTUAL",
    _skipped: false,
    energy: {
      production_kwh: 9146,
      consumption_kwh: 10200,
      import_kwh: 1054,
      grid_import_kwh: 1054,
      auto: 9146,
      total_pv_used_on_site_kwh: 9146,
      direct_self_consumption_kwh: 6444,
      used_credit_kwh: 2702,
      restored_kwh: 2702,
      credited_kwh: 2702,
      surplus_kwh: 0,
      exported_kwh: 0,
      virtual_credit_start_kwh: 1648,
      virtual_credit_end_kwh: 1648,
    },
    auto_kwh: 9146,
    conso_kwh: 10200,
    prod_kwh: 9146,
    import_kwh: 1054,
  };
  attachNormalizedEnergyKpiFields(virtRolloverAudit);
  assert(Math.abs((virtRolloverAudit.energy.site_autonomy_pct ?? 0) - 89.67) < 0.05, "audit BV autonomie stabilisee");
  assert(Math.abs((virtRolloverAudit.energy.solar_coverage_pct ?? 0) - 89.67) < 0.05, "audit BV couverture stabilisee");
  assert(Math.abs((virtRolloverAudit.energy.pv_self_consumption_pct ?? 0) - 100) < 0.05, "audit BV autoconsommation PV stabilisee");
  assert(virtRolloverAudit.energy.site_solar_or_credit_used_kwh === 9146, "audit BV energie utilisee coherente");

  const audit = {
    name: "BASE",
    _skipped: false,
    energy: { prod: 4500, conso: 3300, auto: 1500, surplus: 3000, import: 1800 },
    prod_kwh: 4500,
    conso_kwh: 3300,
    auto_kwh: 1500,
    surplus_kwh: 3000,
    import_kwh: 1800,
  };
  attachNormalizedEnergyKpiFields(audit);
  assert(Math.abs((audit.energy.pv_self_consumption_pct ?? 0) - 33.33) < 0.05, "audit pv_self");
  assert(Math.abs((audit.energy.site_autonomy_pct ?? 0) - 45.45) < 0.05, "audit site_autonomy");
  assert(Math.abs((audit.energy.solar_coverage_pct ?? 0) - 45.45) < 0.05, "audit solar_coverage");
  assert(Math.abs((audit.energy.export_pct ?? 0) - 66.67) < 0.05, "audit export");

  const hybridImpossibleDisplay = {
    name: "BATTERY_HYBRID",
    _skipped: false,
    battery: {
      enabled: true,
      annual_charge_kwh: 1800,
      annual_discharge_kwh: 1600,
      annual_throughput_kwh: 3400,
      equivalent_cycles: 228.57,
      daily_cycles_avg: 0.63,
      battery_utilization_rate: 0.63,
    },
    battery_virtual: {
      enabled: true,
      annual_charge_kwh: 2418,
      annual_discharge_kwh: 4218,
      restored_kwh: 4218,
      overflow_export_kwh: 0,
    },
    energy: {
      production_kwh: 9146,
      consumption_kwh: 10200,
      prod: 9146,
      conso: 10200,
      auto: 11694,
      autoconsumption_kwh: 11694,
      total_pv_used_on_site_kwh: 11694,
      import: 1224,
      import_kwh: 1224,
      billable_import_kwh: 1224,
      grid_import_kwh: 1224,
      surplus: 0,
      surplus_kwh: 0,
      exported_kwh: 0,
      battery_losses_kwh: 170,
      direct_self_consumption_kwh: 5876,
      physical_battery_discharge_kwh: 1600,
      virtual_battery_discharge_kwh: 4218,
      used_credit_kwh: 4218,
      restored_kwh: 4218,
    },
    prod_kwh: 9146,
    conso_kwh: 10200,
    auto_kwh: 11694,
    import_kwh: 1224,
    billable_import_kwh: 1224,
    virtual_credit_start_kwh: 5000,
    virtual_credit_end_kwh: 5000,
  };
  attachNormalizedEnergyKpiFields(hybridImpossibleDisplay);
  assert(hybridImpossibleDisplay.energy.total_pv_used_on_site_kwh <= 9146, "HYBRID PV used capped to annual production");
  assert(hybridImpossibleDisplay.energy.energy_solar_used_kwh <= 9146, "HYBRID display solar used capped to annual production");
  assert(hybridImpossibleDisplay.energy.autoconsumption_kwh <= 9146, "HYBRID autoconsumption_kwh capped to annual production");
  assert(hybridImpossibleDisplay.energy.pv_self_consumption_pct <= 100, "HYBRID PV self-consumption cannot exceed 100%");
  assert(Math.abs((hybridImpossibleDisplay.energy.site_autonomy_pct ?? 0) - 88) < 0.05, "HYBRID site autonomy = 1 - import / conso");
  assert(
    (hybridImpossibleDisplay.energy.solar_coverage_pct ?? 0) <= (9146 / 10200) * 100 + 0.01,
    "HYBRID solar coverage cannot exceed annual PV production / consumption"
  );
  assert(hybridImpossibleDisplay.energy.site_solar_or_credit_used_kwh === 8976, "HYBRID site covered by solar or credit = conso - import");

  const mappedHybrid = mapScenarioToV2(hybridImpossibleDisplay, {
    pv: { kwc: 7, panelsCount: 18 },
    battery_input: { capacity_kwh: 7 },
    finance_input: { battery_physical_price_ttc: 0 },
  });
  assert(mappedHybrid.energy.energy_solar_used_kwh <= 9146, "scenarios_v2 energy_solar_used_kwh capped");
  assert(mappedHybrid.energy.total_pv_used_on_site_kwh <= 9146, "scenarios_v2 total_pv_used_on_site_kwh capped");
  assert(mappedHybrid.energy.billable_import_kwh === 1224, "scenarios_v2 billable_import_kwh preserved");
  assert(mappedHybrid.energy.energy_grid_import_kwh === 1224, "scenarios_v2 energy_grid_import_kwh preserved");
  assert(mappedHybrid.energy.site_solar_or_credit_used_kwh === 8976, "scenarios_v2 site solar or credit used preserved");

  const mappedVirtualStalePct = mapScenarioToV2(
    {
      name: "BATTERY_VIRTUAL",
      _skipped: false,
      energy: {
        production_kwh: 9146,
        consumption_kwh: 10200,
        total_pv_used_on_site_kwh: 9146,
        autoconsumption_kwh: 9146,
        import_kwh: 1054,
        billable_import_kwh: 1054,
        grid_import_kwh: 1054,
        energy_grid_import_kwh: 1054,
        site_autonomy_pct: 63.2,
        solar_coverage_pct: 63.2,
        pv_self_consumption_pct: 70.45,
      },
      prod_kwh: 9146,
      conso_kwh: 10200,
      auto_kwh: 9146,
      import_kwh: 1054,
      billable_import_kwh: 1054,
      virtual_credit_start_kwh: 1648,
      virtual_credit_end_kwh: 1648,
    },
    { pv: { kwc: 7, panelsCount: 18 } }
  );
  assert(Math.abs((mappedVirtualStalePct.energy.site_autonomy_pct ?? 0) - 89.67) < 0.05, "scenarios_v2 BV recompute autonomie, ignore stale pct");
  assert(Math.abs((mappedVirtualStalePct.energy.solar_coverage_pct ?? 0) - 89.67) < 0.05, "scenarios_v2 BV recompute couverture, ignore stale pct");
  assert(Math.abs((mappedVirtualStalePct.energy.pv_self_consumption_pct ?? 0) - 100) < 0.05, "scenarios_v2 BV recompute pv_self, ignore stale pct");
  assert(mappedVirtualStalePct.energy.energy_grid_import_kwh === 1054, "scenarios_v2 BV import corrige preserved");
  assert(mappedVirtualStalePct.energy.energy_solar_used_kwh === 9146, "scenarios_v2 BV energie PV utilisee corrigee");
  assert(mappedVirtualStalePct.energy.site_solar_or_credit_used_kwh === 9146, "scenarios_v2 BV energie site couverte corrigee");

  const mappedVirtualCapture = mapScenarioToV2(
    {
      name: "BATTERY_VIRTUAL",
      _skipped: false,
      energy: {
        production_kwh: 9152,
        consumption_kwh: 10200,
        total_pv_used_on_site_kwh: 6447,
        autoconsumption_kwh: 6447,
        direct_self_consumption_kwh: 6447,
        import_kwh: 1048,
        billable_import_kwh: 1048,
        grid_import_kwh: 1048,
        energy_grid_import_kwh: 1048,
        credited_kwh: 2705,
        used_credit_kwh: 2705,
        restored_kwh: 2705,
        site_autonomy_pct: 63.2,
        solar_coverage_pct: 63.2,
        pv_self_consumption_pct: 70.44,
      },
      prod_kwh: 9152,
      conso_kwh: 10200,
      auto_kwh: 9152,
      import_kwh: 1048,
      billable_import_kwh: 1048,
      virtual_credit_start_kwh: 1657,
      virtual_credit_end_kwh: 1657,
    },
    { pv: { kwc: 7, panelsCount: 18 } }
  );
  assert(Math.abs((mappedVirtualCapture.energy.site_autonomy_pct ?? 0) - 89.73) < 0.05, "capture BV scenarios_v2 autonomie stabilisee");
  assert(Math.abs((mappedVirtualCapture.energy.solar_coverage_pct ?? 0) - 89.73) < 0.05, "capture BV scenarios_v2 couverture stabilisee");
  assert(Math.abs((mappedVirtualCapture.energy.pv_self_consumption_pct ?? 0) - 100) < 0.05, "capture BV scenarios_v2 autoconsommation PV stabilisee");
  assert(mappedVirtualCapture.energy.energy_grid_import_kwh === 1048, "capture BV scenarios_v2 import stabilise");
  assert(mappedVirtualCapture.energy.site_solar_or_credit_used_kwh === 9152, "capture BV scenarios_v2 energie site couverte");

  console.log("OK — energyKpisNormalize\n");
}

main();
