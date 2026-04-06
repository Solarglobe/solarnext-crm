/**
 * CP-FAR-C-06 — Validation couverture France IGN RGE ALTI.
 * Teste 3 zones : Paris (urbain dense), Beauce (campagne), Chamonix (montagne).
 * Assertions : pas de masque plat, variance angulaire, résolution 360, pas d'erreur tuile, source IGN.
 * Ne modifie pas computeHorizonMaskAuto, ni le provider, ni le cache.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
import { getIgnDsmDataDir } from "../services/horizon/providers/ign/ignRgeAltiConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RADIUS_M = 500;
const STEP_DEG = 1;
const MIN_ELEVATION_SPAN_DEG = 0.5;
const MIN_STD_DEV_DEG = 0.2;
const EXPECTED_MASK_LENGTH = 360;

const ZONES = [
  { name: "PARIS", lat: 48.8566, lon: 2.3522 },
  { name: "BEAUCE", lat: 48.05, lon: 1.7 },
  { name: "CHAMONIX", lat: 45.9237, lon: 6.8694 },
];

function ensureIndexBboxes() {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("FAIL: index IGN absent. Exécuter: npm run build-ign-index-bboxes");
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (!index.tiles || index.tiles.length === 0) {
    console.error("FAIL: index IGN vide. Exécuter: npm run build-ign-index-bboxes");
    process.exit(1);
  }
}

function elevationStats(mask) {
  if (!mask || mask.length === 0) return { min: 0, max: 0, stdDev: 0 };
  const elevs = mask.map((m) => Number(m?.elev ?? 0)).filter(Number.isFinite);
  if (elevs.length === 0) return { min: 0, max: 0, stdDev: 0 };
  const min = Math.min(...elevs);
  const max = Math.max(...elevs);
  const mean = elevs.reduce((a, b) => a + b, 0) / elevs.length;
  const variance = elevs.reduce((a, b) => a + (b - mean) ** 2, 0) / elevs.length;
  const stdDev = Math.sqrt(variance);
  return { min, max, stdDev };
}

function runZone(zone) {
  return computeHorizonMaskAuto({
    lat: zone.lat,
    lon: zone.lon,
    radius_m: RADIUS_M,
    step_deg: STEP_DEG,
    enableHD: false,
  }).then((result) => ({ result, zone })).catch((err) => ({ error: err, zone }));
}

function assertPass(zoneName, result, stats) {
  const failures = [];

  if (result.meta?.fallbackReason) {
    failures.push(`fallback involontaire: ${result.meta.fallbackReason}`);
  }

  const farSource = result.meta?.farSource ?? result.dataCoverage?.provider ?? result.source;
  if (farSource !== "IGN_RGE_ALTI") {
    failures.push(`source attendue IGN_RGE_ALTI, obtenue: ${farSource}`);
  }

  if (!Array.isArray(result.mask) || result.mask.length !== EXPECTED_MASK_LENGTH) {
    failures.push(`résolution azimutale: mask.length attendu ${EXPECTED_MASK_LENGTH}, obtenu ${result.mask?.length ?? "n/a"}`);
  }

  const span = stats.max - stats.min;
  if (span < MIN_ELEVATION_SPAN_DEG) {
    failures.push(`masque plat suspect: maxElev - minElev = ${span.toFixed(3)}° < ${MIN_ELEVATION_SPAN_DEG}°`);
  }

  if (stats.stdDev < MIN_STD_DEV_DEG) {
    failures.push(`variance angulaire faible: stdDev = ${stats.stdDev.toFixed(3)}° < ${MIN_STD_DEV_DEG}°`);
  }

  if (failures.length > 0) {
    console.log(`[${zoneName}] FAIL — ${failures.join("; ")}`);
    if (stats) {
      console.log(`  minElev=${(stats.min).toFixed(3)}° maxElev=${(stats.max).toFixed(3)}° stdDev=${(stats.stdDev).toFixed(3)}°`);
    }
    return false;
  }
  console.log(`[${zoneName}] PASS`);
  console.log(`  minElev=${(stats.min).toFixed(3)}° maxElev=${(stats.max).toFixed(3)}° stdDev=${(stats.stdDev).toFixed(3)}°`);
  return true;
}

async function main() {
  ensureIndexBboxes();

  process.env.HORIZON_DSM_ENABLED = "true";
  process.env.DSM_ENABLE = "true";
  process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

  let passed = 0;
  for (const zone of ZONES) {
    let outcome;
    try {
      outcome = await runZone(zone);
    } catch (err) {
      console.log(`[${zone.name}] FAIL — erreur tuile/mosaïque: ${err?.message ?? err}`);
      passed = -1;
      break;
    }

    if (outcome.error) {
      console.log(`[${zone.name}] FAIL — erreur réseau/tuile: ${outcome.error?.message ?? outcome.error}`);
      passed = -1;
      break;
    }

    const { result, zone: z } = outcome;
    const stats = elevationStats(result.mask);
    if (assertPass(z.name, result, stats)) passed += 1;
    else { passed = -1; break; }
  }

  if (passed !== ZONES.length) {
    process.exit(1);
  }
  console.log("");
  console.log(`${ZONES.length}/${ZONES.length} PASS — IGN RGE ALTI couvre les 3 zones sans masque plat, sans trou, sans erreur tuile.`);
}

main().catch((err) => {
  console.error("Erreur:", err?.message ?? err);
  process.exit(1);
});
