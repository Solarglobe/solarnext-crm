import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CALC_ENGINE_VERSION } from '../../services/calc/calc.constants.js';
import { quoteFingerprint } from '../../services/calculationFingerprint.service.js';

let sourceHash, quoteHash, calculations, mutations, statements, auditFailure, changeDuringCalculation;
const oldData={scenarios_v2:[{id:'BASE',finance:{economie_total:-123}}],scenarios_computed_at:'2025-01-01'};
const source=()=>({input_fingerprint:sourceHash,quote_fingerprint:quoteHash,
  inputs:{quote:{},meter:{annual:1955}},detected_grid_phase:null});
const query=async(sql,values=[])=>{
  statements.push(sql);
  if(sql.startsWith('UPDATE')){mutations.push({sql,values});return {rows:[],rowCount:1};}
  if(sql.includes('SELECT lead_id FROM studies'))return {rows:[{lead_id:'lead'}]};
  if(sql.includes('SELECT data_json'))return {rows:[{data_json:{...structuredClone(oldData),...(sql.includes('FOR UPDATE')?{user_note:'edited during calculation'}:{})},is_locked:false}]};
  if(sql.includes('SELECT id, is_locked, version_number'))return {rows:[{id:'version',version_number:1,is_locked:false}]};
  return {rows:[],rowCount:0};
};
mock.module('../../config/db.js',{namedExports:{pool:{query,connect:async()=>({query,release(){}})}}});
mock.module('../../services/solarnextPayloadBuilder.service.js',{namedExports:{
  resolveStudyVersionMeterContext:async()=>({version:{id:'version',is_locked:false},energyLead:{},meterRow:null,resolvedSelectedMeterId:null}),
  buildSolarNextPayload:async()=>({finance_input:{capex_ttc:14960}}),
}});
mock.module('../../services/studyCalculationFreshness.service.js',{namedExports:{readStudyCalculationInputs:async()=>source()}});
mock.module('../../controllers/calc.controller.js',{namedExports:{calculateSmartpitch:async(_req,res)=>{
  calculations++;if(changeDuringCalculation)sourceHash='changed';
  res.json({meta:{version:CALC_ENGINE_VERSION},scenarios_v2:[{id:'BASE',finance:{economie_total:100}}]});
}}});
mock.module('../../services/financialScenarios.service.js',{namedExports:{upsertFinancialScenariosForVersion:async()=>{if(auditFailure)throw Error('write failed');}}});
mock.module('../../services/audit/auditLog.service.js',{namedExports:{logAuditEvent:async()=>{}}});
const {runStudyCalc}=await import('../../controllers/studyCalc.controller.js');
function setup(){sourceHash='original';quoteHash=quoteFingerprint({});calculations=0;mutations=[];statements=[];auditFailure=false;changeDuringCalculation=false;
  const captured={code:200,body:null};const res={status(code){captured.code=code;return this;},json(body){captured.body=body;return this;}};
  return {req:{user:{organizationId:'org'},params:{studyId:'study',versionId:'1'},body:{expected_quote_fingerprint:quoteFingerprint({})}},res,captured};
}
test('a saved quote changed before validation never starts the engine',async()=>{
  const t=setup();quoteHash='new quote';await runStudyCalc(t.req,t.res);
  assert.equal(t.captured.code,409);assert.equal(t.captured.body.error,'QUOTE_REVISION_CHANGED');
  assert.equal(calculations,0);assert.equal(mutations.length,0);
});
test('input changed during calculation returns conflict without persisting or success',async()=>{
  const t=setup();changeDuringCalculation=true;await runStudyCalc(t.req,t.res);
  assert.equal(t.captured.code,409);assert.equal(t.captured.body.error,'CALCULATION_INPUTS_CHANGED');
  assert.equal(calculations,1);assert.equal(mutations.length,0);
});
test('successful calculation persists the exact revision and archives historical values',async()=>{
  const t=setup();await runStudyCalc(t.req,t.res);assert.equal(t.captured.code,200);
  const stored=JSON.parse(mutations[0].values[0]);
  assert.equal(stored.calculation_trace.saved_quote_fingerprint,quoteFingerprint({}));
  assert.equal(stored.calculation_trace.input_fingerprint,'original');
  assert.equal(stored.user_note,'edited during calculation','Concurrent unrelated data must not be overwritten');
  assert.deepEqual(stored.calculation_history[0].scenarios,oldData.scenarios_v2);
  assert.ok(statements.includes('COMMIT'));assert.equal(t.captured.body.ok,true);
});
test('financial persistence failure rolls back the calculation and does not acknowledge success',async()=>{
  const t=setup();auditFailure=true;await runStudyCalc(t.req,t.res);
  assert.equal(t.captured.code,500);assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.filter(sql=>sql==='COMMIT').length,1,'Only the read snapshot transaction was committed');
  assert.notEqual(t.captured.body.ok,true);
});
