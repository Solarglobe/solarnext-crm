import test from 'node:test';
import assert from 'node:assert/strict';
import { attachScenarioElectricityBilling, resolveVirtualSupplyPricing } from '../services/scenarioElectricityBilling.service.js';

const hours = (fn) => Array.from({ length: 8760 }, (_, h) => fn(h % 24));
const sum = values => values.reduce((a,b)=>a+b,0);
function fixture(summary = 'HP/HC (22H30-6H30) — 18 kVA — 230/400 V') {
  const load=hours(()=>10112/8760), imports=hours(h=>h===22||h===6?1:0), credit=hours(()=>0);
  const ctx={
    form:{lead:{tariff_type:'hp_hc',hp_hc:true,meter_power_kva:18,electricity_annual_bill_ttc:1955,energy_profile:{engine:{contract_summary:summary}}},conso:{annuelle_kwh:10112}},
    conso:{hourly:load},pv:{hourly:hours(()=>0)},site:{puissance_kva:18},
    virtual_battery_input:{provider_code:'URBAN_SOLAR',contract_type:'HPHC'},settings:{economics:{price_eur_kwh:0.1952}},
  };
  const vb={virtual_battery_hourly_grid_import_kwh:imports,virtual_battery_hourly_discharge_kwh:credit,grid_import_kwh:sum(imports)};
  const scenarios={BASE:{},BATTERY_VIRTUAL:{_virtualBattery8760:vb,virtual_battery_finance:{annual_total_virtual_cost_ttc:0,annual_virtual_discharge_cost_ttc:0}}};
  return {ctx,scenarios,vb};
}

test('annual bill with legacy imported HC summary completes provider billing without changing customer average',()=>{
  const {ctx,scenarios,vb}=fixture();
  const supply=resolveVirtualSupplyPricing(ctx,vb);
  assert.deepEqual(supply.contract.off_peak_periods,[{start:'22:30',end:'06:30'}]);
  // Only boundary hours carry imports: half HP and half HC in each hour.
  assert.ok(Math.abs(supply.energyCost-365*(0.2142+0.1589))<1e-8);
  attachScenarioElectricityBilling(scenarios,ctx);
  const bill=scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(bill.status,'FULL');
  assert.equal(bill.bill_before_eur,1955);
  assert.equal(bill.current_contract.source,'ANNUAL_BILL_AVERAGE');
  assert.equal(bill.current_contract.price_base_eur_kwh,(1955-373.68)/10112);
  assert.equal(bill.scenario_contract.price_hp_eur_kwh,0.2142);
  assert.equal(bill.scenario_contract.price_hc_eur_kwh,0.1589);
});

test('truly unknown HC schedule asks only for hours, not for already known supplier prices',()=>{
  const {ctx,scenarios}=fixture('HP/HC — 18 kVA — 230/400 V');
  attachScenarioElectricityBilling(scenarios,ctx);
  const bill=scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(bill.status,'INCOMPLETE');
  assert.deepEqual(bill.missing_fields,['SCENARIO_OFF_PEAK_PERIODS']);
  assert.equal(bill.bill_savings_eur,null);
});

test('known price and schedule with missing hourly imports identifies consumption data',()=>{
  const {ctx,scenarios}=fixture();
  delete scenarios.BATTERY_VIRTUAL._virtualBattery8760.virtual_battery_hourly_grid_import_kwh;
  attachScenarioElectricityBilling(scenarios,ctx);
  const bill=scenarios.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(bill.status,'INCOMPLETE');
  assert.deepEqual(bill.missing_fields,['SCENARIO_CONSUMPTION_DATA']);
});
