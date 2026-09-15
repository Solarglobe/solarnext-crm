import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSelectedScenarioSnapshotToPdfViewModel} from '../services/pdf/pdfViewModel.mapper.js';

function vm(horizon=25, extra={}) {
  let cumul=-12000;
  const flows=Array.from({length:horizon},(_,i)=>{const total=i===1?-1500:1000;cumul+=total;return {year:i+1,total_eur:total,cumul_eur:cumul,cumul_gains_eur:cumul+12000};});
  const economics={capex_ttc:12000,horizon_years:horizon,price_eur_kwh:.2,elec_growth_pct:5,oa_rate_eur_kwh:0,prime_eur:0,financing:{amount_eur:12000,duration_months:120,interest_rate_annual_pct:0,taeg_pct:1,insurance_eur:1200,application_fee_eur:100,other_costs_eur:50,...extra}};
  return mapSelectedScenarioSnapshotToPdfViewModel({scenario_type:'BASE',client:{full_name:'Test'},installation:{puissance_kwc:3},economic_snapshot:economics,
    finance:{capex_ttc:12000,economie_total:cumul,economie_horizon_years:horizon,annual_cashflows:flows,finance_meta:{economic_snapshot:economics}},energy:{production_kwh:4000,consumption_kwh:6000}});
}
for(const horizon of [20,25,30])test(`PDF conserve flux signés, horizon ${horizon} et cumul économique`,()=>{
  const mapped=vm(horizon),p11=mapped.fullReport.p11.data;
  assert.equal(p11.series.economies_annuelles.length,horizon);
  assert.equal(p11.series.economies_annuelles[1],-1500);
  assert.equal(p11.series.reste_a_charge_annuel[1],-2820);
  assert.equal(p11.financing.monthly_payment_eur,110);
  assert.equal(p11.series.paiement_annuel[0],1470);
  assert.equal(p11.financing.annual_payment_eur,1470);
  assert.equal(p11.kpi.reste_moyen_mois_eur,39);
  assert.equal(p11.financing.total_paid_eur,13350);
  assert.equal(p11.financing.credit_cost_eur,1350);
  assert.equal(p11.financing.indicative,false);
  assert.equal(p11.financing.taeg_display,'1,0 %');
  assert.match(p11.post_loan.economies_net_25_label,new RegExp(`${horizon} ans`));
  assert.equal(p11.post_loan.economies_net_25_eur,-12000+(horizon-1)*1000-1500-1350);
});
test('financement incomplet demeure explicitement indicatif et ne transforme pas absence en confirmation zéro',()=>{
  const p11=vm(25,{insurance_eur:null,other_costs_eur:null}).fullReport.p11.data;
  assert.equal(p11.financing.indicative,true);
  assert.equal(p11.financing.insurance_eur,null);
  assert.match(p11.financial_scope_note,/indicatif.*incomplets/);
});
