/**
 * CSV horaire PARTIEL (< 8760 h) — non-régression du fix 01/07/2026.
 * Voir AUDIT_CONSO_ANNUELLE_CSV_PARTIEL_2026-07-01.md.
 * Bug corrigé : rebuildHourlyIncomplete comblait les heures manquantes avec le
 * profil de base « active » (~4 878 kWh/an) NON rescalé et désaligné calendrier
 * → 7 830 kWh/an au lieu de ~12 760 pour une courbe fév→juin de 4 990 kWh.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConsumption } from "../services/consumptionService.js";

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

function writePartialLoadCurveCsv(avgWatts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solarnext-partial-"));
  const file = path.join(dir, "loadcurve.csv");
  const start = Date.UTC(2026, 1, 8, 4, 0, 0);
  const lines = ["prm,startDate,powerInWatts"];
  const N = 3426;
  for (let i = 0; i < N; i++) {
    const ts = start + i * 3600 * 1000;
    const hour = new Date(ts).getUTCHours();
    const mod = hour >= 18 && hour <= 22 ? 1.6 : hour <= 5 ? 0.5 : 1.0;
    lines.push(`22175108508919,${new Date(ts).toISOString()},${Math.round(avgWatts * mod)}`);
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return { file, count: N, startTs: start };
}

test("CSV horaire partiel : annualisation coherente avec extrapolation brute", () => {
  const { file, count } = writePartialLoadCurveCsv(1456);
  const out = loadConsumption({ profil: "active" }, file, { puissance_kva: 12, reseau_type: "mono" });

  assert.equal(out.engine_consumption_source, "CSV_HOURLY_PARTIAL_REBUILT");
  assert.equal(out.hourly.length, 8760);
  assert.ok(count === 3426);

  const annual = out.annual_kwh;
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => Number(l.split(",")[2]));
  const kwh = sum(rows) / 1000;
  const rawFromCsv = (kwh / (rows.length / 24)) * 365;

  assert.ok(
    annual >= 0.8 * rawFromCsv && annual <= 1.25 * rawFromCsv,
    `annual_kwh=${annual.toFixed(0)} hors bornes (brut=${rawFromCsv.toFixed(0)})`
  );
  assert.ok(annual > 11000, `annual_kwh=${annual.toFixed(0)} — regression fallback non rescale ?`);
  assert.ok(Math.abs(sum(out.hourly) - annual) < 0.5);
});

test("CSV horaire partiel : alignement calendrier", () => {
  const { file, startTs } = writePartialLoadCurveCsv(1456);
  const out = loadConsumption({ profil: "active" }, file, {});
  const startOfYear = Date.UTC(2026, 0, 1);
  const idx = Math.floor((startTs - startOfYear) / 3600000);
  assert.equal(idx, 38 * 24 + 4);
  assert.ok(Math.abs(out.hourly[idx] - 0.728) < 0.001, `hourly[${idx}]=${out.hourly[idx]}`);
  assert.ok(out.hourly[0] > 0);
});

test("CSV horaire complet (>= 8760) : branche full-year inchangee", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solarnext-full-"));
  const file = path.join(dir, "loadcurve.csv");
  const start = Date.UTC(2025, 0, 1);
  const lines = ["prm,startDate,powerInWatts"];
  for (let i = 0; i < 8760; i++) {
    lines.push(`1,${new Date(start + i * 3600 * 1000).toISOString()},1000`);
  }
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  const out = loadConsumption({ profil: "active" }, file, {});
  assert.equal(out.engine_consumption_source, "CSV_HOURLY_FULL_YEAR");
  assert.ok(Math.abs(out.annual_kwh - 8760) < 20, `annual=${out.annual_kwh}`);
});
