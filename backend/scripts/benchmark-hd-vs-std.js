/**
 * CP-FAR-IGN-06 — Benchmark HD vs STD (précision + CPU)
 * Compare mode STD (step=2, radius=500) et HD (step=1, radius=800) sur 6 points France.
 * Mesure: durée CPU, range/stdDev masque, totalLossPct.
 * Usage: cd backend && node scripts/benchmark-hd-vs-std.js
 */

import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import fs from "fs";
import path from "path";

const BENCHMARK_POINTS = [
  { name: "Urbain dense", lat: 48.8566, lon: 2.3522 },
  { name: "Campagne plate", lat: 48.2, lon: 1.7 },
  { name: "Montagne", lat: 45.9237, lon: 6.8694 },
  { name: "Vallée encaissée", lat: 45.5, lon: 6.5 },
  { name: "Zone côtière", lat: 43.6959, lon: 7.2712 },
  { name: "Zone forêt", lat: 48.4045, lon: 2.7012 },
];

const MINIMAL_PANEL = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

function maskStats(mask) {
  if (!mask || mask.length === 0) {
    return { range: 0, stdDev: 0, mean: 0 };
  }
  const elevs = mask.map((m) => Number(m.elev ?? 0));
  const min = Math.min(...elevs);
  const max = Math.max(...elevs);
  const mean = elevs.reduce((a, b) => a + b, 0) / elevs.length;
  const variance = elevs.reduce((s, x) => s + (x - mean) ** 2, 0) / elevs.length;
  const stdDev = Math.sqrt(variance);
  return { range: max - min, stdDev, mean };
}

async function runStd(point) {
  process.env.FAR_HORIZON_HD_ENABLE = "false";
  const t0 = performance.now();
  const horizon = await computeHorizonMaskAuto({
    lat: point.lat,
    lon: point.lon,
    radius_m: 500,
    step_deg: 2,
    enableHD: false,
  });
  const duration = performance.now() - t0;
  const stats = maskStats(horizon?.mask);
  const shading = await computeCalpinageShading({
    lat: point.lat,
    lon: point.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    options: { __testHorizonMaskOverride: horizon },
  });
  const totalLossPct = shading?.totalLossPct ?? null;
  return { duration, range: stats.range, stdDev: stats.stdDev, totalLossPct };
}

async function runHd(point) {
  process.env.FAR_HORIZON_HD_ENABLE = "true";
  process.env.FAR_HORIZON_HD_STEP_DEG = process.env.FAR_HORIZON_HD_STEP_DEG || "1";
  process.env.FAR_HORIZON_HD_RADIUS_M = process.env.FAR_HORIZON_HD_RADIUS_M || "800";
  const t0 = performance.now();
  const horizon = await computeHorizonMaskAuto({
    lat: point.lat,
    lon: point.lon,
    radius_m: 800,
    step_deg: 1,
    enableHD: true,
  });
  const duration = performance.now() - t0;
  const stats = maskStats(horizon?.mask);
  const shading = await computeCalpinageShading({
    lat: point.lat,
    lon: point.lon,
    panels: [MINIMAL_PANEL],
    obstacles: [],
    options: { __testHorizonMaskOverride: horizon },
  });
  const totalLossPct = shading?.totalLossPct ?? null;
  return { duration, range: stats.range, stdDev: stats.stdDev, totalLossPct };
}

function main() {
  const dsmEnabled = process.env.HORIZON_DSM_ENABLED === "true";
  if (!dsmEnabled) {
    console.warn("[BENCHMARK] HORIZON_DSM_ENABLED is not 'true' — horizon will use RELIEF_ONLY. Results reflect resolution/radius difference only.");
  }

  const points = [];
  let sumDurationStd = 0;
  let sumDurationHd = 0;
  const lossDeltas = [];
  const rangeDeltas = [];
  const stdDevDeltas = [];

  return (async () => {
    console.log("\n===== HD vs STD BENCHMARK =====\n");

    for (const point of BENCHMARK_POINTS) {
      const name = point.name;
      const std = await runStd(point);
      const hd = await runHd(point);

      const cpuRatio = std.duration > 0 ? hd.duration / std.duration : 0;
      const lossDelta =
        std.totalLossPct != null && hd.totalLossPct != null
          ? Math.abs(hd.totalLossPct - std.totalLossPct)
          : null;
      const rangeDelta = hd.range - std.range;
      const stdDevDelta = hd.stdDev - std.stdDev;

      if (lossDelta != null) lossDeltas.push(lossDelta);
      rangeDeltas.push(rangeDelta);
      stdDevDeltas.push(stdDevDelta);
      sumDurationStd += std.duration;
      sumDurationHd += hd.duration;

      points.push({
        name,
        lat: point.lat,
        lon: point.lon,
        std: {
          durationMs: Math.round(std.duration * 100) / 100,
          range: Math.round(std.range * 1000) / 1000,
          stdDev: Math.round(std.stdDev * 1000) / 1000,
          totalLossPct: std.totalLossPct != null ? Math.round(std.totalLossPct * 100) / 100 : null,
        },
        hd: {
          durationMs: Math.round(hd.duration * 100) / 100,
          range: Math.round(hd.range * 1000) / 1000,
          stdDev: Math.round(hd.stdDev * 1000) / 1000,
          totalLossPct: hd.totalLossPct != null ? Math.round(hd.totalLossPct * 100) / 100 : null,
        },
        cpuRatio: Math.round(cpuRatio * 100) / 100,
        lossDelta: lossDelta != null ? Math.round(lossDelta * 100) / 100 : null,
        rangeDelta: Math.round(rangeDelta * 1000) / 1000,
        stdDevDelta: Math.round(stdDevDelta * 1000) / 1000,
      });

      console.log(
        `[${name}] STD ${Math.round(std.duration)} ms | HD ${Math.round(hd.duration)} ms | ratio ${cpuRatio.toFixed(2)}x | lossDelta ${lossDelta != null ? lossDelta.toFixed(2) + " %" : "—"} | rangeDelta ${rangeDelta.toFixed(3)}° | stdDevDelta ${stdDevDelta.toFixed(3)}°`
      );
    }

    const n = BENCHMARK_POINTS.length;
    const cpuStdMean = sumDurationStd / n;
    const cpuHdMean = sumDurationHd / n;
    const cpuRatio = cpuStdMean > 0 ? cpuHdMean / cpuStdMean : 0;
    const meanLossDelta = lossDeltas.length ? lossDeltas.reduce((a, b) => a + b, 0) / lossDeltas.length : 0;
    const maxLossDelta = lossDeltas.length ? Math.max(...lossDeltas) : 0;
    const meanRangeDelta = rangeDeltas.reduce((a, b) => a + b, 0) / n;
    const meanStdDevDelta = stdDevDeltas.reduce((a, b) => a + b, 0) / n;

    console.log("\n----- Summary -----");
    console.log("CPU mean STD: " + Math.round(cpuStdMean * 100) / 100 + " ms");
    console.log("CPU mean HD : " + Math.round(cpuHdMean * 100) / 100 + " ms");
    console.log("CPU ratio   : " + Math.round(cpuRatio * 100) / 100 + "x");
    console.log("Mean loss delta: " + meanLossDelta.toFixed(2) + " %");
    console.log("Max loss delta : " + maxLossDelta.toFixed(2) + " %");
    console.log("Mean range delta: " + (meanRangeDelta >= 0 ? "+" : "") + meanRangeDelta.toFixed(3) + "°");
    console.log("Mean stdDev delta: " + (meanStdDevDelta >= 0 ? "+" : "") + meanStdDevDelta.toFixed(3) + "°");

    const summary = {
      cpuStdMean: Math.round(cpuStdMean * 100) / 100,
      cpuHdMean: Math.round(cpuHdMean * 100) / 100,
      cpuRatio: Math.round(cpuRatio * 100) / 100,
      meanLossDelta: Math.round(meanLossDelta * 100) / 100,
      maxLossDelta: Math.round(maxLossDelta * 100) / 100,
      meanRangeDelta: Math.round(meanRangeDelta * 1000) / 1000,
      meanStdDevDelta: Math.round(meanStdDevDelta * 1000) / 1000,
    };

    const reportDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const reportPath = path.join(reportDir, "hd-vs-std-benchmark-" + dateStr + ".json");
    const payload = { points, summary, runAt: new Date().toISOString() };
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), "utf8");
    console.log("\nReport written: " + reportPath);
    console.log("\n===== HD vs STD BENCHMARK =====\n");
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
