import {buildPanHourly} from './pvHourlyModel.service.js';
import {getCalendar,calendarForLength} from './energyCalendar.service.js';
/** Deterministic, orientation-aware hourly curve reconciled to monthly AC yield. */
export function buildHourlyPV(arg1,ctx={}) {
  const months=Array.isArray(arg1)?arg1:arg1?.monthly_kwh??arg1?.monthly_ac_kwh;
  if(!Array.isArray(months)||months.length!==12)throw new Error('buildHourlyPV: 12 mois en kWh AC requis');
  const pan=ctx.form?.roof?.pans?.[0]??{};
  const orientation={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315}[String(ctx.site?.orientation??'S').toUpperCase()]??180;
  return buildPanHourly({monthly_kwh:months,latitude:Number(ctx.site?.lat??48.8566),longitude:Number(ctx.site?.lon??2.3522),azimuth:Number(pan.azimuth??orientation),tilt:Number(pan.tilt??ctx.site?.inclinaison??30),calendar:ctx.conso?.calendar??(ctx.conso?.hourly?getCalendar(ctx.conso.hourly):calendarForLength()),pvgis_hourly:ctx.pvgis_hourly_reference?.hourly??null});
}
