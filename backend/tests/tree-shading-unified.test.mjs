import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createTreeShadingRouter} from '../services/shading/trees/crmRouter.js';
import {calculateCombined} from '../services/shading/trees/combinedCalculation.js';
import {calculateAnnual} from '../services/shading/trees/treeEngine.js';import {withUncertainty} from '../services/shading/trees/uncertainty.js';
import {stateDirectory,geometryHash,automaticZeroAttestation} from '../services/shading/trees/crmState.js';
import {jobManager,atomicJson} from '../services/shading/trees/jobs.js';import {savedStudyShading,toStudyShading} from '../services/shading/trees/studyResult.js';import {presentShading} from '../services/pdf/shadingPresentation.js';import {rayHitsPrism} from '../services/shading/trees/prism.js';
process.env.SHADING_ATTESTATION_SECRET='fictional-local-unified-test-key-only-0000';process.env.SHADING_ATTESTATION_KEY_ID='local-tests';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const geometry={roofState:{map:{centerLatLng:{lat:49,lng:2}},scale:{metersPerPixel:.1},image:{width:100,height:100}},pans:[],frozenBlocks:[{panId:'roof',panels:[{projection:{points:[{x:5,y:5}]}}]}]};
const tree={id:'ign-tree',x:0,y:-3,groundZ:0,height:8,diameter:5,crownBottom:1};
const baseScene={preparationVersion:'measured-roofs-v2',status:'available',origin:{lat:49,lon:2,north:[0,1]},acquisition:{complete:true},emptySceneAttested:true,roofSurveyRequired:false,trees:[],panels:[{id:'P1',polygon:[[-.5,-.5,1],[.5,-.5,1],[.5,.5,1],[-.5,.5,1]]}],roofs:[{polygon:[[-2,-2,1],[2,-2,1],[2,2,1],[-2,2,1]],plane:[0,0,1]}]};
const hourly=Array.from({length:8760},(_,i)=>{const s=new Date(Date.UTC(2023,0,1,i)).toISOString();return {time:s.slice(0,10).replaceAll('-','')+':'+s.slice(11,16).replace(':',''),'Gb(i)':s.slice(11,13)==='12'?100:0,'Gd(i)':s.slice(11,13)==='12'?20:0,'Gr(i)':0};});
const irradiation={inputs:{location:{latitude:49,longitude:2}},outputs:{hourly}},options={grid:2,skyBins:[2,8]};
const calc=s=>calculateCombined(s,irradiation,irradiation,options);
async function harness(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'unified-shading-'));const manager=jobManager(root,{heartbeatMs:25,orphanMs:100});let geometryNow=structuredClone(geometry),locked=false,complete=true,roofSurveyRequired=false,calls=0,acquisitions=0,gate=null,pdfHook=null;const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['test-org'])req.user={organizationId:req.headers['test-org']};next();});const loadStudy=async(org,id,v)=>org==='owner'&&id==='fixture'&&v===1?{id:'fixture-version',geometry:geometryNow,locked}:null;
app.use('/s/:studyId/v/:versionId',createTreeShadingRouter({dataDir:root,loadStudy,acquire:async(_,dir,{onStage})=>{acquisitions++;await onStage('detection');for(const n of ['irradiation.json','irradiation-no-horizon.json'])await fs.writeFile(path.join(dir,n),JSON.stringify(irradiation));return {...structuredClone(baseScene),roofSurveyRequired,acquisition:{complete}};},calculate:async(scene,irr,{signal})=>{calls++;if(gate)await gate;signal.throwIfAborted();return calc(scene);},renderPdf:async()=>{await pdfHook?.();return Buffer.from('%PDF-test');}}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const dir=stateDirectory(root,'owner','fixture-version'),url=`http://127.0.0.1:${server.address().port}/s/fixture/v/1`;
const req=(p,body,org='owner')=>fetch(url+p,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(org?{'test-org':org}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const status=async()=>await(await req('/jobs')).json();const done=async()=>{for(let i=0;i<200;i++){const s=await status();if(['completed','failed'].includes(s.job?.status))return s;await sleep(15);}throw Error('Job did not finish');};
return {root,dir,req,status,done,manager,get calls(){return calls},get acquisitions(){return acquisitions},set gate(v){gate=v},set roofSurveyRequired(v){roofSurveyRequired=v},set complete(v){complete=v},set locked(v){locked=v},set geometry(v){geometryNow=v},set pdfHook(v){pdfHook=v}};}
test('concurrent validation is one durable job; polling/reload keeps heartbeat, saved result, and PDF',async t=>{const h=await harness(t);assert.equal((await h.req('/jobs',undefined,null)).status,401);assert.equal((await h.req('/jobs',undefined,'other')).status,404);h.locked=true;assert.equal((await h.req('/jobs',{})).status,409);h.locked=false;
let release;h.gate=new Promise(r=>release=r);const requests=await Promise.all(Array.from({length:8},()=>h.req('/jobs',{})));const jobs=await Promise.all(requests.map(r=>r.json()));assert(jobs.every(j=>j.job.id===jobs[0].job.id));for(let i=0;i<40&&h.calls===0;i++)await sleep(10);const first=await h.status();assert.equal(first.job.step,'annual');await sleep(90);const reloaded=await h.status();assert.equal(reloaded.job.id,first.job.id);assert(Date.parse(reloaded.job.heartbeatAt)>Date.parse(first.job.heartbeatAt));assert.equal(h.calls,1);assert.equal((await h.req('/scene',{revision:1,trees:[]})).status,409);release();const completed=await h.done();assert.equal(completed.job.status,'completed');assert.equal(completed.result.lossPercent,0);assert.equal((await h.req('/jobs',{})).status,200);assert.equal(h.calls,1);assert.equal(h.acquisitions,1);assert.equal((await h.req('/pdf')).status,200);
const saved=await savedStudyShading('owner','fixture-version',geometry,{root:h.root});assert.equal(saved.result.hash,completed.result.hash);assert.equal(saved.shading.combined.totalLossPct,completed.result.lossPercent);assert.equal(presentShading(saved.shading).monthlyFactors.length,12);assert(saved.result.energyReference.additionalMonthlyFactors.every(v=>v===1));
const scene=await(await h.req('/scene')).json();assert.equal((await h.req('/scene',{revision:scene.revision,trees:[{...tree,id:'forged'}]})).status,422);assert.equal((await h.req('/scene',{revision:scene.revision,trees:[{...tree,id:'manual-one'}]})).status,200);assert.equal((await h.req('/scene',{revision:scene.revision,trees:[]})).status,409);assert.equal((await h.req('/pdf')).status,409);await h.req('/jobs',{});const nonzero=await h.done();assert.equal(nonzero.job.status,'completed');assert(nonzero.result.lossPercent>0);assert.equal(h.acquisitions,1);h.pdfHook=()=>{h.geometry={...geometry,pans:[{id:'changed'}]};};assert.equal((await h.req('/pdf')).status,409);assert.equal((await h.status()).result,null);
});
test('abandoned job becomes failed and can be retried without a global lock',async t=>{const h=await harness(t);await h.req('/jobs');await atomicJson(path.join(h.dir,'analysis-job.json'),{id:'orphan',pid:process.pid,owner:'old-process',status:'running',step:'annual',heartbeatAt:'2020-01-01T00:00:00Z'});const s=await h.status();assert.equal(s.job.status,'failed');assert.equal(s.job.code,'JOB_ABANDONED');const retry=await(await h.req('/jobs',{})).json();assert.notEqual(retry.job.id,'orphan');assert.equal((await h.done()).job.status,'completed');});
test('unavailable IGN is not zero; explicit skip excludes loss and allows retry; no panels is clear',async t=>{const h=await harness(t);h.complete=false;await h.req('/jobs',{});const failed=await h.done();assert.equal(failed.job.status,'failed');assert.match(failed.job.error,/Analyse non disponible/);assert.equal(failed.result,null);assert.equal(h.calls,0);assert.equal((await h.req('/skip',{})).status,200);assert.equal((await h.status()).excluded,true);assert.equal((await savedStudyShading('owner','fixture-version',geometry,{root:h.root})).shading.combined.totalLossPct,null);h.complete=true;await h.req('/jobs',{});assert.equal((await h.done()).result.lossPercent,0);h.geometry={...geometry,frozenBlocks:[]};const res=await h.req('/jobs',{});assert.equal(res.status,422);assert.match((await res.json()).error,/Placez les panneaux/);assert(!automaticZeroAttestation({...baseScene,acquisition:{complete:false}}));});
test('tree physics unchanged; no tree zero; opaque overlap wins without adding percentages',()=>{const empty=calc(baseScene);assert.equal(empty.lossPercent,0);assert.deepEqual([empty.uncertainty.low,empty.uncertainty.central,empty.uncertainty.high],[0,0,0]);const trees={...baseScene,trees:[tree]},result=calc(trees),original=withUncertainty(calculateAnnual({...trees,sampleGrid:2},irradiation,{skyBins:[2,8]}));assert(Math.abs(result.lossPercent-original.lossPercent)<1e-10);assert(result.lossPercent>0);
const obstacle={id:'solid',polygon:[[-4,-7],[4,-7],[4,1],[-4,1]],plane:[0,0,0],height:9};const solid=calc({...baseScene,opaqueObstacles:[obstacle]}),union=calc({...trees,opaqueObstacles:[obstacle]});assert(Math.abs(union.lossPercent-solid.lossPercent)<1e-9);assert(union.lossPercent<solid.lossPercent+result.lossPercent);assert.equal(union.components.trees.lossPercent,0);assert.equal(union.uncertainty.low,union.uncertainty.high);
const withHorizon={...irradiation,outputs:{hourly:hourly.map(h=>({...h,'Gb(i)':h['Gb(i)']*.5}))}},combined=calculateCombined(trees,withHorizon,irradiation,options);assert(combined.components.horizon.lossPercent>0);assert(combined.hourly.every(h=>h.lost<=h.irradiance+1e-6));assert(Math.abs(Object.values(combined.components).reduce((s,c)=>s+c.lossPercent,0)-combined.lossPercent)<1e-9);assert(combined.lossPercent<100);});
test('prism intersections preserve height, direction and roof plane',()=>{const prism={polygon:[[-1,-1],[1,-1],[1,1],[-1,1]],plane:[.2,0,1],height:2};assert(rayHitsPrism([0,-3,2],[0,1,0],prism));assert(!rayHitsPrism([0,-3,4],[0,1,0],prism));assert(!rayHitsPrism([0,-3,2],[0,-1,0],prism));assert(rayHitsPrism([0,0,0],[0,0,1],prism));});

test('missing roof height is explicit, including old failed jobs; skip remains unknown and layout-scoped',async t=>{
 const h=await harness(t);h.roofSurveyRequired=true;await h.req('/jobs',{});const failed=await h.done();
 assert.equal(failed.job.code,'ROOF_SURVEY_REQUIRED');assert.match(failed.job.error,/hauteur de la toiture/);assert.equal(h.calls,0);assert.equal(failed.result,null);
 const file=path.join(h.dir,'analysis-job.json'),old=JSON.parse(await fs.readFile(file,'utf8'));
 await atomicJson(file,{...old,code:'ANALYSIS_FAILED',error:'Analyse non disponible : données IGN indisponibles ou récupération incomplète.'});
 const before=await fs.readFile(file,'utf8');assert.equal((await h.status()).job.code,'ROOF_SURVEY_REQUIRED');assert.equal((await(await h.req('/scene')).json()).job.code,'ROOF_SURVEY_REQUIRED');assert.equal(await fs.readFile(file,'utf8'),before);
 assert.equal((await h.req('/skip',{})).status,200);assert.equal((await h.status()).excluded,true);
 const saved=await savedStudyShading('owner','fixture-version',geometry,{root:h.root});assert.equal(saved.shading.combined.totalLossPct,null);assert.equal((await h.req('/pdf')).status,409);
 h.geometry={...geometry,frozenBlocks:[{panId:'roof',panels:[{projection:{points:[{x:25,y:5}]}}]}]};assert.equal((await h.status()).excluded,false);
 h.locked=true;assert.equal((await h.req('/skip',{})).status,409);
});

test('skipping after editing never makes an old IGN scene current for a later retry',async t=>{
 const h=await harness(t);await h.req('/jobs',{});await h.done();assert.equal(h.acquisitions,1);
 h.geometry={...geometry,pans:[{id:'new-roof'}]};assert.equal((await h.req('/skip',{})).status,200);assert.equal((await h.status()).excluded,true);
 assert.equal((await h.req('/scene',{revision:2,trees:[]})).status,409);
 await h.req('/jobs',{});assert.equal((await h.done()).job.status,'completed');assert.equal(h.acquisitions,2);assert.equal((await h.status()).excluded,false);
});

test('retry reacquires an incomplete roof scene even when IGN coverage was complete',async t=>{
 const h=await harness(t);h.roofSurveyRequired=true;await h.req('/jobs',{});assert.equal((await h.done()).job.status,'failed');
 h.roofSurveyRequired=false;await h.req('/jobs',{});assert.equal((await h.done()).job.status,'completed');assert.equal(h.acquisitions,2);
});

test('populated roofs use distinct irradiation; aggregate is weighted by area and energy',()=>{
 const scene={...baseScene,panels:[{...baseScene.panels[0],roofId:'south'},
  {id:'P2',roofId:'east',polygon:[[2,0,1],[4,0,2],[4,1,2],[2,1,1]]}],trees:[tree]};
 const east={...irradiation,outputs:{hourly:hourly.map(h=>({...h,'Gb(i)':h['Gb(i)']*2,'Gd(i)':h['Gd(i)']*2}))}};
 const result=calculateCombined(scene,{byRoof:{south:irradiation,east}},{byRoof:{south:irradiation,east}},options);
 const southResult=calc({...scene,panels:[scene.panels[0]]});
 const eastResult=calculateCombined({...scene,panels:[scene.panels[1]]},east,east,options);
 const area=Math.sqrt(5),weighted=(a,b)=>(a+area*b)/(1+area);
 assert.equal(result.panels.length,2);assert.equal(result.hourly.length,8760);
 assert(Math.abs(result.baselineKwhM2-weighted(southResult.baselineKwhM2,eastResult.baselineKwhM2))<1e-10);
 assert(Math.abs(result.lostKwhM2-weighted(southResult.lostKwhM2,eastResult.lostKwhM2))<1e-10);
 assert(Math.abs(result.lossPercent-100*result.lostKwhM2/result.baselineKwhM2)<1e-9);
 assert(Math.abs(Object.values(result.components).reduce((n,v)=>n+v.lossPercent,0)-result.lossPercent)<1e-9);
 assert(result.uncertainty.low<=result.lossPercent&&result.uncertainty.high>=result.lossPercent);
 assert(result.hourly.every(h=>Number.isFinite(h.lost)&&h.lost<=h.irradiance));
 assert.throws(()=>calculateCombined(scene,{byRoof:{south:irradiation}},{byRoof:{south:irradiation}},options),/manquante/);
});

test('stored Python tracebacks remain private and yield a useful retry instruction',async t=>{
 const h=await harness(t);await h.req('/jobs');await atomicJson(path.join(h.dir,'analysis-job.json'),{id:'old',status:'failed',error:'Traceback (most recent call last):\nFile /private/server/path\nValueError: altitude'});
 const before=await fs.readFile(path.join(h.dir,'analysis-job.json'),'utf8');const status=await h.status();assert.match(status.job.error,/Réessayer/);assert(!status.job.error.includes('/private/'));assert.equal(await fs.readFile(path.join(h.dir,'analysis-job.json'),'utf8'),before);
});

test('retry rebuilds legacy prepared scenes with old irradiation, without changing completed history',async t=>{
 const h=await harness(t);await h.req('/jobs',{});const completed=await h.done();assert.equal(completed.job.status,'completed');
 const file=path.join(h.dir,'crm-state.json'),state=JSON.parse(await fs.readFile(file,'utf8'));delete state.scene.preparationVersion;await atomicJson(file,state);
 await h.req('/jobs',{});assert.equal(h.acquisitions,1);
 await atomicJson(file,{...state,result:null,revision:state.revision+1});await h.req('/jobs',{});assert.equal((await h.done()).job.status,'completed');assert.equal(h.acquisitions,2);
});
