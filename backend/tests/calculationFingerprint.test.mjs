import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, quoteFingerprint, calculationFreshness, assertQuoteRevision,
  assertElectricalPhaseDecision, detectedGridPhase, preserveCalculationHistory } from '../services/calculationFingerprint.service.js';
import { CALC_ENGINE_VERSION } from '../services/calc/calc.constants.js';

test('canonical fingerprint preserves every nested input and ignores object key order', () => {
  assert.equal(fingerprint({b: {y: 2,x: 1}, a:[1,2]}), fingerprint({a:[1,2],b:{x:1,y:2}}));
  assert.notEqual(fingerprint({quote:{price:1}}), fingerprint({quote:{price:2}}));
  assert.notEqual(fingerprint({hours:[1,2]}), fingerprint({hours:[2,1]}));
  assert.equal(fingerprint({a:undefined,b:null}), fingerprint({b:null}));
  assert.notEqual(fingerprint({date:'2026-10-25T00:00:00Z'}),fingerprint({date:'2026-10-25T01:00:00Z'}));
});

test('each source domain independently invalidates current results', () => {
  const original = {quote:{price:1},meter:{annual_bill:1955,subscription:null,kva:18,hp:.3,hc:.13},
    consumption:{provenance:'R65',hourly:[1,2]},pans:[{azimuth:90,tilt:30}],pvgis:{version:'5.3'},
    providers:{priority:'HC'},finance:{horizon:25},battery:{capacity:7},engine:CALC_ENGINE_VERSION};
  const data = {scenarios_engine_version:CALC_ENGINE_VERSION,calculation_trace:{input_fingerprint:fingerprint(original)}};
  assert.equal(calculationFreshness(data,fingerprint(original)).needs_recompute,false);
  for(const key of Object.keys(original)) {
    const modified=structuredClone(original);modified[key]={changed:true};
    assert.equal(calculationFreshness(data,fingerprint(modified)).needs_recompute,true,key);
  }
  assert.equal(calculationFreshness({},fingerprint(original)).stale_reason,'INPUT_FINGERPRINT_MISSING');
  assert.equal(calculationFreshness({...data,scenarios_engine_version:'old'},fingerprint(original)).stale_reason,'ENGINE_VERSION_CHANGED');
});

test('validate requires exactly the revision acknowledged by saving', () => {
  const saved=quoteFingerprint({total:14960,installer:{phase:'TRI'}});
  assert.doesNotThrow(()=>assertQuoteRevision(saved,saved));
  assert.throws(()=>assertQuoteRevision(null,saved),{code:'SAVED_QUOTE_REVISION_REQUIRED'});
  assert.throws(()=>assertQuoteRevision(saved,quoteFingerprint({total:14961})),{code:'QUOTE_REVISION_CHANGED'});
});

test('detected phase cannot silently impose quote or waive difference confirmation', () => {
  assert.equal(detectedGridPhase({grid_type:'mono',energy_profile:{engine:{phase_detection:'triphasé'}}}),'TRI');
  const config={installer_cost:{electrical_type:'MONO'}};
  assert.throws(()=>assertElectricalPhaseDecision(config,'TRI'),{code:'ELECTRICAL_PHASE_CONFIRMATION_REQUIRED'});
  assert.equal(config.installer_cost.electrical_type,'MONO');
  config.electrical_phase_decision={detected_phase:'TRI',retained_phase:'MONO',difference_confirmed:true};
  assert.doesNotThrow(()=>assertElectricalPhaseDecision(config,'TRI'));
  config.electrical_phase_decision.retained_phase='TRI';
  assert.throws(()=>assertElectricalPhaseDecision(config,'TRI'));
  assert.doesNotThrow(()=>assertElectricalPhaseDecision({installer_cost:{electrical_type:'TRI'}},'TRI'));
});

test('recalculation archives exact old results including legacy with no fingerprint', () => {
  const data={scenarios_v2:[{finance:{gain:-300}}],scenarios_computed_at:'2026-01-01',calculation_history:[]};
  const history=preserveCalculationHistory(data);
  assert.equal(history[0].input_fingerprint,null);
  assert.equal(history[0].scenarios[0].finance.gain,-300);
  assert.equal(data.calculation_history.length,0);
});
