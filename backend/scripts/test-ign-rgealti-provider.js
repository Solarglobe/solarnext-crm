/**
 * CP-FAR-IGN-01 — Test CLI IGN RGE ALTI (données réelles, PASS obligatoire).
 * Télécharge si nécessaire, charge la grille pour Paris, vérifie variance.
 * Sortie exacte si PASS. exit(0) si PASS, exit(1) sinon.
 */

import { getIgnDsmGridForSite } from "../services/horizon/providers/ignRgeAltiProvider.js";

const LAT = 48.8566;
const LON = 2.3522;
const RADIUS_M = 500;
const MIN_VARIANCE = 1e-6;

function variance(arr) {
  const valid = arr.filter((v) => typeof v === "number" && !isNaN(v));
  if (valid.length === 0) return 0;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length;
}

async function main() {
  let dsm;
  try {
    dsm = await getIgnDsmGridForSite({ lat: LAT, lon: LON, radius_m: RADIUS_M });
  } catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
  }

  const { grid, width, height, source } = dsm;
  if (!grid || grid.length === 0) {
    console.error("FAIL: grid vide");
    process.exit(1);
  }
  if (width < 2 || height < 2) {
    console.error("FAIL: grille trop petite");
    process.exit(1);
  }

  const arr = Array.from(grid);
  const validAlt = arr.filter((v) => typeof v === "number" && !isNaN(v));
  if (validAlt.length === 0) {
    console.error("FAIL: aucune altitude valide");
    process.exit(1);
  }

  const varAlt = variance(validAlt);
  if (varAlt < MIN_VARIANCE) {
    console.error("FAIL: variance ~ 0");
    process.exit(1);
  }

  console.log("IGN DSM READY");
  console.log("VARIANCE OK");
  console.log("GRID VALID");
  console.log("VERDICT: 🟢 PASS");
  process.exit(0);
}

main();
