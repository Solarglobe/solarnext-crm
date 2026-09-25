import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEnergyReference, validateEnergyBalance, energyTolerance } from "../services/energyReference.service.js";
import { simulateBattery8760 } from "../services/batteryService.js";
import { aggregateMonthly } from "../services/monthlyAggregator.js";
const zeros = () => Array(8760).fill(0);
const config = { enabled: true, capacity_kwh: 10, roundtrip_efficiency: 0.9, max_charge_kw: 5, max_discharge_kw: 5, depth_of_discharge_pct: 100 };

test("independent 100/120 kWh balance: useful solar is 85, captured solar is 90", () => {
  const flows = { production_kwh: 100, consumption_kwh: 120, direct_kwh: 40, battery_charge_solar_kwh: 50, battery_charge_grid_kwh: 0, battery_discharge_solar_kwh: 45, battery_discharge_grid_kwh: 0, storage_losses_kwh: 5, stock_change_kwh: 0, physical_export_kwh: 10, grid_to_load_kwh: 35, curtailment_kwh: 0 };
  assert.deepEqual(validateEnergyBalance(flows), []);
  assert.equal(flows.direct_kwh + flows.battery_discharge_solar_kwh, 85);
  assert.notDeepEqual(validateEnergyBalance({ ...flows, battery_discharge_solar_kwh: 50 }), []);
});

test("no initial gift; solar and stock close hourly, monthly, annually including month boundary", () => {
  const pv=zeros(), load=zeros();load[0]=4;pv[743]=10;load[744]=4;pv[8759]=10;
  const b=simulateBattery8760({pv_hourly:pv,conso_hourly:load,battery:config});
  assert.equal(b.batt_discharge_hourly[0],0);
  assert.equal(b.batt_discharge_hourly[744],4);
  const ref=buildEnergyReference({pv,load,battery:b,scenarioId:"BATTERY_PHYSICAL"});
  assert.ok(ref.annual.stock_change_kwh>0);
  assert.ok(Math.abs(b.annual_charge_from_surplus_kwh-b.annual_discharge_kwh-b.battery_losses_kwh-b.stock_change_kwh)<energyTolerance(20));
  assert.equal(ref.monthly[0].stock_change_kwh,b.battery_soc_hourly[743]);
  assert.ok(ref.ratios.useful_pv_utilization < ref.ratios.captured_pv_before_storage_losses);
});

test("saturation, zero powers, zero capacity and invalid efficiency do not become defaults", () => {
  const pv=Array(8760).fill(10),load=zeros();
  for(const max_charge_kw of [0,5]) {
    const b=simulateBattery8760({pv_hourly:pv,conso_hourly:load,battery:{...config,max_charge_kw}});
    assert.ok(b.battery_soc_hourly.every(s=>s>=0&&s<=10));
    assert.ok(b.batt_charge_input_hourly.every(c=>c<=max_charge_kw));
    if(max_charge_kw===0)assert.equal(b.annual_charge_from_surplus_kwh,0);
    buildEnergyReference({pv,load,battery:b,scenarioId:"BATTERY_PHYSICAL"});
  }
  assert.equal(simulateBattery8760({pv_hourly:pv,conso_hourly:load,battery:{...config,capacity_kwh:0}}).reason,"MISSING_BATTERY_CAPACITY");
  assert.equal(simulateBattery8760({pv_hourly:pv,conso_hourly:load,battery:{...config,roundtrip_efficiency:0}}).reason,"INVALID_BATTERY_EFFICIENCY");
});

test("zero PV, zero surplus, low load and explicit zero injection", () => {
  for(const [p,l,limit] of [[0,1,null],[1,2,null],[2,0.01,null],[2,0.01,0]]) {
    const ref=buildEnergyReference({pv:Array(8760).fill(p),load:Array(8760).fill(l),injectionLimitKw:limit});
    assert.deepEqual(validateEnergyBalance(ref.annual),[]);
    if(limit===0){assert.equal(ref.annual.physical_export_kwh,0);assert.ok(ref.annual.curtailment_kwh>0);}
  }
});

test("missing samples rejected; annual aggregation never sums rounded months", () => {
  const pv=Array(8760).fill(0.001234567),load=Array(8760).fill(0.002);
  const months=aggregateMonthly(pv,load);
  assert.ok(Math.abs(months.reduce((a,m)=>a+m.prod_kwh,0)-8760*pv[0])<1e-9);
  pv[52]=null;
  assert.throws(()=>buildEnergyReference({pv,load}),/manquante ou invalide/);
});
