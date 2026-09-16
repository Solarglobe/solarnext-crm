import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash,geometryHash as fingerprint,stateIsCurrent,automaticZeroAttestation} from './crmState.js';
import {acquireScene} from './acquireScene.js';
import {runCalculation} from './runCalculation.js';
import {instantaneous,validateScene} from './treeEngine.js';
import {renderTreePdf} from './renderTreePdf.js';

let busy=false; // one acquisition/calculation/PDF per API process; math runs off the HTTP thread.
const error=(status,message)=>Object.assign(Error(message),{status});
/** Mounted behind JWT/RBAC. loadStudy MUST enforce organization ownership. */
export function createTreeShadingRouter({loadStudy,dataDir,acquire=acquireScene,calculate=runCalculation,renderPdf=renderTreePdf}){
  const router=express.Router({mergeParams:true});
  router.use(async(req,res,next)=>{try{
    const org=req.user?.organizationId??req.user?.organization_id;if(!org)throw error(401,'Non authentifié');
    const version=Number(req.params.versionId);if(!Number.isInteger(version)||version<1)throw error(400,'Version invalide');
    const study=await loadStudy(org,req.params.studyId,version);if(!study)throw error(404,'Étude inaccessible');
    if(!study.geometry)throw error(409,'Calepinage requis');
    const directory=path.join(dataDir,hash([org,study.id]));
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    let state=null;try{state=JSON.parse(await fs.readFile(path.join(directory,'crm-state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const geometryHash=fingerprint(study.geometry);req.tree={study,directory,state,geometryHash,org,version,stale:!!state&&!stateIsCurrent(state,study.geometry)};next();
  }catch(e){next(e);}});
  async function persist(ctx,state){const file=path.join(ctx.directory,'crm-state.json');await fs.writeFile(file+'.tmp',JSON.stringify(state),{mode:0o600});await fs.rename(file+'.tmp',file);}
  function current(ctx){if(!ctx.state)throw error(409,'Charger les arbres IGN depuis le calepinage');if(ctx.stale)throw error(409,'Calepinage modifié : recharger la scène puis recalculer');return ctx.state;}
  async function recheck(req){const fresh=await loadStudy(req.tree.org,req.params.studyId,req.tree.version);if(!fresh||fingerprint(fresh.geometry)!==req.tree.geometryHash)throw error(409,'Calepinage modifié pendant le traitement');}
  function job(fn){return async(req,res,next)=>{if(busy)return next(error(429,'Un traitement arbres est déjà en cours'));if(req.method==='POST'&&req.tree.study.locked)return next(error(409,'Version verrouillée : créer une version modifiable'));busy=true;try{await fn(req,res);}catch(e){next(e);}finally{busy=false;}};}
  router.get('/scene',(req,res)=>{const {state,stale,study}=req.tree;res.json({scene:state?.scene??null,result:stale?null:state?.result??null,revision:state?.revision??0,stale,locked:study.locked,title:study.title||'Analyse arbres'});});
  router.post('/acquire',job(async(req,res)=>{
    const ctx=req.tree,clone=path.join(ctx.directory,'geometry.json');await fs.writeFile(clone,JSON.stringify({geometry:ctx.study.geometry}),{mode:0o600});
    const scene=await acquire(clone,ctx.directory);scene.title=ctx.study.title||'Analyse arbres';scene.context='crm';scene.id=ctx.study.id;scene.emptySceneAttested=automaticZeroAttestation(scene);await recheck(req);
    const state={scene,result:null,geometryHash:hash(ctx.study.geometry),geometryFingerprint:ctx.geometryHash,revision:0};await persist(ctx,state);res.json(state);
  }));
  router.post('/scene',job(async(req,res)=>{
    const ctx=req.tree,state=current(ctx);if(req.body.revision!==state.revision)throw error(409,'Scène modifiée dans une autre fenêtre : recharger');
    const trees=req.body.trees;if(!Array.isArray(trees))throw error(422,'Arbres invalides');
    // Do not accept arbitrary point clouds, result objects or source attestations.
    const originals=new Map(state.scene.trees.map(t=>[t.id,t]));const seen=new Set();
    const edited=trees.map(t=>{if(typeof t.id!=='string'||t.id.length>100||seen.has(t.id))throw error(422,'Identifiant arbre invalide');seen.add(t.id);const original=originals.get(t.id);if(!original&&!t.id.startsWith('manual-'))throw error(422,'Volume inconnu');const base=original||{id:t.id,source:'manual'};return {...base,...Object.fromEntries(['x','y','groundZ','height','diameter','crownBottom'].map(k=>[k,Number(t[k])])),enabled:t.enabled!==false,correctedByUser:true};});
    let scene={...state.scene,trees:edited,emptySceneAttested:automaticZeroAttestation(state.scene)||req.body.emptySceneAttested===true};
    if(req.body.roofAltitudeM!==undefined){const altitude=Number(req.body.roofAltitudeM);if(!Number.isFinite(altitude)||altitude<-100||altitude>4800||scene.roofs.length!==1)throw error(422,'Altitude IGN69 invalide');const delta=altitude-scene.roofs[0].polygon[0][2];scene={...scene,roofSurveyRequired:false,roofs:scene.roofs.map(r=>({...r,polygon:r.polygon.map(p=>[p[0],p[1],p[2]+delta]),plane:[r.plane[0],r.plane[1],r.plane[2]+delta],datum:'IGN69_MANUAL'})),panels:scene.panels.map(p=>({...p,polygon:p.polygon.map(v=>[v[0],v[1],v[2]+delta])}))};}
    validateScene({...scene,emptySceneAttested:true,roofSurveyRequired:false});await recheck(req);
    const updated={...state,scene,result:null,revision:state.revision+1};await persist(ctx,updated);res.json(updated);
  }));
  router.get('/instant',(req,res,next)=>{try{res.json(instantaneous({...current(req.tree).scene,emptySceneAttested:true},String(req.query.date)));}catch(e){next(e);}});
  router.post('/calculate',job(async(req,res)=>{const ctx=req.tree,state=current(ctx);if((state.scene.status==='unavailable'||state.scene.acquisition?.complete===false)&&!state.scene.emptySceneAttested)throw error(422,'Données IGN indisponibles ou incomplètes : complétez le relevé dans les détails');const irradiation=JSON.parse(await fs.readFile(path.join(ctx.directory,'irradiation.json'),'utf8'));const result=await calculate(state.scene,irradiation);await recheck(req);await persist(ctx,{...state,result});res.json(result);}));
  router.get('/ortho.png',(req,res,next)=>{try{current(req.tree);res.sendFile(path.join(req.tree.directory,'ortho.png'));}catch(e){next(e);}});
  router.get('/pdf',job(async(req,res)=>{const state=current(req.tree);if(!state.result)throw error(409,'Recalcul requis avant export');const pdf=await renderPdf(state.scene,state.result,req.tree.directory,req.query);await recheck(req);res.type('application/pdf').set('Content-Disposition','attachment; filename="analyse-arbres.pdf"').send(pdf);}));
  router.use((e,_req,res,_next)=>res.status(e.status||422).json({error:e.message}));return router;
}
