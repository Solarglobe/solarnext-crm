import test from 'node:test';
import assert from 'node:assert/strict';
import {computeInstallationCostFromCatalog} from '../domains/installers/installers.pricing.js';
import {enrichInstallerCostWithVat,computeProjectEconomicTotalsFromConfig} from '../services/projectEconomicTotals.service.js';
import {assertElectricalPhaseDecision} from '../services/calculationFingerprint.service.js';
import {computeFinance} from '../services/financeService.js';

// Deterministic local catalogue fixture: same published TRI rule as the audited
// installer catalogue. No database, lead mutation or commercial default change.
const catalog={
 installer:{id:'installer-fixture',name:'Installateur de contrôle'},
 tariff_version:{id:'tariff-fixture',status:'ACTIVE'},
 grids:[{id:'roof',code:'ROOF',label:'Toiture'}],
 installation_type_mappings:[{installation_type:'ROOF_SUPERIMPOSED',pricing_grid_id:'roof'}],
 tariff_rows:[{pricing_grid_id:'roof',power_wc:6000,amount_ht_cents:200000}],
 electrical_rules:[
  {electrical_type:'MONO',rule_type:'NONE',amount_ht_cents:0},
  {electrical_type:'TRI',rule_type:'FIXED_SURCHARGE',amount_ht_cents:25000},
 ],options:[],
};
const ids=['BASE','BATTERY_PHYSICAL','BATTERY_VIRTUAL','BATTERY_HYBRID'];
const scenarios=Object.fromEntries(ids.map(id=>[id,{
 id,name:id,_v2:true,kwc:6,prod_kwh:7000,auto_kwh:3500,surplus_kwh:3500,conso_kwh:9000,import_kwh:5500,
 energy:{production_kwh:7000,consumption_kwh:9000,autoconsumption_kwh:3500,surplus_kwh:3500,import_kwh:5500},
}]));

async function quoteToFinance(phase){
 const quote=computeInstallationCostFromCatalog(catalog,{
  requested_power_wc:6000,installation_type:'ROOF_SUPERIMPOSED',electrical_type:phase,
 });
 const saved={
  totals:{ht:8333.33,tva:1666.67,ttc:10000},
  installer_cost:enrichInstallerCostWithVat(quote,20),
  electrical_phase_decision:{detected_phase:'MONO',retained_phase:phase,difference_confirmed:true},
 };
 assertElectricalPhaseDecision(saved,'MONO');
 const totals=computeProjectEconomicTotalsFromConfig(saved);
 // Same project total and separate battery price passed by buildSolarNextPayload.
 const finance=await computeFinance({
  finance_input:{capex_ttc:totals.project.ttc,battery_physical_price_ttc:3480,economic_snapshot_config:saved},
  form:{params:{tarif_kwh:.24},economics:{price_eur_kwh:.24,elec_growth_pct:0,pv_degradation_pct:0,battery_degradation_pct:0,oa_rate_lt_9:0,oa_rate_gte_9:0,prime_lt9:0,prime_gte9:0,horizon_years:25,maintenance_pct:0,onduleur_year:12,onduleur_cost_pct:0},finance_projection:{surplus_sale_type:'none',aid_eligibility:'ineligible',battery_replacements:[],inverter_replacements:[]}},
  settings:{economics:{elec_growth_pct:0}},
 },structuredClone(scenarios));
 return {quote,saved,totals,finance};
}

test('TRI confirmé : +250 € HT au devis, +300 € TTC projet et CAPEX des quatre scénarios, une seule fois',async()=>{
 const before=structuredClone(catalog);
 const mono=await quoteToFinance('MONO'),tri=await quoteToFinance('TRI');
 assert.equal(tri.quote.electrical_adjustments[0].amount_ht_cents,25000);
 assert.equal(tri.quote.final_total_ht_cents-mono.quote.final_total_ht_cents,25000);
 assert.equal(tri.saved.installer_cost.final_total_vat_cents-mono.saved.installer_cost.final_total_vat_cents,5000);
 assert.equal(tri.saved.installer_cost.final_total_ttc_cents-mono.saved.installer_cost.final_total_ttc_cents,30000);
 assert.deepEqual(mono.totals.project,{ht:10333.33,vat:2066.67,ttc:12400});
 assert.deepEqual(tri.totals.project,{ht:10583.33,vat:2116.67,ttc:12700});
 for(const id of ids){
  const m=mono.finance.scenarios[id],t=tri.finance.scenarios[id];
  const battery=id==='BATTERY_PHYSICAL'||id==='BATTERY_HYBRID'?3480:0;
  assert.equal(m.capex_ttc,12400+battery,id);
  assert.equal(t.capex_ttc,12700+battery,id);
  assert.equal(t.capex_ttc-m.capex_ttc,300,id);
  assert.equal(t.flows.length,25,id);
  assert.ok(t.flows.every(f=>Math.abs(f.total_eur-840)<1e-9),`${id}: constant operating savings at zero growth`);
  assert.deepEqual(t.flows.map(f=>f.total_eur),m.flows.map(f=>f.total_eur),`${id}: phase pricing alone does not alter energy savings`);
  assert.equal(t.flows[0].cumul_eur-m.flows[0].cumul_eur,-300,id);
  assert.equal(t.flows.at(-1).cumul_eur-m.flows.at(-1).cumul_eur,-300,id);
 }
 assert.deepEqual(catalog,before,'the catalogue is not mutated');
});

test('une phase TRI divergent du compteur exige la confirmation avant cette chaîne',()=>{
 assert.throws(()=>assertElectricalPhaseDecision({installer_cost:{electrical_type:'TRI'},electrical_phase_decision:{detected_phase:'MONO',retained_phase:'TRI',difference_confirmed:false}},'MONO'),{code:'ELECTRICAL_PHASE_CONFIRMATION_REQUIRED'});
});
