/**
 * CP-PV-014 — Tests Safe Zone Geometry Engine
 * Usage: cd backend && node scripts/test-safe-zone-engine.js
 */

import { computeSafeZones } from "../../shared/geometry/safeZoneEngine.js";

let passed = 0;
let failed = 0;
const TOL = 1;

function ok(label) {
  console.log(`✅ ${label}`);
  passed++;
}

function fail(label, msg) {
  console.log(`❌ ${label}: ${msg}`);
  failed++;
}

function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

function approxEqual(a, b, tol = TOL) {
  return Math.abs(a - b) <= tol;
}

// --- 1) Pan rectangle 1000x600, marginPx=50 -> inset 900x500, sans obstacles ---
console.log("\n--- 1) Pan rectangle, margin 50px, sans obstacles ---");
const pan1 = {
  id: "pan-1",
  polygonPx: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 600 },
    { x: 0, y: 600 },
  ],
};
const r1 = computeSafeZones({
  pans: [pan1],
  obstacles: [],
  marginPxOverride: 50,
});
const safe1 = r1.byPanId["pan-1"];
assert(safe1 && safe1.safeZonePolygonsPx.length >= 1, "safeZone non vide");
const area1 = safe1.stats.totalAreaPx2;
const expectedInset = 900 * 500;
assert(approxEqual(area1, expectedInset, 500), `area ≈ ${expectedInset} (got ${area1.toFixed(0)})`);

// --- 2) Obstacle au centre 200x100, margin 50 -> obstacle expanded 300x200 ---
console.log("\n--- 2) Obstacle au centre, margin 50 ---");
const obstacle1 = {
  id: "obs-1",
  polygonPx: [
    { x: 400, y: 250 },
    { x: 600, y: 250 },
    { x: 600, y: 350 },
    { x: 400, y: 350 },
  ],
};
const r2 = computeSafeZones({
  pans: [pan1],
  obstacles: [obstacle1],
  marginPxOverride: 50,
});
const safe2 = r2.byPanId["pan-1"];
const area2 = safe2.stats.totalAreaPx2;
const expected2 = 900 * 500 - 300 * 200;
assert(approxEqual(area2, expected2, 5000), `area ≈ ${expected2} (got ${area2.toFixed(0)})`);

// --- 3) Obstacle proche du bord ---
console.log("\n--- 3) Obstacle proche du bord ---");
const obstacle2 = {
  id: "obs-2",
  polygonPx: [
    { x: 50, y: 250 },
    { x: 150, y: 250 },
    { x: 150, y: 350 },
    { x: 50, y: 350 },
  ],
};
const r3 = computeSafeZones({
  pans: [pan1],
  obstacles: [obstacle2],
  marginPxOverride: 50,
});
const safe3 = r3.byPanId["pan-1"];
assert(safe3.safeZonePolygonsPx.length >= 1, "safeZone non vide (obstacle bord)");
const area3 = safe3.stats.totalAreaPx2;
assert(area3 < area1, "area réduite par obstacle bord");

// --- 4) Multi-obstacles union (deux obstacles qui se chevauchent) ---
console.log("\n--- 4) Multi-obstacles union ---");
const obsA = {
  id: "obs-a",
  polygonPx: [
    { x: 200, y: 200 },
    { x: 350, y: 200 },
    { x: 350, y: 350 },
    { x: 200, y: 350 },
  ],
};
const obsB = {
  id: "obs-b",
  polygonPx: [
    { x: 300, y: 250 },
    { x: 450, y: 250 },
    { x: 450, y: 400 },
    { x: 300, y: 400 },
  ],
};
const r4 = computeSafeZones({
  pans: [pan1],
  obstacles: [obsA, obsB],
  marginPxOverride: 50,
});
const safe4 = r4.byPanId["pan-1"];
const area4 = safe4.stats.totalAreaPx2;
assert(area4 < area2, "union obstacles: area correcte (pas double soustraction)");

// --- 5) Multi-pan: 2 pans, obstacles sur pan1 seulement ---
console.log("\n--- 5) Multi-pan ---");
const pan2 = {
  id: "pan-2",
  polygonPx: [
    { x: 1100, y: 0 },
    { x: 1500, y: 0 },
    { x: 1500, y: 400 },
    { x: 1100, y: 400 },
  ],
};
const r5 = computeSafeZones({
  pans: [pan1, pan2],
  obstacles: [obstacle1],
  marginPxOverride: 50,
});
const safe5a = r5.byPanId["pan-1"];
const safe5b = r5.byPanId["pan-2"];
const area5b = safe5b.stats.totalAreaPx2;
const expected5b = 300 * 300; // 400x400 inset 50 -> 300x300
assert(approxEqual(area5b, expected5b, 500), `pan2 intact: area ≈ ${expected5b} (got ${area5b.toFixed(0)})`);

// --- 6) Robustesse orientation: CW vs CCW, ordre points différent ---
console.log("\n--- 6) Robustesse orientation ---");
const panCw = {
  id: "pan-cw",
  polygonPx: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 },
  ],
};
const panCcw = {
  id: "pan-ccw",
  polygonPx: [
    { x: 0, y: 0 },
    { x: 0, y: 80 },
    { x: 100, y: 80 },
    { x: 100, y: 0 },
  ],
};
const r6a = computeSafeZones({ pans: [panCw], obstacles: [], marginPxOverride: 10 });
const r6b = computeSafeZones({ pans: [panCcw], obstacles: [], marginPxOverride: 10 });
const area6a = r6a.byPanId["pan-cw"].stats.totalAreaPx2;
const area6b = r6b.byPanId["pan-ccw"].stats.totalAreaPx2;
assert(approxEqual(area6a, area6b, 10), `CW vs CCW: areas proches (${area6a.toFixed(0)} vs ${area6b.toFixed(0)})`);

// --- Résultat ---
const total = passed + failed;
console.log(`\nPASS CP-PV-014 SafeZoneEngine: ${passed}/${total}`);
if (failed > 0) process.exit(1);
