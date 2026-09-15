/** Calendar shared by meters, solar, storage and tariffs. Imported instants are never
 * converted into a fictitious 365-day year. Legacy estimated shapes retain an explicit
 * civil model calendar until replaced by timestamped measurements. */
const bindings = new WeakMap();
const cache = new WeakMap();
const paris = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const HOUR_MS=3600000;
export function parisParts(instant) {
  const p=Object.fromEntries(paris.formatToParts(new Date(instant)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  return {year:p.year,month:p.month-1,day:p.day,hour:p.hour,minute:p.minute};
}
export function calendarForLength(length=8760) {
  return {version:1,kind:'civil_model_year',timezone:'Europe/Paris',year:length===8784?2024:2025,length,step_hours:1};
}
export function calendarFromInstants(instants,stepHours=1) {
  const times=instants.map(x=>new Date(x).toISOString());
  if(times.some((x,i)=>i&&Date.parse(x)<=Date.parse(times[i-1]))) throw new Error('Calendrier : instants non croissants');
  return {version:1,kind:'utc_instants',timezone:'Europe/Paris',instants:times,length:times.length,step_hours:stepHours};
}
export function bindCalendar(values,calendar) {
  if(Array.isArray(values)&&calendar) {
    if((calendar.length??calendar.instants?.length)!==values.length) throw new Error('Calendrier et énergie : nombres d’intervalles différents');
    bindings.set(values,calendar);
  }
  return values;
}
export function getCalendar(values,explicit=null) {return explicit??bindings.get(values)??calendarForLength(values?.length??8760);}
export function copyEnergy(values,calendar=null) {return bindCalendar(values.slice(),getCalendar(values,calendar));}
export function isEnergyYear(values) {return Array.isArray(values)&&(values.length===8760||values.length===8784||bindings.has(values));}
export function calendarParts(calendar) {
  if(cache.has(calendar))return cache.get(calendar);
  const parts=calendar.kind==='utc_instants'
    ? calendar.instants.map(t=>parisParts(t))
    : Array.from({length:calendar.length},(_,i)=>{
      const d=new Date(Date.UTC(calendar.year??2025,0,1)+i*HOUR_MS);
      return {year:d.getUTCFullYear(),month:d.getUTCMonth(),day:d.getUTCDate(),hour:d.getUTCHours(),minute:0};
    });
  cache.set(calendar,parts);return parts;
}
export function monthlySums(values,calendar=null) {
  const parts=calendarParts(getCalendar(values,calendar)),out=Array(12).fill(0);
  values.forEach((v,i)=>{out[parts[i].month]+=Number(v)||0;});return out;
}
export function calendarInstantMs(calendar,index) {
  if(calendar.kind==='utc_instants')return Date.parse(calendar.instants[index]);
  const p=calendarParts(calendar)[index];
  const nominal=Date.UTC(p.year,p.month,p.day,p.hour,p.minute);
  // Civil estimated profiles have no measured DST instants. Resolve local time
  // deterministically; missing/repeated hours remain labelled estimated.
  let utc=nominal;
  for(let i=0;i<2;i++) {
    const local=parisParts(utc);
    utc+=nominal-Date.UTC(local.year,local.month,local.day,local.hour,local.minute);
  }
  return utc;
}
export function billingPeriods(values,calendar=null) {
  const parts=calendarParts(getCalendar(values,calendar)),groups=[];
  parts.forEach((p,i)=>{
    const key=`${p.year}-${String(p.month+1).padStart(2,'0')}`;
    if(groups.at(-1)?.key!==key)groups.push({key,month:p.month,indices:[]});
    groups.at(-1).indices.push(i);
  });return groups;
}
/** Map an estimated civil shape by local month/day/hour, preserving its energy. */
export function alignCivilShape(values,targetCalendar,{preserveTotal=true}={}) {
  const srcCal=calendarForLength(values.length),src=calendarParts(srcCal),lookup=new Map(src.map((p,i)=>[`${p.month}/${p.day}/${p.hour}`,values[i]]));
  const out=calendarParts(targetCalendar).map(p=>lookup.get(`${p.month}/${p.day}/${p.hour}`)??lookup.get(`${p.month}/${Math.min(p.day,28)}/${p.hour}`)??0);
  const a=values.reduce((s,v)=>s+v,0),b=out.reduce((s,v)=>s+v,0);
  return bindCalendar(preserveTotal&&b>0?out.map(v=>v*a/b):out,targetCalendar);
}

export function parisMidnightMs(date) {
  const nominal=Date.parse(`${date.slice(0,10)}T00:00:00Z`);let utc=nominal;
  for(let i=0;i<3;i++){const p=parisParts(utc);utc+=nominal-Date.UTC(p.year,p.month,p.day,p.hour,p.minute);}
  return utc;
}
