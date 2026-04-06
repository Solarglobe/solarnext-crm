/**
 * CP-FAR-C-04 — Audit performance HD (raycast DSM)
 * Valide: activation HD, timeBudget, fallback legacy, latence, mémoire, stabilité.
 * Usage: node backend/scripts/test-hd-performance.js
 *
 * Env optionnels pour activer HD (sinon RELIEF ou stub):
 *   HORIZON_DSM_ENABLED=true
 *   DSM_ENABLE=true
 *   DSM_PROVIDER_TYPE=HTTP_GEOTIFF
 *   DSM_GEOTIFF_URL_TEMPLATE=<URL valide ou fixture>
 *   FAR_HORIZON_HD_ENABLE=true
 *   FAR_HORIZON_HD_TIME_BUDGET_MS=3000
 *
 * Exit 0 = PASS, 1 = FAIL
 */

import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";

const LAT = 48.8566;
const LON = 2.3522;
const RADIUS_M = 500;
const STEP_DEG = 2;
const TIME_BUDGET_MS =
  process.env.FAR_HORIZON_HD_TIME_BUDGET_MS != null && process.env.FAR_HORIZON_HD_TIME_BUDGET_MS !== ""
    ? parseInt(process.env.FAR_HORIZON_HD_TIME_BUDGET_MS, 10)
    : 3000;
const BUDGET_TOLERANCE = 1.2;
const TARGET_MEAN_MS = 800;
const TARGET_P95_MS = 1500;
const MEMORY_GROWTH_PCT_MAX = 15;
const N_LATENCY = 10;
const N_MEMORY = 100;

function getMaxElev(mask) {
  if (!mask || !Array.isArray(mask)) return null;
  let max = -Infinity;
  for (const m of mask) {
    const e = m?.elev ?? 0;
    if (Number.isFinite(e) && e > max) max = e;
  }
  return Number.isFinite(max) ? max : null;
}

function percentile(sortedArr, p) {
  if (!sortedArr || sortedArr.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

async function main() {
  console.log("CP-FAR-C-04 — Audit performance HD (raycast DSM)\n");
  console.log("Env: HORIZON_DSM_ENABLED=" + process.env.HORIZON_DSM_ENABLED);
  console.log("     DSM_ENABLE=" + process.env.DSM_ENABLE);
  console.log("     DSM_PROVIDER_TYPE=" + process.env.DSM_PROVIDER_TYPE);
  console.log("     FAR_HORIZON_HD_TIME_BUDGET_MS=" + TIME_BUDGET_MS + "\n");

  const failures = [];
  let hdActivated = false;
  let fallbackTriggered = false;
  let meanMs = null;
  let p95Ms = null;
  let maxMs = null;
  let memoryStable = true;

  // --- A) Activation HD ---
  console.log("--- A) Activation HD ---");
  const params = { lat: LAT, lon: LON, radius_m: RADIUS_M, step_deg: STEP_DEG, enableHD: true };
  let result;
  try {
    result = await computeHorizonMaskAuto(params);
  } catch (err) {
    console.log("Erreur:", err.message);
    failures.push("computeHorizonMaskAuto throw: " + err.message);
    result = null;
  }

  if (result) {
    const provider = result.source || "unknown";
    const mask = result.mask || [];
    const maxElev = getMaxElev(mask);
    hdActivated = result.meta?.algorithm === "RAYCAST_HD";
    const elapsed = result.meta?.elapsedMs;
    fallbackTriggered =
      params.enableHD && provider === "SURFACE_DSM" && result.meta?.algorithm !== "RAYCAST_HD";

    console.log("provider final:", provider);
    console.log("hdActivated:", hdActivated);
    console.log("elapsed ms:", elapsed != null ? elapsed : "(n/a)");
    console.log("maxElev:", maxElev != null ? maxElev.toFixed(2) + "°" : "(n/a)");
    console.log("fallbackUsed:", fallbackTriggered);

    if (provider === "RELIEF_ONLY") {
      failures.push("provider = RELIEF_ONLY (DSM non activé ou indisponible)");
    }
    if (params.enableHD && !hdActivated && provider === "SURFACE_DSM") {
      console.log("(HD demandé mais non utilisé: stub ou fallback legacy)");
    }
  }
  console.log("");

  // --- B) TimeBudget + latence (10 runs) ---
  console.log("--- B) TimeBudget + latence (10 runs) ---");
  const latencies = [];
  let exceedCount = 0;
  for (let i = 0; i < N_LATENCY; i++) {
    const t0 = Date.now();
    try {
      const r = await computeHorizonMaskAuto(params);
      const elapsed = Date.now() - t0;
      const metaMs = r?.meta?.elapsedMs;
      if (r?.meta?.algorithm === "RAYCAST_HD" && metaMs != null) {
        latencies.push(metaMs);
        if (metaMs > TIME_BUDGET_MS * BUDGET_TOLERANCE) exceedCount++;
      } else {
        latencies.push(elapsed);
      }
    } catch (e) {
      latencies.push(Date.now() - t0);
      failures.push("Run " + (i + 1) + " throw: " + e.message);
    }
  }
  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    meanMs = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    p95Ms = percentile(sorted, 95);
    maxMs = Math.max(...sorted);
    console.log("mean ms:", meanMs.toFixed(0));
    console.log("p95 ms:", p95Ms != null ? p95Ms.toFixed(0) : "n/a");
    console.log("max ms:", maxMs.toFixed(0));
    if (exceedCount > 0 && hdActivated) {
      console.log("dépassements timeBudget (" + TIME_BUDGET_MS + " ms):", exceedCount);
      if (exceedCount > N_LATENCY / 2) {
        failures.push("dépassements timeBudget trop fréquents");
      }
    }
  } else {
    console.log("(aucune mesure HD — provider non HD)");
  }
  console.log("");

  // --- C) Fallback maîtrisé (radius 3000, step 1°) ---
  console.log("--- C) Fallback maîtrisé (radius 3000 m, step 1°) ---");
  const heavyParams = {
    lat: LAT,
    lon: LON,
    radius_m: 3000,
    step_deg: 1,
    enableHD: true,
  };
  try {
    const rHeavy = await computeHorizonMaskAuto(heavyParams);
    const mask = rHeavy?.mask;
    const validMask = Array.isArray(mask) && mask.length > 0;
    console.log("masque valide:", validMask ? "oui" : "non");
    console.log("source:", rHeavy?.source || "n/a");
    if (!validMask) failures.push("Fallback: masque vide après calcul lourd");
    if (rHeavy?.source !== "RELIEF_ONLY" && !validMask) failures.push("Fallback: masque vide");
  } catch (e) {
    console.log("crash:", e.message);
    failures.push("Fallback: exception " + e.message);
  }
  console.log("");

  // --- D) Verdict latence ---
  console.log("--- D) Latence ---");
  let latencyVerdict = "🟡 non mesuré (HD non actif)";
  if (meanMs != null) {
    if (meanMs <= TARGET_MEAN_MS && (p95Ms == null || p95Ms <= TARGET_P95_MS)) {
      latencyVerdict = "🟢 acceptable";
    } else if (meanMs <= TARGET_MEAN_MS * 1.5 && (p95Ms == null || p95Ms <= TARGET_P95_MS * 1.5)) {
      latencyVerdict = "🟡 limite";
    } else {
      latencyVerdict = "🔴 trop lent";
      if (meanMs > TARGET_MEAN_MS) failures.push("mean latency > " + TARGET_MEAN_MS + " ms");
    }
  }
  console.log("Verdict:", latencyVerdict);
  console.log("");

  // --- E) Memory ---
  console.log("--- E) Memory (100 appels) ---");
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < N_MEMORY; i++) {
    try {
      await computeHorizonMaskAuto(params);
    } catch (_) {}
  }
  const heapAfter = process.memoryUsage().heapUsed;
  let heapAfterGc = heapAfter;
  if (typeof global.gc === "function") {
    global.gc();
    heapAfterGc = process.memoryUsage().heapUsed;
  } else {
    console.log("(node --expose-gc non utilisé, pas de GC forcé)");
  }
  const growthPct = heapBefore > 0 ? ((heapAfterGc - heapBefore) / heapBefore) * 100 : 0;
  console.log("heap before:", (heapBefore / 1024 / 1024).toFixed(2), "MB");
  console.log("heap after:", (heapAfter / 1024 / 1024).toFixed(2), "MB");
  console.log("heap after GC:", (heapAfterGc / 1024 / 1024).toFixed(2), "MB");
  console.log("growth %:", growthPct.toFixed(2) + "%");
  if (growthPct > MEMORY_GROWTH_PCT_MAX) {
    memoryStable = false;
    if (hdActivated) failures.push("Heap growth > " + MEMORY_GROWTH_PCT_MAX + "% (sous charge HD)");
  }
  console.log("");

  // --- Résumé ---
  console.log("--- Résumé ---");
  console.log("HD activated:", hdActivated ? "YES" : "NO");
  console.log("Mean latency:", meanMs != null ? meanMs.toFixed(0) + " ms" : "n/a");
  console.log("P95 latency:", p95Ms != null ? p95Ms.toFixed(0) + " ms" : "n/a");
  console.log("Max latency:", maxMs != null ? maxMs.toFixed(0) + " ms" : "n/a");
  console.log("Fallback triggered:", fallbackTriggered ? "YES" : "NO");
  console.log("Memory stable:", memoryStable ? "YES" : "NO");
  console.log("");

  let verdict = "🟢";
  if (failures.length > 0) verdict = "🔴";
  else if (!hdActivated) verdict = "🟡 (HD non testé: configurer DSM + HTTP_GEOTIFF)";
  console.log("VERDICT:", verdict);
  if (failures.length > 0) {
    console.log("Failures:", failures.join("; "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
