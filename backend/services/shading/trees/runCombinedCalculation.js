import {Worker} from 'node:worker_threads';
export function runCombinedCalculation(scene,irradiation,{reference,signal}={}){
 return new Promise((resolve,reject)=>{signal?.throwIfAborted();const worker=new Worker(new URL('./combinedWorker.js',import.meta.url),{workerData:{scene,irradiation,reference},resourceLimits:{maxOldGenerationSizeMb:384}});
 const stop=()=>{void worker.terminate();reject(signal?.reason||Error('Calcul interrompu'));};signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(()=>{void worker.terminate();reject(Error('Calcul interrompu après 180 secondes'));},180000);
 const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};worker.once('message',m=>{clean();m.error?reject(Error(m.error)):resolve(m.result);});worker.once('error',e=>{clean();reject(e);});worker.once('exit',code=>{clean();if(code)reject(Error('Calcul interrompu'));});
 });
}
