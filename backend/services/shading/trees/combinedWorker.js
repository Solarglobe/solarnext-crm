import {parentPort,workerData} from 'node:worker_threads';
import {calculateCombined} from './combinedCalculation.js';
try{parentPort.postMessage({result:calculateCombined(workerData.scene,workerData.irradiation,workerData.reference)});}catch(e){parentPort.postMessage({error:e.message});}
