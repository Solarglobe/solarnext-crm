import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConsumption, buildConsumptionFromDailyPoints } from "../services/consumptionService.js";
import { aggregateMonthly } from "../services/monthlyAggregator.js";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ENEDIS_REFERENCE_MONTHLY = [2231, 1267, 1229, 725, 683, 411, 397, 411, 609, 900, 1464, 1749];

function monthlyFromHourly(hourly) {
  return aggregateMonthly(new Array(8760).fill(0), hourly).map((m) => m.conso_kwh);
}

function writeRollingHourlyLoadcurve(monthlyKwh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solarnext-enedis-rolling-"));
  const file = path.join(dir, "loadcurve.csv");
  const start = Date.UTC(2024, 10, 1, 0, 0, 0);
  const hours = 365 * 24;
  const lines = ["prm,startDate,powerInWatts"];
  for (let i = 0; i <= hours; i++) {
    const ts = start + i * 3600 * 1000;
    const d = new Date(ts);
    const m = d.getUTCMonth();
    const watts = (monthlyKwh[m] / (DAYS_IN_MONTH[m] * 24)) * 1000;
    lines.push(`22175108508919,${d.toISOString()},${watts}`);
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

function buildDailyPoints(monthlyKwh, skip = () => false) {
  const points = [];
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= DAYS_IN_MONTH[m]; d++) {
      if (skip(m, d)) continue;
      points.push({
        date: `2025-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        kwh: monthlyKwh[m] / DAYS_IN_MONTH[m],
      });
    }
  }
  return points;
}

test("loadcurve Enedis glissante: agrégation calendaire directe janvier à décembre", () => {
  const csvPath = writeRollingHourlyLoadcurve(ENEDIS_REFERENCE_MONTHLY);
  const out = loadConsumption({ profil: "active" }, csvPath, {});

  assert.equal(out.engine_consumption_source, "CSV_HOURLY_FULL_YEAR");
  assert.deepEqual(monthlyFromHourly(out.hourly), ENEDIS_REFERENCE_MONTHLY);
  assert.equal(Math.round(out.annual_kwh), 12076);
});

test("R65 quotidien complet: les mensualités réelles priment sur tout profil théorique", () => {
  const out = buildConsumptionFromDailyPoints(buildDailyPoints(ENEDIS_REFERENCE_MONTHLY), {
    profil: "active",
    params: {},
  });

  assert.ok(out);
  assert.equal(out.engine_consumption_source, "R65_DAILY_REBUILT");
  assert.deepEqual(out.monthly_kwh_ref.map(Math.round), ENEDIS_REFERENCE_MONTHLY);
  assert.deepEqual(monthlyFromHourly(out.hourly), ENEDIS_REFERENCE_MONTHLY);
  assert.equal(Math.round(out.annual_kwh), 12076);
});

test("R65 quotidien partiel: seuls les jours manquants sont estimés, les autres mois restent inchangés", () => {
  const out = buildConsumptionFromDailyPoints(
    buildDailyPoints(ENEDIS_REFERENCE_MONTHLY, (month, day) => month === 0 && day === 15),
    { profil: "active", params: {} }
  );

  assert.ok(out);
  const monthly = monthlyFromHourly(out.hourly);
  assert.equal(monthly[1], ENEDIS_REFERENCE_MONTHLY[1]);
  assert.equal(monthly[2], ENEDIS_REFERENCE_MONTHLY[2]);
  assert.equal(Math.round(monthly[0]), ENEDIS_REFERENCE_MONTHLY[0]);
  assert.ok(Math.abs(out.annual_kwh - ENEDIS_REFERENCE_MONTHLY.reduce((a, b) => a + b, 0)) < 0.5);
});
