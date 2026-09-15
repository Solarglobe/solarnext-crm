import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presentShading } from '../services/pdf/shadingPresentation.js';
import { buildPage2Content, buildDsmAnalysisHtml } from '../pdf/dsmAnalysisHtmlBuilder.js';
import { buildShadingReportHtml } from '../pdf/shadingReportHtmlBuilder.js';
import { mapSelectedScenarioSnapshotToPdfViewModel } from '../services/pdf/pdfViewModel.mapper.js';
import { deriveGeometryFromGeometryJson } from '../services/finalStudyJson.service.js';
import { mapScenarioToV2 } from '../services/scenarioV2Mapper.service.js';
import { formatShadingLossPct } from '../../shared/shading/shadingAssessment.js';

const makeShading = (status = 'computed', loss = 0) => ({
  assessment: { status, nearStatus: status, farStatus: status, reasons: [] },
  near: { status, totalLossPct: loss },
  far: { status, totalLossPct: 0 },
  combined: { status, totalLossPct: loss },
  shadingQuality: { grade: 'Excellent', score: 100 },
  monthlyFactors: [], monthlyKwhStats: [], annualLossKwh: 0,
});
const data = shading => ({ address: 'Site test', date: '15/09/2026', shading, installation: {}, geometry: { frozenBlocks: [] } });

for (const status of ['insufficient_data', 'error', 'stale', 'not_calculated']) {
  test(`PDF and mapper discard stale numeric zeros when ${status}`, () => {
    const shading = makeShading(status);
    for (const render of [buildPage2Content, buildDsmAnalysisHtml, buildShadingReportHtml]) {
      const html = render(data(shading));
      assert.ok(html.includes(formatShadingLossPct(null, status)));
      assert.doesNotMatch(html, /Excellent|>0[,.]0 %</);
    }
    const vm = mapSelectedScenarioSnapshotToPdfViewModel({ shading });
    assert.equal(vm.fullReport.p_shading.assessment.status, status);
    assert.equal(vm.fullReport.p_shading.combinedLossPct, null);
    assert.equal(vm.fullReport.p_shading.nearLossPct, null);
    assert.equal(vm.fullReport.p_shading.annualLossKwh, null);
  });
}

test('calculated zero and small positive losses remain distinguishable in every PDF', () => {
  for (const loss of [0, 0.0004]) {
    const shading = makeShading('computed', loss);
    for (const render of [buildPage2Content, buildDsmAnalysisHtml, buildShadingReportHtml]) {
      assert.ok(render(data(shading)).replaceAll('&lt;', '<').includes(formatShadingLossPct(loss)));
    }
    const vm = mapSelectedScenarioSnapshotToPdfViewModel({ shading });
    assert.equal(vm.fullReport.p_shading.combinedLossPct, loss);
  }
});

test('missing monthly values, empty arrays and zero-energy years cannot manufacture annual kWh', () => {
  const shading = makeShading();
  assert.equal(presentShading(shading).prodNoShadingKwh, null);
  shading.monthlyKwhStats = Array.from({ length: 12 }, (_, i) => ({ month: i + 1 }));
  shading.monthlyFactors = Array.from({ length: 12 }, (_, i) => ({ month: i + 1 }));
  assert.equal(presentShading(shading).monthlyKwhStats, null);
  assert.equal(presentShading(shading).monthlyFactors, null);
  shading.monthlyKwhStats = shading.monthlyKwhStats.map(row => ({ ...row, productionNoShadingKwh: 0, productionWithShadingKwh: 0, kwhLoss: 0 }));
  assert.equal(presentShading(shading).annualLossKwh, null);
});

test('monthly energy conservation and annual loss must agree before export', () => {
  const shading = makeShading('computed', 10);
  shading.monthlyKwhStats = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, productionNoShadingKwh: 100, productionWithShadingKwh: 90, kwhLoss: 10 }));
  assert.equal(presentShading(shading).annualLossKwh, 120);
  shading.monthlyKwhStats[0].kwhLoss = 0;
  assert.equal(presentShading(shading).monthlyKwhStats, null);
});

test('final geometry and scenario preserve assessment without fabricating compute timestamps', () => {
  const shading = makeShading('insufficient_data');
  const exported = deriveGeometryFromGeometryJson({ validatedRoofData: { pans: [] }, shading });
  assert.equal(exported.shading.near.totalLossPct, null);
  assert.equal(exported.shading.totalLossPct, null);
  assert.equal(exported.shading.assessment.status, 'insufficient_data');
  assert.equal(exported.shading.computedAt, null);
  const scenario = mapScenarioToV2({ name: 'BASE' }, { shading, form: { installation: {}, economics: {} }, settings: { economics: {} } });
  assert.deepEqual(scenario.shading.assessment, shading.assessment);
  assert.deepEqual(scenario.shading.near, shading.near);
});

test('PDF export uses the horizon belonging to the calculation, without a second provider request', () => {
  const source = readFileSync(new URL('../services/dsmAnalysisPdf.service.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getOrComputeHorizonMask|computeHorizonMaskAuto/);
  assert.match(source, /const horizonMask = shading.horizonMask/);
});
