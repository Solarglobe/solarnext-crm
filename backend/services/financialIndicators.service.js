/** Cash-flow indicators, including year zero. No inference from terminal gain. */
export function cashflowIrr(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some(v=>!Number.isFinite(v))) return { rate:null,status:"invalid" };
  const nonzero=values.filter(v=>v!==0);
  const changes=nonzero.slice(1).filter((v,i)=>Math.sign(v)!==Math.sign(nonzero[i])).length;
  if(changes!==1 || values[0]>=0) return {rate:null,status:changes>1?"non_conventional_ambiguous":"no_root"};
  const npv=r=>values.reduce((a,v,i)=>a+v/(1+r)**i,0);
  let lo=-0.9999,hi=1;
  while(npv(hi)>0 && hi<1e6) hi=hi*2+1;
  if(npv(lo)<0||npv(hi)>0)return {rate:null,status:"no_root"};
  for(let i=0;i<200;i++){const mid=(lo+hi)/2;if(npv(mid)>0)lo=mid;else hi=mid;}
  return {rate:(lo+hi)/2,status:"unique"};
}

export function compareScenarioCashflows(base, option) {
  if(base.annual_cashflows.length!==option.annual_cashflows.length)throw new Error("Horizons financiers differents");
  const investment=option.capex_ttc-base.capex_ttc;
  let cumulative=-investment;
  const flows=option.annual_cashflows.map((f,i)=>{
    if(f.year!==base.annual_cashflows[i].year)throw new Error("Annees financieres non alignees");
    const net=f.total_eur-base.annual_cashflows[i].total_eur;cumulative+=net;
    return {year:f.year,incremental_net_eur:net,cumulative_net_eur:cumulative};
  });
  return {investment_delta_eur:investment,flows,payback_year:investment>0?flows.find(f=>f.cumulative_net_eur>=0)?.year??null:null,net_gain_eur:cumulative,irr:cashflowIrr([-investment,...flows.map(f=>f.incremental_net_eur)])};
}
