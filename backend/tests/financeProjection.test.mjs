import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashflows, computeFinance, applyElectricityBillingToCashflows } from '../services/financeService.js';
import { resolveFinanceProjection, batteryAgeAtYear } from '../services/financeProjection.service.js';
import { resolveOaTariffForKwc } from '../services/economicsResolve.service.js';
import { simulateAnnualScenarioEnergy } from '../services/annualScenarioEnergy.service.js';

const economics = { price_eur_kwh:.2,elec_growth_pct:5,pv_degradation_pct:0,oa_rate_lt_3:.13,oa_rate_lt_9:.04,oa_rate_gte_9:.07,prime_lt9:80,prime_gte9:180,horizon_years:25,maintenance_pct:0,onduleur_year:0,onduleur_cost_pct:0,battery_degradation_pct:2 };
function context(projection = {}, overrides = {}) {
  return { form:{finance_projection:projection},settings:{economics},finance_input:{capex_ttc:10000,battery_physical_price_ttc:3000},simulation_contract:{injection_mode:'allowed'},...overrides };
}
function scenario(name='BASE', overrides={}) {
  return {name,_v2:true,kwc:6,prod_kwh:5000,auto_kwh:2000,surplus_kwh:3000,conso_kwh:10000,import_kwh:8000,...overrides};
}
async function calculate(projection={}, overrides={}) {
  return (await computeFinance(context(projection),{BASE:scenario('BASE',overrides)})).scenarios.BASE;
}
function flow(year, credit=1000) { return {year,auto_kwh:2000,virtual_credit_used_kwh:credit,gain_auto:400,import_savings_eur:200,gain_oa:0,prime:0,maintenance:0,inverter_cost:0,battery_cost:0}; }
function billed(name='BATTERY_VIRTUAL') {
  return {name,electricity_billing:{status:'FULL',current_energy_bill_eur:2000,current_supplier_subscription_eur:300,scenario_energy_purchase_eur:1400,scenario_consumption_energy_eur:2000,scenario_effective_auto_price:.2,scenario_effective_credit_price:.2,scenario_supplier_subscription_eur:300,virtual_service_cost_eur:220,virtual_service_fixed_cost_eur:120,virtual_restitution_cost_eur:100,virtual_restitution_price_eur_kwh:.1},virtual_battery_finance:{annual_total_virtual_cost_ttc:220,annual_virtual_discharge_cost_ttc:100}};
}

test('defaults are explicit zero indexation and unconfirmed rights; legacy expenses are provisions',()=>{
  const p=resolveFinanceProjection({form:{economics:{battery_replacements:[{year:12,cost_eur:3000}]}}});
  assert.equal(p.supplier_subscription_growth_pct,0);assert.equal(p.virtual_restitution_growth_pct,0);
  assert.equal(p.battery_replacements[0].kind,'provision');
  assert.ok(p.warnings.includes('BATTERY_LEGACY_EXPENSE_TREATED_AS_PROVISION'));
  assert.equal(p.post_contract_sale_price_eur_kwh,0);assert.equal(p.aid_eligibility,'unconfirmed');
});
test('same subscription indexation before and after cannot fabricate an energy saving',()=>{
  const sc=billed('BASE');sc.electricity_billing.virtual_service_cost_eur=0;
  const rows=applyElectricityBillingToCashflows([flow(1,0),flow(2,0)],sc,{elec_growth_pct:0},{supplier_subscription_growth_pct:10});
  assert.equal(rows[1].current_supplier_subscription_eur,330);assert.equal(rows[1].supplier_subscription_eur,330);
  assert.equal(rows[1].supplier_subscription_gain_eur,0);assert.equal(rows[1].electricity_bill_savings_eur,400);
});
test('more expensive supplier subscription remains a growing expense on both sides',()=>{
  const sc=billed();sc.electricity_billing.scenario_supplier_subscription_eur=360;
  const rows=applyElectricityBillingToCashflows([flow(1),flow(2)],sc,{elec_growth_pct:0},{supplier_subscription_growth_pct:10});
  assert.equal(rows[1].supplier_subscription_gain_eur,-66.00000000000006);
});
test('variable restitution follows annual kWh; independent rates do not inflate fixed fees',()=>{
  const rows=applyElectricityBillingToCashflows([flow(1),flow(2,800)],billed(),{elec_growth_pct:0},{virtual_subscription_growth_pct:5,virtual_restitution_growth_pct:10});
  assert.equal(rows[0].virtual_service_cost_eur,220);
  assert.equal(rows[1].virtual_fixed_service_cost_eur,126);
  assert.equal(rows[1].virtual_restitution_cost_eur,88);
  assert.equal(rows[1].virtual_service_cost_eur,214);
});
test('hourly annual reprojection prices actual imports and HP/HC restitution, including zero year-one credit',()=>{
  const sc=billed();sc.electricity_billing.virtual_service_cost_eur=120;
  const rows=applyElectricityBillingToCashflows([flow(1,0),{...flow(2,800),scenario_energy_purchase_at_initial_rates:1234,virtual_restitution_cost_at_initial_rates:60}],sc,{elec_growth_pct:5},{virtual_restitution_growth_pct:10});
  assert.equal(rows[1].bill_with_project_energy_eur,1234*1.05);assert.equal(rows[1].virtual_restitution_cost_eur,66);
});
test('OA stops at its configured end; post-contract zero default and explicit alternative price',async()=>{
  const a=await calculate({surplus_sale_type:'oa',oa_contract_years:20});
  assert.equal(a.flows[19].gain_oa,120);assert.equal(a.flows[20].gain_oa,0);assert.equal(a.flows[24].gain_oa,0);
  const b=await calculate({surplus_sale_type:'oa',oa_contract_years:12,post_contract_sale_price_eur_kwh:.01});
  assert.equal(b.flows[11].gain_oa,120);assert.equal(b.flows[12].gain_oa,30);
});
test('no unconfirmed sale or prime is manufactured from organisation defaults',async()=>{
  const a=await calculate();assert.ok(a.flows.every(f=>f.gain_oa===0&&f.prime===0));
  assert.equal(a.finance_meta.projection_assumptions.surplus_sale.status,'NO_CONFIRMED_SALE');
});
test('common inclusive 3 and 9 kWc resolver is consumed by finance',async()=>{
  for(const [kwc,rate] of [[2.5,.13],[3,.13],[3.01,.04],[9,.04],[9.01,.07]]) {
    const a=await calculate({surplus_sale_type:'oa'},{kwc});
    assert.equal(a.flows[0].gain_oa,3000*rate);
    assert.equal(a.finance_meta.economic_snapshot.oa_rate_eur_kwh,rate);
  }
  const c={settings:{economics:{oa_rate_lt_9:0}}};const r=resolveOaTariffForKwc(c,3);
  assert.equal(r.rate_eur_kwh,0);assert.equal(r.key,'oa_rate_lt_9');assert.equal(r.uses_broader_configured_tier,true);
  assert.equal(resolveOaTariffForKwc({},3).rate_eur_kwh,0);
  assert.equal(resolveOaTariffForKwc({settings:{economics:{oa_rate_lt_3:.1305},economics_raw:null}},3).rate_eur_kwh,0,'merged technical defaults never substitute for an explicitly absent raw tariff');
});
test('aid requires an eligible OA contract, permitted injection and an explicit real schedule',async()=>{
  const p={surplus_sale_type:'oa',aid_eligibility:'eligible',aid_payment_schedule:[{year:1,share_pct:80},{year:2,share_pct:5},{year:3,share_pct:5},{year:4,share_pct:5},{year:5,share_pct:5}]};
  const a=await calculate(p);assert.deepEqual(a.flows.slice(0,6).map(f=>f.prime),[384,24,24,24,24,0]);assert.equal(a.prime_eur,480);
  assert.equal(a.capex_net,9520);assert.equal(a.flows[0].cumul_eur,-10000+a.flows[0].total_eur);
  for(const mode of ['none','unconfirmed']) {
    const b=(await computeFinance(context(p,{simulation_contract:{injection_mode:mode}}),{BASE:scenario()})).scenarios.BASE;
    assert.equal(b.prime_eur,0);assert.ok(b.flows.every(f=>f.prime===0));
  }
  const v=(await computeFinance(context(p),{BASE:scenario(),BATTERY_VIRTUAL:scenario('BATTERY_VIRTUAL',{billable_import_kwh:7000})})).scenarios.BATTERY_VIRTUAL;
  assert.equal(v.prime_eur,null);
  assert.equal(v.flows,null);
  assert.equal(v.blocked_reason,'OA_PROJECT_CONTRACT_CHANGE_REQUIRED');
  const unknownSchedule=await calculate({...p,aid_payment_schedule:[]});assert.equal(unknownSchedule.prime_eur,0);
  const noRate=(await computeFinance(context(p,{settings:{economics,economics_raw:null}}),{BASE:scenario()})).scenarios.BASE;
  assert.equal(noRate.prime_eur,0,'confirming eligibility cannot invent a missing aid rate');
});
test('battery replacement restores its age and output; provision only debits money',()=>{
  const p={prod_y1:10000,auto_y1:8000,surplus_y1:1500,price_y1:.2,oa_rate:0,elec_growth_pct:0,pv_degradation_pct:0,horizon_years:25,prime_eur:0,maintenance_pct:0,inverter_replacement_year:null,inverter_cost_pct:0,capex_ttc:10000,battery_contribution_y1:4000,battery_degradation_pct:2};
  const old=buildCashflows(p),replacement=buildCashflows({...p,battery_replacements:[{year:12,cost_eur:3000,kind:'replacement'}]}),provision=buildCashflows({...p,battery_replacements:[{year:12,cost_eur:3000,kind:'provision'}]});
  assert.equal(replacement[11].auto_kwh,8000);assert.equal(replacement[12].auto_kwh,7920);
  assert.equal(replacement[11].battery_age_years,0);assert.equal(replacement[11].battery_cost,3000);
  assert.equal(provision[11].auto_kwh,old[11].auto_kwh);assert.equal(provision[11].battery_provision_eur,3000);
  assert.equal(batteryAgeAtYear(15,[{year:12,kind:'replacement'}]),3);
});
test('explicit maintenance and inverter expenses occur in the requested years and may create signed losses',async()=>{
  const a=await calculate({maintenance_pct:0,inverter_replacements:[{year:3,cost_eur:2500}]});
  assert.ok(a.flows.every(f=>f.maintenance===0));assert.equal(a.flows[2].inverter_cost,2500);assert.ok(a.flows[2].total_eur<0);
  const b=await calculate({maintenance_pct:1,inverter_replacements:[]});assert.ok(b.flows.every(f=>f.maintenance===100&&f.inverter_cost===0));
});
test('20, 25 and 30-year project horizons use their matching final flow and preserve metadata',async()=>{
  for(const n of [20,25,30]) {const a=await calculate({horizon_years:n});assert.equal(a.flows.length,n);assert.equal(a.economie_25a,a.flows[n-1].cumul_eur);assert.equal(a.finance_meta.projection_assumptions.horizon_years,n);}
});
test('invalid payment schedules or negative costs cannot silently become zero assumptions',()=>{
  assert.throws(()=>resolveFinanceProjection({form:{finance_projection:{aid_payment_schedule:[{year:1,share_pct:80}]}}}),/100/);
  assert.throws(()=>resolveFinanceProjection({form:{finance_projection:{battery_replacements:[{year:12,cost_eur:-1}]}}}),/invalide/);
});
test('aid paid later has the same nominal amount but a higher discounted project energy cost',async()=>{
  const p={surplus_sale_type:'oa',aid_eligibility:'eligible'};
  const early=await calculate({...p,aid_payment_schedule:[{year:1,share_pct:100}]});
  const late=await calculate({...p,aid_payment_schedule:[{year:5,share_pct:100}]});
  assert.equal(early.prime_eur,late.prime_eur);
  assert.ok(late.lcoe_eur_kwh>early.lcoe_eur_kwh);
  assert.equal(late.flows[0].prime,0);assert.equal(late.flows[4].prime,480);
});
test('zero-rate financing and explicit zero ancillary costs remain known in the frozen snapshot',async()=>{
  const c=context({}, {finance_input:{capex_ttc:10000,economic_snapshot_config:{financing:{amount:10000,duration_months:120,interest_rate_annual:0,taeg_pct:0,insurance_eur:0,application_fee_eur:0,other_costs_eur:0}}}});
  const a=(await computeFinance(c,{BASE:scenario()})).scenarios.BASE;
  const f=a.finance_meta.economic_snapshot.financing;
  assert.equal(f.enabled,true);assert.equal(f.interest_rate_annual_pct,0);assert.equal(f.other_costs_eur,0);
  assert.ok(!a.finance_warnings.some(w=>w.startsWith('FINANCING_INDICATIVE')));
});
test('full hourly projection ages battery capacity and a real replacement restores the simulated output',async()=>{
  const contract={contract_type:'BASE',price_base_eur_kwh:.2,energy_pricing_complete:true};
  const input={scenario_id:'BATTERY_PHYSICAL',pv_hourly:Array.from({length:8760},(_,i)=>i%24>=10&&i%24<15?4:0),conso_hourly:Array(8760).fill(1),battery:{capacity_kwh:6,max_charge_kw:6,max_discharge_kw:6,roundtrip_efficiency:1,depth_of_discharge_pct:100},current_contract:contract,scenario_contract:contract};
  const initial=simulateAnnualScenarioEnergy(input);
  const sc=scenario('BATTERY_PHYSICAL',{prod_kwh:initial.prod_kwh,auto_kwh:initial.auto_kwh,surplus_kwh:initial.surplus_kwh,conso_kwh:8760,import_kwh:initial.billable_import_kwh,battery:{annual_discharge_kwh:initial.physical_discharge_kwh},_energyProjectionInput:input});
  sc.electricity_billing={status:'FULL',current_energy_bill_eur:8760*.2,current_supplier_subscription_eur:300,scenario_energy_purchase_eur:initial.scenario_energy_purchase_at_initial_rates,scenario_consumption_energy_eur:8760*.2,scenario_effective_auto_price:.2,scenario_effective_credit_price:0,scenario_supplier_subscription_eur:300,virtual_service_cost_eur:0};
  const c=context({horizon_years:3,battery_replacements:[{year:3,cost_eur:1000,kind:'replacement'}]});c.settings.economics={...economics,battery_degradation_pct:50};
  const result=(await computeFinance(c,{BATTERY_PHYSICAL:sc})).scenarios.BATTERY_PHYSICAL;
  assert.ok(result.flows[1].auto_kwh<result.flows[0].auto_kwh);
  assert.equal(result.flows[2].auto_kwh,result.flows[0].auto_kwh);
  assert.equal(result.flows[2].battery_cost,1000);assert.equal(result.flows[2].battery_age_years,0);
  assert.equal(result.finance_meta.projection_method,'annual_hourly_resimulation');
  assert.equal(result._energyProjectionInput,undefined);
});
test('virtual credits and cashout are never sold again as physical overflow',async()=>{
  const ctx=context({surplus_sale_type:'market'});
  const base=scenario();
  const virtual=scenario('BATTERY_VIRTUAL',{billable_import_kwh:7000,surplus_kwh:3000});
  const out=(await computeFinance(ctx,{BASE:base,BATTERY_VIRTUAL:virtual})).scenarios.BATTERY_VIRTUAL;
  assert.equal(out.flows[0].gain_oa,0,'ambiguous physical surplus is not confirmed overflow');
  const explicit=(await computeFinance(ctx,{BASE:base,BATTERY_VIRTUAL:{...virtual,energy:{virtual_battery_overflow_export_kwh:100}}})).scenarios.BATTERY_VIRTUAL;
  assert.equal(explicit.flows[0].gain_oa,4,'only 100 kWh explicitly outside the credit account are sold');
  const f=applyElectricityBillingToCashflows([{...flow(1),virtual_cashout_eur:25}],billed(),{elec_growth_pct:0});
  assert.equal(f[0].gain_oa,0);assert.equal(f[0].total_eur,f[0].electricity_bill_savings_eur+25);
});
test('Urban 299 EUR setup remains once in year one outside the investment with a full bill ledger',async()=>{
  const virtual={...scenario('BATTERY_VIRTUAL',{billable_import_kwh:7000}),...billed(),virtualSetupFee:299};
  virtual.virtual_battery_finance={...virtual.virtual_battery_finance,one_time_setup_fee_ttc:299};
  const out=(await computeFinance(context(),{BASE:scenario(),BATTERY_VIRTUAL:virtual})).scenarios.BATTERY_VIRTUAL;
  assert.equal(out.capex_ttc,10000);
  assert.equal(out.flows[0].initial_virtual_service_fees_eur,299);
  assert.ok(out.flows.slice(1).every(f=>f.initial_virtual_service_fees_eur===0));
  assert.equal(out.flows[0].total_eur,out.flows[0].electricity_bill_savings_eur-299);
});
test('an unspecified inverter cost stays zero instead of manufacturing a replacement expense',async()=>{
  const c=context({}, {settings:{economics:{elec_growth_pct:5}},form:{pv_inverter:{inverter_type:'string'}}});
  const out=(await computeFinance(c,{BASE:scenario()})).scenarios.BASE;
  assert.ok(out.flows.every(f=>f.inverter_cost===0));
});

test('annual virtual projection carries the age of credit lots and expires them exactly once',async()=>{
  const contract={contract_type:'BASE',price_base_eur_kwh:.2,energy_pricing_complete:true};
  const input={scenario_id:'BATTERY_VIRTUAL',pv_hourly:[10,...Array(8759).fill(0)],conso_hourly:Array(8760).fill(0),current_contract:contract,scenario_contract:contract,
    virtual_battery_input:{provider_code:'URBAN_SOLAR',off_peak_periods:[{start:'22:00',end:'06:00'}],contract_rules_override:{source:'explicit-test-contract',credit_validity_months:12}}};
  const c=context({horizon_years:3});
  const sc=scenario('BATTERY_VIRTUAL',{prod_kwh:10,auto_kwh:0,surplus_kwh:10,conso_kwh:0,import_kwh:0,billable_import_kwh:0,_energyProjectionInput:input});
  const out=(await computeFinance(c,{BATTERY_VIRTUAL:sc})).scenarios.BATTERY_VIRTUAL;
  assert.deepEqual(out.flows.map(f=>f.virtual_credit_end_kwh),[10,10,10]);
  assert.deepEqual(out.flows.map(f=>f.projection_energy.virtual_credit_expired_kwh),[0,10,10]);
  assert.equal(out.flows[1].virtual_credit_opening_kwh,10);
  assert.equal(out.flows[2].projection_energy.virtual_credit_end_lots.length,1);
});
