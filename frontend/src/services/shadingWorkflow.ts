import {apiFetch} from './api';import {buildApiUrl} from '../config/crmApiBase';
export type ShadingJob={id:string;status:'queued'|'running'|'completed'|'failed';step:string;startedAt?:string;createdAt:string;heartbeatAt:string;error?:string};
export const shadingKey=(study:string,version:string)=>`${study}:${version}`;
export const shadingResumeKey=(study:string,version:string)=>`calpinage:validate-shading:${shadingKey(study,version)}`;
export async function shadingRequest(study:string,version:string,suffix:string,body?:object){const r=await apiFetch(buildApiUrl(`/api/studies/${study}/versions/${version}/tree-shading${suffix}`),{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),timeoutMs:15000,skipErrorToast:true});const data=await r.json();if(!r.ok)throw Error(data.error||'Analyse non disponible');return data;}
const pending=new Map<string,Promise<unknown>>();
export function ensureSavedShading(study:string,version:string,{retry=false}={}){
 const key=shadingKey(study,version);if(pending.has(key))return pending.get(key)!;
 const run=(async()=>{let state=await shadingRequest(study,version,'/jobs');
  if(state.result?.scope==='combined-shading-v1'||(state.excluded&&!retry))return state.result;
  if(state.job?.status==='failed'&&!retry)throw Error(state.job.error||'Analyse non disponible');
  if(!['queued','running'].includes(state.job?.status)){state=await shadingRequest(study,version,'/jobs',{});}
  let failures=0;
  for(;;){window.dispatchEvent(new CustomEvent('shading:progress',{detail:{key,job:state.job}}));
   if(state.job?.status==='failed')throw Error(state.job.error||'Analyse non disponible');
   if(state.result?.scope==='combined-shading-v1')return state.result;
   await new Promise(r=>setTimeout(r,1200));
   try{state=await shadingRequest(study,version,'/jobs');failures=0;
    if(state.job?.status==='completed'&&!state.result)throw Error('Résultat indisponible ou calepinage modifié : relancez l’analyse.');}catch(e){if(++failures>=3)throw Error('Connexion interrompue. Le traitement reste suivi dans l’analyse et après rechargement.');}
  }
 })();pending.set(key,run);void run.finally(()=>pending.delete(key)).catch(()=>{});return run;
}
