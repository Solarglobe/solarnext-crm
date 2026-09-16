import fs from 'node:fs/promises';import path from 'node:path';
import {treeDataDir,stateDirectory,stateIsCurrent} from './crmState.js';
import {sealServerShading,hasValidServerShadingReceipt} from '../shadingServerReceipt.js';
export function toStudyShading(r){
 const status=r?'computed':'not_calculated',loss=r?.lossPercent??null;
 const sh={totalLossPct:loss,assessment:{status,nearStatus:status,farStatus:status,geometryContractVersion:'combined-shading-v1',resultHash:r?.hash??null,reasons:[]},
  near:{status,totalLossPct:r? r.components.trees.lossPercent+r.components.obstacles.lossPercent:null},far:{status,totalLossPct:r?.components.horizon.lossPercent??null,source:r?'PVGIS_HORIZON':'NOT_EVALUATED'},combined:{status,totalLossPct:loss},
  perPanel:r?.panels.map(p=>({panelId:p.id,lossPct:p.lossPercent}))??[],
  monthlyFactors:r?.months.map(m=>({month:m.month,farLossFraction:m.baseline?m.horizonLost/m.baseline:0,nearLossFraction:m.baseline?m.nearLost/m.baseline:0,combinedLossFraction:m.lossPercent/100}))??null,
  resultHash:r?.hash??null,combinedAnalysis:true,energyReference:r?.energyReference??null};
 return r?sealServerShading(sh):sh;
}
export async function savedStudyShading(org,version,geometry,{root=treeDataDir()}={}){
 try{const state=JSON.parse(await fs.readFile(path.join(stateDirectory(root,org,version),'crm-state.json'),'utf8'));
  if(state.pipelineVersion!=='unified-v1')return {managed:false};
  const valid=stateIsCurrent(state,geometry)&&state.result?.scope==='combined-shading-v1'&&hasValidServerShadingReceipt(state.result.shading);
  return {managed:true,result:valid?state.result:null,shading:valid?state.result.shading:toStudyShading(null),fingerprint:valid?state.result.hash:state.excluded?'excluded':'unavailable'};
 }catch(e){if(e.code==='ENOENT')return {managed:false};throw e;}
}
