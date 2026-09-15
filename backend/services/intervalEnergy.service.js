import {HOUR_MS,calendarFromInstants,bindCalendar} from './energyCalendar.service.js';
/** Integrate average power over actual UTC instants. The final row is an interval
 * boundary; importers label any inferred final interval explicitly. */
export function powerIntervalsToHourly(rows,{unit='W',maxIntervalHours=1,startMs=null,endMs=null,allowMissing=false}={}) {
  if(!['W','kW'].includes(unit))throw new Error('Unite de puissance requise : W ou kW');
  const unique=[];
  for(const r of [...rows].sort((a,b)=>a.ts-b.ts)) {
    if(!Number.isFinite(r.ts)||(!(allowMissing&&r.w==null)&&(!Number.isFinite(r.w)||r.w<0)))throw new Error('Mesure de puissance invalide');
    if(unique.at(-1)?.ts===r.ts){if(unique.at(-1).w!==r.w)throw new Error('Doublon contradictoire de consommation');continue;}
    unique.push(r);
  }
  if(!unique.length)return {hourly:[],observed_energy_kwh:0,coverage_hours:0,calendar:null};
  const y=new Date(unique[0].ts).getUTCFullYear();
  const start=startMs??Date.UTC(y,0,1),end=endMs??Date.UTC(y+1,0,1);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Periode de mesure invalide');
  const length=Math.ceil((end-start)/HOUR_MS);
  const energy=Array(length).fill(0),coverage=Array(length).fill(0);
  for(let i=0;i<unique.length-1;i++) {
    if(unique[i].w==null)continue;
    if((unique[i+1].ts-unique[i].ts)/HOUR_MS>maxIntervalHours+1e-9)continue;
    let cursor=Math.max(start,unique[i].ts),stopAt=Math.min(end,unique[i+1].ts);
    while(cursor<stopAt) {
      const idx=Math.floor((cursor-start)/HOUR_MS),stop=Math.min(stopAt,start+(idx+1)*HOUR_MS);
      const hours=(stop-cursor)/HOUR_MS;
      energy[idx]+=unique[i].w*(unit==='W'?0.001:1)*hours;coverage[idx]+=hours;
      if(coverage[idx]>1+1e-9)throw new Error('Periodes superposees dans le profil importe');
      cursor=stop;
    }
  }
  const calendar=calendarFromInstants(Array.from({length},(_,i)=>start+i*HOUR_MS));
  return {hourly:bindCalendar(energy.map((e,i)=>Math.abs(coverage[i]-1)<1e-9?e:undefined),calendar),calendar,
    hourly_observed_energy_kwh:energy,hourly_coverage_hours:coverage,
    observed_energy_kwh:energy.reduce((a,b)=>a+b,0),coverage_hours:coverage.reduce((a,b)=>a+b,0),
    omitted_leap_day_kwh:0,timezone:'Europe/Paris',interval_convention:'average_power_forward_until_next_timestamp',
    source_interval_count:Math.max(0,unique.length-1),period_start:new Date(start).toISOString(),period_end:new Date(end).toISOString()};
}
