/**
 * Tests tri dynamique des mois — physiquement correct (helper local, sans ancien chart).
 * - maxElevation(December) < maxElevation(January)
 * - maxElevation(January) ≈ maxElevation(November)
 * - Juin/Juillet dans les 3 plus hauts
 * Usage: cd backend && node scripts/test-horizon-dynamic-sort.js
 */

import { computeSunPosition } from "../services/shading/solarPosition.js";

function createLocalDate(year, month, day, hour, lon) {
  const offset = Math.round((lon ?? 0) / 15);
  return new Date(Date.UTC(year, month, day, hour - offset, 0, 0));
}

function getMaxElevationForMonth(lat, lon, monthIndex, year) {
  let max = 0;
  for (let h = 6; h <= 18; h++) {
    const d = createLocalDate(year, monthIndex, 21, h, lon);
    const pos = computeSunPosition(d, lat, lon);
    if (pos && pos.elevationDeg > max) max = pos.elevationDeg;
  }
  return max;
}

function getSortedMonthsData(lat, lon, year) {
  const arr = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    arr.push({ monthIndex, maxElevation: getMaxElevationForMonth(lat, lon, monthIndex, year) });
  }
  arr.sort((a, b) => a.maxElevation - b.maxElevation);
  return arr;
}

const CHELLES_LAT = 48.8938962;
const CHELLES_LON = 2.6210259;
const YEAR = 2025;
const TOLERANCE_PCT = 0.08;

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
  console.log("\n=== test-horizon-dynamic-sort ===\n");

  const monthsData = getSortedMonthsData(CHELLES_LAT, CHELLES_LON, YEAR);

  assert(monthsData.length === 12, "12 mois générés", `length=${monthsData.length}`);

  const dec = monthsData.find((m) => m.monthIndex === 11);
  const jan = monthsData.find((m) => m.monthIndex === 0);
  const nov = monthsData.find((m) => m.monthIndex === 10);

  assert(dec && jan, "Décembre et Janvier présents");
  assert(
    dec.maxElevation < jan.maxElevation,
    "maxElevation(Décembre) < maxElevation(Janvier)",
    `dec=${dec?.maxElevation?.toFixed(2)}° jan=${jan?.maxElevation?.toFixed(2)}°`
  );

  assert(nov, "Novembre présent");
  const janNovDiff = jan && nov ? Math.abs(jan.maxElevation - nov.maxElevation) : Infinity;
  const janNovAvg = jan && nov ? (jan.maxElevation + nov.maxElevation) / 2 : 0;
  const janNovRel = janNovAvg > 0 ? janNovDiff / janNovAvg : 0;
  assert(
    janNovRel <= TOLERANCE_PCT,
    "maxElevation(Janvier) ≈ maxElevation(Novembre)",
    `diff relative ${(janNovRel * 100).toFixed(2)} % (jan=${jan?.maxElevation?.toFixed(2)}° nov=${nov?.maxElevation?.toFixed(2)}°)`
  );

  const top3 = monthsData.slice(-3).map((m) => m.monthIndex);
  const juneInTop3 = top3.includes(5);
  const julyInTop3 = top3.includes(6);
  assert(
    juneInTop3 || julyInTop3,
    "Juin ou Juillet dans les 3 plus hauts",
    `top3 mois=${top3.join(",")} (5=Juin, 6=Juillet)`
  );

  for (let i = 1; i < monthsData.length; i++) {
    assert(
      monthsData[i].maxElevation >= monthsData[i - 1].maxElevation,
      `Tri croissant [${i - 1}]<=[${i}]`,
      `${monthsData[i - 1].monthIndex}(${monthsData[i - 1].maxElevation.toFixed(2)}°) vs ${monthsData[i].monthIndex}(${monthsData[i].maxElevation.toFixed(2)}°)`
    );
  }
  ok("Tri strictement croissant vérifié");

  const firstMonth = monthsData[0].monthIndex;
  assert(firstMonth === 11, "Premier mois = Décembre (index 11)", `first=${firstMonth}`);

  const lastMonths = monthsData.slice(-3).map((m) => m.monthIndex).sort((a, b) => a - b);
  const expectedTop = [4, 5, 6];
  const topOk = lastMonths.every((m, i) => m === expectedTop[i]);
  assert(
    topOk,
    "Les 3 plus hauts = Mai, Juin, Juillet",
    `top3=${lastMonths.join(",")} attendu 4,5,6`
  );

  console.log("\n--- Ordre des mois (bas → haut) ---");
  monthsData.forEach((m, i) => {
    const names = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
    console.log(`  ${i + 1}. ${names[m.monthIndex]} (maxElev=${m.maxElevation.toFixed(1)}°)`);
  });

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ test-horizon-dynamic-sort PASS\n");
  process.exit(0);
}

main();
