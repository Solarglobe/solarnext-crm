/**
 * CP-FAR-009 — Tests unitaires horizonRaycastHdCore (sans DSM)
 */

import { computeHorizonRaycastHD } from "../services/horizon/hd/horizonRaycastHdCore.js";

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

const EPS = 0.01;

// A) Terrain plat: sampler constant => elevations ~0
function testFlatTerrain() {
  const sampler = () => 100;
  const result = computeHorizonRaycastHD({
    heightSampler: sampler,
    site: { lat: 48.85, lon: 2.35 },
    z0Meters: 100,
    stepDeg: 1,
    maxDistanceMeters: 1000,
  });
  assert(result.algorithm === "RAYCAST_HD", "A) algorithm RAYCAST_HD");
  assert(result.elevationsDeg.length === 360, "A) length 360 (360/1)");
  for (let i = 0; i < result.elevationsDeg.length; i++) {
    assert(Math.abs(result.elevationsDeg[i]) < EPS, "A) flat elev ~0 at " + i);
  }
}

// B) Mur lointain: step height à distance D
function testWallAtDistance() {
  const D = 500;
  const wallHeight = 50;
  const siteLat = 48.85;
  const siteLon = 2.35;
  const M_PER_DEG = 111320;
  const mPerDegLon = M_PER_DEG * Math.cos((siteLat * Math.PI) / 180);

  const sampler = (lat, lon) => {
    const dLat = (lat - siteLat) * M_PER_DEG;
    const dLon = (lon - siteLon) * mPerDegLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    return dist > D ? wallHeight : 0;
  };

  const result = computeHorizonRaycastHD({
    heightSampler: sampler,
    site: { lat: siteLat, lon: siteLon },
    z0Meters: 0,
    stepDeg: 2,
    maxDistanceMeters: 1000,
  });

  const expectedTheta = (Math.atan2(wallHeight, D) * 180) / Math.PI;
  let found = false;
  for (let i = 0; i < result.elevationsDeg.length; i++) {
    if (result.elevationsDeg[i] >= expectedTheta - 2) {
      found = true;
      break;
    }
  }
  assert(found, "B) maxTheta ~" + expectedTheta.toFixed(1) + "° found");
}

// C) Colline progressive: z = d*k
function testProgressiveSlope() {
  const k = 0.1;
  const siteLat = 48.85;
  const siteLon = 2.35;
  const M_PER_DEG = 111320;
  const mPerDegLon = M_PER_DEG * Math.cos((siteLat * Math.PI) / 180);

  const sampler = (lat, lon) => {
    const dLat = (lat - siteLat) * M_PER_DEG;
    const dLon = (lon - siteLon) * mPerDegLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    return dist * k;
  };

  const result = computeHorizonRaycastHD({
    heightSampler: sampler,
    site: { lat: siteLat, lon: siteLon },
    z0Meters: 0,
    stepDeg: 2,
    maxDistanceMeters: 500,
  });

  const expectedTheta = (Math.atan(k) * 180) / Math.PI;
  let maxElev = 0;
  for (let i = 0; i < result.elevationsDeg.length; i++) {
    if (result.elevationsDeg[i] > maxElev) maxElev = result.elevationsDeg[i];
  }
  assert(Math.abs(maxElev - expectedTheta) < 2, "C) theta approx atan(k)");
}

// D) stepDeg=0.5 => length 720
function testStepDeg05() {
  const result = computeHorizonRaycastHD({
    heightSampler: () => 0,
    site: { lat: 48.85, lon: 2.35 },
    z0Meters: 0,
    stepDeg: 0.5,
    maxDistanceMeters: 100,
  });
  assert(result.elevationsDeg.length === 720, "D) stepDeg 0.5 => length 720");
  assert(result.stepDeg === 0.5, "D) stepDeg 0.5");
}

function main() {
  console.log("\n--- A) Terrain plat ---");
  testFlatTerrain();

  console.log("\n--- B) Mur lointain ---");
  testWallAtDistance();

  console.log("\n--- C) Colline progressive ---");
  testProgressiveSlope();

  console.log("\n--- D) stepDeg 0.5 ---");
  testStepDeg05();

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

main();
