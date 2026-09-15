import {isEnergyYear,getCalendar,calendarParts} from './energyCalendar.service.js';
/** Sum physical or commercial energy on the same local calendar as consumption. */
export function aggregateMonthly(prodHourly,consoHourly,battSummary=null) {
  if(!isEnergyYear(prodHourly)||!isEnergyYear(consoHourly)||prodHourly.length!==consoHourly.length)throw new Error('aggregateMonthly: profils annuels et calendriers incompatibles (8760h / 8784h).');
  const months=Array.from({length:12},()=>({prod_kwh:0,conso_kwh:0,auto_kwh:0,surplus_kwh:0,import_kwh:0,batt_kwh:0}));
  const parts=calendarParts(getCalendar(consoHourly));
  for(let i=0;i<prodHourly.length;i++) {
    const pv=prodHourly[i],load=consoHourly[i],m=months[parts[i].month];
    const auto=battSummary?.auto_hourly?.[i]??Math.min(pv,load);
    const surplus=battSummary?.surplus_hourly?.[i]??Math.max(0,pv-load);
    m.prod_kwh+=pv;m.conso_kwh+=load;m.auto_kwh+=auto;m.surplus_kwh+=surplus;
    m.import_kwh+=Math.max(0,load-auto);m.batt_kwh+=battSummary?.batt_discharge_hourly?.[i]??0;
  }
  return months.map(m=>({...m,auto_pct:m.prod_kwh>0?Math.round(m.auto_kwh/m.prod_kwh*100):0}));
}
