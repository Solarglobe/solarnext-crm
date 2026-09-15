// Fictitious keys belong exclusively to this isolated test worker.
process.env.SHADING_ATTESTATION_SECRET = 'test-only-shading-attestation-not-a-real-key';
process.env.SHADING_ATTESTATION_KEY_ID = 'unit-local-v1';
import test from 'node:test';
import assert from 'node:assert/strict';
import {flatRoofSurvey,clearHorizon,rect} from './fixtures/flat-roof-survey.mjs';
import {deriveBackendCommercialGeometryVerdict as verdict,sanitizeCalpinageGeometryForPersistence as sanitize} from '../services/calpinage/calpinageCommercialIntegrity.js';
import {computeCalpinageShading} from '../services/shading/calpinageShading.service.js';
import {buildOfficialShadingFromComputeResult} from '../services/calpinage/officialShading.service.js';
import {getNormalizedShadingFromGeometry} from '../services/calpinage/calpinageShadingLegacyAdapter.js';
import {computeShadingInputFingerprint,SHADING_MODEL_VERSION} from '../services/shading/shadingAssessment.service.js';
import {formatShadingLossPct} from '../../shared/shading/shadingAssessment.js';
const compute=g=>computeCalpinageShading({geometry:g,options:{__testHorizonMaskOverride:clearHorizon,includePerPanelBreakdown:true}});
for(const [name,edit,code] of [
 ['unknown',g=>delete g.pans[0].roofKind,'ROOF_KIND_MISSING'],
 ['pitched',g=>g.pans[0].roofKind='PITCHED','ROOF_KIND_UNSUPPORTED'],
 ['negative nonzero tilt',g=>g.pans[0].tiltDeg=-Number.MIN_VALUE,'ROOF_KIND_UNSUPPORTED'],
 ['positive nonzero tilt',g=>g.pans[0].tiltDeg=Number.MIN_VALUE,'ROOF_KIND_UNSUPPORTED'],
 ['two pans',g=>g.pans.push({...g.pans[0],id:'pan2'}),'MULTIPLE_ROOF_PLANES_UNSUPPORTED'],
 ['missing survey',g=>delete g.localObstacleSurvey,'LOCAL_SURVEY_INCOMPLETE'],
 ['orthophoto',g=>g.localObstacleSurvey.source='orthophoto','LOCAL_SURVEY_INCOMPLETE'],
 ['missing list',g=>delete g.obstacles,'OBSTACLE_LIST_INCOMPLETE'],
 ['incomplete list',g=>g.localObstacleSurvey.obstaclesComplete=false,'OBSTACLE_LIST_INCOMPLETE'],
 ['unbound',g=>delete g.frozenBlocks[0].panels[0].panId,'PANEL_BINDING_INVALID'],
 ['outside',g=>g.frozenBlocks[0].panels[0].polygonPx=rect(290,290,20,20),'PANEL_OUTSIDE_ROOF'],
 ['zero area',g=>g.pans[0].polygonPx=[{x:0,y:0},{x:1,y:0},{x:2,y:0}],'ROOF_POLYGON_INVALID'],
 ['self intersection',g=>g.pans[0].polygonPx=[{x:0,y:0},{x:300,y:300},{x:0,y:300},{x:250,y:0}],'ROOF_POLYGON_INVALID'],
 ['scale',g=>g.scale.metersPerPixel=0,'METRIC_SCALE_INVALID'],
 ['GPS',g=>g.gps.lat=91,'GPS_INVALID'],
 ['north',g=>g.north.angleDeg=360,'NORTH_INVALID'],
 ['height',g=>g.pans[0].heightM=4,'VERTICAL_REFERENCE_INVALID'],
 ['panel height',g=>g.frozenBlocks[0].panels[0].heightM=1,'VERTICAL_REFERENCE_INVALID'],
 ['bad obstacle',g=>g.obstacles=[{id:'o',polygonPx:rect(1,1,2,2)}],'OBSTACLE_GEOMETRY_INVALID'],
 ['obstacle datum',g=>g.obstacles=[{id:'o',polygonPx:rect(1,1,2,2),heightM:4,baseHeightM:1,verticalReference:'ROOF_SURFACE'}],'VERTICAL_REFERENCE_INVALID'],
 ['competing legacy',g=>g.roofState={obstacles:[]},'GEOMETRY_CONTRACT_AMBIGUOUS'],
]) test('canonical refuses '+name,()=>{const g=flatRoofSurvey();edit(g);const v=verdict(g);assert.equal(v.officialNearShadingAllowed,false);assert.ok(v.blockingCodes.includes(code),JSON.stringify(v));});
for(const obstacle of [false,true]) test('server computed, certified and stable '+(obstacle?'positive':'zero'),async()=>{
 const g=sanitize(flatRoofSurvey({obstacle})),v=verdict(g);assert.equal(v.status,'CERTIFIED');
 const raw=await compute(g);assert.equal(raw.assessment.status,'computed',JSON.stringify(raw.assessment));
 const expected=obstacle?0.016869870659674824:0;assert.equal(raw.totalLossPct,expected);
 g.shading=buildOfficialShadingFromComputeResult(raw,true,true);
 for(let i=0;i<3;i++){const read=getNormalizedShadingFromGeometry(sanitize(JSON.parse(JSON.stringify(g)))).shading;assert.equal(read.assessment.status,'computed',JSON.stringify(read.assessment));assert.equal(read.totalLossPct,expected);g.shading=read;}
 assert.equal(g.shading.assessment.modelVersion,SHADING_MODEL_VERSION);assert.equal(g.shading.assessment.geometryFingerprint,computeShadingInputFingerprint({geometry:g}));
 assert.equal(formatShadingLossPct(g.shading.totalLossPct,g.shading.assessment.status),obstacle?'< 0,1 %':'0,0 %');
 const tampered=structuredClone(g);tampered.shading.totalLossPct=42;tampered.shading.combined.totalLossPct=42;assert.equal(getNormalizedShadingFromGeometry(tampered).shading.assessment.status,'insufficient_data');
 for(const edit of [x=>x.obstacles.push({id:'new'}),x=>x.pans[0].roofKind='PITCHED',x=>x.frozenBlocks[0].panels[0].polygonPx=rect(400,400,20,20),x=>delete x.shading.assessment.modelVersion,x=>delete x.shading.assessment.geometryFingerprint]){const changed=structuredClone(g);edit(changed);assert.notEqual(getNormalizedShadingFromGeometry(changed).shading.assessment.status,'computed');}
});
test('geometry, horizon and annual energy remain separate',async()=>{
 const g=flatRoofSurvey();assert.equal(verdict(g).status,'CERTIFIED');delete g.irradianceSamples;assert.equal((await compute(g)).assessment.status,'insufficient_data');
 g.irradianceSamples=flatRoofSurvey().irradianceSamples.slice(0,8759);assert.equal((await compute(g)).assessment.status,'insufficient_data');
 g.irradianceSamples=flatRoofSurvey().irradianceSamples;
 const r=await computeCalpinageShading({geometry:g,options:{__testHorizonMaskOverride:{source:'IGN_GEOPLATEFORME',mask:clearHorizon.mask.slice(0,10)}}});assert.notEqual(r.assessment.status,'computed');
});

test('horizon error with otherwise complete mask is refused',async()=>{
 const g=flatRoofSurvey();const r=await computeCalpinageShading({geometry:g,options:{__testHorizonMaskOverride:{...clearHorizon,error:'provider failed',status:'error'}}});assert.equal(r.assessment.status,'error');assert.equal(r.totalLossPct,null);
});
test('invalid canonical members produce reason codes without throwing',()=>{
 for(const edit of [g=>g.pans=[null],g=>g.pans={},g=>g.frozenBlocks=[null],g=>g.frozenBlocks[0].panels=[null],g=>g.obstacles=[null]]){const g=flatRoofSurvey();edit(g);assert.equal(verdict(g).officialNearShadingAllowed,false);}
});
