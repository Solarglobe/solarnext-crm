import test from 'node:test';import assert from 'node:assert/strict';
import {irradiationPlans} from '../services/shading/trees/irradiationPlans.js';
test('PVGIS uses populated roofs, south zero and north normalized to minus 180',()=>{
 const scene={origin:{north:[0,1]},roofs:[{id:'north',plane:[0,-.6,100]},{id:'south',plane:[0,.6,100]}],panels:[{roofId:'south'}]};
 const [p]=irradiationPlans(scene);assert.equal(p.roofId,'south');assert.equal(p.aspect,0);
 scene.panels.push({roofId:'north'});assert.equal(irradiationPlans(scene)[1].aspect,-180);
 scene.panels.push({roofId:'missing'});assert.throws(()=>irradiationPlans(scene),/introuvable/);
});
test('Lambert grid convergence is accounted for in geographic azimuth',()=>{
 const scene={origin:{north:[1,0]},roofs:[{id:'r',plane:[.6,0,100]}],panels:[{roofId:'r'}]};
 assert.equal(irradiationPlans(scene)[0].aspect,0);
});
