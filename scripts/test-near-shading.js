/**
 * Test Node du module nearShadingCore (shading proche pur).
 * Exécuter : node scripts/test-near-shading.js
 */

const path = require("path");
const nearShadingCore = require(path.join(__dirname, "../shared/shading/nearShadingCore.cjs"));

const { computeNearShading, computePanelShadedFraction, computeSunVector } = nearShadingCore;

// Soleil au nord (azimuth ~180°), altitude 30° → ombre vers le sud
const SUN_NORTH = computeSunVector(180, 30);
// Soleil au sud (azimuth ~0°), altitude 60°
const SUN_SOUTH = computeSunVector(0, 60);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    return true;
  }
  failed++;
  console.error("FAIL:", msg);
  return false;
}

// --- SCENARIO 1 : Obstacle devant panneau, heightM=2 → perte > 0 ---
// Soleil az=180° (sud), dy<0. Rayon: panel + t*sunDir, t=zTop/dz≈4. Δy≈3.5.
// Obstacle y 70-85, panneau y 87-95 → à t=4, point projeté dans obstacle.
function scenario1() {
  const panel = {
    id: "p1",
    polygonPx: [
      { x: 50, y: 87 },
      { x: 60, y: 87 },
      { x: 60, y: 95 },
      { x: 50, y: 95 },
    ],
  };
  const obstacle = {
    id: "obs1",
    polygonPx: [
      { x: 50, y: 70 },
      { x: 60, y: 70 },
      { x: 60, y: 85 },
      { x: 50, y: 85 },
    ],
    heightM: 2,
  };
  const getZWorldAtXY = () => 0;

  const result = computeNearShading({
    panels: [panel],
    obstacles: [obstacle],
    sunVectors: [SUN_NORTH],
    getZWorldAtXY,
    useZLocal: true,
    metersPerPixel: 1,
  });

  return assert(result.totalLossPct > 0, "SCENARIO 1: Obstacle devant panneau → perte > 0");
}

// --- SCENARIO 2 : Obstacle derrière panneau → perte = 0 ---
function scenario2() {
  const panel = {
    id: "p2",
    polygonPx: [
      { x: 50, y: 30 },
      { x: 60, y: 30 },
      { x: 60, y: 40 },
      { x: 50, y: 40 },
    ],
  };
  const obstacle = {
    id: "obs2",
    polygonPx: [
      { x: 50, y: 70 },
      { x: 60, y: 70 },
      { x: 60, y: 85 },
      { x: 50, y: 85 },
    ],
    heightM: 2,
  };
  const getZWorldAtXY = () => 0;

  const result = computeNearShading({
    panels: [panel],
    obstacles: [obstacle],
    sunVectors: [SUN_NORTH],
    getZWorldAtXY,
    useZLocal: true,
    metersPerPixel: 1,
  });

  return assert(result.totalLossPct === 0, "SCENARIO 2: Obstacle derrière → perte = 0");
}

// --- SCENARIO 3 : heightM doublée → perte augmente ---
function scenario3() {
  const panel = {
    id: "p3",
    polygonPx: [
      { x: 50, y: 85 },
      { x: 60, y: 85 },
      { x: 60, y: 93 },
      { x: 50, y: 93 },
    ],
  };
  const obstacleBase = {
    id: "obs3",
    polygonPx: [
      { x: 50, y: 70 },
      { x: 60, y: 70 },
      { x: 60, y: 85 },
      { x: 50, y: 85 },
    ],
  };
  const getZWorldAtXY = () => 0;

  const result2m = computeNearShading({
    panels: [panel],
    obstacles: [{ ...obstacleBase, heightM: 2 }],
    sunVectors: [SUN_NORTH],
    getZWorldAtXY,
    useZLocal: true,
    metersPerPixel: 1,
  });

  const result4m = computeNearShading({
    panels: [panel],
    obstacles: [{ ...obstacleBase, heightM: 4 }],
    sunVectors: [SUN_NORTH],
    getZWorldAtXY,
    useZLocal: true,
    metersPerPixel: 1,
  });

  return assert(
    result4m.totalLossPct >= result2m.totalLossPct,
    "SCENARIO 3: heightM doublée → perte augmente"
  );
}

// --- SCENARIO 4 : Obstacle très bas → perte faible ---
function scenario4() {
  const panel = {
    id: "p4",
    polygonPx: [
      { x: 50, y: 88 },
      { x: 60, y: 88 },
      { x: 60, y: 94 },
      { x: 50, y: 94 },
    ],
  };
  const obstacle = {
    id: "obs4",
    polygonPx: [
      { x: 50, y: 70 },
      { x: 60, y: 70 },
      { x: 60, y: 85 },
      { x: 50, y: 85 },
    ],
    heightM: 0.1,
  };
  const getZWorldAtXY = () => 0;

  const result = computeNearShading({
    panels: [panel],
    obstacles: [obstacle],
    sunVectors: [SUN_NORTH],
    getZWorldAtXY,
    useZLocal: true,
    metersPerPixel: 1,
  });

  return assert(result.totalLossPct < 50, "SCENARIO 4: Obstacle très bas → perte faible");
}

// --- SCENARIO 5 : Z offset énorme (-5000) → invariance prouvée ---
function scenario5() {
  const Z_OFFSET = -5000;
  const panel = {
    id: "p5",
    polygonPx: [
      { x: 50, y: 87 },
      { x: 60, y: 87 },
      { x: 60, y: 95 },
      { x: 50, y: 95 },
    ],
  };
  const obstacle = {
    id: "obs5",
    polygonPx: [
      { x: 50, y: 70 },
      { x: 60, y: 70 },
      { x: 60, y: 85 },
      { x: 50, y: 85 },
    ],
    heightM: 4,
  };

  const getZWorldAtXY = () => Z_OFFSET;
  const obstaclesWithBaseZ = [{
    ...obstacle,
    baseZ: Z_OFFSET,
    baseZWorld: Z_OFFSET,
  }];

  const result = computeNearShading({
    panels: [panel],
    obstacles: obstaclesWithBaseZ,
    sunVectors: [SUN_NORTH],
    getZWorldAtXY,
    useZLocal: true,
    metersPerPixel: 1,
  });

  const lossWithOffset = result.totalLossPct;

  const getZWorldAtXYZero = () => 0;
  const obstaclesZero = [{
    ...obstacle,
    baseZ: 0,
    baseZWorld: 0,
  }];

  const resultZero = computeNearShading({
    panels: [panel],
    obstacles: obstaclesZero,
    sunVectors: [SUN_NORTH],
    getZWorldAtXY: getZWorldAtXYZero,
    useZLocal: true,
    metersPerPixel: 1,
  });

  const lossZero = resultZero.totalLossPct;

  return assert(
    Math.abs(lossWithOffset - lossZero) < 1,
    "SCENARIO 5: Z offset -5000 → invariance (perte similaire à z=0)"
  );
}

// --- Run ---
scenario1();
scenario2();
scenario3();
scenario4();
scenario5();

const total = passed + failed;
console.log("\n" + passed + "/" + total + " TESTS PASSED");
if (failed > 0) {
  process.exit(1);
}
