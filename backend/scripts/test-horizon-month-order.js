/**
 * Tests ordre solaire des mois + rendu premium (CP-FAR-C-11).
 * Helper local : maxElevation par mois (21, 6h–18h) puis tri.
 * Test 1 : Premier mois = Décembre (index 11)
 * Test 2 : Symétrie élévation Jan≈Nov, Fév≈Oct, Mar≈Sep
 * Test 3 : SVG premium (heatmap-layer, hour-rays-layer)
 * Usage: cd backend && node scripts/test-horizon-month-order.js
 */

import { computeSunPosition } from "../services/shading/solarPosition.js";
import { buildPremiumHorizonMaskSvg } from "../pdf/horizonMaskPremiumChart.js";

const CHELLES_LAT = 48.8938962;
const CHELLES_LON = 2.6210259;
const YEAR = 2025;
const TOLERANCE_PCT = 0.05;
const TOLERANCE_EQUINOX_PCT = 0.10;

function createLocalDate(year, month, day, hour, lon) {
  const offset = Math.round((lon ?? 0) / 15);
  return new Date(Date.UTC(year, month, day, hour - offset, 0, 0));
}

/** Max élévation solaire le 21 du mois (heures 6–18). */
function getMaxElevationForMonth(lat, lon, monthIndex, year) {
  let max = 0;
  for (let h = 6; h <= 18; h++) {
    const d = createLocalDate(year, monthIndex, 21, h, lon);
    const pos = computeSunPosition(d, lat, lon);
    if (pos && pos.elevationDeg > max) max = pos.elevationDeg;
  }
  return max;
}

/** Données 12 mois triées par maxElevation (croissant). */
function getSortedMonthsDataLocal(lat, lon, year) {
  const arr = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const maxElevation = getMaxElevationForMonth(lat, lon, monthIndex, year);
    arr.push({ monthIndex, maxElevation });
  }
  arr.sort((a, b) => a.maxElevation - b.maxElevation);
  return arr;
}

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

function main() {
  console.log("\n=== test-horizon-month-order ===\n");

  const monthsData = getSortedMonthsDataLocal(CHELLES_LAT, CHELLES_LON, YEAR);
  const sortedOrder = monthsData.map((m) => m.monthIndex);

  assert(
    sortedOrder[0] === 11,
    "Test 1 : premier mois = Décembre (index 11)",
    `sortedOrder[0]=${sortedOrder[0]}, attendu 11`
  );

  const pairs = [
    [0, 10, "Janvier / Novembre", TOLERANCE_PCT],
    [1, 9, "Février / Octobre", TOLERANCE_PCT],
    [2, 8, "Mars / Septembre", TOLERANCE_EQUINOX_PCT],
  ];

  for (const [m1, m2, label, tol] of pairs) {
    const md1 = monthsData.find((m) => m.monthIndex === m1);
    const md2 = monthsData.find((m) => m.monthIndex === m2);
    const e1 = md1?.maxElevation ?? 0;
    const e2 = md2?.maxElevation ?? 0;
    const avg = (e1 + e2) / 2;
    const relDiff = avg > 0 ? Math.abs(e1 - e2) / avg : 0;
    assert(
      relDiff <= tol,
      `Test 2 : symétrie ${label}`,
      `diff relative ${(relDiff * 100).toFixed(2)} % > ${tol * 100} %`
    );
  }

  assert(sortedOrder.length === 12, "Tri contient 12 mois", `length=${sortedOrder.length}`);
  assert(sortedOrder[0] === 11, "Décembre en premier");
  const top3 = new Set(sortedOrder.slice(-3));
  assert(
    top3.has(4) && top3.has(5) && top3.has(6),
    "Mai, Juin, Juillet dans les 3 plus hauts",
    `top3=${JSON.stringify([...top3])}`
  );

  const svg = buildPremiumHorizonMaskSvg({
    lat: CHELLES_LAT,
    lon: CHELLES_LON,
    horizonMask: { mask: [], source: "EMPTY" },
  });
  assert(svg.includes('id="heatmap-layer"'), "SVG contient heatmap-layer");
  assert(svg.includes('id="hour-rays-layer"'), "SVG contient hour-rays-layer");
  assert(svg.includes('id="seasonal-layer"'), "SVG contient seasonal-layer");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ test-horizon-month-order PASS\n");
  process.exit(0);
}

main();
