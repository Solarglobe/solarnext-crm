import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { calculationConflict } from '../../services/calculationFingerprint.service.js';
let stale, mutateWhileRendering, rendered, saved, checks;
const snapshot={scenario_type:'BASE',input_fingerprint:'current',economic_snapshot:{
  price_eur_kwh:.2,elec_growth_pct:5,horizon_years:25,oa_rate_eur_kwh:0,prime_eur:0,capex_ttc:14960,reste_a_charge_eur:14960}};
mock.module('../../config/db.js',{namedExports:{pool:{query:async()=>{throw Error('Unexpected database access');}}}});
mock.module('../../routes/studies/service.js',{namedExports:{getVersionById:async()=>({study_id:'study',data:{},selected_scenario_id:'BASE',selected_scenario_snapshot:snapshot})}});
mock.module('../../services/studyCalculationFreshness.service.js',{namedExports:{assertStudyCalculationCurrent:async()=>{checks++;if(stale)throw calculationConflict();}}});
mock.module('../../services/studyExportValidation.service.js',{namedExports:{assertStudySnapshotExportable:()=>({ok:true})}});
mock.module('../../services/pdfGeneration.service.js',{namedExports:{getRendererUrl:()=> 'http://127.0.0.1/local-fixture',generatePdfFromRendererUrl:async()=>{
  rendered++;if(mutateWhileRendering)stale=true;return Buffer.from('%PDF-test');
}}});
mock.module('../../services/pdfRenderToken.service.js',{namedExports:{createPdfRenderToken:()=> 'local-test-token'}});
mock.module('../../services/pdfEphemeralSnapshot.service.js',{namedExports:{putEphemeralSnapshot:()=> 'local-snapshot'}});
mock.module('../../services/documents.service.js',{namedExports:{saveStudyPdfDocument:async()=>{saved++;return {id:'doc',file_name:'local.pdf'};}}});
mock.module('../../services/legalCgvPdfMerge.service.js',{namedExports:{mergeOrganizationCgvPdfAppend:async data=>data}});
const {generatePdfForVersion}=await import('../../controllers/pdfGeneration.controller.js');
const params={studyId:'study',versionId:'version',organizationId:'org'};
function reset(){stale=false;mutateWhileRendering=false;rendered=0;saved=0;checks=0;}
test('stale calculation cannot start a client PDF export',async()=>{
  reset();stale=true;await assert.rejects(generatePdfForVersion(params),{code:'CALCULATION_INPUTS_CHANGED'});
  assert.equal(rendered,0);assert.equal(saved,0);
});
test('input modified while PDF renders cannot create a stale document',async()=>{
  reset();mutateWhileRendering=true;await assert.rejects(generatePdfForVersion(params),{code:'CALCULATION_INPUTS_CHANGED'});
  assert.equal(rendered,1);assert.equal(checks,2);assert.equal(saved,0);
});
test('current calculation is checked before rendering and again before saving',async()=>{
  reset();const result=await generatePdfForVersion(params);
  assert.equal(result.id,'doc');assert.equal(checks,2);assert.equal(rendered,1);assert.equal(saved,1);
});
