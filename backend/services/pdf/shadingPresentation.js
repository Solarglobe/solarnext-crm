import {
  getShadingAssessment,
  getShadingComponentLossPct,
  validShadingLossPct,
} from '../../../shared/shading/shadingAssessment.js';

const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function completeYear(rows, validRow) {
  return Array.isArray(rows) && rows.length === 12 &&
    new Set(rows.map(row => row?.month)).size === 12 &&
    rows.every(row => Number.isInteger(row?.month) && row.month >= 1 && row.month <= 12 && validRow(row));
}

/** Read-only projection shared by all server PDF renderers. Never fills missing measurements. */
export function presentShading(shading) {
  const assessment = getShadingAssessment(shading);
  const combinedLossPct = getShadingComponentLossPct(shading, 'combined');
  const computed = assessment.status === 'computed';
  const fraction = value => nonnegative(value) && value <= 1;
  const rawFactors = shading?.monthlyFactors;
  const factorsValid = computed && completeYear(rawFactors, row =>
    fraction(row.farLossFraction) && fraction(row.nearLossFraction) && fraction(row.combinedLossFraction));
  const factorsCoherent = factorsValid && (combinedLossPct === 0
    ? rawFactors.every(row => row.combinedLossFraction === 0)
    : rawFactors.some(row => row.combinedLossFraction > 0));
  const rawStats = shading?.monthlyKwhStats;
  const statsValid = computed && completeYear(rawStats, row =>
    ['productionNoShadingKwh', 'productionWithShadingKwh', 'kwhLoss'].every(key => nonnegative(row[key])) &&
    Math.abs(row.productionNoShadingKwh - row.productionWithShadingKwh - row.kwhLoss) <= 0.02 &&
    row.productionWithShadingKwh <= row.productionNoShadingKwh);
  const sum = key => rawStats.reduce((total, row) => total + row[key], 0);
  const reference = statsValid ? sum('productionNoShadingKwh') : null;
  const loss = statsValid ? sum('kwhLoss') : null;
  const statsCoherent = reference > 0 && Math.abs(loss / reference * 100 - combinedLossPct) <= 0.05;
  return {
    assessment,
    combinedLossPct,
    nearLossPct: getShadingComponentLossPct(shading, 'near'),
    farLossPct: getShadingComponentLossPct(shading, 'far'),
    monthlyFactors: factorsCoherent ? rawFactors : null,
    monthlyKwhStats: statsCoherent ? rawStats : null,
    prodNoShadingKwh: statsCoherent ? reference : null,
    prodWithShadingKwh: statsCoherent ? sum('productionWithShadingKwh') : null,
    annualLossKwh: statsCoherent ? loss : null,
    perPanel: computed && Array.isArray(shading?.perPanel)
      ? shading.perPanel.filter(row => validShadingLossPct(row?.lossPct) !== null) : [],
  };
}
