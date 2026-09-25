/** Timestamped average power to an explicit 365-day UTC model year.
 * Missing intervals remain missing, never silently stretch a power sample over a gap.
 */
export function powerIntervalsToHourly(rows, { unit = "W", maxIntervalHours = 1 } = {}) {
  if(!["W","kW"].includes(unit))throw new Error("Unite de puissance requise : W ou kW");
  const sorted=[...rows].sort((a,b)=>a.ts-b.ts);
  const unique=[];
  for(const r of sorted){
    if(!Number.isFinite(r.ts)||!Number.isFinite(r.w)||r.w<0)throw new Error("Mesure de puissance invalide");
    if(unique.at(-1)?.ts===r.ts){if(unique.at(-1).w!==r.w)throw new Error("Doublon contradictoire de consommation");continue;}
    unique.push(r);
  }
  const energy=Array(8760).fill(0),coverage=Array(8760).fill(0);
  let omittedLeapKwh=0;
  for(let i=0;i<unique.length-1;i++){
    const start=unique[i].ts,end=unique[i+1].ts;
    if((end-start)/3600000>maxIntervalHours+1e-9)continue;
    let cursor=start;
    while(cursor<end){
      const stop=Math.min(end,(Math.floor(cursor/3600000)+1)*3600000);
      const hours=(stop-cursor)/3600000,kwh=unique[i].w*(unit==="W"?0.001:1)*hours;
      const d=new Date(cursor);
      if(d.getUTCMonth()===1&&d.getUTCDate()===29)omittedLeapKwh+=kwh;
      else {
        const idx=(Date.UTC(2001,d.getUTCMonth(),d.getUTCDate(),d.getUTCHours())-Date.UTC(2001,0,1))/3600000;
        energy[idx]+=kwh;coverage[idx]+=hours;
        if(coverage[idx]>1+1e-9)throw new Error("Periodes annuelles superposees dans le profil importe");
      }
      cursor=stop;
    }
  }
  return { hourly:energy.map((e,i)=>Math.abs(coverage[i]-1)<1e-9?e:undefined), observed_energy_kwh:energy.reduce((a,b)=>a+b,0), coverage_hours:coverage.reduce((a,b)=>a+b,0), omitted_leap_day_kwh:omittedLeapKwh, timezone:"UTC", calendar:"365_day_model_year", interval_convention:"average_power_forward_until_next_timestamp" };
}
