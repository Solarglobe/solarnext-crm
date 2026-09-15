import {test} from "node:test";
import assert from "node:assert/strict";
import {buildEnergyReference} from "../services/energyReference.service.js";
import {simulateVirtualBattery8760,aggregateVirtualBatteryMonthly} from "../services/virtualBattery8760.service.js";
import {applyVerifiedEnergyPresentation} from "../services/pdf/verifiedEnergyPresentation.js";
function fixture(power) {
 const pv=Array.from({length:8760},(_,h)=>h%24>=9&&h%24<16?power:0);
 const load=Array(8760).fill(1);
 const ref=buildEnergyReference({pv,load,scenarioId:"BATTERY_VIRTUAL"});
 const vb=simulateVirtualBattery8760({pv_hourly:pv,conso_hourly:load,config:{capacity_kwh:200,initial_credit_kwh:20}});
 ref.virtual_credit={opening_kwh:vb.virtual_battery_credit_start_kwh,closing_kwh:vb.virtual_battery_credit_end_kwh,credited_kwh:vb.virtual_battery_total_charged_kwh,used_kwh:vb.virtual_battery_total_discharged_kwh,overflow_kwh:vb.virtual_battery_overflow_export_kwh,monthly:aggregateVirtualBatteryMonthly(vb.virtual_battery_hourly_grid_import_kwh,vb.virtual_battery_hourly_charge_kwh,vb.virtual_battery_hourly_discharge_kwh,vb.virtual_battery_hourly_credit_balance_kwh)};
 const vm={meta:{},production:{},savings:{},fullReport:{p3:{energy_summary:{}},p4:{},p5:{},p6:{p6:{}},p7:{},p7_virtual_battery:{},p10:{best:{}}}};
 return {ref,vm,scenario:{virtual_battery_8760:vb}};
}
for(const power of [2,3,5]) test(`virtual charts preserve chronological withdrawals and annual totals at ${power} kW`,()=>{
 const {ref,vm,scenario}=fixture(power),before=structuredClone(ref);
 applyVerifiedEnergyPresentation(vm,ref,scenario);
 const p6=vm.fullReport.p6.p6;
 assert.equal(p6.is_virtual_credit_scenario,true);
 for(let m=0;m<12;m++) assert.ok(Math.abs(p6.dir[m]+p6.bat[m]+p6.grid[m]-p6.tot[m])<1e-7);
 assert.ok(p6.bat.some(v=>v>0));
 assert.ok(Math.abs(p6.bat.reduce((a,b)=>a+b,0)-ref.virtual_credit.used_kwh)<1e-7);
 assert.equal(p6.totals.grid_import_kwh,vm.fullReport.p7_virtual_battery.kpis.energy_grid_import_kwh);
 assert.ok(vm.fullReport.p5.credit_kw[20]>0);
 assert.equal(vm.fullReport.p5.credit_kw[12],0,'charge is not withdrawal');
 assert.ok(Math.abs(vm.fullReport.p5.credit_kw.reduce((a,b)=>a+b,0)*365-ref.virtual_credit.used_kwh)<1e-7);
 assert.deepEqual(ref,before,'presentation must preserve physical reference and financial inputs');
});
test('inconsistent credit months fail instead of inventing a curve',()=>{
 const {ref,vm,scenario}=fixture(2);ref.virtual_credit.monthly[0].used_credit+=100;
 assert.throws(()=>applyVerifiedEnergyPresentation(vm,ref,scenario),/MONTHLY_MISMATCH/);
});

import fs from "node:fs";
import vmModule from "node:vm";
test('legacy P5 renderer uses credit withdrawals and averaged direct flow',()=>{
 const sandbox={window:{},document:{querySelector:()=>null},console:{log(){}}};
 vmModule.runInNewContext(fs.readFileSync(new URL('../../frontend/public/pdf-engines/engine-p5.js',import.meta.url),'utf8'),sandbox);
 let hydrate,rows;
 sandbox.window.API.bindEngineP5({on:(_,fn)=>{hydrate=fn;}});
 sandbox.window.API_p5_drawChart=r=>{rows=r;};
 hydrate({production_kw:Array(24).fill(2),consommation_kw:Array(24).fill(2),direct_kw:Array(24).fill(0.8),batterie_kw:Array(24).fill(0),credit_kw:Array(24).fill(1.2)});
 assert.equal(rows[0].batt,1.2);assert.equal(rows[0].auto,0.8);
});
