/**
 * CP-FAR-IGN-01 — Test CLI obligatoire du provider IGN RGE ALTI
 * Données réelles uniquement. Aucun mock, aucune simulation.
 * Usage: node backend/scripts/test-ign-provider.js
 * Exit 0 si PASS. FAIL si altitude plate, variance ≈ 0, grid vide, crash GeoTIFF.
 */

import { getDsmGridFromIgnRgeAlti } from "../services/horizon/providers/ignRgeAltiProvider.js";

const LAT = 48.8566;
const LON = 2.3522;
const RADIUS_M = 500;

const MIN_VARIANCE = 1e-6;
const MIN_GRID_SIZE = 10;

function variance(arr) {
  const n = arr.length;
  if (n === 0) return 0;
  const valid = arr.filter((v) => typeof v === "number" && !isNaN(v));
  if (valid.length === 0) return 0;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length;
}

async function main() {
  let result;
  try {
    result = await getDsmGridFromIgnRgeAlti({ lat: LAT, lon: LON, radius_m: RADIUS_M });
  } catch (err) {
    console.error("FAIL: crash lecture GeoTIFF ou téléchargement:", err.message);
    process.exit(1);
  }

  const { grid, width, height, resolution, source } = result;
  if (!grid || grid.length === 0) {
    console.error("FAIL: grid vide");
    process.exit(1);
  }
  if (width < MIN_GRID_SIZE || height < MIN_GRID_SIZE) {
    console.error("FAIL: grille trop petite");
    process.exit(1);
  }

  const arr = Array.from(grid);
  const validAlt = arr.filter((v) => typeof v === "number" && !isNaN(v));
  if (validAlt.length === 0) {
    console.error("FAIL: aucune altitude valide");
    process.exit(1);
  }

  const minAlt = Math.min(...validAlt);
  const maxAlt = Math.max(...validAlt);
  const varAlt = variance(validAlt);

  if (maxAlt - minAlt < 0.1) {
    console.error("FAIL: altitude plate (max - min < 0.1 m)");
    process.exit(1);
  }
  if (varAlt < MIN_VARIANCE) {
    console.error("FAIL: variance ≈ 0");
    process.exit(1);
  }

  const valid = validAlt.length >= Math.max(10, Math.floor(width * height * 0.1));

  console.log("PROVIDER: " + source);
  console.log("GRID SIZE: " + width + " x " + height);
  console.log("RESOLUTION: " + resolution + "m");
  console.log("MAX ALT: " + maxAlt.toFixed(2));
  console.log("MIN ALT: " + minAlt.toFixed(2));
  console.log("VARIANCE: " + varAlt.toFixed(6));
  console.log("VALID: " + (valid ? "YES" : "NO"));

  if (!valid) {
    console.error("FAIL: trop de no-data");
    process.exit(1);
  }

  console.log("");
  console.log("IGN DSM READY");
  console.log("VARIANCE OK");
  console.log("GRID VALID");
  console.log("VERDICT: 🟢 PASS");
  process.exit(0);
}

main();
