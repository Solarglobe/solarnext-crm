import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {computeFinance} from '../services/financeService.js';
import {mapSelectedScenarioSnapshotToPdfViewModel as mapPdf} from '../services/pdf/pdfViewModel.mapper.js';

// Reconstruct only the three pre-refactor activation lines. All formulas must
// produce the exact same result, including the entire PDF view model.
async function beforeModule(relative,revert){
 const url=new URL(relative,import.meta.url);
 let source=revert(await fs.readFile(url,'utf8'));
 source=source.replace(/(from\s*|import\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_m,lead,q,path)=>`${lead}${q}${new URL(path,url).href}${q}`);
 return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const beforeFinance=await beforeModule('../services/financeService.js',s=>s.replace('raw.enabled !== false && Number.isFinite(duration)','Number.isFinite(duration)'));
const beforePdf=await beforeModule('../services/pdf/pdfViewModel.mapper.js',s=>s.replace('      enabled: f.enabled,\n','').replace('raw.enabled !== false && duration > 0 && rateRaw != null && rate >= 0','duration > 0 && rate >= 0'));
const economics={price_eur_kwh:.2,elec_growth_pct:5,pv_degradation_pct:.5,oa_rate_lt_3:.13,oa_rate_lt_9:.04,oa_rate_gte_9:.07,prime_lt9:80,prime_gte9:180,maintenance_pct:0,onduleur_year:15,onduleur_cost_pct:12,battery_degradation_pct:2};
const credit={amount:12000,duration_months:120,interest_rate_annual:4,taeg_pct:4.4,insurance_eur:1200,application_fee_eur:100,other_costs_eur:0};
function ctx(years,financing){return {form:{finance_projection:{horizon_years:years}},settings:{economics:{...economics,horizon_years:years}},finance_input:{capex_ttc:12000,battery_physical_price_ttc:3000,economic_snapshot_config:{totals:{ttc:12000},financing}},simulation_contract:{injection_mode:'allowed'}};}
function scenarios(){return Object.fromEntries(['BASE','BATTERY_PHYSICAL','BATTERY_VIRTUAL','BATTERY_HYBRID'].map(name=>[name,{name,_v2:true,kwc:6,prod_kwh:7200,auto_kwh:3000,surplus_kwh:4200,conso_kwh:10000,import_kwh:7000}]));}
const stable=value=>JSON.parse(JSON.stringify(value, (key,v)=>key==='calculated_at'?'<same-clock>':v));
function snapshot(sc,horizon){return {scenario_type:sc.name,created_at:'2026-09-16T10:00:00Z',client:{full_name:'Qualification fictive'},site:{},installation:{puissance_kwc:6,panneaux_nombre:12},equipment:{panneau:{},onduleur:{},batterie:{}},shading:{},economic_snapshot:sc.finance_meta.economic_snapshot,energy:{production_kwh:7200,consumption_kwh:10000,autoconsumption_kwh:3000,surplus_kwh:4200,import_kwh:7000},production:{annual_kwh:7200,monthly_kwh:Array(12).fill(600)},finance:{...sc,capex_ttc:sc.capex_ttc,economie_total:sc.economie_25a,economie_horizon_years:horizon,annual_cashflows:sc.flows,finance_meta:sc.finance_meta},cashflows:sc.flows};}
for(const years of [25,30])for(const mode of ['legacy','active','empty'])test(`UI refactor preserves all four calculations and PDF data: ${years} years, ${mode}`,async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-16T10:00:00Z')});
 const f=mode==='legacy'?credit:mode==='active'?{...credit,enabled:true}:{enabled:false,amount:0,duration_months:0,interest_rate_annual:0};
 const old=await beforeFinance.computeFinance(ctx(years,f),scenarios());const next=await computeFinance(ctx(years,f),scenarios());
 assert.deepEqual(stable(next),stable(old));
 for(const id of Object.keys(next.scenarios)){
  assert.deepEqual(stable(mapPdf(snapshot(next.scenarios[id],years))),stable(beforePdf.mapSelectedScenarioSnapshotToPdfViewModel(snapshot(old.scenarios[id],years))));
 }
});
for(const years of [25,30])test(`explicit financing OFF preserves fields, ROI and energy while disabling PDF credit: ${years}`,async()=>{
 const on=await computeFinance(ctx(years,{...credit,enabled:true}),scenarios());
 const off=await computeFinance(ctx(years,{...credit,enabled:false}),scenarios());
 for(const id of Object.keys(off.scenarios)){
  const a=on.scenarios[id],b=off.scenarios[id];
  assert.deepEqual(b.flows,a.flows);assert.equal(b.roi_years,a.roi_years);assert.equal(b.irr_pct,a.irr_pct);assert.equal(b.economie_25a,a.economie_25a);
  assert.deepEqual({...b.finance_meta.economic_snapshot.financing,enabled:true},a.finance_meta.economic_snapshot.financing);
  const pdf=mapPdf(snapshot(b,years));assert.equal(pdf.fullReport.p11.data.financing.enabled,false);assert.ok(pdf.fullReport.p11.data.series.paiement_annuel.every(n=>n===0));
 }
});
test('an absent interest rate never becomes an accepted zero-rate PDF loan',()=>{
 const s=snapshot({name:'BASE',finance_meta:{economic_snapshot:{...economics,capex_ttc:12000,horizon_years:25,financing:{enabled:true,amount_eur:12000,duration_months:120,interest_rate_annual_pct:null}}},flows:[]},25);
 assert.equal(mapPdf(s).fullReport.p11.data.financing.enabled,false);
});
