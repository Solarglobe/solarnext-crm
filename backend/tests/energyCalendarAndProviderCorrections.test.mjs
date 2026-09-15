import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarFromInstants,calendarForLength,calendarParts,bindCalendar,monthlySums,parisMidnightMs} from '../services/energyCalendar.service.js';
import {powerIntervalsToHourly} from '../services/intervalEnergy.service.js';
import {priceElectricitySeries} from '../services/scenarioElectricityBilling.service.js';
import {simulateVirtualBattery8760,simulateVirtualBattery8760Rollover} from '../services/virtualBattery8760.service.js';
import {simulateAnnualScenarioEnergy} from '../services/annualScenarioEnergy.service.js';
import {buildPanHourly} from '../services/pvHourlyModel.service.js';
import {pvgisHourlyRequest,getPvgisHourlyReference} from '../services/pvgisHourly.service.js';
import {azimuthDegToPvgisAspect} from '../services/pvgisService.js';
import {buildConsumptionFromDailyPoints} from '../services/consumptionService.js';
import {buildPilotedProfile} from '../services/pilotageService.js';
import {resolveKnownVirtualOffPeakPeriods} from '../services/pv/hphcMask.service.js';
import {computeRowToRowShading} from '../shading/rowToRowShading.js';
import {attachVerifiedVirtualCapacity,assessScenarioAntiOversell,isCommercialUnboundedVirtualBatteryAllowed} from '../services/antiOversell.service.js';
const sum=a=>a.reduce((s,v)=>s+v,0),zero=()=>Array(8760).fill(0);
const hours=[{start:'22:00',end:'06:00'}];
const contract={energy_pricing_complete:true,contract_type:'HPHC',price_hp_eur_kwh:.30,price_hc_eur_kwh:.13,off_peak_periods:hours};
const config={provider_code:'URBAN_SOLAR',off_peak_periods:hours};
test('A missing supplier HC schedule is never promoted to a known contract schedule',()=>{
  assert.equal(resolveKnownVirtualOffPeakPeriods({},{}),null);
  assert.deepEqual(resolveKnownVirtualOffPeakPeriods({}, {form:{params:{off_peak_periods:hours}}}),hours);
});
function closed(ledger){
  const rows=ledger.periods??[];
  for(const p of rows)assert.ok(Math.abs(p.opening_kwh+p.credited_kwh-p.used_credit_kwh-p.expired_kwh-p.cashout_kwh-p.closing_kwh)<1e-7,JSON.stringify(p));
  assert.ok(Math.abs(ledger.opening_kwh+ledger.credited_kwh-ledger.used_hp_kwh-ledger.used_hc_kwh-ledger.expired_kwh-ledger.cashout_kwh-ledger.closing_kwh)<1e-7);
}
test('UTC instant tariffs use Paris winter/summer and both DST repeated hours',()=>{
  const instants=['2026-01-01T22:00:00Z','2026-07-01T21:00:00Z','2026-10-25T00:00:00Z','2026-10-25T01:00:00Z'];
  const c=calendarFromInstants(instants),v=bindCalendar([1,1,1,1],c);
  assert.deepEqual(calendarParts(c).map(p=>p.hour),[23,23,2,2]);
  assert.equal(priceElectricitySeries(v,contract),.52);
});
test('Leap UTC year conserves all 8784 kWh; commercial month is Paris',()=>{
  const start=Date.UTC(2024,0,1),end=Date.UTC(2025,0,1);
  const rows=Array.from({length:8785},(_,i)=>({ts:start+i*3600000,w:1000}));
  const r=powerIntervalsToHourly(rows,{startMs:start,endMs:end});
  assert.equal(r.hourly.length,8784);assert.equal(sum(r.hourly),8784);
  assert.equal(calendarParts(r.calendar).filter(p=>p.month===1&&p.day===29).length,24);
  const c=calendarFromInstants(['2026-01-31T23:00:00Z']);assert.equal(monthlySums(bindCalendar([2],c))[1],2);
});
test('Missing power is an explicit gap and does not erase the preceding valid interval',()=>{
  const t=Date.UTC(2026,0,1),rows=[{ts:t,w:1000},{ts:t+3600000,w:null},{ts:t+7200000,w:2000},{ts:t+10800000,w:0}];
  const r=powerIntervalsToHourly(rows,{startMs:t,endMs:t+10800000,allowMissing:true});
  assert.deepEqual(r.hourly,[1,undefined,2]);assert.equal(r.observed_energy_kwh,3);assert.equal(r.coverage_hours,2);
  const half=powerIntervalsToHourly([{ts:t,w:1000},{ts:t+1800000,w:2000},{ts:t+3600000,w:0}],{startMs:t,endMs:t+3600000});
  assert.equal(half.hourly[0],1.5);
});
test('Daily R65 preserves 23/25-hour civil days and February 29',()=>{
  const points=Array.from({length:366},(_,i)=>({date:new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10),kwh:24}));
  const r=buildConsumptionFromDailyPoints(points);
  assert.equal(r.hourly.length,8784);assert.ok(Math.abs(r.annual_kwh-366*24)<1e-7);
  const p=calendarParts(r.calendar);
  for(const [month,day,n] of [[2,31,23],[9,27,25],[1,29,24]]){
    const ids=p.map((x,i)=>x.month===month&&x.day===day?i:-1).filter(i=>i>=0);
    assert.equal(ids.length,n);assert.ok(Math.abs(sum(ids.map(i=>r.hourly[i]))-24)<1e-8);
  }
  assert.equal(parisMidnightMs('2026-07-02'),Date.parse('2026-07-01T22:00:00Z'));
});
test('Urban settles the month HC first, including production later in that month',()=>{
  const p=zero(),l=zero();l[0]=8;l[18]=10;p[100]=10;
  const r=simulateVirtualBattery8760({pv_hourly:p,conso_hourly:l,config});
  assert.equal(r.commercial_ledger.used_hc_kwh,8);assert.equal(r.commercial_ledger.used_hp_kwh,2);
  assert.equal(r.virtual_battery_credit_start_kwh,0);assert.equal(r.grid_import_kwh,8);closed(r.commercial_ledger);
  const legacy=simulateVirtualBattery8760({pv_hourly:p,conso_hourly:l,config:{capacity_kwh:20}});
  assert.equal(legacy.virtual_battery_total_discharged_kwh,0);
});
test('Year one opens at zero and remains distinct from stabilized year',()=>{
  const p=zero(),l=zero();l[0]=10;p[8750]=10;
  const r=simulateVirtualBattery8760Rollover({pv_hourly:p,conso_hourly:l,config,years:3});
  assert.equal(r.year1.virtual_battery_credit_start_kwh,0);assert.equal(r.year1.grid_import_kwh,10);
  assert.equal(r.stabilized.virtual_battery_credit_start_kwh,10);assert.equal(r.stabilized.grid_import_kwh,0);
});
test('Urban unlimited report, explicit cashout and expiry have closed period ledgers',()=>{
  const p=zero(),l=zero();p[0]=20;
  const unlimited=simulateVirtualBattery8760({pv_hourly:p,conso_hourly:l,config:{...config,capacity_kwh:1}});
  assert.equal(unlimited.virtual_battery_credit_end_kwh,20);closed(unlimited.commercial_ledger);
  const cashout=simulateVirtualBattery8760({pv_hourly:p,conso_hourly:l,config:{...config,anniversary_cashout_requested:true,anniversary_base_energy_price_eur_kwh:.2}});
  assert.equal(cashout.commercial_ledger.cashout_eur,1);assert.equal(cashout.commercial_ledger.expired_kwh,0);closed(cashout.commercial_ledger);
  const exp=simulateVirtualBattery8760({pv_hourly:p,conso_hourly:l,config:{...config,contract_rules_override:{source:'test-contract',credit_validity_months:2}}});
  assert.equal(exp.commercial_ledger.expired_kwh,20);assert.equal(exp.commercial_ledger.periods[2].opening_kwh,20);closed(exp.commercial_ledger);
  const reset=simulateVirtualBattery8760({pv_hourly:p,conso_hourly:l,config:{...config,contract_rules_override:{source:'test-contract',annual_reset:true}}});closed(reset.commercial_ledger);
});
test('Published Urban unlimited capacity is contractual, not an invented capacity estimate',()=>{
  const sim=simulateVirtualBattery8760({pv_hourly:zero(),conso_hourly:zero(),config});
  const sc={name:'BATTERY_VIRTUAL',_virtualBattery8760:sim,_virtualBatteryP2:{capacity_auto_from_unbounded:true},finance_warnings:['VB_CAPACITY_AUTO_UNBOUNDED','OTHER_WARNING']};
  assert.equal(attachVerifiedVirtualCapacity(sc),true);
  assert.deepEqual(sc.finance_warnings,['OTHER_WARNING']);assert.equal(sc.provider_capacity_contract.unlimited,true);
  const ctx={virtual_battery_input:config,_vb_commercial_enforce_no_unbounded:true};
  assert.equal(isCommercialUnboundedVirtualBatteryAllowed(ctx),true);
  assert.ok(!assessScenarioAntiOversell(ctx,sc).anti_oversell_flags.includes('VB_CAPACITY_AUTO_UNBOUNDED'));
  assert.equal(isCommercialUnboundedVirtualBatteryAllowed({virtual_battery_input:{provider_code:'OTHER'},_vb_commercial_enforce_no_unbounded:true}),false);
});
test('Finite-validity credit lots retain age across annual projection boundaries',()=>{
  const p=zero(),l=zero();p[8750]=10;
  const input={scenario_id:'BATTERY_VIRTUAL',pv_hourly:p,conso_hourly:l,current_contract:contract,scenario_contract:contract,virtual_battery_input:{...config,contract_rules_override:{source:'test-contract',credit_validity_months:2}},restitution:{rate_hp_ttc:.1,rate_hc_ttc:.08}};
  const y1=simulateAnnualScenarioEnergy(input);assert.equal(y1.virtual_credit_end_kwh,10);
  const y2=simulateAnnualScenarioEnergy(input,{year:2,pv_factor:0,initial_credit_kwh:y1.virtual_credit_end_kwh,initial_credit_lots:y1.virtual_credit_end_lots});
  assert.equal(y2.virtual_credit_expired_kwh,10);assert.equal(y2.commercial_ledger.periods[1].expired_kwh,10);closed(y2.commercial_ledger);
});
test('Physical aging changes useful capacity; replacement restores original dispatch',()=>{
  const p=zero(),l=zero();p[12]=10;l[20]=10;
  const input={scenario_id:'BATTERY_PHYSICAL',pv_hourly:p,conso_hourly:l,current_contract:contract,battery:{enabled:true,capacity_kwh:10,usable_kwh:10,depth_of_discharge_pct:100,roundtrip_efficiency:1,max_charge_kw:10,max_discharge_kw:10}};
  const fresh=simulateAnnualScenarioEnergy(input),aged=simulateAnnualScenarioEnergy(input,{battery_factor:.5}),replaced=simulateAnnualScenarioEnergy(input,{year:11,battery_factor:1});
  assert.equal(fresh.auto_kwh,10);assert.equal(aged.auto_kwh,5);assert.equal(replaced.auto_kwh,10);
  for(let y=0;y<25;y++)assert.ok(simulateAnnualScenarioEnergy({...input,battery:{...input.battery,capacity_kwh:7}},{battery_factor:.98**y}).auto_kwh>=0);
});
test('Aging applies before inverter clipping each year',()=>{
  const raw=zero(),pv=zero(),load=zero();raw[12]=2;pv[12]=1;load[12]=3;
  const input={scenario_id:'BASE',pv_hourly:pv,pv_unclipped_hourly:raw,inverter_nominal_kw_total:1,conso_hourly:load,current_contract:contract};
  assert.equal(simulateAnnualScenarioEnergy(input).prod_kwh,1);
  assert.equal(simulateAnnualScenarioEnergy(input,{year:2,pv_factor:.5}).prod_kwh,1);
});
test('East and west have different production time and reconcile monthly AC totals without double shading',()=>{
  const base={monthly_kwh:Array(12).fill(500),latitude:43.6,longitude:6.9,tilt:40};
  const east=buildPanHourly({...base,azimuth:90}),west=buildPanHourly({...base,azimuth:270});
  const weightedHour=a=>sum(a.map((v,i)=>v*(i%24)))/sum(a);
  assert.ok(weightedHour(west)>weightedHour(east)+2);
  for(const total of monthlySums(east))assert.ok(Math.abs(total-500)<1e-8);
  const shade=buildPanHourly({...base,azimuth:90,shading_hourly:Array(8760).fill(.1)});
  assert.ok(Math.abs(sum(shade)-5400)<1e-7);
  assert.equal(azimuthDegToPvgisAspect(90),-90);assert.equal(pvgisHourlyRequest({...base,azimuth:270}).parameters.aspect,90);
});
test('PVGIS unavailable fallback is explicit, reproducible and performs no offline call',async()=>{
  const r=await getPvgisHourlyReference({latitude:48.123456,longitude:2.987654,azimuth:73.123,tilt:37.456},{offline:true,fetchImpl:()=>{throw new Error('Unexpected network');}});
  assert.equal(r.source,'NOAA_ISOTROPIC_ESTIMATE');assert.equal(r.warning,'PVGIS_HOURLY_REFERENCE_UNAVAILABLE');assert.equal(r.key.length,64);
});
test('Pilotage accepts actual leap calendar and conserves energy',()=>{
  const c=calendarForLength(8784),l=bindCalendar(Array(8784).fill(1),c),p=bindCalendar(Array.from({length:8784},(_,i)=>(i%24>=10&&i%24<16)?3:0),c);
  const r=buildPilotedProfile(l,p);assert.equal(r.conso_pilotee_hourly.length,8784);assert.ok(Math.abs(sum(r.conso_pilotee_hourly)-8784)<1e-6);
});
test('Row shading uses the full actual calendar including leap day',()=>{
  const r=computeRowToRowShading({tiltDeg:35,azimuthDeg:180,pitchM:2,panelHeightM:2,latitudeDeg:48,longitudeDeg:2,calendar:calendarForLength(8784)});
  assert.equal(r.shadingFactor8760.length,8784);assert.ok(r.shadingFactor8760.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});
