/**
 * CP-FAR-012 — Bench performance moteur shading / horizon
 * Mesure temps sans accès réseau. Aucune modification du moteur.
 * Usage: node scripts/bench-shading-performance.js
 */

import { computeHorizonMaskReliefOnly } from "../services/horizon/horizonMaskCore.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
import { computeHorizonRaycastHD } from "../services/horizon/hd/horizonRaycastHdCore.js";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

const LAT = 48.8566;
const LON = 2.3522;
const RUNS = 10;

const panel = {
  id: "p1",
  polygon: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 60 }],
};
const geometry = { frozenBlocks: [{ panels: [panel] }] };

function createDenseSampler() {
  const siteLat = LAT;
  const siteLon = LON;
  const M_PER_DEG = 111320;
  const mPerDegLon = M_PER_DEG * Math.cos((siteLat * Math.PI) / 180);
  return (lat, lon) => {
    const dLat = (lat - siteLat) * M_PER_DEG;
    const dLon = (lon - siteLon) * mPerDegLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    const az = Math.atan2(dLon, dLat) * (180 / Math.PI) + 180;
    if (az >= 90 && az <= 270 && dist > 150 && dist < 300) return 15;
    return 2;
  };
}

function bench(name, fn) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / RUNS;
  const max = Math.max(...times);
  return { name, avg, max, times };
}

function benchAsync(name, fn) {
  const times = [];
  return (async () => {
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      await fn();
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / RUNS;
    const max = Math.max(...times);
    return { name, avg, max, times };
  })();
}

async function main() {
  const origDsm = process.env.HORIZON_DSM_ENABLED;
  process.env.HORIZON_DSM_ENABLED = "false";

  console.log("\n=== CP-FAR-012 — Bench Performance ===\n");
  console.log("Runs:", RUNS, "par scénario\n");

  const results = [];

  // --- RELIEF_ONLY step 2 ---
  const r1 = bench("RELIEF_ONLY step=2", () => {
    computeHorizonMaskReliefOnly({ lat: LAT, lon: LON, radius_m: 500, step_deg: 2 });
  });
  results.push({
    mode: "RELIEF_ONLY",
    step_deg: 2,
    avgMs: r1.avg.toFixed(2),
    maxMs: r1.max.toFixed(2),
    bins: 180,
    maxDistance: 500,
    gridRes: 25,
  });

  // --- RELIEF_ONLY step 1 ---
  const r2 = bench("RELIEF_ONLY step=1", () => {
    computeHorizonMaskReliefOnly({ lat: LAT, lon: LON, radius_m: 500, step_deg: 1 });
  });
  results.push({
    mode: "RELIEF_ONLY",
    step_deg: 1,
    avgMs: r2.avg.toFixed(2),
    maxMs: r2.max.toFixed(2),
    bins: 360,
    maxDistance: 500,
    gridRes: 25,
  });

  // --- RELIEF_ONLY step 0.5 ---
  const r3 = bench("RELIEF_ONLY step=0.5", () => {
    computeHorizonMaskReliefOnly({ lat: LAT, lon: LON, radius_m: 500, step_deg: 0.5 });
  });
  results.push({
    mode: "RELIEF_ONLY",
    step_deg: 0.5,
    avgMs: r3.avg.toFixed(2),
    maxMs: r3.max.toFixed(2),
    bins: 720,
    maxDistance: 500,
    gridRes: 25,
  });

  // --- computeHorizonMaskAuto (RELIEF) ---
  const r4 = await benchAsync("computeHorizonMaskAuto RELIEF", () =>
    computeHorizonMaskAuto({ lat: LAT, lon: LON, radius_m: 500, step_deg: 2 })
  );
  results.push({
    mode: "HorizonMaskAuto",
    step_deg: 2,
    avgMs: r4.avg.toFixed(2),
    maxMs: r4.max.toFixed(2),
    bins: 180,
    maxDistance: 500,
    gridRes: 25,
  });

  // --- HD step 1 (synthetic sampler) ---
  const sampler = createDenseSampler();
  const r5 = bench("RAYCAST_HD step=1 dense", () => {
    computeHorizonRaycastHD({
      heightSampler: sampler,
      site: { lat: LAT, lon: LON },
      z0Meters: 0,
      stepDeg: 1,
      maxDistanceMeters: 4000,
    });
  });
  results.push({
    mode: "RAYCAST_HD",
    step_deg: 1,
    avgMs: r5.avg.toFixed(2),
    maxMs: r5.max.toFixed(2),
    bins: 360,
    maxDistance: 4000,
    gridRes: 10,
  });

  // --- HD step 0.5 ---
  const r6 = bench("RAYCAST_HD step=0.5 dense", () => {
    computeHorizonRaycastHD({
      heightSampler: sampler,
      site: { lat: LAT, lon: LON },
      z0Meters: 0,
      stepDeg: 0.5,
      maxDistanceMeters: 4000,
    });
  });
  results.push({
    mode: "RAYCAST_HD",
    step_deg: 0.5,
    avgMs: r6.avg.toFixed(2),
    maxMs: r6.max.toFixed(2),
    bins: 720,
    maxDistance: 4000,
    gridRes: 10,
  });

  // --- computeCalpinageShading (full pipeline) ---
  const r7 = await benchAsync("computeCalpinageShading full", () =>
    computeCalpinageShading({ lat: LAT, lon: LON, geometry })
  );
  results.push({
    mode: "CalpinageShading",
    step_deg: 2,
    avgMs: r7.avg.toFixed(2),
    maxMs: r7.max.toFixed(2),
    bins: "-",
    maxDistance: 500,
    gridRes: 25,
  });

  if (origDsm) process.env.HORIZON_DSM_ENABLED = origDsm;

  // --- Affichage ---
  console.log("Résultats:\n");
  console.log(JSON.stringify(results, null, 2));

  console.log("\n--- Critères acceptation ---");
  const reliefOk = r1.avg < 50 && r2.avg < 50 && r3.avg < 50;
  const hd1Ok = r5.avg < 250;
  const hd05Ok = r6.avg < 500;
  console.log("RELIEF_ONLY < 50ms:", reliefOk ? "✅" : "❌", "avg:", r1.avg.toFixed(1), "ms");
  console.log("HD step 1° < 250ms:", hd1Ok ? "✅" : "❌", "avg:", r5.avg.toFixed(1), "ms");
  console.log("HD step 0.5° < 500ms:", hd05Ok ? "✅" : "❌", "avg:", r6.avg.toFixed(1), "ms");

  const allOk = reliefOk && hd1Ok && hd05Ok;
  if (!allOk) {
    console.log("\n⚠️  Certains critères non atteints (bench indicatif)");
  } else {
    console.log("\n✅ Tous les critères atteints");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
