import {computeSunPosition} from './shading/solarPosition.js';
import {calendarForLength,calendarParts,calendarInstantMs,bindCalendar} from './energyCalendar.service.js';
const DEG=Math.PI/180;
/** NOAA solar geometry + isotropic diffuse irradiance. Used only as an explicit
 * estimated fallback when the reproducible PVGIS hourly reference is unavailable.
 * The monthly PVGIS yield already includes losses: normalization adds none. */
export function buildPanHourly({monthly_kwh,latitude,longitude,azimuth=180,tilt=30,calendar=calendarForLength(),pvgis_hourly=null,shading_hourly=null}) {
  const parts=calendarParts(calendar),length=parts.length;
  const template=pvgis_hourly?new Map(pvgis_hourly.map(p=>{
    const d=new Date(p.timestamp);return [`${d.getUTCMonth()}/${d.getUTCDate()}/${d.getUTCHours()}`,p.power_w];
  })):null;
  const raw=parts.map((p,i)=>{
    const instant=calendarInstantMs(calendar,i),d=new Date(instant);
    if(template) {
      return Math.max(0,template.get(`${d.getUTCMonth()}/${d.getUTCDate()}/${d.getUTCHours()}`)??template.get(`${d.getUTCMonth()}/${Math.min(d.getUTCDate(),28)}/${d.getUTCHours()}`)??0);
    }
    // Integrate quarter-hour midpoint irradiance to avoid point-sample bias.
    let value=0;
    for(let q=0;q<4;q++) {
      const sun=computeSunPosition(instant+(q+.5)*900000,latitude,longitude);
      if(!sun||sun.elevationDeg<=0)continue;
      const el=sun.elevationDeg*DEG,beta=tilt*DEG;
      const incidence=Math.sin(el)*Math.cos(beta)+Math.cos(el)*Math.sin(beta)*Math.cos((sun.azimuthDeg-azimuth)*DEG);
      const airMass=1/(Math.sin(el)+0.50572*Math.pow(sun.elevationDeg+6.07995,-1.6364));
      const direct=Math.pow(.7,Math.pow(airMass,.678));
      const diffuse=.12*Math.sin(el);
      value+=(direct*Math.max(0,incidence)+diffuse*(1+Math.cos(beta))/2)/4;
    }
    return value;
  });
  const totals=Array(12).fill(0);raw.forEach((v,i)=>totals[parts[i].month]+=v);
  const hourly=raw.map((v,i)=>{
    const m=parts[i].month;
    if(totals[m]<=0&&Number(monthly_kwh[m])>0)throw new Error(`PV_HOURLY_NO_IRRADIANCE_MONTH_${m+1}`);
    return totals[m]>0?v*Number(monthly_kwh[m]??0)/totals[m]:0;
  });
  // Hourly shading is applied instead of a scalar shade loss, never both.
  if(shading_hourly){if(shading_hourly.length!==length)throw new Error('PV_SHADING_CALENDAR_MISMATCH');hourly.forEach((v,i)=>{const loss=Number(shading_hourly[i]);if(!Number.isFinite(loss)||loss<0||loss>1)throw new Error('PV_SHADING_INVALID');hourly[i]=v*(1-loss);});}
  return bindCalendar(hourly,calendar);
}
