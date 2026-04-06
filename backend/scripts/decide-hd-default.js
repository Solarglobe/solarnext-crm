/**
 * CP-FAR-IGN-06 — Décision automatique : HD par défaut ou non
 * Lit le dernier benchmark HD vs STD, applique des seuils configurables,
 * produit une recommandation (sans modifier le moteur ni les ENV).
 * Usage: cd backend && node scripts/decide-hd-default.js
 *
 * Seuils (ENV, optionnel) :
 *   HD_DECISION_LOSS_MEAN_THRESHOLD=0.3   — gain précision moyen (%) pour considérer significatif
 *   HD_DECISION_LOSS_MAX_THRESHOLD=0.8    — gain précision max (%) pour considérer significatif
 *   HD_DECISION_CPU_RATIO_MAX=3           — ratio CPU max acceptable (HD/STD)
 */

import fs from "fs";
import path from "path";

const REPORTS_DIR = path.join(process.cwd(), "reports");
const BENCHMARK_PREFIX = "hd-vs-std-benchmark-";
const BENCHMARK_GLOB = BENCHMARK_PREFIX + "*.json";

const LOSS_MEAN_THRESHOLD = Number(process.env.HD_DECISION_LOSS_MEAN_THRESHOLD) || 0.3;
const LOSS_MAX_THRESHOLD = Number(process.env.HD_DECISION_LOSS_MAX_THRESHOLD) || 0.8;
const CPU_RATIO_MAX = Number(process.env.HD_DECISION_CPU_RATIO_MAX) || 3;

function findLatestBenchmark() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const files = fs.readdirSync(REPORTS_DIR);
  const benchmarks = files.filter((f) => f.startsWith(BENCHMARK_PREFIX) && f.endsWith(".json"));
  if (benchmarks.length === 0) return null;
  benchmarks.sort((a, b) => {
    const dateA = a.slice(BENCHMARK_PREFIX.length, -5);
    const dateB = b.slice(BENCHMARK_PREFIX.length, -5);
    return dateB.localeCompare(dateA);
  });
  return path.join(REPORTS_DIR, benchmarks[0]);
}

function main() {
  const benchmarkPath = findLatestBenchmark();
  if (!benchmarkPath) {
    console.error("[DECIDE-HD] No benchmark found. Run: npm run benchmark-hd-vs-std");
    process.exit(1);
  }

  const raw = fs.readFileSync(benchmarkPath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("[DECIDE-HD] Invalid JSON:", benchmarkPath, e.message);
    process.exit(1);
  }

  const summary = data.summary || {};
  const cpuRatioMean = summary.cpuRatio ?? 0;
  const meanLossDelta = summary.meanLossDelta ?? 0;
  const maxLossDelta = summary.maxLossDelta ?? 0;

  const significantPrecision =
    meanLossDelta > LOSS_MEAN_THRESHOLD || maxLossDelta > LOSS_MAX_THRESHOLD;
  const acceptableCost = cpuRatioMean < CPU_RATIO_MAX;
  const enableHdByDefault = significantPrecision && acceptableCost;

  const decision = enableHdByDefault ? "ENABLE HD BY DEFAULT" : "KEEP STD BY DEFAULT";

  console.log("\n===== HD DEFAULT DECISION =====");
  console.log("Mean loss gain : " + meanLossDelta.toFixed(2) + " %");
  console.log("Max loss gain  : " + maxLossDelta.toFixed(2) + " %");
  console.log("CPU ratio      : " + cpuRatioMean.toFixed(2) + "x");
  console.log("Decision       : " + decision);
  console.log("(thresholds: meanLoss>" + LOSS_MEAN_THRESHOLD + " % OR maxLoss>" + LOSS_MAX_THRESHOLD + " %, cpuRatio<" + CPU_RATIO_MAX + "x)");
  console.log("===============================\n");

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const reportPath = path.join(REPORTS_DIR, "hd-decision-" + dateStr + ".json");
  const payload = {
    decision: enableHdByDefault ? "HD_DEFAULT_TRUE" : "HD_DEFAULT_FALSE",
    recommendation: decision,
    fromBenchmark: path.basename(benchmarkPath),
    benchmarkRunAt: data.runAt ?? null,
    inputs: {
      cpuRatioMean,
      meanLossDelta,
      maxLossDelta,
    },
    thresholds: {
      lossMean: LOSS_MEAN_THRESHOLD,
      lossMax: LOSS_MAX_THRESHOLD,
      cpuRatioMax: CPU_RATIO_MAX,
    },
    rules: {
      significantPrecision,
      acceptableCost,
      enableHdByDefault,
    },
    decidedAt: new Date().toISOString(),
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("Report written: " + reportPath);
}

main();
