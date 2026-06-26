import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConsumption, applyEquipmentShape } from "../services/consumptionService.js";
import { aggregateMonthly } from "../services/monthlyAggregator.js";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MARKED_MONTHLY = [2860, 2340, 1820, 910, 600, 540, 510, 510, 840, 910, 1690, 2470];

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

function monthlyFromHourly(hourly) {
  return aggregateMonthly(new Array(8760).fill(0), hourly).map((m) => m.conso_kwh);
}

function assertMonthlyEqual(actual, expected) {
  assert.deepEqual(
    actual.map((v) => Math.round(v)),
    expected.map((v) => Math.round(v))
  );
}

function buildGenericHourly(total) {
  const raw = [];
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < DAYS_IN_MONTH[m]; d++) {
      for (let h = 0; h < 24; h++) {
        const evening = h >= 18 && h <= 22 ? 1.8 : 0.8;
        const winter = m <= 1 || m >= 10 ? 1.4 : 0.7;
        raw.push(evening * winter);
      }
    }
  }
  const f = total / sum(raw);
  return raw.map((v) => v * f);
}

function writeHourlyEnedisCsv(hourly) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solarnext-conso-"));
  const file = path.join(dir, "enedis-hourly.csv");
  const lines = ["startDate,powerInWatts"];
  const start = Date.UTC(2025, 0, 1, 0, 0, 0);
  for (let i = 0; i <= 8760; i++) {
    const d = new Date(start + i * 3600 * 1000).toISOString();
    const kwh = hourly[Math.min(i, hourly.length - 1)] ?? 0;
    lines.push(`${d},${kwh * 1000}`);
  }
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

test("mode mensuel: le profil 8760 réagrégé conserve exactement les 12 mois", () => {
  const out = loadConsumption({
    mode: "mensuelle",
    mensuelle: MARKED_MONTHLY,
    annuelle_kwh: sum(MARKED_MONTHLY),
    profil: "active",
  });

  assert.equal(Math.round(out.annual_kwh), 16000);
  assertMonthlyEqual(monthlyFromHourly(out.hourly), MARKED_MONTHLY);
});

test("mode mensuel: une ancienne courbe hourly ne doit pas écraser les 12 mois saisis", () => {
  const staleAnnualShape = buildGenericHourly(16000);
  const out = loadConsumption({
    mode: "mensuelle",
    mensuelle: MARKED_MONTHLY,
    annuelle_kwh: sum(MARKED_MONTHLY),
    hourly: staleAnnualShape,
    profil: "active",
  });

  assert.equal(out.consumption_source_mode, "MONTHLY");
  assertMonthlyEqual(monthlyFromHourly(out.hourly), MARKED_MONTHLY);
});

test("mode annuel: le total annuel est conservé après distribution horaire", () => {
  const out = loadConsumption({
    mode: "annuelle",
    annuelle_kwh: 16000,
    profil: "active",
  });

  assert.ok(Math.abs(sum(out.hourly) - 16000) < 0.001);
  assert.equal(Math.round(out.annual_kwh), 16000);
});

test("CSV Enedis horaire: l'agrégation mensuelle correspond aux données importées", () => {
  const expectedMonthly = [900, 800, 850, 750, 700, 650, 510, 510, 720, 820, 900, 990];
  const hourly = [];
  for (let m = 0; m < 12; m++) {
    const hours = DAYS_IN_MONTH[m] * 24;
    for (let h = 0; h < hours; h++) hourly.push(expectedMonthly[m] / hours);
  }
  const csvPath = writeHourlyEnedisCsv(hourly);

  const out = loadConsumption({ mode: "annuelle", annuelle_kwh: sum(expectedMonthly) }, csvPath);

  assert.equal(out.engine_consumption_source, "CSV_HOURLY_FULL_YEAR");
  assertMonthlyEqual(monthlyFromHourly(out.hourly), expectedMonthly);
});

test("équipements actuels: ils remodèlent l'horaire mais ne modifient pas les mois de référence", () => {
  const base = loadConsumption({
    mode: "mensuelle",
    mensuelle: MARKED_MONTHLY,
    annuelle_kwh: sum(MARKED_MONTHLY),
    profil: "active",
  });

  const out = applyEquipmentShape(base, {
    profil: "active",
    equipement_actuel_params: {
      schemaVersion: 2,
      items: [
        { kind: "pac", id: "pac1", pac_type: "air_eau", puissance_kw: 9, fonctionnement: "moyen" },
        { kind: "ballon", id: "ballon1", volume_litres: 200, mode_charge: "hc" },
      ],
    },
  }, false);

  assertMonthlyEqual(monthlyFromHourly(out.hourly), MARKED_MONTHLY);
  assert.equal(Math.round(out.annual_kwh), 16000);
});
