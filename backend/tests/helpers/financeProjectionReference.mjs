/** Independent closed-form oracle for the flat-tariff regression fixtures.
 * Does not import any production financial function. No batteries with explicit
 * throughput, HP/HC, virtual storage or replacement schedules belong here.
 */
export function referenceFlatProject(ctx, scenario) {
  const e=ctx.form.economics, p=ctx.form.finance_projection;
  const cost=ctx.finance_input.capex_ttc+(scenario.name==='BATTERY_PHYSICAL'?ctx.finance_input.battery_physical_price_ttc:0);
  const rate=scenario.kwc<=9?e.oa_rate_lt_9:e.oa_rate_gte_9;
  const prime=scenario.kwc*(scenario.kwc<=9?e.prime_lt9:e.prime_gte9);
  const growth=ctx.settings.economics.elec_growth_pct/100;
  const decay=1-e.pv_degradation_pct/100;
  const price=ctx.form.params.tarif_kwh;
  const maintenance=cost*e.maintenance_pct/100;
  const values=[-cost];let cumul=-cost, payback=null, numerator=cost, denominator=0;
  for(let y=1;y<=e.horizon_years;y++) {
    const production=scenario.prod_kwh*decay**(y-1);
    const selfUsed=scenario.auto_kwh*decay**(y-1);
    const energySaving=selfUsed*price*(1+growth)**(y-1);
    const aid=prime*p.aid_payment_schedule.filter(x=>x.year===y).reduce((sum,x)=>sum+x.share_pct/100,0);
    const income=(production-selfUsed)*(y<=p.oa_contract_years?rate:p.post_contract_sale_price_eur_kwh);
    const inverter=ctx.form.pv_inverter.type==='micro'||y!==e.onduleur_year?0:cost*e.onduleur_cost_pct/100;
    const net=energySaving+income+aid-maintenance-inverter;
    values.push(net);cumul+=net;if(payback==null&&cumul>=0)payback=y;
    numerator+=(maintenance+inverter-aid)/1.03**y;
    denominator+=production/1.03**y;
  }
  let irr=null;
  const nonzero=values.filter(x=>x!==0);
  const changes=nonzero.slice(1).filter((x,i)=>Math.sign(x)!==Math.sign(nonzero[i])).length;
  if(changes===1) {
    const npv=r=>values.reduce((sum,x,i)=>sum+x/(1+r)**i,0);
    let lo=-.99,hi=2;
    for(let i=0;i<150;i++){const mid=(lo+hi)/2;if(npv(mid)>0)lo=mid;else hi=mid;}
    irr=Math.round((lo+hi)/2*10000)/100;
  }
  return {capex_ttc:cost,capex_net:cost-prime,roi_years:payback,irr_pct:irr,lcoe_eur_kwh:numerator/denominator,economie_an1:scenario.auto_kwh*price,gain_25a:cumul};
}
