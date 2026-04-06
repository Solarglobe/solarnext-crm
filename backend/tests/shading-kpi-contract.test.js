/**
 * Anti-dérive sémantique KPI shading — docs/shading-kpi-contract.md
 * Enchaîné par : npm run test:shading:lock
 */

import assert from "assert";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";
import { getOfficialGlobalShadingLossPct } from "../services/shading/officialShadingTruth.js";
import { computeWeightedShadingCombinedPct } from "../services/shading/weightedShadingKpi.js";

const SQ = {
  score: 0.85,
  grade: "B",
  inputs: { near: 3, far: 5, resolution_m: 30, coveragePct: 1 },
};

function test1_officialPathsOnNormalizedV2() {
  const raw = {
    near: { totalLossPct: 3 },
    far: {
      totalLossPct: 5,
      source: "RELIEF_ONLY",
      algorithm: "LEGACY",
      radius_m: 500,
      step_deg: 2,
      resolution_m: 30,
      confidenceScore: 0.5,
      confidenceLevel: "LOW",
      confidenceBreakdown: {},
      dataCoverage: { ratio: 1, effectiveRadiusMeters: 500, gridResolutionMeters: 30, provider: "RELIEF_ONLY" },
    },
    combined: { totalLossPct: 7.85 },
    totalLossPct: 7.85,
    nearLossPct: 3,
    farLossPct: 5,
    shadingQuality: SQ,
    perPanel: [],
  };
  const n = normalizeCalpinageShading(raw, {});
  assert.strictEqual(typeof n.near.totalLossPct, "number", "near.totalLossPct number");
  assert.strictEqual(typeof n.far.totalLossPct, "number", "far.totalLossPct number");
  assert.strictEqual(typeof n.combined.totalLossPct, "number", "combined.totalLossPct number");
  assert.strictEqual(n.totalLossPct, n.combined.totalLossPct, "racine = miroir combined");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(n, "nearLossPct"),
    false,
    "V2 normalisé : pas de nearLossPct racine (lecture = nested)"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(n, "farLossPct"),
    false,
    "V2 normalisé : pas de farLossPct racine"
  );
}

function test2_displayTruthIsCombinedNotSumOfComponents() {
  const n = normalizeCalpinageShading(
    {
      near: { totalLossPct: 3 },
      far: {
        totalLossPct: 5,
        source: "RELIEF_ONLY",
        algorithm: "LEGACY",
        radius_m: 500,
        step_deg: 2,
        resolution_m: 30,
        confidenceScore: 0.5,
        confidenceLevel: "LOW",
        confidenceBreakdown: {},
        dataCoverage: { ratio: 1, effectiveRadiusMeters: 500, gridResolutionMeters: 30, provider: "RELIEF_ONLY" },
      },
      combined: { totalLossPct: 99 },
      totalLossPct: 99,
      shadingQuality: SQ,
      perPanel: [],
    },
    {}
  );
  const official = getOfficialGlobalShadingLossPct(n);
  assert.strictEqual(official, 99, "vérité affichée/export = combined.totalLossPct, pas recomposition near+far");
}

function test2b_officialNearDoesNotOverrideCombined() {
  const n = normalizeCalpinageShading(
    {
      near: {
        totalLossPct: 10,
        official: { engine: "legacy_polygon", officialLossPct: 10, fallbackTriggered: false },
      },
      far: {
        totalLossPct: 2,
        source: "RELIEF_ONLY",
        algorithm: "LEGACY",
        radius_m: 500,
        step_deg: 2,
        resolution_m: 30,
        confidenceScore: 0.5,
        confidenceLevel: "LOW",
        confidenceBreakdown: {},
        dataCoverage: { ratio: 1, effectiveRadiusMeters: 500, gridResolutionMeters: 30, provider: "RELIEF_ONLY" },
      },
      combined: { totalLossPct: 11.5 },
      totalLossPct: 11.5,
      shadingQuality: SQ,
      perPanel: [],
    },
    {}
  );
  assert.strictEqual(getOfficialGlobalShadingLossPct(n), 11.5, "officialNear nested : KPI global reste combined");
  assert(n.near.official, "near.official présent = métadonnée technique");
}

function test3_weightedKpiIsSeparateAggregatorNotEngineOutput() {
  assert.strictEqual(computeWeightedShadingCombinedPct(null), null);
  assert.strictEqual(computeWeightedShadingCombinedPct([]), null);
  const w = computeWeightedShadingCombinedPct([
    { panelCount: 10, shadingCombinedPct: 4 },
    { panelCount: 10, shadingCombinedPct: 8 },
  ]);
  assert.strictEqual(w, 6, "pondération modules : KPI étude multi-pan, pas confondre avec near.totalLossPct seul");
}

function test3b_gpsBlockYieldsNullOfficial() {
  const n = normalizeCalpinageShading(
    {
      near: { totalLossPct: 5 },
      far: {
        source: "UNAVAILABLE_NO_GPS",
        totalLossPct: null,
        farHorizonKind: "UNAVAILABLE",
        algorithm: "LEGACY",
        radius_m: null,
        step_deg: null,
        resolution_m: 0,
        confidenceScore: 0,
        confidenceLevel: "LOW",
        confidenceBreakdown: {},
        dataCoverage: { ratio: 0, effectiveRadiusMeters: 0, gridResolutionMeters: 0, provider: "UNAVAILABLE_NO_GPS" },
      },
      combined: { totalLossPct: 5 },
      totalLossPct: 5,
      shadingQuality: { ...SQ, blockingReason: "missing_gps" },
      perPanel: [],
    },
    {}
  );
  assert.strictEqual(getOfficialGlobalShadingLossPct(n), null, "GPS manquant : pas de KPI global officiel (null)");
}

let failed = 0;
function run(name, fn) {
  try {
    fn();
    console.log("✅ kpi-contract: " + name);
  } catch (e) {
    failed++;
    console.error("❌ kpi-contract: " + name, e.message);
  }
}

run("TEST1 chemins officiels V2 (sans legacy plat racine)", test1_officialPathsOnNormalizedV2);
run("TEST2 vérité = combined (pas near+far)", test2_displayTruthIsCombinedNotSumOfComponents);
run("TEST2b officialNear ne remplace pas combined", test2b_officialNearDoesNotOverrideCombined);
run("TEST3 weighted KPI = agrégat pans (sémantique distincte)", test3_weightedKpiIsSeparateAggregatorNotEngineOutput);
run("TEST3b GPS bloqué → official null", test3b_gpsBlockYieldsNullOfficial);

if (failed > 0) {
  console.error("\n--- shading-kpi-contract FAILED: " + failed + " ---\n");
  process.exit(1);
}
console.log("\n--- shading-kpi-contract OK ---\n");
