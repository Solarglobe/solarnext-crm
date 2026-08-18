#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { buildHourlyPV } from "../../services/solarModelService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node backend/scripts/export-study/analyze-hourly-reconstructability.mjs <snapshot.json>");
  process.exit(2);
}

const resolvedInput = path.resolve(process.cwd(), inputPath);
const resultsDir = path.join(__dirname, "results");

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function assertHourly(values, label) {
  if (!Array.isArray(values) || values.length !== 8760) {
    throw new Error(`${label} must be an array of 8760 values`);
  }
  const invalidIndex = values.findIndex((value) => !Number.isFinite(Number(value)) || Number(value) < 0);
  if (invalidIndex !== -1) {
    throw new Error(`${label} contains an invalid value at index ${invalidIndex}`);
  }
  return values.map((value) => Number(value));
}

function monthlySums8760(values) {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [];
  let cursor = 0;
  for (const dayCount of days) {
    const hours = dayCount * 24;
    out.push(sum(values.slice(cursor, cursor + hours)));
    cursor += hours;
  }
  return out;
}

function monthlyDiffs(sourceMonthly, rebuiltMonthly) {
  return sourceMonthly.map((source, index) => {
    const rebuilt = rebuiltMonthly[index];
    return {
      month: index + 1,
      source_kwh: round(source, 6),
      rebuilt_kwh: round(rebuilt, 6),
      diff_kwh: round(rebuilt - source, 9),
      diff_pct: source ? round(((rebuilt - source) / source) * 100, 9) : null,
    };
  });
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function renderReport(summary) {
  const pvMaxAbsDiff = Math.max(...summary.production.monthly_diffs.map((m) => Math.abs(m.diff_kwh)));
  const consoMaxAbsDiff = summary.consumption.monthly_diffs?.length
    ? Math.max(...summary.consumption.monthly_diffs.map((m) => Math.abs(m.diff_kwh)))
    : null;

  return `# Validation horaire ${summary.study_reference}

## Statut

- Statut: ${summary.status}
- Source: ${summary.input_file}
- Fichier benchmark: ${summary.output_json}

## Consommation

- Courbe source: ${summary.consumption.source_path}
- Longueur: ${summary.consumption.length}
- Somme annuelle: ${summary.consumption.annual_sum_kwh} kWh
- Annuel déclaré: ${summary.consumption.annual_declared_kwh} kWh
- Ecart annuel: ${summary.consumption.annual_diff_kwh} kWh
${consoMaxAbsDiff == null ? "- Totaux mensuels source: non disponibles\n" : `- Ecart mensuel max: ${round(consoMaxAbsDiff, 9)} kWh\n`}
## Production PV

- Méthode: ${summary.production.method}
- Source mensuelle: ${summary.production.source_monthly_path}
- Longueur: ${summary.production.length}
- Somme annuelle reconstruite: ${summary.production.annual_sum_kwh} kWh
- Somme mensuelle source: ${summary.production.annual_source_kwh} kWh
- Ecart annuel: ${summary.production.annual_diff_kwh} kWh
- Ecart mensuel max: ${round(pvMaxAbsDiff, 9)} kWh

## Anomalies

${summary.anomalies.length ? summary.anomalies.map((a) => `- ${a}`).join("\n") : "- Aucune anomalie bloquante détectée."}
`;
}

async function main() {
  const raw = await fs.readFile(resolvedInput, "utf8");
  const snapshot = JSON.parse(raw);

  const studyRef = snapshot?.export_metadata?.study_reference || "SGS-2026-0137";
  const outputJson = path.join(resultsDir, `${studyRef}-hourly-benchmark.json`);
  const outputReport = path.join(resultsDir, `${studyRef}-hourly-benchmark-report.md`);

  const anomalies = [];
  const consumptionRaw = snapshot?.raw_technical_snapshots?.lead?.energy_profile?.engine?.hourly;
  const consumptionHourly = assertHourly(consumptionRaw, "consumption hourly curve");
  const consumptionAnnualDeclared =
    Number(snapshot?.raw_technical_snapshots?.lead?.energy_profile?.engine?.annual_kwh) ||
    Number(snapshot?.consumption?.annual_kwh) ||
    null;
  const consumptionMonthlySource = Array.isArray(snapshot?.consumption?.monthly_kwh) && snapshot.consumption.monthly_kwh.length === 12
    ? snapshot.consumption.monthly_kwh.map(Number)
    : null;
  const consumptionMonthlyRebuilt = monthlySums8760(consumptionHourly);

  const sourceMonthly =
    snapshot?.results?.final_study_json?.production?.monthlyKwh ||
    snapshot?.results?.scenarios_v2?.[0]?.production?.monthly_kwh;
  if (!Array.isArray(sourceMonthly) || sourceMonthly.length !== 12) {
    throw new Error("production monthly source must be an array of 12 values");
  }
  const productionMonthlySource = sourceMonthly.map((value) => Number(value) || 0);

  const lat = Number(snapshot?.site?.latitude);
  const lon = Number(snapshot?.site?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("site latitude/longitude are required for buildHourlyPV deterministic seed");
  }

  const productionHourly = assertHourly(
    buildHourlyPV(productionMonthlySource, { site: { lat, lon } }),
    "production hourly curve"
  );
  const productionMonthlyRebuilt = monthlySums8760(productionHourly);

  const consumptionAnnualSum = sum(consumptionHourly);
  const productionAnnualSum = sum(productionHourly);
  const productionAnnualSource = sum(productionMonthlySource);

  const consumptionAnnualDiff = consumptionAnnualDeclared == null ? null : consumptionAnnualSum - consumptionAnnualDeclared;
  if (consumptionAnnualDeclared != null && Math.abs(consumptionAnnualDiff) > Math.max(1, consumptionAnnualDeclared * 0.01)) {
    anomalies.push("Consommation: somme horaire éloignée de plus de 1% de l'annuel déclaré.");
  }

  const productionDiffs = monthlyDiffs(productionMonthlySource, productionMonthlyRebuilt);
  const maxPvMonthlyAbsDiff = Math.max(...productionDiffs.map((m) => Math.abs(m.diff_kwh)));
  if (maxPvMonthlyAbsDiff > 0.001) {
    anomalies.push("Production: écart mensuel supérieur à 0.001 kWh après reconstruction.");
  }

  const result = {
    export_metadata: {
      study_reference: studyRef,
      generated_at: new Date().toISOString(),
      input_file: resolvedInput,
      method: "local_snapshot_readonly_plus_solarModelService.buildHourlyPV",
      no_database_access: true,
      no_vps_access: true,
      no_business_service_modified: true,
    },
    consumption: {
      source_path: "raw_technical_snapshots.lead.energy_profile.engine.hourly",
      hourly_8760_kwh: consumptionHourly,
      length: consumptionHourly.length,
      annual_sum_kwh: round(consumptionAnnualSum, 6),
      annual_declared_kwh: consumptionAnnualDeclared == null ? null : round(consumptionAnnualDeclared, 6),
      annual_diff_kwh: consumptionAnnualDiff == null ? null : round(consumptionAnnualDiff, 6),
      monthly_rebuilt_kwh: consumptionMonthlyRebuilt.map((v) => round(v, 6)),
      monthly_source_kwh: consumptionMonthlySource,
      monthly_diffs: consumptionMonthlySource ? monthlyDiffs(consumptionMonthlySource, consumptionMonthlyRebuilt) : [],
    },
    production: {
      method: "solarModelService.buildHourlyPV",
      source_monthly_path: "results.final_study_json.production.monthlyKwh",
      source_monthly_kwh: productionMonthlySource,
      hourly_8760_kwh: productionHourly,
      length: productionHourly.length,
      annual_sum_kwh: round(productionAnnualSum, 6),
      annual_source_kwh: round(productionAnnualSource, 6),
      annual_diff_kwh: round(productionAnnualSum - productionAnnualSource, 9),
      monthly_rebuilt_kwh: productionMonthlyRebuilt.map((v) => round(v, 6)),
      monthly_diffs: productionDiffs,
      site_seed: { lat, lon },
    },
    anomalies,
  };

  const summary = {
    study_reference: studyRef,
    status: "success",
    input_file: resolvedInput,
    output_json: outputJson,
    consumption: {
      source_path: result.consumption.source_path,
      length: result.consumption.length,
      annual_sum_kwh: result.consumption.annual_sum_kwh,
      annual_declared_kwh: result.consumption.annual_declared_kwh,
      annual_diff_kwh: result.consumption.annual_diff_kwh,
      monthly_diffs: result.consumption.monthly_diffs,
    },
    production: {
      method: result.production.method,
      source_monthly_path: result.production.source_monthly_path,
      length: result.production.length,
      annual_sum_kwh: result.production.annual_sum_kwh,
      annual_source_kwh: result.production.annual_source_kwh,
      annual_diff_kwh: result.production.annual_diff_kwh,
      monthly_diffs: result.production.monthly_diffs,
    },
    anomalies,
  };

  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(outputJson, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(outputReport, renderReport(summary), "utf8");

  const jsonHash = await sha256(outputJson);
  const reportHash = await sha256(outputReport);
  console.log(JSON.stringify({
    status: "success",
    output_json: outputJson,
    output_report: outputReport,
    output_json_sha256: jsonHash,
    output_report_sha256: reportHash,
    consumption_length: result.consumption.length,
    production_length: result.production.length,
    consumption_annual_sum_kwh: result.consumption.annual_sum_kwh,
    production_annual_sum_kwh: result.production.annual_sum_kwh,
    production_monthly_max_abs_diff_kwh: round(Math.max(...productionDiffs.map((m) => Math.abs(m.diff_kwh))), 9),
    anomalies,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "error",
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
