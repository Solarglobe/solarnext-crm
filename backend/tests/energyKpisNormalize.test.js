/**
 * KPIs normalisés — attachNormalizedEnergyKpiFields
 * Usage: node backend/tests/energyKpisNormalize.test.js
 */

import { attachNormalizedEnergyKpiFields } from "../services/energyKpisNormalize.service.js";

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
  assert(virt.energy.pv_self_consumption_pct > 60, "BV : part production valorisée sur site peut dépasser l’ancien biais « direct seul »");

  console.log("OK — energyKpisNormalize\n");
}

main();
