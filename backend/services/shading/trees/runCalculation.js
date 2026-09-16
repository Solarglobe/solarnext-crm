import {Worker} from 'node:worker_threads';
export function runCalculation(scene,irradiation){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./calculateWorker.js',import.meta.url),{workerData:{scene,irradiation},resourceLimits:{maxOldGenerationSizeMb:384}});
    const timer=setTimeout(()=>{void worker.terminate();reject(Error('Calcul arbres interrompu après 180 secondes'));},180000);
    worker.once('message',m=>{clearTimeout(timer);m.error?reject(Error(m.error)):resolve(m.result);});
    worker.once('error',e=>{clearTimeout(timer);reject(e);});
    worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Calcul arbres interrompu'));});
  });
}
