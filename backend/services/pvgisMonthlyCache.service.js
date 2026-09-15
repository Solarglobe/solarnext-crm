import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import fetch from 'node-fetch';
const pending=new Map();
const folder=fileURLToPath(new URL('../weather/cache/pvgis-monthly/',import.meta.url));
export async function fetchPvgisMonthlyReference(url,{offline=false}={}){
  const key=createHash('sha256').update(url).digest('hex'),file=`${folder}${key}.json`;
  try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.key===key&&saved.data?.outputs?.monthly?.fixed?.length===12)return saved;}catch{}
  if(offline)throw new Error('PVGIS_MONTHLY_REFERENCE_UNAVAILABLE');
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`PVGIS_HTTP_${response.status}`);const data=await response.json();if(data?.outputs?.monthly?.fixed?.length!==12)throw new Error('PVGIS_MONTHLY_INVALID');
    const saved={key,url,data,data_hash:createHash('sha256').update(JSON.stringify(data)).digest('hex'),retrieved_at:new Date().toISOString()};await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,JSON.stringify(saved));return saved;})();
  pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
