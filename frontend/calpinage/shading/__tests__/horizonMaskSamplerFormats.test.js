/**
 * Formats masque horizon : compat sampler (mask, values, elevations legacy, array).
 * Régression : convertHorizonToMask → { azimuthStepDeg, elevations } doit être reconnu.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const {
  sampleHorizonElevationDeg,
  isSunBlockedByHorizonMaskSafe,
} = require("../horizonMaskSampler.js");
const { computeAnnualShadingLoss } = require("../shadingEngine.js");

test("sans masque : safe = pas bloqué, sample 0", function () {
  assert.strictEqual(sampleHorizonElevationDeg(null, 90), 0);
  assert.strictEqual(isSunBlockedByHorizonMaskSafe(null, 90, 30), false);
});

test("format { mask: [{az,elev}] } inchangé", function () {
  const mask = [];
  for (let i = 0; i < 180; i++) mask.push({ az: i * 2, elev: 40 });
  const hm = { mask };
  assert.ok(sampleHorizonElevationDeg(hm, 0) > 35);
  assert.strictEqual(isSunBlockedByHorizonMaskSafe(hm, 90, 20), true);
  assert.strictEqual(isSunBlockedByHorizonMaskSafe(hm, 90, 50), false);
});

test("format { values, stepDeg } inchangé", function () {
  const values = new Array(180).fill(35);
  const hm = { values, stepDeg: 2 };
  assert.ok(sampleHorizonElevationDeg(hm, 45) > 30);
  assert.strictEqual(isSunBlockedByHorizonMaskSafe(hm, 180, 25), true);
});

test("format legacy { azimuthStepDeg, elevations } désormais reconnu", function () {
  const elevations = new Array(180).fill(42);
  const hm = { azimuthStepDeg: 2, elevations };
  assert.ok(Math.abs(sampleHorizonElevationDeg(hm, 10) - 42) < 0.01);
  assert.strictEqual(isSunBlockedByHorizonMaskSafe(hm, 270, 30), true);
  assert.strictEqual(isSunBlockedByHorizonMaskSafe(hm, 270, 50), false);
});

test("horizon très haut → farLossPct live élevé (computeAnnualShadingLoss, obstacles vides)", function () {
  const panel = {
    id: "p1",
    polygonPx: [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 60 },
      { x: 50, y: 60 },
    ],
  };
  const highHorizon = {
    azimuthStepDeg: 2,
    elevations: new Array(180).fill(88),
  };
  const rBlocked = computeAnnualShadingLoss({
    latDeg: 48.8566,
    lonDeg: 2.3522,
    panels: [panel],
    obstacles: [],
    roofPans: [],
    horizonMask: highHorizon,
    config: { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 },
    metersPerPixel: 1,
  });
  assert.ok(
    rBlocked.annualLossPercent >= 85,
    "annualLossPercent doit refléter un horizon quasi totalement bloquant, got " +
      rBlocked.annualLossPercent
  );

  const rOpen = computeAnnualShadingLoss({
    latDeg: 48.8566,
    lonDeg: 2.3522,
    panels: [panel],
    obstacles: [],
    roofPans: [],
    horizonMask: null,
    config: { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 },
    metersPerPixel: 1,
  });
  assert.ok(
    rOpen.annualLossPercent < rBlocked.annualLossPercent,
    "sans masque la perte doit être plus faible qu’avec horizon à 88°"
  );
});

test("near inchangé par ce correctif : obstacle proche sans horizon", function () {
  const panel = {
    id: "p1",
    polygonPx: [
      { x: 100, y: 160 },
      { x: 200, y: 160 },
      { x: 200, y: 220 },
      { x: 100, y: 220 },
    ],
  };
  const obstacle = {
    id: "obs1",
    polygonPx: [
      { x: 100, y: 80 },
      { x: 200, y: 80 },
      { x: 200, y: 130 },
      { x: 100, y: 130 },
    ],
    heightM: 3,
  };
  const r = computeAnnualShadingLoss({
    latDeg: 48.8566,
    lonDeg: 2.3522,
    panels: [panel],
    obstacles: [obstacle],
    roofPans: [],
    config: { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 },
    metersPerPixel: 1,
  });
  assert.ok(
    r.annualLossPercent > 0,
    "scénario near classique doit rester > 0, got " + r.annualLossPercent
  );
});
