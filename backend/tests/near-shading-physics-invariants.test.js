/**
 * Invariants physiques near shading (échelle, toit incliné) — nearShadingCore + parité back.
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { computeCalpinageShading, getAnnualSunVectorsForNear } from "../services/shading/calpinageShading.service.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nearShadingCore = require(path.join(__dirname, "../../shared/shading/nearShadingCore.cjs"));
const { computeNearShading } = nearShadingCore;

const LAT = 48.8566;
const LON = 2.3522;
const CONFIG = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };

let passed = 0;
let failed = 0;

function ok(label) {
  console.log("✅ " + label);
  passed++;
}
function fail(label, msg) {
  console.log("❌ " + label + ": " + msg);
  failed++;
}
function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

function buildScaledScenario(scale, mpp) {
  const s = scale;
  return {
    metersPerPixel: mpp,
    panels: [
      {
        id: "p1",
        polygonPx: [
          { x: 100 * s, y: 160 * s },
          { x: 200 * s, y: 160 * s },
          { x: 200 * s, y: 220 * s },
          { x: 100 * s, y: 220 * s },
        ],
      },
    ],
    obstacles: [
      {
        id: "o1",
        polygonPx: [
          { x: 100 * s, y: 80 * s },
          { x: 320 * s, y: 80 * s },
          { x: 320 * s, y: 130 * s },
          { x: 100 * s, y: 130 * s },
        ],
        heightM: 3,
      },
    ],
  };
}

function testScaleInvarianceCore() {
  console.log("\n--- TEST 1 — Invariance échelle (core) ---");
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const mppA = 0.05;
  const mppB = 0.025;
  const A = buildScaledScenario(1, mppA);
  const B = buildScaledScenario(2, mppB);

  const rA = computeNearShading({
    panels: A.panels,
    obstacles: A.obstacles,
    sunVectors,
    useZLocal: false,
    panelGridSize: 2,
    metersPerPixel: A.metersPerPixel,
  });
  const rB = computeNearShading({
    panels: B.panels,
    obstacles: B.obstacles,
    sunVectors,
    useZLocal: false,
    panelGridSize: 2,
    metersPerPixel: B.metersPerPixel,
  });

  const diff = Math.abs(rA.totalLossPct - rB.totalLossPct);
  assert(diff < 1e-6, "core nearLossPct identique homothétie + mpp/2", "A=" + rA.totalLossPct + " B=" + rB.totalLossPct + " diff=" + diff);
}

async function testScaleInvarianceBackend() {
  console.log("\n--- TEST 1b — Invariance échelle (backend) ---");
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const mppA = 0.05;
  const mppB = 0.025;
  const A = buildScaledScenario(1, mppA);
  const B = buildScaledScenario(2, mppB);

  const backA = await computeCalpinageShading({
    lat: LAT,
    lon: LON,
    panels: A.panels,
    obstacles: A.obstacles,
    metersPerPixel: mppA,
  });
  const backB = await computeCalpinageShading({
    lat: LAT,
    lon: LON,
    panels: B.panels,
    obstacles: B.obstacles,
    metersPerPixel: mppB,
  });

  const diff = Math.abs(backA.nearLossPct - backB.nearLossPct);
  assert(diff < 0.05, "backend nearLossPct quasi identique (tol 0.05%)", "A=" + backA.nearLossPct + " B=" + backB.nearLossPct);
}

function testSlopedRoofDifferentBase() {
  console.log("\n--- TEST 2 — Toit incliné : base obstacle différente ---");
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const mpp = 0.1;

  const getZ = (x, y) => 5 + (y / 100) * 2;

  const obstacleLow = {
    id: "obsLow",
    polygonPx: [
      { x: 40, y: 40 },
      { x: 50, y: 40 },
      { x: 50, y: 50 },
      { x: 40, y: 50 },
    ],
    heightM: 2,
  };
  const obstacleHigh = {
    id: "obsHigh",
    polygonPx: [
      { x: 40, y: 140 },
      { x: 50, y: 140 },
      { x: 50, y: 150 },
      { x: 40, y: 150 },
    ],
    heightM: 2,
  };

  const panel = {
    id: "p1",
    polygonPx: [
      { x: 40, y: 160 },
      { x: 60, y: 160 },
      { x: 60, y: 180 },
      { x: 40, y: 180 },
    ],
  };

  const rLow = computeNearShading({
    panels: [panel],
    obstacles: [obstacleLow],
    sunVectors,
    getZWorldAtXY: getZ,
    useZLocal: true,
    panelGridSize: 2,
    metersPerPixel: mpp,
  });
  const rHigh = computeNearShading({
    panels: [panel],
    obstacles: [obstacleHigh],
    sunVectors,
    getZWorldAtXY: getZ,
    useZLocal: true,
    panelGridSize: 2,
    metersPerPixel: mpp,
  });

  assert(
    Math.abs(rLow.totalLossPct - rHigh.totalLossPct) > 1e-9,
    "perte différente si base toit différente (obstacle bas vs haut)",
    "low=" + rLow.totalLossPct + " high=" + rHigh.totalLossPct
  );
}

async function main() {
  testScaleInvarianceCore();
  await testScaleInvarianceBackend();
  testSlopedRoofDifferentBase();

  console.log("\n--- RÉSUMÉ invariants ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
