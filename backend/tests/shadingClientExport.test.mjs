import test from 'node:test';
import assert from 'node:assert/strict';
import { getClientStudyExportBlock, assertClientStudyExportable } from '../../shared/shading/clientStudyExport.js';
import { putEphemeralSnapshot } from '../services/pdfEphemeralSnapshot.service.js';
import { assertStudySnapshotExportable } from '../services/studyExportValidation.service.js';
import { generatePdfFromRendererUrl } from '../services/pdfGeneration.service.js';
import { buildFinalStudyJson } from '../services/finalStudyJson.service.js';
import { computeShadingInputFingerprint, markShadingStaleIfInputsChanged } from '../services/shading/shadingAssessment.service.js';
import { getOrComputeHorizonMask, __testGetStats, __testClearCache } from '../services/horizon/horizonMaskCache.js';
const good=()=>({shading:{assessment:{status:'computed',nearStatus:'computed',farStatus:'computed'},near:{totalLossPct:0},far:{totalLossPct:0},combined:{totalLossPct:0}}});
for(const reason of ['stale','not_calculated','insufficient_data','error','needs_recompute','display_blocked'])test(reason+' blocks snapshot, final JSON, and low-level renderer before browser/network',async()=>{
 const snapshot=good();if(reason.endsWith('blocked')||reason==='needs_recompute')snapshot[reason]=true;else snapshot.shading.assessment.status=reason;
 for(const wrap of [s=>s,s=>({scenario_result:s}),s=>({selected_scenario_snapshot:s})]){
  assert.equal(getClientStudyExportBlock(wrap(snapshot)).blocked,true);
  for(const call of [()=>assertStudySnapshotExportable(wrap(snapshot)),()=>putEphemeralSnapshot(wrap(snapshot),'BASE')])assert.throws(call,e=>e.code==='PDF_BLOCKED_SHADING_ASSESSMENT'&&e.status===409);
  await assert.rejects(generatePdfFromRendererUrl('http://127.0.0.1:1/must-not-load',{clientSnapshot:wrap(snapshot)}),e=>e.code==='PDF_BLOCKED_SHADING_ASSESSMENT');
 }
 assert.throws(()=>buildFinalStudyJson({geometryJson:{shading:snapshot.shading},calcResult:snapshot}),e=>e.code==='PDF_BLOCKED_SHADING_ASSESSMENT');
});
test('missing snapshot cannot bypass direct generation service',()=>assert.rejects(generatePdfFromRendererUrl('http://127.0.0.1:1/'),e=>e.code==='PDF_BLOCKED_SHADING_ASSESSMENT'));
test('real zero and sub-0.1 positive assessed values are exportable; stale trace cannot override current status',()=>{for(const loss of [0,0.0004]){const v=good();v.shading.near.totalLossPct=v.shading.combined.totalLossPct=loss;assert.equal(assertClientStudyExportable(v).blocked,false);v.shading.historicalResult={assessment:{status:'stale'}};assert.equal(assertClientStudyExportable(v).blocked,false);}const v=good();v.documentPurpose='internal_diagnostic';assert.equal(getClientStudyExportBlock(v).blocked,true);});
test('freshness fingerprint ignores images/view state but tracks physical input',()=>{const g={roofState:{gps:{lat:49,lon:2},scale:{metersPerPixel:0.1},roof:{north:{angleDeg:0}},image:'huge',selectedId:'one'},pans:[{tilt:10}]};const h=computeShadingInputFingerprint({geometry:g});g.roofState.image='another';g.roofState.selectedId='two';assert.equal(computeShadingInputFingerprint({geometry:g}),h);g.pans[0].tilt=20;assert.notEqual(computeShadingInputFingerprint({geometry:g}),h);});
test('stale result retains one historical result across repeated reads',()=>{const value=good().shading;const stale=markShadingStaleIfInputsChanged(value,{});assert.equal(stale.combined.totalLossPct,null);assert.equal(stale.historicalResult.combined.totalLossPct,0);assert.deepEqual(markShadingStaleIfInputsChanged(stale,{}).historicalResult,stale.historicalResult);});
test('cache remains bounded for distinct coordinates; sync rejection and error flag are retried',async()=>{
 __testClearCache();const prior=process.env.HORIZON_CACHE_MAX_ITEMS;process.env.HORIZON_CACHE_MAX_ITEMS='3';const clear={mask:Array.from({length:36},(_,i)=>({az:i*10,elev:0}))};
 try{for(let i=0;i<20;i++)await getOrComputeHorizonMask({lat:49+i/10000,lon:2},()=>clear);assert.equal(__testGetStats().entries,3);const point={lat:48,lon:2};await assert.rejects(getOrComputeHorizonMask(point,()=>{throw Error('provider down');}));assert.equal(__testGetStats().inflight,0);await assert.rejects(getOrComputeHorizonMask(point,()=>({...clear,error:true})));assert.equal((await getOrComputeHorizonMask(point,()=>clear)).cached,false);}finally{if(prior===undefined)delete process.env.HORIZON_CACHE_MAX_ITEMS;else process.env.HORIZON_CACHE_MAX_ITEMS=prior;__testClearCache();}
});
test('at most 32 distinct horizon computations can be in flight',async()=>{__testClearCache();let release;const gate=new Promise(r=>release=r);const clear={mask:Array.from({length:36},(_,i)=>({az:i*10,elev:0}))};const pending=Array.from({length:32},(_,i)=>getOrComputeHorizonMask({lat:40+i/100,lon:3},async()=>{await gate;return clear;}));try{await assert.rejects(getOrComputeHorizonMask({lat:10,lon:3},()=>clear),/HORIZON_CACHE_BUSY/);assert.equal(__testGetStats().inflight,32);}finally{release();await Promise.all(pending);__testClearCache();}});

import { getNormalizedShadingFromGeometry } from '../services/calpinage/calpinageShadingLegacyAdapter.js';
import { sanitizeCalpinageGeometryForPersistence } from '../services/calpinage/calpinageCommercialIntegrity.js';
import { SHADING_MODEL_VERSION } from '../services/shading/shadingAssessment.service.js';
test('server geometric verdict cannot be bypassed by a matching client-computed zero',()=>{
 const geometry={pans:[{id:'flat',roofKind:'FLAT',tilt:0}],localObstacleSurvey:{status:'complete',source:'manual_survey'}};
 const shading=good().shading;Object.assign(shading.assessment,{modelVersion:SHADING_MODEL_VERSION,geometryFingerprint:computeShadingInputFingerprint({geometry})});
 const persisted=sanitizeCalpinageGeometryForPersistence({...geometry,shading});assert.equal(persisted.backendCommercialGeometry.officialNearShadingAllowed,false);
 const normalized=getNormalizedShadingFromGeometry(persisted).shading;assert.equal(normalized.assessment.status,'insufficient_data');assert.equal(normalized.totalLossPct,null);assert.equal(normalized.historicalResult.combined.totalLossPct,0);assert.equal(getClientStudyExportBlock({shading:normalized}).blocked,true);
});
