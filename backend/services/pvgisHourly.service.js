import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import fetch from 'node-fetch';
const cacheDir=fileURLToPath(new URL('../weather/cache/pvgis-hourly/',import.meta.url));
const pending=new Map();
export function pvgisHourlyRequest({latitude,longitude,azimuth,tilt,reference_year=2020}) {
  const aspect=((Number(azimuth)-180+540)%360)-180;
  const parameters={lat:latitude,lon:longitude,angle:tilt,aspect,peakpower:1,loss:0,mountingplace:'building',raddatabase:'PVGIS-ERA5',pvcalculation:1,startyear:reference_year,endyear:reference_year,outputformat:'json'};
  return {model:'PVGIS-5.3-seriescalc',parameters,url:`https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?${new URLSearchParams(parameters)}`};
}
/** Immutable reference-year cache: a repeated input reuses the same weather data. */
export async function getPvgisHourlyReference(input,{fetchImpl=fetch,offline=false}={}) {
  const request=pvgisHourlyRequest(input),key=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const file=path.join(cacheDir,`${key}.json`);
  try {const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.key===key&&Array.isArray(saved.hourly))return {...saved,data_hash:saved.data_hash??createHash('sha256').update(JSON.stringify(saved.hourly)).digest('hex')};}catch{}
  if(offline)return {key,request,hourly:null,source:'NOAA_ISOTROPIC_ESTIMATE',warning:'PVGIS_HOURLY_REFERENCE_UNAVAILABLE'};
  if(pending.has(key))return pending.get(key);
  const promise=(async()=>{
    try {
      const response=await fetchImpl(request.url,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error(`PVGIS_HTTP_${response.status}`);
      const data=await response.json();
      if(!Array.isArray(data?.outputs?.hourly)||data.outputs.hourly.length<8760)throw new Error('PVGIS_HOURLY_INCOMPLETE');
      const hourly=data.outputs.hourly.map(p=>{
        const match=String(p.time).match(/^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/);
        const power=Number(p.P);if(!match||!Number.isFinite(power)||power<0)throw new Error('PVGIS_HOURLY_INVALID');
        return {timestamp:new Date(Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5])).toISOString(),power_w:power};
      });
      const saved={key,request,hourly,data_hash:createHash('sha256').update(JSON.stringify(hourly)).digest('hex'),source:'PVGIS_HOURLY_MONTHLY_RECONCILED',retrieved_at:new Date().toISOString()};
      await fs.mkdir(cacheDir,{recursive:true});await fs.writeFile(file,JSON.stringify(saved));return saved;
    }catch(error){return {key,request,hourly:null,source:'NOAA_ISOTROPIC_ESTIMATE',warning:'PVGIS_HOURLY_REFERENCE_UNAVAILABLE',reason:error.message};}
  })();
  pending.set(key,promise);try{return await promise;}finally{pending.delete(key);}
}
