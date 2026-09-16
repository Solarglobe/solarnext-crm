import {parentPort,workerData} from 'node:worker_threads';
import {calculateAnnual} from './treeEngine.js';
import {withUncertainty} from './uncertainty.js';
try{parentPort.postMessage({result:withUncertainty(calculateAnnual({...workerData.scene,sampleGrid:8},workerData.irradiation,{skyBins:[20,96]}))});}
catch(e){parentPort.postMessage({error:e.message});}
