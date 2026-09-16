import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTreeShadingRouter} from '../services/shading/trees/crmRouter.js';
import {applyOpacity,withUncertainty} from '../services/shading/trees/uncertainty.js';

test('CRM ownership, locked versions, stale geometry, edit revisions and PDF guard',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tree-shading-test-'));let locked=false,geometry={layout:'original'},calculations=0;
  const scene={origin:{lat:49,lon:2},trees:[{id:'ign-1',x:0,y:5,groundZ:0,height:10,diameter:5,crownBottom:2}],panels:[{id:'P1',polygon:[[0,0,3],[1,0,3],[1,2,3],[0,2,3]]}],roofs:[{polygon:[[0,0,3]],plane:[0,0,3]}]};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.headers['test-org'])req.user={organizationId:req.headers['test-org']};next();});
  app.use('/studies/:studyId/versions/:versionId/trees',createTreeShadingRouter({dataDir:directory,loadStudy:async(org,id,v)=>org==='owner'&&id==='study'&&v===1?{id:'version-1',geometry,locked}:null,acquire:async(_clone,dir)=>{await fs.writeFile(path.join(dir,'irradiation.json'),'{}');return structuredClone(scene);},calculate:async()=>{calculations++;return {lossPercent:33,status:'computed'};},renderPdf:async()=>Buffer.from('%PDF-test')}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/studies/study/versions/1/trees`;
  const request=(route,body,org='owner')=>fetch(url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(org?{'test-org':org}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await request('/scene',undefined,null)).status,401);
    assert.equal((await request('/scene',undefined,'outsider')).status,404);
    assert.equal((await request('/pdf')).status,409);
    locked=true;assert.equal((await request('/acquire',{})).status,409);locked=false;
    assert.equal((await request('/acquire',{})).status,200);assert.equal((await request('/pdf')).status,409);
    const edit={trees:scene.trees,revision:0,emptySceneAttested:false};
    assert.equal((await request('/scene',edit)).status,200);assert.equal((await request('/scene',edit)).status,409);
    assert.equal((await request('/scene',{trees:[{...scene.trees[0],id:'forged'}],revision:1})).status,422);
    assert.equal((await request('/calculate',{})).status,200);assert.equal(calculations,1);assert.equal((await request('/pdf')).status,200);
    geometry={layout:'changed'};const state=await(await request('/scene')).json();assert(state.stale);assert.equal(state.result,null);assert.equal((await request('/pdf')).status,409);assert.equal((await request('/calculate',{})).status,409);
    assert.equal((await request('/scene',undefined,'outsider')).status,404);
  }finally{await new Promise(r=>server.close(r));if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'tree-shading-test-'))throw Error('Unexpected test directory');await fs.rm(directory,{recursive:true,force:true});}
});
test('opacity scenarios preserve weighted components and exact transparent/opaque ordering',()=>{
  const monthly=Array.from({length:12},(_,i)=>({baseline:100,directLost:20,diffuseLost:10}));
  const r={hash:'source',lossPercent:30,baselineKwhM2:1.2,months:monthly.map((m,i)=>({month:i+1,baseline:100,lost:30,lossPercent:30})),hours:[{hourUTC:12,baseline:1200,lost:360}],hourly:monthly.map((m,i)=>({time:`2023-${String(i+1).padStart(2,'0')}-01T12:00:00Z`,irradiance:100,directLost:20,diffuseLost:10,lost:30})),panels:[{id:'P1',baseline:1200,monthly}]};
  const q=withUncertainty(r);assert(q.uncertainty.low<q.lossPercent);assert(q.lossPercent<q.uncertainty.high);assert(q.uncertainty.high<q.opaqueLossPercent);
  assert(Math.abs(q.lostKwhM2-q.directLostKwhM2-q.diffuseLostKwhM2)<1e-12);assert(Math.abs(applyOpacity(r,'high').lossPercent-29.4)<1e-12);
  assert.notEqual(q.hash,r.hash);
});
