/**
 * CP-FAR-009 — Tests DSM grid sampler (bilinear + nodata)
 */

import { createDsmGridSampler, getSiteElevation } from "../services/horizon/hd/dsmGridSampler.js";

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
const NODATA = -9999;

function main() {
  // Grille 10x10: origin NW (48.9, 2.3), stepMeters=100
  const width = 10;
  const height = 10;
  const grid = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y * width + x] = 50 + x * 2 + y * 3;
    }
  }
  grid[5 * width + 5] = NODATA;

  const dsmGrid = {
    grid,
    width,
    height,
    origin: { lat: 48.9, lon: 2.3 },
    stepMeters: 100,
    noDataValue: NODATA,
  };

  const sampler = createDsmGridSampler(dsmGrid);

  // Sample hors grille => NaN
  const zOut = sampler(40, 0);
  assert(isNaN(zOut), "hors grille => NaN");

  // Pixel (0,0) = 50
  const z00 = sampler(48.9, 2.3);
  assert(Math.abs(z00 - 50) < EPS, "origin sample ~50");

  // Pixel (1,1) = 50+2+3=55
  const lat11 = 48.9 - 100 / 111320;
  const lon11 = 2.3 + 100 / (111320 * Math.cos((48.9 * Math.PI) / 180));
  const z11 = sampler(lat11, lon11);
  assert(Math.abs(z11 - 55) < 2, "pixel (1,1) ~55");

  // getSiteElevation moyenne 3x3
  const z0 = getSiteElevation(sampler, 48.9, 2.3, 100);
  assert(typeof z0 === "number" && !isNaN(z0) && z0 >= 0, "getSiteElevation returns number");

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
