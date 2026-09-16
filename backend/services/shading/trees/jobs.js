import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const managers=new Map();
const active=j=>j && ['queued','running'].includes(j.status);
export async function atomicJson(file,value){const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});for(let attempt=0;;attempt++){try{await fs.rename(tmp,file);return;}catch(e){if(process.platform!=='win32'||!['EPERM','EBUSY','EACCES'].includes(e.code)||attempt>=6)throw e;await new Promise(r=>setTimeout(r,20*(attempt+1)));}}}
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
/** One bounded queue per API process; the production PM2 app is a single fork.
 * Durable records survive browser disconnects. A new process fails abandoned work
 * explicitly instead of restoring an unowned in-memory lock. */
export function jobManager(root,{heartbeatMs=5000,orphanMs=30000}={}){
 if(managers.has(root))return managers.get(root);
 const owner=randomUUID(),running=new Map(),serial=new Map();let queue=Promise.resolve();
 async function exclusive(dir,fn){const previous=serial.get(dir)||Promise.resolve();const task=previous.catch(()=>{}).then(fn);serial.set(dir,task);try{return await task;}finally{if(serial.get(dir)===task)serial.delete(dir);}}
 async function status(dir){let job=await read(path.join(dir,'analysis-job.json'));
  if(active(job)&&!running.has(job.id)){
   let alive=false;try{process.kill(job.pid,0);alive=true;}catch{}
   if(!alive||job.pid===process.pid||Date.now()-Date.parse(job.heartbeatAt)>orphanMs){job={...job,status:'failed',step:'failed',error:'Traitement interrompu. Réessayez.',code:'JOB_ABANDONED',finishedAt:new Date().toISOString()};await atomicJson(path.join(dir,'analysis-job.json'),job);}
  }return job;
 }
 async function start(dir,inputKey,run){return exclusive(dir,async()=>{
  const old=await status(dir);if(active(old)||(old?.status==='completed'&&old.inputKey===inputKey))return old;
  const job={id:randomUUID(),inputKey,owner,pid:process.pid,status:'queued',step:'queued',createdAt:new Date().toISOString(),heartbeatAt:new Date().toISOString()};
  running.set(job.id,job);await atomicJson(path.join(dir,'analysis-job.json'),job);
  const execute=async()=>{
   let writes=Promise.resolve();const save=()=>{const copy={...job};writes=writes.catch(()=>{}).then(()=>atomicJson(path.join(dir,'analysis-job.json'),copy));return writes;};
   const controller=new AbortController();let stepTimer;
   const stage=async(step)=>{clearTimeout(stepTimer);job.step=step;job.heartbeatAt=new Date().toISOString();await save();
    // Existing acquisition and worker bounds, not an extended HTTP timeout.
    stepTimer=setTimeout(()=>controller.abort(Error('Étape interrompue : '+step)),step==='annual'?180000:step==='save'?30000:180000);stepTimer.unref?.();};
   job.status='running';job.startedAt=new Date().toISOString();await save();
   const heartbeat=setInterval(()=>{job.heartbeatAt=new Date().toISOString();void save().catch(()=>controller.abort(Error('Suivi serveur indisponible')));},heartbeatMs);heartbeat.unref?.();
   try{const result=await Promise.race([run({id:job.id,stage,signal:controller.signal}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))]);job.status='completed';job.step='completed';job.resultHash=result.hash;}
   catch(e){job.status='failed';job.step='failed';job.error=e?.message||'Analyse non disponible';job.code=e?.code||'ANALYSIS_FAILED';}
   finally{clearTimeout(stepTimer);clearInterval(heartbeat);job.finishedAt=new Date().toISOString();job.heartbeatAt=job.finishedAt;try{await save();}finally{running.delete(job.id);}}
  };
  queue=queue.catch(()=>{}).then(execute);void queue.catch(()=>{});return {...job};
 });}
 const manager={status,start,isActive:active,exclusive};managers.set(root,manager);return manager;
}
