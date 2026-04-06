/**
 * Parité near shading : backend (calpinageShading.service) vs nearShadingCore (shared/shading).
 * Scénario fixe : 1 toit implicite, 2 panneaux, 1 obstacle 3m au sud, Paris, config 2026 step 60.
 * Tolérance ±0.2 % sur totalLossPct. Tests stress + panels=[].
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
const TOLERANCE_PCT = 0.2;

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

// --- Scénario de base : 2 panneaux, 1 obstacle 3m au sud (y plus petit = sud en convention moteur) ---
function buildBaseScenario() {
  const panels = [
    {
      id: "p1",
      polygonPx: [
        { x: 100, y: 160 },
        { x: 200, y: 160 },
        { x: 200, y: 220 },
        { x: 100, y: 220 },
      ],
    },
    {
      id: "p2",
      polygonPx: [
        { x: 220, y: 160 },
        { x: 320, y: 160 },
        { x: 320, y: 220 },
        { x: 220, y: 220 },
      ],
    },
  ];
  const obstacle = {
    id: "obs1",
    polygonPx: [
      { x: 100, y: 80 },
      { x: 320, y: 80 },
      { x: 320, y: 130 },
      { x: 100, y: 130 },
    ],
    heightM: 3,
  };
  return { panels, obstacles: [obstacle] };
}

async function runParityTest() {
  console.log("\n--- 1) Test comparatif front/back (2 panneaux, 1 obstacle 3m sud) ---");
  const { panels, obstacles } = buildBaseScenario();

  const backResult = await computeCalpinageShading({
    lat: LAT,
    lon: LON,
    panels,
    obstacles,
    metersPerPixel: 1,
  });
  const backNear = backResult != null ? backResult.nearLossPct : null;
  assert(typeof backNear === "number", "backend nearLossPct number", "got " + backNear);

  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  assert(sunVectors.length > 0, "sunVectors non vides", "count=" + (sunVectors?.length ?? 0));

  const coreResult = computeNearShading({
    panels,
    obstacles,
    sunVectors,
    getZWorldAtXY: undefined,
    useZLocal: false,
    panelGridSize: 2,
    metersPerPixel: 1,
    debug: true,
  });
  const coreNear = coreResult != null ? coreResult.totalLossPct : null;
  assert(typeof coreNear === "number", "nearShadingCore totalLossPct number", "got " + coreNear);

  assert(coreNear > 0, "C3 obstacle 3m sud → nearLossPct > 0 (nearShadingCore, zMode FLAT)", "got " + coreNear);

  const diff = Math.abs(backNear - coreNear);
  assert(diff <= TOLERANCE_PCT, "parité back vs core (tol " + TOLERANCE_PCT + "%)", "back=" + backNear + " core=" + coreNear + " diff=" + diff);

  assert(Array.isArray(coreResult.perPanel) && coreResult.perPanel.length === 2, "perPanel length 2", "got " + (coreResult.perPanel?.length ?? 0));
  const sampleCount = coreResult.debugInfo ? coreResult.debugInfo.sunVectorCount : 0;
  assert(sampleCount > 0, "sampleCount > 0", "got " + sampleCount);
  coreResult.perPanel.forEach((p, i) => {
    assert(typeof p.shadedFractionAvg === "number" && p.shadedFractionAvg >= 0 && p.shadedFractionAvg <= 1, "panel " + i + " shadedFractionAvg [0,1]", "got " + p.shadedFractionAvg);
    assert(typeof p.lossPct === "number" && p.lossPct >= 0 && p.lossPct <= 100, "panel " + i + " lossPct [0,100]", "got " + p.lossPct);
  });
}

async function runStressObstacleNorth() {
  console.log("\n--- 2) Stress : obstacle au nord (ne doit pas impacter) ---");
  const panels = [
    { id: "p1", polygonPx: [{ x: 100, y: 160 }, { x: 200, y: 160 }, { x: 200, y: 220 }, { x: 100, y: 220 }] },
  ];
  const obstacleNorth = {
    id: "obsNorth",
    polygonPx: [{ x: 100, y: 260 }, { x: 200, y: 260 }, { x: 200, y: 320 }, { x: 100, y: 320 }],
    heightM: 3,
  };
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const result = computeNearShading({ panels, obstacles: [obstacleNorth], sunVectors, useZLocal: false, panelGridSize: 2, metersPerPixel: 1 });
  assert(result.totalLossPct >= 0 && result.totalLossPct <= 100, "perte [0,100] obstacle nord", "got " + result.totalLossPct);
  assert(result.totalLossPct < 1, "C3 obstacle au nord → nearLossPct ≈ 0", "got " + result.totalLossPct);
  assert(result.perPanel.length === 1 && result.perPanel[0].lossPct >= 0, "perPanel cohérent", "got " + JSON.stringify(result.perPanel));
}

async function runStressObstacleVeryClose() {
  console.log("\n--- 3) Stress : obstacle 0.5m très proche panneau ---");
  const panels = [
    { id: "p1", polygonPx: [{ x: 100, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 230 }, { x: 100, y: 230 }] },
  ];
  const obstacleClose = {
    id: "obsClose",
    polygonPx: [{ x: 100, y: 130 }, { x: 200, y: 130 }, { x: 200, y: 145 }, { x: 100, y: 145 }],
    heightM: 0.5,
  };
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const result = computeNearShading({ panels, obstacles: [obstacleClose], sunVectors, useZLocal: false, panelGridSize: 2, metersPerPixel: 1 });
  assert(result.totalLossPct >= 0 && result.totalLossPct <= 100, "perte [0,100] obstacle proche", "got " + result.totalLossPct);
  assert(result.perPanel.every((p) => p.lossPct >= 0 && p.lossPct <= 100), "perte par panneau [0,100]", "got " + JSON.stringify(result.perPanel));
}

async function runStressObstacle5mAt3m() {
  console.log("\n--- 4) Stress : obstacle 5m haut à 3m distance ---");
  const panels = [
    { id: "p1", polygonPx: [{ x: 100, y: 200 }, { x: 180, y: 200 }, { x: 180, y: 280 }, { x: 100, y: 280 }] },
  ];
  const obstacle = {
    id: "obs5m",
    polygonPx: [{ x: 100, y: 120 }, { x: 180, y: 120 }, { x: 180, y: 170 }, { x: 100, y: 170 }],
    heightM: 5,
  };
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const result = computeNearShading({ panels, obstacles: [obstacle], sunVectors, useZLocal: false, panelGridSize: 2 });
  assert(result.totalLossPct >= 0 && result.totalLossPct <= 100, "perte [0,100] obstacle 5m", "got " + result.totalLossPct);
  assert(result.perPanel.every((p) => p.lossPct >= 0 && p.lossPct <= 100), "perte par panneau [0,100]", "got " + JSON.stringify(result.perPanel));
}

function runPanelsEmpty() {
  console.log("\n--- 5) panels = [] : nearLossPct = 0, aucune exception ---");
  const sunVectors = getAnnualSunVectorsForNear(LAT, LON, CONFIG);
  const obstacles = [{ id: "o1", polygonPx: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], heightM: 2 }];
  let threw = false;
  let result;
  try {
    result = computeNearShading({ panels: [], obstacles, sunVectors, metersPerPixel: 1 });
  } catch (e) {
    threw = true;
  }
  assert(!threw, "pas d'exception panels=[]", threw ? "exception" : "ok");
  assert(result && result.totalLossPct === 0, "nearLossPct = 0", "got " + (result?.totalLossPct ?? "null"));
  assert(Array.isArray(result.perPanel) && result.perPanel.length === 0, "perPanel vide", "got " + (result.perPanel?.length ?? "?"));
}

async function main() {
  await runParityTest();
  await runStressObstacleNorth();
  await runStressObstacleVeryClose();
  await runStressObstacle5mAt3m();
  runPanelsEmpty();

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS (parité near front/back + stress + panels=[])");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
