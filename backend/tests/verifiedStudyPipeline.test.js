import assert from "node:assert/strict";
import {test} from "node:test";
import {powerIntervalsToHourly} from "../services/intervalEnergy.service.js";
import {buildEnergyReference} from "../services/energyReference.service.js";
import {cashflowIrr,compareScenarioCashflows} from "../services/financialIndicators.service.js";
import {buildCashflows} from "../services/financeService.js";
import {validateStudyScenarioForExport, assertStudySnapshotExportable} from "../services/studyExportValidation.service.js";
import {applyVerifiedEnergyPresentation} from "../services/pdf/verifiedEnergyPresentation.js";

test("half-hour average W and kW sum energy; DST offsets represent distinct real intervals",()=>{
  const rows=["2025-10-26T02:00:00+02:00","2025-10-26T02:30:00+02:00","2025-10-26T02:00:00+01:00","2025-10-26T02:30:00+01:00","2025-10-26T03:00:00+01:00"].map(d=>({ts:Date.parse(d),w:1000}));
  const a=powerIntervalsToHourly(rows);assert.equal(a.observed_energy_kwh,2);assert.equal(a.coverage_hours,2);
  assert.equal(powerIntervalsToHourly(rows.map(r=>({...r,w:1})),{unit:"kW"}).observed_energy_kwh,2);
  assert.equal(powerIntervalsToHourly([...rows,rows[0]]).observed_energy_kwh,2);
  assert.throws(()=>powerIntervalsToHourly([...rows,{...rows[0],w:900}]),/Doublon/);
  const spring=["2025-03-30T01:00:00+01:00","2025-03-30T03:00:00+02:00"].map(d=>({ts:Date.parse(d),w:1000}));
  assert.equal(powerIntervalsToHourly(spring).observed_energy_kwh,1);
  assert.equal(powerIntervalsToHourly([{ts:0,w:1000},{ts:4*3600000,w:1000}]).coverage_hours,0);
});

test("financial series preserve battery losses; zero indexation, surplus and prices remain zero",()=>{
  const p={prod_y1:100,auto_y1:85,surplus_y1:10,price_y1:1,oa_rate:0,elec_growth_pct:0,pv_degradation_pct:0,horizon_years:25,prime_eur:0,maintenance_pct:0,inverter_replacement_year:null,inverter_cost_pct:0,capex_ttc:1000,battery_contribution_y1:45,battery_degradation_pct:0};
  const f=buildCashflows(p);assert.equal(f.length,25);assert.ok(f.every(r=>r.gain_auto===85&&r.gain_oa===0));assert.equal(f[24].cumul_eur,1125);
  const sold=buildCashflows({...p,oa_rate:0.2});assert.ok(sold.every(r=>r.gain_oa===2));
  const indexed=buildCashflows({...p,elec_growth_pct:5});assert.ok(Math.abs(indexed[1].gain_auto-89.25)<1e-10);
  const replaced=buildCashflows({...p,inverter_replacement_year:12,inverter_cost_pct:10});assert.equal(replaced[11].inverter_cost,100);assert.equal(replaced[24].cumul_eur,1025);
  assert.equal(buildCashflows({...p,price_auto_y1:0})[0].gain_auto,0);
});

test("IRR uses full flows; no-payback and non-conventional series are explicit",()=>{
  assert.ok(Math.abs(cashflowIrr([-100,110]).rate-0.1)<1e-12);
  assert.equal(cashflowIrr([-100,230,-132]).status,"non_conventional_ambiguous");
  const base={capex_ttc:100,annual_cashflows:[{year:1,total_eur:10},{year:2,total_eur:10}]};
  const option={capex_ttc:120,annual_cashflows:[{year:1,total_eur:12},{year:2,total_eur:12}]};
  const d=compareScenarioCashflows(base,option);assert.equal(d.investment_delta_eur,20);assert.equal(d.net_gain_eur,-16);assert.equal(d.payback_year,null);
});

function exampleScenario(id="BASE"){
  const reference=buildEnergyReference({pv:Array(8760).fill(1),load:Array(8760).fill(2),scenarioId:id});
  return {id,energy:{reference},finance:{capex_ttc:100,annual_cashflows:[{year:1,total_eur:110,cumul_eur:10}],economie_total:10,irr_pct:10}};
}

test('export balances chronological virtual periods, expiration, cashout and signed finance',()=>{
 const s=exampleScenario('BATTERY_VIRTUAL');
 s.energy.reference.virtual_credit={opening_kwh:0,credited_kwh:20,used_kwh:15,expired_kwh:2,cashout_kwh:3,closing_kwh:0,
  periods:[
   {opening_kwh:0,credited_kwh:20,used_credit_kwh:15,expired_kwh:0,cashout_kwh:0,closing_kwh:5},
   {opening_kwh:5,credited_kwh:0,used_credit_kwh:0,expired_kwh:2,cashout_kwh:3,closing_kwh:0},
  ]};
 s.finance.annual_cashflows[0]={year:1,gain_auto:100,gain_oa:0,prime:0,maintenance:0,inverter_cost:0,virtual_cashout_eur:10,total_eur:110,cumul_eur:10};
 assert.equal(validateStudyScenarioForExport(s,s.id).ok,true);
 const broken=structuredClone(s);broken.energy.reference.virtual_credit.periods[1].opening_kwh=3;
 assert.ok(validateStudyScenarioForExport(broken,s.id).errors.includes('VIRTUAL_PERIOD_BALANCE_INVALID'));
 const wrongAnnual=structuredClone(s);wrongAnnual.energy.reference.virtual_credit.credited_kwh+=1;wrongAnnual.energy.reference.virtual_credit.used_kwh+=1;
 assert.ok(validateStudyScenarioForExport(wrongAnnual,s.id).errors.includes('VIRTUAL_PERIOD_SUM_MISMATCH: used_kwh'));
 const missingAnnual=structuredClone(s);delete missingAnnual.energy.reference.virtual_credit.used_kwh;
 assert.ok(validateStudyScenarioForExport(missingAnnual,s.id).errors.includes('VIRTUAL_CREDIT_COMPONENT_INVALID'));
 const wrongFinance=structuredClone(s);wrongFinance.finance.annual_cashflows[0].virtual_cashout_eur=11;
 assert.ok(validateStudyScenarioForExport(wrongFinance,s.id).errors.some(e=>e.startsWith('FINANCIAL_COMPONENT_SUM_MISMATCH')));
});

for (const id of ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL", "BATTERY_HYBRID"]) {
 test(`indicative financing permits ${id} PDF exports without weakening calculation checks`, () => {
  const scenario = exampleScenario(id);
  if (id === "BATTERY_VIRTUAL" || id === "BATTERY_HYBRID") {
   scenario.energy.reference.virtual_credit = { opening_kwh: 0, credited_kwh: 20, used_kwh: 15, closing_kwh: 5 };
  }
  scenario.finance.finance_meta = { economic_snapshot: { blocking_warnings: ["FINANCING_INDICATIVE_ONLY_MISSING_TAEG_INSURANCE_OR_FEES"] } };
  const before = structuredClone(scenario);
  for (const snapshot of [
   { scenario_type: id, scenario_result: scenario },
   { scenario_type: id, scenarios_v2: [scenario] },
   { scenario_type: id, data_json: { scenarios_v2: [scenario] } },
   { ...scenario, scenario_type: id },
  ]) {
   const result = assertStudySnapshotExportable(snapshot);
   assert.equal(result.ok, true);
   assert.ok(result.warnings.some(w => w.includes("Financement indicatif")));
  }
  assert.deepEqual(scenario, before, "Frozen results must not be rewritten");
  scenario.finance.finance_meta.economic_snapshot.blocking_warnings.push("ECONOMIC_ASSUMPTION_NOT_TRACEABLE:price_eur_kwh");
  assert.throws(() => assertStudySnapshotExportable({ scenario_type: id, scenario_result: scenario }), /ECONOMIC_ASSUMPTION_NOT_TRACEABLE/);
  scenario.finance.finance_meta.economic_snapshot.blocking_warnings.pop();
  scenario.finance.annual_cashflows[0].total_eur += 100;
  assert.equal(validateStudyScenarioForExport(scenario, id).ok, false);
 });
}
test("export blocks wrong scenario, corrupted energy or finance; warnings remain non-blocking",()=>{
  const s=exampleScenario();assert.equal(validateStudyScenarioForExport(s,"BASE").ok,true);
  assert.equal(validateStudyScenarioForExport(s,"BATTERY_PHYSICAL").ok,false);
  const broken=structuredClone(s);broken.energy.reference.annual.direct_kwh+=1;assert.equal(validateStudyScenarioForExport(broken,"BASE").ok,false);
  broken.energy=s.energy;broken.finance.annual_cashflows[0].total_eur=120;assert.equal(validateStudyScenarioForExport(broken,"BASE").ok,false);
  const v=exampleScenario("BATTERY_VIRTUAL");v.energy.reference.virtual_credit={opening_kwh:0,credited_kwh:20,used_kwh:15,closing_kwh:5};v.grid_contract={virtual_credit_eligibility:false};assert.ok(validateStudyScenarioForExport(v,v.id).errors.some(x=>x.startsWith("VIRTUAL_CREDIT_INELIGIBLE")));
  v.grid_contract.virtual_credit_eligibility=true;assert.equal(validateStudyScenarioForExport(v,v.id).ok,true);
});

test("successive/concurrent presentation maps keep scenario identity and source values isolated",async()=>{
  const map=(id,pv)=>{
    const ref=buildEnergyReference({pv:Array(8760).fill(pv),load:Array(8760).fill(2),scenarioId:id});
    const vm={meta:{},production:{},savings:{},fullReport:{p3:{energy_summary:{}},p4:{},p5:{},p6:{p6:{}},p7:{},p10:{best:{}}}};
    return applyVerifiedEnergyPresentation(vm,ref);
  };
  const [a,b]=await Promise.all([Promise.resolve().then(()=>map("BASE",1)),Promise.resolve().then(()=>map("BATTERY_VIRTUAL",0.5))]);
  assert.notEqual(a.meta.results_hash,b.meta.results_hash);
  for(const vm of [a,b]){assert.equal(vm.fullReport.p3.energy_summary.production_kwh,vm.fullReport.p4.production_annuelle);assert.equal(vm.fullReport.p7.production_kwh,vm.fullReport.p4.production_annuelle);}
  assert.equal(a.fullReport.p4.production_annuelle,8760);assert.equal(b.fullReport.p4.production_annuelle,4380);
});

import {parseR65Json,parseDailyCsv,parseMonthlyCsv} from '../services/energy/solteoImportService.js';
import {simulateBattery8760} from '../services/batteryService.js';
import {simulateVirtualBattery8760} from '../services/virtualBattery8760.service.js';
import {repairScenarioV2DisplayKpis} from '../services/scenarioV2DisplayRepair.service.js';
import {mapSelectedScenarioSnapshotToPdfViewModel} from '../services/pdf/pdfViewModel.mapper.js';

test('imports require declared units, preserve large kWh values and reject conflicting duplicates',()=>{
 assert.throws(()=>parseDailyCsv('date,value\n2025-01-01,1800'),/unité/);
 assert.equal(parseDailyCsv('date,value\n2025-01-01,1800',{unit:'Wh'}).points[0].kwh,1.8);
 assert.equal(parseMonthlyCsv('date,kwh\n2025-01,250000').months.get('2025-01'),250000);
 assert.throws(()=>parseMonthlyCsv('date,kwh\n2025-01,2\n2025-01,3'),/doublon/);
 assert.throws(()=>parseR65Json({grandeur:[{unite:'W',points:[{d:'2025-01-01',v:10}]}]}),/unité/);
 assert.throws(()=>parseR65Json({grandeur:[{unite:'Wh',points:[{d:'2025-01-01',v:10},{d:'2025-01-01',v:20}]}]}),/doublon/);
});

test('battery replacements are explicit cash expenses, with exclusion and zero cost preserved',()=>{
 const p={prod_y1:100,auto_y1:85,surplus_y1:10,price_y1:1,oa_rate:0,elec_growth_pct:0,pv_degradation_pct:0,horizon_years:25,prime_eur:0,maintenance_pct:0,inverter_replacement_year:null,inverter_cost_pct:0,capex_ttc:1000,battery_degradation_pct:0};
 const base=buildCashflows(p),withCost=buildCashflows({...p,battery_replacements:[{year:12,cost_eur:300}]});
 assert.equal(withCost[11].battery_cost,300);assert.equal(base[24].cumul_eur-withCost[24].cumul_eur,300);
 assert.deepEqual(buildCashflows({...p,battery_replacements:[{year:12,cost_eur:0}]}),base);
 assert.throws(()=>buildCashflows({...p,battery_replacements:[{year:12}]}),/cout/);
});

test('four power/storage variants, sale/free surplus, and physical/virtual/hybrid chronological ledgers',()=>{
 const load=Array.from({length:8760},(_,h)=>h%24>=18?2:0.8);
 for(const power of [6,8])for(const physical of [false,true])for(const virtual of [false,true])for(const sale of [0,0.1]){
  const pv=Array.from({length:8760},(_,h)=>power*Math.max(0,Math.sin((h%24-6)/12*Math.PI))*0.25);
  const battery=physical?simulateBattery8760({pv_hourly:pv,conso_hourly:load,battery:{enabled:true,capacity_kwh:7,roundtrip_efficiency:0.9,max_charge_kw:3.75,max_discharge_kw:5,depth_of_discharge_pct:100}}):null;
  if(battery)assert.equal(battery.ok,true);
  const id=physical?(virtual?'BATTERY_HYBRID':'BATTERY_PHYSICAL'):(virtual?'BATTERY_VIRTUAL':'BASE');
  const ref=buildEnergyReference({pv,load,battery,scenarioId:id});
  const a=ref.annual;
  let credit=null;
  if(virtual){
   const remainingPv=battery?battery.surplus_hourly:pv.map((v,h)=>Math.max(0,v-load[h]));
   const remainingLoad=battery?load.map((v,h)=>v-battery.direct_self_consumption_hourly[h]-battery.batt_discharge_hourly[h]):load.map((v,h)=>Math.max(0,v-pv[h]));
   credit=simulateVirtualBattery8760({pv_hourly:remainingPv,conso_hourly:remainingLoad,config:{capacity_kwh:100}});
   assert.equal(credit.ok,true);
   const charged=credit.virtual_battery_total_charged_kwh,used=credit.virtual_battery_total_discharged_kwh;
   assert.ok(Math.abs(charged-used-credit.virtual_battery_credit_end_kwh)<1e-7);
   assert.ok(used<=a.grid_to_load_kwh+1e-7);
  }
  const f=buildCashflows({prod_y1:a.production_kwh,auto_y1:a.direct_kwh+a.battery_discharge_solar_kwh,surplus_y1:a.physical_export_kwh,price_y1:0.2,oa_rate:sale,elec_growth_pct:0,pv_degradation_pct:0,horizon_years:25,prime_eur:0,maintenance_pct:0,inverter_replacement_year:null,inverter_cost_pct:0,capex_ttc:10000,battery_contribution_y1:a.battery_discharge_solar_kwh,battery_degradation_pct:0});
  assert.ok(Math.abs(f[0].gain_auto-(a.direct_kwh+a.battery_discharge_solar_kwh)*0.2)<1e-8);
  assert.equal(f[0].gain_oa,a.physical_export_kwh*sale);
 }
});

test('verified snapshots bypass inferred display repairs and reject a different scenario at export',()=>{
 const scenario=exampleScenario('BATTERY_VIRTUAL');
 assert.equal(repairScenarioV2DisplayKpis([scenario])[0],scenario);
 assert.throws(()=>mapSelectedScenarioSnapshotToPdfViewModel({scenario_type:'BATTERY_VIRTUAL',scenario_result:scenario},{selected_scenario_id:'BASE'}),/PDF_SCENARIO_MISMATCH/);
 const bad=structuredClone(exampleScenario());bad.energy.reference.ratios.useful_pv_utilization=0.4;
 assert.ok(validateStudyScenarioForExport(bad,'BASE').errors.some(e=>e.includes('RATIO_MISMATCH')));
});

import {putEphemeralSnapshot,getEphemeralSnapshot} from '../services/pdfEphemeralSnapshot.service.js';
test('concurrent export tokens isolate snapshots from later selection and render mutations',async()=>{
 const a={scenario_type:'BASE',energy:{value:1}},b={scenario_type:'BATTERY_PHYSICAL',energy:{value:2}};
 const [ka,kb]=await Promise.all([Promise.resolve().then(()=>putEphemeralSnapshot(a,a.scenario_type)),Promise.resolve().then(()=>putEphemeralSnapshot(b,b.scenario_type))]);
 a.energy.value=999;b.scenario_type='BASE';
 assert.notEqual(ka,kb);assert.equal(getEphemeralSnapshot(ka).snapshot.energy.value,1);
 const returned=getEphemeralSnapshot(kb);returned.snapshot.energy.value=99;
 assert.equal(getEphemeralSnapshot(kb).snapshot.energy.value,2);assert.equal(getEphemeralSnapshot(kb).scenarioId,'BATTERY_PHYSICAL');
 assert.equal(getEphemeralSnapshot('unknown'),null);
});
