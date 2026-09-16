import {toStudyShading} from './studyResult.js';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash,geometryHash as fingerprint,stateIsCurrent,automaticZeroAttestation} from './crmState.js';
import {acquireScene} from './acquireScene.js';
import {runCombinedCalculation} from './runCombinedCalculation.js';
import {instantaneous,validateScene} from './treeEngine.js';
import {renderTreePdf} from './renderTreePdf.js';
import {jobManager,atomicJson} from './jobs.js';
const error=(status,message)=>Object.assign(Error(message),{status});
const roofSurveyMessage='Analyse non disponible : la hauteur de la toiture n’a pas pu être déterminée à partir des données IGN. Un relevé de hauteur est nécessaire pour calculer l’ombrage.';
export function createTreeShadingRouter({loadStudy,dataDir,acquire=acquireScene,calculate=runCombinedCalculation,renderPdf=renderTreePdf}){
 const router=express.Router({mergeParams:true}),jobs=jobManager(dataDir);
 async function readState(directory){try{return JSON.parse(await fs.readFile(path.join(directory,'crm-state.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 router.use(async(req,res,next)=>{try{
  const org=req.user?.organizationId??req.user?.organization_id;if(!org)throw error(401,'Non authentifié');
  const version=Number(req.params.versionId);if(!Number.isInteger(version)||version<1)throw error(400,'Version invalide');
  const study=await loadStudy(org,req.params.studyId,version);if(!study)throw error(404,'Étude inaccessible');
  const directory=path.join(dataDir,hash([org,study.id]));await fs.mkdir(directory,{recursive:true,mode:0o700});const state=await readState(directory);
  req.tree={study,studyId:req.params.studyId,directory,state,geometryHash:fingerprint(study.geometry),org,version,stale:!!state&&!stateIsCurrent(state,study.geometry)};next();
 }catch(e){next(e);}});
 const persist=(ctx,state)=>atomicJson(path.join(ctx.directory,'crm-state.json'),state);
 function current(ctx){if(!ctx.state)throw error(409,'Analyse non disponible');if(ctx.stale||ctx.state.sceneStale)throw error(409,'Calepinage modifié : recalcul nécessaire');return ctx.state;}
 async function recheckContext(ctx){const fresh=await loadStudy(ctx.org,ctx.studyId,ctx.version);if(!fresh||fresh.locked||fingerprint(fresh.geometry)!==ctx.geometryHash)throw error(409,'Calepinage modifié pendant le traitement');}
 const recheck=req=>recheckContext(req.tree);
 const publicJob=j=>j?Object.fromEntries(['id','status','step','createdAt','startedAt','finishedAt','heartbeatAt','error','code','resultHash'].map(k=>[k,j[k]??null])):null;
 // Explain existing failed jobs without rewriting their stored diagnostic.
 const explainedJob=(job,state)=>publicJob(job?.status==='failed'&&job.error==='Analyse non disponible : données IGN indisponibles ou récupération incomplète.'&&state?.scene?.acquisition?.complete&&state.scene.roofSurveyRequired
  ?{...job,code:'ROOF_SURVEY_REQUIRED',error:roofSurveyMessage}:job);
 const brief=r=>r?Object.fromEntries(['scope','hash','status','lossPercent','uncertainty','components','calculatedAt'].map(k=>[k,r[k]])):null;
 const panelCount=g=>(g?.frozenBlocks||[]).reduce((n,b)=>n+(b.panels?.length||0),0);
 async function start(ctx){
  if(ctx.study.locked)throw error(409,'Version verrouillée');if(!panelCount(ctx.study.geometry))throw error(422,'Placez les panneaux avant de valider le calepinage.');
  const existing=await jobs.status(ctx.directory);if(jobs.isActive(existing))return existing;
  if(!ctx.stale&&ctx.state?.result?.scope==='combined-shading-v1')return {id:ctx.state.jobId,status:'completed',step:'completed',resultHash:ctx.state.result.hash};
  return jobs.start(ctx.directory,hash([ctx.geometryHash,ctx.state?.revision??0]),async({id,stage,signal})=>{
   let state=await readState(ctx.directory);
   if(!state||state.pipelineVersion!=='unified-v1'||state.sceneStale||!stateIsCurrent(state,ctx.study.geometry)||!state.scene?.acquisition?.complete){
    await stage('ign');const clone=path.join(ctx.directory,'geometry.json');await fs.writeFile(clone,JSON.stringify({geometry:ctx.study.geometry}),{mode:0o600});
    const scene=await acquire(clone,ctx.directory,{signal,onStage:stage});signal.throwIfAborted();scene.title=ctx.study.title||'Analyse d’ombrage';scene.context='crm';scene.id=ctx.study.id;
    const overrides=state?.treeOverrides||{};
    const dx=(state?.scene?.origin?.x??scene.origin.x??0)-(scene.origin.x??0),dy=(state?.scene?.origin?.y??scene.origin.y??0)-(scene.origin.y??0);
    const corrected=t=>({...t,x:t.x+dx,y:t.y+dy});
    scene.trees=scene.trees.filter(t=>overrides[t.id]!==null).map(t=>overrides[t.id]?corrected(overrides[t.id]):t);
    for(const [key,t] of Object.entries(overrides))if(t&&key.startsWith('manual-')&&!scene.trees.some(v=>v.id===key))scene.trees.push(corrected(t));
    const rebasedOverrides=Object.fromEntries(Object.entries(overrides).map(([id,t])=>[id,t?corrected(t):null]));
    scene.emptySceneAttested=automaticZeroAttestation(scene);
    state={pipelineVersion:'unified-v1',treeOverrides:rebasedOverrides,scene,result:null,geometryHash:hash(ctx.study.geometry),geometryFingerprint:ctx.geometryHash,revision:(state?.revision??0)+1,jobId:id};await recheckContext(ctx);await persist(ctx,state);
   }
   if(!state.scene.acquisition?.complete)throw error(422,'Analyse non disponible : données IGN indisponibles ou récupération incomplète.');
   if(state.scene.roofSurveyRequired)throw Object.assign(error(422,roofSurveyMessage),{code:'ROOF_SURVEY_REQUIRED'});
   await stage('annual');const irradiation=JSON.parse(await fs.readFile(path.join(ctx.directory,'irradiation.json'),'utf8'));
   const reference=JSON.parse(await fs.readFile(path.join(ctx.directory,'irradiation-no-horizon.json'),'utf8'));
   const result=await calculate(state.scene,irradiation,{reference,signal});signal.throwIfAborted();result.shading=toStudyShading(result);await stage('save');await recheckContext(ctx);
   const latest=await readState(ctx.directory);if(latest?.revision!==state.revision)throw error(409,'Scène modifiée pendant le traitement');
   await persist(ctx,{...state,result,jobId:id,excluded:false});return result;
  });
 }
 function mutation(fn){return async(req,res,next)=>{try{await jobs.exclusive(req.tree.directory,async()=>{if(req.tree.study.locked)throw error(409,'Version verrouillée');if(jobs.isActive(await jobs.status(req.tree.directory)))throw error(409,'Analyse en cours : les corrections seront disponibles après le calcul.');req.tree.state=await readState(req.tree.directory);await fn(req,res);});}catch(e){next(e);}};}
 router.get('/scene',async(req,res,next)=>{try{const {state,stale,study}=req.tree;res.json({scene:state?.scene??null,result:stale?null:state?.result??null,revision:state?.revision??0,stale:stale||state?.sceneStale===true,excluded:stateIsCurrent(state,req.tree.study.geometry)&&state?.excluded===true,locked:study.locked,title:study.title||'Analyse d’ombrage',job:explainedJob(await jobs.status(req.tree.directory),stale?null:state)});}catch(e){next(e);}});
 router.get('/jobs',async(req,res,next)=>{try{const job=await jobs.status(req.tree.directory),state=await readState(req.tree.directory);res.json({job:explainedJob(job,stateIsCurrent(state,req.tree.study.geometry)?state:null),result:stateIsCurrent(state,req.tree.study.geometry)?brief(state?.result):null,sceneAvailable:!!state?.scene,stale:!!state&&!stateIsCurrent(state,req.tree.study.geometry),locked:req.tree.study.locked,excluded:stateIsCurrent(state,req.tree.study.geometry)&&state?.excluded===true});}catch(e){next(e);}});
 for(const endpoint of ['/jobs','/acquire','/calculate'])router.post(endpoint,async(req,res,next)=>{try{const job=await start(req.tree);res.status(job.status==='completed'?200:202).json({job:publicJob(job)});}catch(e){next(e);}});
 router.post('/skip',mutation(async(req,res)=>{const ctx=req.tree;await recheck(req);await persist(ctx,{...ctx.state,pipelineVersion:'unified-v1',result:null,excluded:true,sceneStale:ctx.state?.sceneStale===true||!stateIsCurrent(ctx.state,ctx.study.geometry),geometryHash:hash(ctx.study.geometry),geometryFingerprint:ctx.geometryHash,revision:(ctx.state?.revision??0)+1});res.json({excluded:true});}));
  router.post('/scene',mutation(async(req,res)=>{
    const ctx=req.tree,state=current(ctx);if(req.body.revision!==state.revision)throw error(409,'Scène modifiée dans une autre fenêtre : recharger');
    const trees=req.body.trees;if(!Array.isArray(trees))throw error(422,'Arbres invalides');
    // Do not accept arbitrary point clouds, result objects or source attestations.
    const originals=new Map(state.scene.trees.map(t=>[t.id,t]));const seen=new Set();
    const edited=trees.map(t=>{if(typeof t.id!=='string'||t.id.length>100||seen.has(t.id))throw error(422,'Identifiant arbre invalide');seen.add(t.id);const original=originals.get(t.id);if(!original&&!t.id.startsWith('manual-'))throw error(422,'Volume inconnu');const base=original||{id:t.id,source:'manual'};return {...base,...Object.fromEntries(['x','y','groundZ','height','diameter','crownBottom'].map(k=>[k,Number(t[k])])),enabled:t.enabled!==false,correctedByUser:true};});
    let scene={...state.scene,trees:edited,emptySceneAttested:automaticZeroAttestation(state.scene)||req.body.emptySceneAttested===true};
    if(req.body.roofAltitudeM!==undefined){const altitude=Number(req.body.roofAltitudeM);if(!Number.isFinite(altitude)||altitude<-100||altitude>4800||scene.roofs.length!==1)throw error(422,'Altitude IGN69 invalide');const delta=altitude-scene.roofs[0].polygon[0][2];scene={...scene,roofSurveyRequired:false,roofs:scene.roofs.map(r=>({...r,polygon:r.polygon.map(p=>[p[0],p[1],p[2]+delta]),plane:[r.plane[0],r.plane[1],r.plane[2]+delta],datum:'IGN69_MANUAL'})),panels:scene.panels.map(p=>({...p,polygon:p.polygon.map(v=>[v[0],v[1],v[2]+delta])}))};}
    validateScene({...scene,emptySceneAttested:true,roofSurveyRequired:false});await recheck(req);
    const treeOverrides={...state.treeOverrides};for(const id of originals.keys())if(!seen.has(id))treeOverrides[id]=null;for(const t of edited)treeOverrides[t.id]=t;
    const updated={...state,scene,treeOverrides,result:null,revision:state.revision+1};await persist(ctx,updated);res.json(updated);
  }));
 router.get('/instant',(req,res,next)=>{try{res.json(instantaneous({...current(req.tree).scene,emptySceneAttested:true},String(req.query.date)));}catch(e){next(e);}});
 router.get('/ortho.png',(req,res,next)=>{try{current(req.tree);res.sendFile(path.join(req.tree.directory,'ortho.png'));}catch(e){next(e);}});
 router.get('/pdf',async(req,res,next)=>{try{const ctx=req.tree,state=current(ctx);if(!state.result)throw error(409,'Analyse non disponible');const pdf=await renderPdf(state.scene,state.result,ctx.directory,req.query);await recheck(req);const latest=await readState(ctx.directory);if(latest?.result?.hash!==state.result.hash)throw error(409,'Analyse modifiée pendant le rapport');res.type('application/pdf').set('Content-Disposition','attachment; filename="analyse-ombrage.pdf"').send(pdf);}catch(e){next(e);}});
 router.use((e,_req,res,_next)=>res.status(e.status||422).json({error:e.message}));return router;
}
