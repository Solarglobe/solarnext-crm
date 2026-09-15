import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { computeCalpinageShading } from '../services/shading/calpinageShading.service.js';
import { buildOfficialShadingFromComputeResult } from '../services/calpinage/officialShading.service.js';
import { computeShadingInputFingerprint, markShadingStaleIfInputsChanged, SHADING_MODEL_VERSION, aggregateShadingEnergy } from '../services/shading/shadingAssessment.service.js';
import { getNormalizedShadingFromGeometry } from '../services/calpinage/calpinageShadingLegacyAdapter.js';
import { getOrComputeHorizonMask, tileKey, __testClearCache } from '../services/horizon/horizonMaskCache.js';
import { getShadingAssessment, getShadingComponentLossPct } from '../../shared/shading/shadingAssessment.js';
const require = createRequire(import.meta.url);
const { computeSunPosition } = require('../../shared/shading/solarPosition.cjs');

const rect = (x, y, w = 20, h = 20) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const panel = { id: 'p1', polygonPx: rect(90, 90) };
const clear = { source: 'IGN_GEOPLATEFORME', mask: Array.from({ length: 360 }, (_, az) => ({ az, elev: 0 })) };
const params = { lat: 49.17144, lon: 2.375402, panels: [panel], obstacles: [], metersPerPixel: 0.1,
  localObstacleSurvey: { status: 'complete', source: 'manual_survey' }, options: { __testHorizonMaskOverride: clear, includePerPanelBreakdown: true } };
const irradiation = Array.from({ length: 8760 }, (_, hour) => {
  const date = new Date(Date.UTC(2026, 0, 1, hour));
  const sun = computeSunPosition(date, params.lat, params.lon);
  return { timestamp: date.toISOString(), directWh: Math.max(0, Math.sin(sun.elevationDeg * Math.PI / 180)) * 100, diffuseWh: 0, reflectedWh: 0 };
});

test('surveyed empty scene and clear horizon calculate a real zero', async () => {
  const raw = await computeCalpinageShading(params);
  const result = buildOfficialShadingFromComputeResult(raw, true, true);
  assert.equal(result.assessment.status, 'computed');
  assert.equal(result.combined.totalLossPct, 0);
});

test('empty default obstacle array and absent survey never certify local zero', async () => {
  const raw = await computeCalpinageShading({ ...params, localObstacleSurvey: undefined });
  assert.equal(raw.assessment.status, 'insufficient_data');
  assert.equal(raw.nearLossPct, null);
  assert.equal(raw.totalLossPct, null);
});

test('empty or invalid provider response is an error even with stored zero', async () => {
  for (const mask of [[], [{ az: 0, elev: NaN }]]) {
    const raw = await computeCalpinageShading({ ...params, options: { __testHorizonMaskOverride: { mask } } });
    assert.equal(raw.assessment.status, 'error');
    assert.equal(raw.totalLossPct, null);
  }
});

test('annual energy reference: high south, east morning, west afternoon, limited north', async () => {
  const obstacles = {
    south: { id: 'south', polygonPx: rect(70, 140, 60, 10), heightM: 4 },
    north: { id: 'north', polygonPx: rect(70, 50, 60, 10), heightM: 4 },
    east: { id: 'east', polygonPx: rect(140, 70, 10, 60), heightM: 4 },
    west: { id: 'west', polygonPx: rect(50, 70, 10, 60), heightM: 4 },
  };
  const results = {};
  for (const [direction, obstacle] of Object.entries(obstacles)) {
    const raw = await computeCalpinageShading({ ...params, obstacles: [obstacle], irradianceSamples: irradiation });
    assert.equal(raw.assessment.status, 'computed', JSON.stringify(raw.assessment));
    results[direction] = raw;
    if (raw.totalLossPct > 1e-10) {
      assert.ok(Math.abs(raw.distribution.monthly.reduce((a, b) => a + b, 0) - 100) < 1e-6);
      assert.ok(Math.abs(Object.values(raw.distribution.periods).reduce((a, b) => a + b, 0) - 100) < 1e-6);
    } else assert.equal(raw.distribution, null);
  }
  assert.ok(results.south.totalLossPct > 5);
  assert.ok(results.north.totalLossPct < results.south.totalLossPct);
  assert.ok(results.north.totalLossPct < 10);
  assert.ok(results.east.distribution.periods.morning > 70);
  assert.ok(results.west.distribution.periods.afternoon > 70);
  const reversed = await computeCalpinageShading({ ...params, obstacles: [{ ...obstacles.south, polygonPx: [...obstacles.south.polygonPx].reverse() }], irradianceSamples: irradiation });
  assert.equal(reversed.totalLossPct, results.south.totalLossPct);
});

test('hours are not energy and incomplete components do not establish annual loss', async () => {
  const rows = [
    { timestamp: '2026-01-01T08:00Z', baselineWh: 10, farWh: 10, combinedWh: 0, period: 'morning' },
    { timestamp: '2026-01-01T12:00Z', baselineWh: 990, farWh: 990, combinedWh: 990, period: 'midday' },
  ];
  assert.ok(Math.abs(aggregateShadingEnergy(rows).totalLossPct - 1) < 1e-9);
  assert.equal(aggregateShadingEnergy([{ ...rows[0], baselineWh: null }]), null);
  const missing = await computeCalpinageShading({ ...params, obstacles: [{ polygonPx: rect(70, 140, 60, 10), heightM: 4 }] });
  assert.equal(missing.totalLossPct, null);
  assert.ok(missing.diagnostics.geometricProxy.totalLossPct > 5);
  const partial = await computeCalpinageShading({ ...params, irradianceSamples: irradiation.slice(0, 24) });
  assert.equal(partial.totalLossPct, null);
});

test('roof, panel, obstacle and model changes invalidate persisted assessment', () => {
  const geometry = { roofState: { gps: { lat: 49, lon: 2 }, scale: { metersPerPixel: 0.1 } }, pans: [{ tilt: 0 }], frozenBlocks: [{ panels: [panel] }], obstacles: [] };
  const shading = { assessment: { status: 'computed', modelVersion: SHADING_MODEL_VERSION, inputFingerprint: computeShadingInputFingerprint({ geometry }) } };
  assert.equal(markShadingStaleIfInputsChanged(shading, geometry), shading);
  for (const mutate of [g => g.pans[0].tilt = 30, g => g.frozenBlocks[0].panels[0].polygonPx[0].x++, g => g.obstacles.push({ heightM: 10 }), g => g.roofState.scale.metersPerPixel = 0.2]) {
    const changed = structuredClone(geometry); mutate(changed);
    assert.equal(markShadingStaleIfInputsChanged(shading, changed).assessment.status, 'stale');
  }
  assert.equal(markShadingStaleIfInputsChanged({ totalLossPct: 0 }, geometry).assessment.status, 'stale');
});

test('horizon cache distinguishes nearby points and never caches an empty successful response', async () => {
  __testClearCache();
  assert.notEqual(tileKey(49.171, 2.375, 500, 2, 0.01), tileKey(49.172, 2.375, 500, 2, 0.01));
  await assert.rejects(getOrComputeHorizonMask({ lat: 49.171, lon: 2.375 }, () => ({ mask: [] })), /HORIZON_INVALID/);
  const retry = await getOrComputeHorizonMask({ lat: 49.171, lon: 2.375 }, () => clear);
  assert.equal(retry.cached, false);
});

test('SGS-2026-0198 regression: ten modules and persisted zero without local data remain unassessed', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/shading-lamorlaye-0198.json', import.meta.url)));
  const { shading } = getNormalizedShadingFromGeometry(fixture.geometry);
  assert.equal(getShadingAssessment(shading).status, 'stale');
  assert.equal(getShadingComponentLossPct(shading), null);
  const recomputed = await computeCalpinageShading({ lat: fixture.lat, lon: fixture.lon, geometry: fixture.geometry, options: params.options });
  assert.equal(recomputed.nearLossPct, null);
  assert.equal(recomputed.totalLossPct, null);
  assert.equal(recomputed.assessment.status, 'insufficient_data');
  assert.ok(recomputed.assessment.reasons.includes('commercial_geometry_invalid'));
});

test('solar position matches 36 independent NREL SPA/pvlib reference points within 0.01 degrees', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/solar-position-reference.json', import.meta.url)));
  for (const row of reference.cases) {
    const actual = computeSunPosition(new Date(row.date), row.lat, row.lon);
    assert.ok(Math.abs(((actual.azimuthDeg - row.azimuthDeg + 540) % 360) - 180) < 0.01, row.date);
    assert.ok(Math.abs(actual.elevationDeg - row.elevationDeg) < 0.01, row.date);
  }
  assert.equal(computeSunPosition(new Date(), 120, 2), null);
  assert.equal(computeSunPosition(new Date('bad'), 49, 2), null);
  assert.deepEqual(computeSunPosition(new Date('2026-06-21T12:00:00+02:00'), 49, 2), computeSunPosition(new Date('2026-06-21T10:00:00Z'), 49, 2));
});

test('side faces intercept a ray, zero height does not, raising the obstacle cannot remove shade', () => {
  const core = require('../../shared/shading/nearShadingCore.cjs');
  const base = {panelPoint:{x:0,y:0},obstacle:{polygonPx:rect(2,-1,1,2),heightM:10},sunDir:{dx:1,dy:0,dz:1},metersPerPixel:1};
  // At height 10 the ray is x=10, outside the footprint, but crosses its side at x=2,z=2.
  assert.equal(core.isPanelPointShadedByObstacle(base),true);
  for(const heightM of [0,1]) assert.equal(core.isPanelPointShadedByObstacle({...base,obstacle:{...base.obstacle,heightM}}),false);
  for(const heightM of [3,10,20]) assert.equal(core.isPanelPointShadedByObstacle({...base,obstacle:{...base.obstacle,heightM}}),true);
});
test('incomplete horizon coverage, missing obstacle height and sloped planes do not certify zero', async()=>{
  const short = await computeCalpinageShading({...params,options:{__testHorizonMaskOverride:{mask:clear.mask.slice(0,180)}}});
  assert.equal(short.assessment.status,'error');
  const missing = await computeCalpinageShading({...params,obstacles:[{polygonPx:rect(50,50)}]});
  assert.equal(missing.totalLossPct,null);
  const sloped = await computeCalpinageShading({...params,geometry:{pans:[{tiltDeg:30,azimuthDeg:180}]},obstacles:[{polygonPx:rect(70,140,60,10),heightM:4}],irradianceSamples:irradiation});
  assert.equal(sloped.totalLossPct,null);
});
test('computed result survives export outputs and read, then becomes stale after panel edit',async()=>{
 const geometry={roofState:{gps:{lat:params.lat,lon:params.lon}},scale:{metersPerPixel:.1},frozenBlocks:[{panels:[panel]}],localObstacleSurvey:params.localObstacleSurvey};
 const raw=await computeCalpinageShading({...params,panels:undefined,geometry});
 geometry.shading=buildOfficialShadingFromComputeResult(raw,true,true);
 const first=getNormalizedShadingFromGeometry(geometry).shading;
 assert.equal(first.assessment.status,'computed');assert.equal(first.combined.totalLossPct,0);
 geometry.shading=first;geometry.frozenBlocks[0].panels[0].shadingLossPct=0;
 assert.equal(getNormalizedShadingFromGeometry(geometry).shading.assessment.status,'computed');
 geometry.frozenBlocks[0].panels[0].polygonPx[0].x++;
 assert.equal(getNormalizedShadingFromGeometry(geometry).shading.assessment.status,'stale');
});

test('PVGIS azimuth is converted from south to north; corrupt heights and network failures throw', async()=>{
 const {computeMask}=await import('../services/horizon/providers/pvgisHorizonProvider.js');
 const savedFetch=globalThis.fetch;
 try {
  globalThis.fetch=async()=>({ok:true,json:async()=>({outputs:{horizon_profile:[{A:-180,H_hor:1},{A:-90,H_hor:2},{A:0,H_hor:30},{A:90,H_hor:4}]}})});
  const result=await computeMask({lat:49,lon:2});assert.deepEqual(result.mask,[{az:0,elev:1},{az:90,elev:2},{az:180,elev:30},{az:270,elev:4}]);
  for(const H_hor of [null,'bad',-1,91]) {
   globalThis.fetch=async()=>({ok:true,json:async()=>({outputs:{horizon_profile:[{A:0,H_hor}]}})});
   await assert.rejects(computeMask({lat:49,lon:2}),/invalid horizon/);
  }
  globalThis.fetch=async()=>{throw new Error('timeout');};
  await assert.rejects(computeMask({lat:49,lon:2}),/timeout/);
 } finally {globalThis.fetch=savedFetch;}
});

test('degenerate panel and missing metric scale cannot certify a zero',async()=>{
 const degenerate=await computeCalpinageShading({...params,panels:[{polygonPx:[{x:0,y:0},{x:1,y:0},{x:2,y:0}]}]});
 assert.equal(degenerate.totalLossPct,null);
 const noScale=await computeCalpinageShading({...params,metersPerPixel:undefined});
 assert.equal(noScale.totalLossPct,null);
});
