import {hasValidServerShadingReceipt} from '../shadingServerReceipt.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Only the physical inputs consumed by prepare_scene.py invalidate an analysis.
export function geometryHash(g) {
  if (!g?.roofState) return hash(g);
  const s=g.roofState;
  return hash({map:{centerLatLng:s.map?.centerLatLng,bearing:s.map?.bearing??0},scale:s.scale?.metersPerPixel,
    image:{width:s.image?.width,height:s.image?.height},
    pans:g.pans?.map(p=>({id:p.id,polygonPx:p.polygonPx,tiltDeg:p.tiltDeg,azimuthDeg:p.azimuthDeg})),
    obstacles:s.obstacles??g.obstacles??[],shadowVolumes:g.shadowVolumes??[],roofExtensions:g.roofExtensions??[],horizon:g.horizonMask??s.horizonMask??null,
    blocks:g.frozenBlocks?.map(b=>({panId:b.panId,panels:b.panels?.map(p=>p.projection?.points)}))});
}
export const treeDataDir=()=>path.resolve(process.env.TREE_SHADING_DATA_DIR || fileURLToPath(new URL('../../../storage/tree-shading',import.meta.url)));
export const stateDirectory=(root,org,version)=>path.join(root,hash([org,version]));
export function stateIsCurrent(state,g) { return !!state && (state.geometryFingerprint===geometryHash(g) || (!state.geometryFingerprint && state.geometryHash===hash(g))); }
export async function readTreeState(root,org,version,g) {
  const directory=stateDirectory(root,org,version);
  try { const state=JSON.parse(await fs.readFile(path.join(directory,'crm-state.json'),'utf8'));
    const valid=state.pipelineVersion!=='unified-v1'||(state.result?.scope==='combined-shading-v1'&&hasValidServerShadingReceipt(state.result?.shading));
    return valid&&stateIsCurrent(state,g)&&state.result?.status==='computed'?{...state,directory}:null;
  } catch(e) { if(e.code==='ENOENT')return null;throw e; }
}
export function automaticZeroAttestation(scene) {
  // Provenance comes only from the acquisition service, never the browser.
  return scene.status==='available' && scene.acquisition?.complete===true && !scene.roofSurveyRequired;
}
