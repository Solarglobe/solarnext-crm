import test from 'node:test';
import assert from 'node:assert/strict';
import { URBAN_SOLAR_VIRTUAL_BATTERY_TARIFFS_2026_08_01 as edition, resolveUrbanSolarTariffsForDate, urbanSolarTariffReferenceDate } from '../../shared/urbanSolarVirtualBatteryTariffs2026.js';
import { computeVirtualBatteryP2Finance } from '../services/virtualBatteryP2Finance.service.js';
import { resolveVirtualElectricityContract } from '../services/electricitySupplyContract.service.js';
import { resolveVirtualProviderRules } from '../services/virtualBatteryProviderRules.service.js';
import { resolveSimulationContract } from '../services/simulationContract.service.js';
import { resolveVirtualStorageOaCompatibility } from '../services/virtualStorageOaCompatibility.service.js';
import { computeFinance } from '../services/financeService.js';
import { validateStudyScenarioForExport } from '../services/studyExportValidation.service.js';
import { mapScenarioToV2 } from '../services/scenarioV2Mapper.service.js';
import { attachScenarioElectricityBilling } from '../services/scenarioElectricityBilling.service.js';

const p2=(contractType='HPHC',tariffReferenceDate='2026-08-01')=>computeVirtualBatteryP2Finance({providerCode:'URBAN_SOLAR',contractType,tariffReferenceDate,installedKwc:6,meterKva:9,vbSim:{virtual_battery_total_discharged_kwh:1500,grid_import_kwh:1000,commercial_ledger:{used_hp_kwh:1000,used_hc_kwh:500}},tariffElectricityPerKwh:.2,oaRatePerKwh:0});
const supply=(tariffReferenceDate,extra={})=>resolveVirtualElectricityContract({providerCode:'URBAN_SOLAR',contractType:'HPHC',meterKva:9,offPeakPeriods:[{start:'22:00',end:'06:00'}],tariffReferenceDate,...extra});
const context=(contract={},projection={})=>({simulation_contract:{injection_mode:'allowed',...contract},form:{finance_projection:projection},finance_input:{capex_ttc:10000,battery_physical_price_ttc:3000},settings:{economics:{price_eur_kwh:.2,elec_growth_pct:5,pv_degradation_pct:0,oa_rate_lt_9:.04,prime_lt9:80,horizon_years:25,maintenance_pct:0,onduleur_year:0,onduleur_cost_pct:0}}});
const scenario=name=>({name,_v2:true,kwc:6,prod_kwh:5000,auto_kwh:2000,surplus_kwh:3000,conso_kwh:10000,import_kwh:8000,billable_import_kwh:7000});
const exit={oa_exit_effective_date:'2026-09-01',oa_exit_document_reference:'Courrier fournisseur référence OA-123',virtual_storage_start_date:'2026-09-15'};

test('official August edition preserves published HTT/TTC and CEE already included',()=>{
  assert.deepEqual(edition.restitutionHttPerKwh,{base:.0499,hp:.0509,hc:.0361});
  assert.deepEqual(edition.restitutionTtcPerKwh,{base:.111,hp:.1122,hc:.0945});
  assert.equal(edition.restitutionTaxTreatment.ceeHtPerKwh,.012);
  assert.equal(edition.restitutionTaxTreatment.extraCeeChargeTtcPerKwh,0);
  assert.equal(edition.restitutionTaxTreatment.includesCee,true);
  assert.equal(edition.restitutionTaxTreatment.includesTicfe,true);
  assert.equal(edition.restitutionTaxTreatment.includesVat,true);
  const hp=p2().virtual_battery_finance,base=p2('BASE').virtual_battery_finance;
  assert.equal(hp.annual_virtual_discharge_cost_ttc,159.45,'1000×0.1122 + 500×0.0945; no second CEE charge');
  assert.equal(base.annual_virtual_discharge_cost_ttc,166.5,'1500×0.111');
  assert.equal(hp.annual_subscription_ttc,86.4);
  assert.equal(hp.one_time_setup_fee_ttc,299);
  assert.equal(hp.tariff_edition_id,edition.id);
  assert.equal(hp.tariff_effective_date,'2026-08-01');
  assert.equal(hp.restitution_tax_treatment.invoicePriceBasis,'PUBLISHED_TTC');
});

test('the credit rule version is independent of the dated price edition',()=>{
  const rules=resolveVirtualProviderRules({provider_code:'URBAN_SOLAR'});
  assert.equal(rules.id,'URBAN_SOLAR_2026_06_MONTHLY_HC');
  assert.equal(rules.effective_date,'2026-06-01');
  assert.equal(rules.restitutionTtcPerKwh,undefined);
  assert.equal(p2().virtual_battery_finance.tariff_edition_id,'URBAN_SOLAR_PARTICULIER_2026_08_01');
});

test('the full invoice includes restitution TTC exactly once and does not duplicate the contribution in subscription',()=>{
  const hours=kwh=>Array.from({length:8760},()=>kwh/8760);
  const vf=p2().virtual_battery_finance;
  const vb={virtual_battery_hourly_grid_import_kwh:hours(1000),virtual_battery_hourly_discharge_kwh:hours(1500),commercial_ledger:{used_hp_kwh:1000,used_hc_kwh:500,billable_hp_kwh:500,billable_hc_kwh:500}};
  const ctx={form:{params:{tariff_type:'base',elec_price_base_eur_kwh:.2,current_supplier_subscription_ttc_month:20}},site:{puissance_kva:9},virtual_battery_input:{provider_code:'URBAN_SOLAR',contract_type:'HPHC',tariff_reference_date:'2026-08-01',off_peak_periods:[{start:'22:00',end:'06:00'}]},conso:{hourly:hours(2500)},pv:{hourly:hours(0)}};
  const sc={BATTERY_VIRTUAL:{...scenario('BATTERY_VIRTUAL'),virtual_battery_finance:vf,_virtualBattery8760:vb}};
  attachScenarioElectricityBilling(sc,ctx);
  const b=sc.BATTERY_VIRTUAL.electricity_billing;
  assert.equal(b.virtual_restitution_cost_eur,159.45);
  assert.equal(b.virtual_service_cost_eur,245.85,'86.40 storage + 159.45 restitution; contribution already in supply subscription');
  assert.equal(b.scenario_supplier_subscription_eur,257.76);
  assert.equal(b.scenario_energy_purchase_eur,186.55);
  assert.equal(b.bill_after_eur,690.16);
  assert.equal(b.virtual_restitution.tax_treatment.extraCeeChargeTtcPerKwh,0);
  assert.equal(b.virtual_restitution.tariff_edition_id,edition.id);
});

test('July cannot borrow August prices; effective-date boundaries are inclusive',()=>{
  assert.equal(resolveUrbanSolarTariffsForDate('2026-07-31'),null);
  assert.equal(resolveUrbanSolarTariffsForDate('2026-08-01'),edition);
  assert.equal(p2('HPHC','2026-07-31').virtual_battery_finance,null);
  assert.equal(p2('HPHC','2026-07-31').provider_tier_status,'MISSING_PROVIDER_TARIFF_FOR_DATE');
  assert.equal(supply('2026-07-31').energy_pricing_complete,false);
  assert.equal(supply('2026-08-01').price_hp_eur_kwh,.2142);
  const fixtures=[{id:'TEST_A',effectiveDate:'2020-01-01'},{id:'TEST_B',effectiveDate:'2020-07-01'}];
  assert.equal(resolveUrbanSolarTariffsForDate('2020-06-30',fixtures).id,'TEST_A');
  assert.equal(resolveUrbanSolarTariffsForDate('2020-07-01',fixtures).id,'TEST_B');
});

test('future dated organisation supply cannot override an earlier date',()=>{
  const providerConfig={effectiveDate:'2026-08-01',electricity_supply:{price_hp_eur_kwh:.3,price_hc_eur_kwh:.1,supplier_subscription_ttc_per_year:250}};
  assert.equal(supply('2026-07-31',{providerConfig}).energy_pricing_complete,false);
  assert.equal(supply('2026-08-01',{providerConfig}).price_hp_eur_kwh,.3);
  const before= supply('2026-07-31',{providerConfig:{electricity_supply:providerConfig.electricity_supply}});
  assert.equal(before.energy_pricing_complete,false,'an undated override cannot invent historical prices');
  const futureContract={...providerConfig,effectiveDate:'2026-10-01'};
  assert.equal(supply('2026-09-15',{providerConfig:futureContract}).price_hp_eur_kwh,.2142,'the published current edition stays applicable before a future organisation override');
  assert.equal(supply('2026-10-01',{providerConfig:futureContract}).price_hp_eur_kwh,.3);
});

test('invalid dates and impossible civil dates fail explicitly',()=>{
  for(const date of ['2026-02-29','2026-99-99','01/08/2026','2026-08-01T00:00:00Z'])assert.throws(()=>urbanSolarTariffReferenceDate(date),/URBAN_TARIFF_REFERENCE_DATE_INVALID/);
  assert.equal(urbanSolarTariffReferenceDate(null,new Date('2026-07-31T22:30:00Z')),'2026-08-01');
  assert.throws(()=>resolveSimulationContract({oa_contract_status:'yes'}),/OA_CONTRACT_STATUS_INVALID/);
  assert.throws(()=>resolveSimulationContract({oa_exit_effective_date:'2026-02-29'}),/OA_EXIT_EFFECTIVE_DATE_INVALID/);
});

test('active OA blocks virtual and hybrid finance rather than merely zeroing sale and aid',async()=>{
  for(const name of ['BATTERY_VIRTUAL','BATTERY_HYBRID']) {
    const f=(await computeFinance(context({oa_contract_status:'active'}),{[name]:scenario(name)})).scenarios[name];
    assert.equal(f.display_blocked,true);assert.equal(f.flows,null);assert.equal(f.economie_an1,null);assert.equal(f.irr_pct,null);
    assert.equal(f.blocked_reason,'OA_ACTIVE_INCOMPATIBLE_WITH_VIRTUAL_STORAGE');
    assert.equal(f.finance_meta.virtual_storage_oa_compatibility.status,'BLOCKED');
    const mapped=mapScenarioToV2({...f,electricity_billing:{status:'FULL',bill_before_eur:2000,bill_after_eur:1000,bill_savings_eur:1000}},context({oa_contract_status:'active'}));
    assert.equal(mapped.finance.bill_savings_eur,null);
    assert.equal(mapped.finance.estimated_annual_bill_eur,null);
    assert.match(mapped.finance.note,/contrat OA est actif/);
    assert.equal(mapped.grid_contract.oa_contract_status,'active');
    const validation=validateStudyScenarioForExport({id:name,grid_contract:f.grid_contract,finance:{finance_meta:f.finance_meta}},name);
    assert.ok(validation.errors.some(e=>e.startsWith(f.blocked_reason)));
  }
});

test('future OA project requires an explicit change for BV but does not imply current active OA',async()=>{
  const ctx=context({}, {surplus_sale_type:'oa'});
  const result=await computeFinance(ctx,{BASE:scenario('BASE'),BATTERY_VIRTUAL:scenario('BATTERY_VIRTUAL')});
  assert.equal(result.scenarios.BASE.flows[0].gain_oa,120);
  const vb=result.scenarios.BATTERY_VIRTUAL;
  assert.equal(vb.blocked_reason,'OA_PROJECT_CONTRACT_CHANGE_REQUIRED');
  assert.equal(vb.finance_meta.virtual_storage_oa_compatibility.current_oa_status,'unconfirmed');
});

test('only a documented exit effective by virtual start permits the alternative, without OA revenue',async()=>{
  for(const oa_contract_status of ['active','terminated']) {
    const ctx=context({oa_contract_status,...exit},{surplus_sale_type:'oa',aid_eligibility:'eligible',aid_payment_schedule:[{year:1,share_pct:100}]});
    const f=(await computeFinance(ctx,{BATTERY_VIRTUAL:scenario('BATTERY_VIRTUAL')})).scenarios.BATTERY_VIRTUAL;
    assert.equal(f.finance_meta.virtual_storage_oa_compatibility.status,'OA_EXIT_DOCUMENTED');
    assert.equal(f.flows.length,25);assert.equal(f.prime_eur,0);assert.ok(f.flows.every(row=>row.gain_oa===0&&row.prime===0));
  }
  for(const changes of [{oa_exit_document_reference:''},{oa_exit_effective_date:null},{oa_exit_effective_date:'2026-09-16'}]) {
    assert.equal(resolveVirtualStorageOaCompatibility({oa_contract_status:'terminated',...exit,...changes}).status,'BLOCKED');
  }
  assert.equal(resolveVirtualStorageOaCompatibility({oa_contract_status:'terminated',...exit,oa_exit_effective_date:exit.virtual_storage_start_date}).status,'OA_EXIT_DOCUMENTED');
});

test('export rechecks active OA facts even if a caller removed stored block metadata',()=>{
  const check=validateStudyScenarioForExport({id:'BATTERY_VIRTUAL',grid_contract:{oa_contract_status:'active'},finance:{finance_meta:{}}},'BATTERY_VIRTUAL');
  assert.ok(check.errors.some(e=>e.startsWith('OA_ACTIVE_INCOMPATIBLE_WITH_VIRTUAL_STORAGE')));
  const terminated=validateStudyScenarioForExport({id:'BATTERY_VIRTUAL',grid_contract:{oa_contract_status:'terminated'},finance:{finance_meta:{}}},'BATTERY_VIRTUAL');
  assert.ok(terminated.errors.some(e=>e.startsWith('OA_EXIT_DOCUMENTATION_REQUIRED')));
});
