import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCalculationConfidenceFromCalc,isPdfBlockedByConfidence} from '../services/calculationConfidence.service.js';
import {migrateCalculationConfidence} from '../services/confidenceMigration.service.js';
import {shadingExportBlockers} from '../services/shading/shadingExportGuard.service.js';
import {validateStudyScenarioForExport,assertStudySnapshotExportable} from '../services/studyExportValidation.service.js';
import {mapScenarioToV2} from '../services/scenarioV2Mapper.service.js';

const audit={blocking_warnings:['SHADING_GEOMETRY_BLOCK_PDF'],non_blocking_warnings:['OBSTACLE_HEIGHT_MISSING','SHADING_PAN_MISMATCH'],flags:{geometryWarnings:['OBSTACLE_HEIGHT_MISSING'],shadingPanMismatch:true,shadingPanMismatchAbsDiff:6.5}};
const context={meta:{shading_commercial_audit:audit},form:{installation:{shading:{}},economics:{}},settings:{economics:{}},pv:{source:'PVGIS'}};

test('synthetic missing obstacle height remains a hard block through confidence and migration',()=>{
  const confidence=buildCalculationConfidenceFromCalc(context,{});
  assert.equal(confidence.level,'BLOCKED');
  assert.deepEqual(confidence.blocking_warnings,['SHADING_GEOMETRY_INPUT_INCOMPLETE']);
  assert.equal(confidence.assumptions.shading_pan_mismatch_abs_diff,6.5);
  assert.equal(isPdfBlockedByConfidence(confidence),true);
  const migrated=migrateCalculationConfidence(confidence);
  assert.equal(isPdfBlockedByConfidence(migrated),true);
  assert.equal(migrated.level,'BLOCKED');
  assert.deepEqual(migrated.blocking_warnings,['SHADING_GEOMETRY_INPUT_INCOMPLETE']);
});

test('a previously downgraded legacy confidence is blocked from factual missing geometry',()=>{
  const confidence={level:'LOW',blocking_warnings:[],non_blocking_warnings:['SHADING_GEOMETRY_BLOCK_PDF'],assumptions:{shading_geometry_strict_warnings:['OBSTACLE_HEIGHT_MISSING']}};
  assert.equal(isPdfBlockedByConfidence(confidence),true);
  const restored=migrateCalculationConfidence(confidence);
  assert.equal(restored.level,'BLOCKED');
  assert.ok(restored.blocking_warnings.includes('SHADING_GEOMETRY_INPUT_INCOMPLETE'));
  assert.throws(()=>assertStudySnapshotExportable({calculation_confidence:confidence}),error=>error.code==='PDF_BLOCKED_CALCULATION_CONFIDENCE');
});

test('generic legacy warnings and unavailable horizon alone do not arbitrarily block old studies',()=>{
  const confidence={level:'BLOCKED',blocking_warnings:['SHADING_GEOMETRY_BLOCK_PDF','SHADING_PAN_MISMATCH_BLOCK_PDF','FAR_SHADING_UNAVAILABLE_BLOCK_PDF','PVGIS_FALLBACK_USED'],non_blocking_warnings:[],assumptions:{far_shading_unavailable:true,shading_geometry_strict_warnings:['UNCLASSIFIED_OLD_WARNING']}};
  assert.equal(isPdfBlockedByConfidence(confidence),false);
  const migrated=migrateCalculationConfidence(confidence);
  assert.deepEqual(migrated.blocking_warnings,[]);
  assert.equal(isPdfBlockedByConfidence(migrated),false);
});

test('numeric mismatch uses the pre-existing eight-point threshold, including values immediately below the threshold',()=>{
  assert.deepEqual(shadingExportBlockers({audit:{flags:{shadingPanMismatchAbsDiff:6.5}}}),[]);
  assert.deepEqual(shadingExportBlockers({audit:{flags:{shadingPanMismatchAbsDiff:7.999}}}),[]);
  assert.equal(shadingExportBlockers({audit:{flags:{shadingPanMismatchAbsDiff:8}}})[0].code,'SHADING_PAN_VALUES_INCONSISTENT');
  assert.equal(shadingExportBlockers({audit:{flags:{geometryWarnings:['SHADING_SCALE_MISSING']}}})[0].code,'SHADING_GEOMETRY_INPUT_INCOMPLETE');
});

test('scenario mapping freezes the shading facts and independent export validation checks them',()=>{
  const scenario=mapScenarioToV2({name:'BASE',prod_kwh:1000,conso_kwh:2000,auto_kwh:500,capex_ttc:5000},context);
  assert.deepEqual(scenario.shading.commercial_audit,audit);
  const result=validateStudyScenarioForExport(scenario,'BASE');
  assert.ok(result.errors.some(error=>error.startsWith('SHADING_GEOMETRY_INPUT_INCOMPLETE')));
});
