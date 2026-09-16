import test from 'node:test';
import assert from 'node:assert/strict';
import {rayHitsBox,rayHitsCrown,crownBoxes,instantaneous,calculateAnnual,validateScene} from '../services/shading/trees/treeEngine.js';

const tree={id:'survey',x:0,y:-10,groundZ:0,height:5,diameter:8,crownBottom:2};
const scene={origin:{lat:49,lon:2,north:[0,1]},trees:[tree],panels:[{id:'P1',polygon:[[-.5,-.5,1],[.5,-.5,1],[.5,.5,1],[-.5,.5,1]]}],emptySceneAttested:false};
test('ray geometry distinguishes front, behind, parallel and origin inside',()=>{
  assert(rayHitsBox([0,0,0],[0,0,1],[-1,-1,2,1,1,3]));
  assert(!rayHitsBox([0,0,0],[0,0,-1],[-1,-1,2,1,1,3]));
  assert(!rayHitsBox([3,0,0],[0,0,1],[-1,-1,2,1,1,3]));
  assert(rayHitsCrown([0,-10,3],[0,0,1],tree));
  assert(!rayHitsCrown([0,0,1],[0,1,0],tree));
});
test('measured footprint preserves gaps and edits transform the actual columns',()=>{
  const t={...tree,measuredHeight:5,measuredCrownBottom:2,measuredDiameter:8,cellSize:1,columns:[[-2,0,2,5],[2,0,2,5]]};
  assert(crownBoxes(t).every(b=>!rayHitsBox([0,-10,0],[0,0,1],b)));
  const moved=crownBoxes({...t,x:10,height:8,diameter:16});
  assert.deepEqual(moved[0],[5,-11,2,7,-9,8]);
});
test('unassessed empty scene and missing roof datum fail closed',()=>{
  assert.throws(()=>validateScene({...scene,trees:[]}),/vide non attestée/);
  assert.throws(()=>validateScene({...scene,roofSurveyRequired:true}),/Altitude/);
  assert.throws(()=>validateScene({...scene,trees:[{...tree,height:NaN}]}),/invalide/);
});
test('season changes actual rays; annual loss is irradiation weighted, not hours averaged',()=>{
  const winter=instantaneous(scene,'2023-01-01T12:00:00Z').panels[0].shade;
  const summer=instantaneous(scene,'2023-07-01T12:00:00Z').panels[0].shade;
  assert.equal(winter,1);assert.equal(summer,0);
  const hourly=Array.from({length:8760},(_,i)=>{
    const iso=new Date(Date.UTC(2023,0,1,i)).toISOString();const day=iso.slice(0,10),hour=iso.slice(11,16);
    return {time:day.replaceAll('-','')+':'+hour.replace(':',''),'Gb(i)':day==='2023-01-01'&&hour==='12:00'?900:day==='2023-07-01'&&hour==='12:00'?100:0,'Gd(i)':0,'Gr(i)':0};
  });
  const irradiation={inputs:{location:{latitude:49,longitude:2}},outputs:{hourly}};
  assert.equal(calculateAnnual(scene,irradiation).lossPercent,90);
  const overlap=calculateAnnual({...scene,trees:[tree,{...tree,id:'same-canopy'}]},irradiation,{attribution:true});
  assert.equal(overlap.lossPercent,90);
  assert(overlap.attribution.every(t=>t.removalPercentagePoints===0),'Overlapping crowns must not be attributed twice');
  assert.equal(calculateAnnual({...scene,trees:[],emptySceneAttested:true},irradiation).lossPercent,0);
  assert.throws(()=>calculateAnnual(scene,{outputs:{hourly:[]}}),/incomplète/);
});
