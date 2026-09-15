import { createHash } from "node:crypto";

export const SHADING_MODEL_VERSION = "SHADING_ASSESSMENT_2026_09_15_V2";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

// Results embedded by the exporter are outputs, never geometric inputs.
function geometryInputs(value) {
  if (Array.isArray(value)) return value.map(geometryInputs);
  if (!value || typeof value !== 'object') return value;
  const outputs = new Set(['image', 'imageData', 'backgroundImage', 'satelliteImage', 'layout_snapshot', 'screenshot', 'thumbnail', 'imageUrl', 'imageBase64', 'background', 'viewport', 'zoom', 'selected', 'selectedId', 'updatedAt', 'createdAt', 'historicalResult', 'shading', 'shadingNormalized', 'shadingSummary', 'shadingLossPct', 'shadingNearPct', 'shadingFarPct', 'shadingCombinedPct', 'shading_near_pct', 'shading_far_pct', 'shading_combined_pct', 'nearLossPct', 'farLossPct', 'totalLossPct', 'monthlyFactors', 'computedAt']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !outputs.has(key)).map(([key, v]) => [key, geometryInputs(v)]));
}

/** A roof/panel/obstacle/scale/GPS edit must invalidate the result, including old engines. */
export function computeShadingInputFingerprint(params = {}) {
  const g = params.geometry || {};
  const gps = g.roofState?.gps ?? g.roof?.gps ?? g.validatedRoofData?.roofState?.gps ?? g.gps ?? {};
  const input = {
    modelVersion: SHADING_MODEL_VERSION,
    geometryContractVersion: g.geometryContractVersion ?? null,
    verticalReference: g.verticalReference ?? null,
    lat: params.lat ?? gps.lat ?? null,
    lon: params.lon ?? gps.lon ?? null,
    roof: g.roof ?? null,
    roofState: g.roofState ? { gps: g.roofState.gps, scale: g.roofState.scale, roof: g.roofState.roof, north: g.roofState.north, pans: g.roofState.pans, obstacles: g.roofState.obstacles, localObstacleSurvey: g.roofState.localObstacleSurvey } : null,
    pans: g.pans ?? null,
    validatedRoofData: g.validatedRoofData ?? null,
    frozenBlocks: g.frozenBlocks ?? null,
    panels: params.panels ?? g.panels ?? null,
    obstacles: params.obstacles ?? g.obstacles ?? null,
    shadowVolumes: g.shadowVolumes ?? null,
    roofExtensions: g.roofExtensions ?? null,
    roofModel: g.roofModel ?? g.roofModelV1 ?? null,
    geometry3d: g.geometry3d ?? null,
    panel: g.panel ?? null,
    rules: g.rules ?? null,
    scale: params.metersPerPixel ?? g.scale ?? null,
    north: g.north ?? null,
    localObstacleSurvey: params.localObstacleSurvey ?? g.localObstacleSurvey ?? null,
    irradianceSamples: params.irradianceSamples ?? g.irradianceSamples ?? null,
    horizonConfig: {
      hd: process.env.FAR_HORIZON_HD_ENABLED ?? "false",
      radius: process.env.FAR_HORIZON_HD_MAX_DIST_M ?? "4000",
      step: process.env.FAR_HORIZON_HD_STEP_DEG ?? "1",
      provider: process.env.DSM_PROVIDER_TYPE ?? process.env.DSM_PROVIDER ?? null,
      product: process.env.DSM_PRODUCT ?? null,
    },
  };
  return createHash("sha256").update(JSON.stringify(stable(geometryInputs(input)))).digest("hex");
}

export function markShadingStaleIfInputsChanged(shading, geometry) {
  if (!shading || typeof shading !== "object") return shading;
  const assessment = shading.assessment;
  if (assessment?.modelVersion === SHADING_MODEL_VERSION &&
      (assessment.geometryFingerprint ?? assessment.inputFingerprint) === computeShadingInputFingerprint({ geometry })) return shading;
  return {
    ...shading,
    // One previous result only. Display/export consumers never traverse this trace.
    historicalResult: shading.historicalResult ?? { assessment: shading.assessment ?? null, near: shading.near ?? null, far: shading.far ?? null, combined: shading.combined ?? null, totalLossPct: shading.totalLossPct ?? null, perPanel: shading.perPanel ?? [], monthlyFactors: shading.monthlyFactors ?? null },
    needs_recompute: true,
    totalLossPct: null,
    near: { ...shading.near, status: "stale", totalLossPct: null },
    far: { ...shading.far, status: "stale", totalLossPct: null },
    combined: { ...shading.combined, status: "stale", totalLossPct: null },
    perPanel: [],
    monthlyFactors: null,
    monthlyKwhStats: null,
    annualLossKwh: null,
    assessment: { ...assessment, status: "stale", nearStatus: "stale", farStatus: "stale", reasons: ["inputs_or_model_changed"] },
  };
}

/** Energy, not hours: callers supply unrounded Wh for every panel/interval. */
export function aggregateShadingEnergy(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let baseline = 0, far = 0, combined = 0;
  const monthly = Array.from({ length: 12 }, () => ({ baselineWh: 0, farWh: 0, combinedWh: 0 }));
  const periods = { morning: 0, midday: 0, afternoon: 0 };
  for (const row of rows) {
    const { baselineWh: b, farWh: f, combinedWh: c } = row;
    if (![b, f, c].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) || c > f + 1e-8 || f > b + 1e-8) return null;
    const date = new Date(row.timestamp);
    if (!Number.isFinite(date.getTime())) return null;
    baseline += b; far += f; combined += c;
    const m = monthly[date.getUTCMonth()];
    m.baselineWh += b; m.farWh += f; m.combinedWh += c;
    if (!Object.hasOwn(periods, row.period)) return null;
    periods[row.period] += b - c;
  }
  if (baseline <= 0) return null;
  const loss = baseline - combined;
  return {
    farLossPct: 100 * (1 - far / baseline),
    nearLossPct: far > 0 ? 100 * (1 - combined / far) : null,
    totalLossPct: 100 * (1 - combined / baseline),
    baselineWh: baseline,
    lossWh: loss,
    monthlyFactors: monthly.map((m, i) => ({ month: i + 1,
      farLossFraction: m.baselineWh > 0 ? 1 - m.farWh / m.baselineWh : null,
      nearLossFraction: m.farWh > 0 ? 1 - m.combinedWh / m.farWh : null,
      combinedLossFraction: m.baselineWh > 0 ? 1 - m.combinedWh / m.baselineWh : null,
      baselineWh: m.baselineWh, lossWh: m.baselineWh - m.combinedWh,
    })),
    distribution: loss > 1e-10 ? {
      monthly: monthly.map((m) => 100 * (m.baselineWh - m.combinedWh) / loss),
      periods: Object.fromEntries(Object.entries(periods).map(([k, v]) => [k, 100 * v / loss])),
    } : null,
  };
}

/** Complete 360 degree profile, at most 10 degrees between measured samples. */
export function isCompleteHorizonMask(mask) {
  if (!Array.isArray(mask) || mask.length < 36 || mask.some(p => !p || !Number.isFinite(p.az) || p.az < -180 || p.az > 360 || !Number.isFinite(p.elev) || p.elev < 0 || p.elev > 90)) return false;
  const az = [...new Set(mask.map(p => (p.az + 360) % 360))].sort((a,b) => a-b);
  return az.length >= 36 && az.every((a,i) => (i === az.length-1 ? az[0]+360 : az[i+1])-a <= 10.000001);
}
