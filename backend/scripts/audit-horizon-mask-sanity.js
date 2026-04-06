/**
 * AUDIT — Sanity check numérique masque d'horizon (lecture seule, 0 modif)
 * Usage: cd backend && node scripts/audit-horizon-mask-sanity.js
 */

import { computeSunPosition } from "../services/shading/solarPosition.js";
import { getHorizonElevationAtAzimuth } from "../services/horizon/horizonInterpolation.js";
import { computeHorizonMaskReliefOnly } from "../services/horizon/horizonMaskCore.js";

const LAT = 48.88;
const LON = 2.59;

const mask = computeHorizonMaskReliefOnly({ lat: LAT, lon: LON, radius_m: 500, step_deg: 2 });

console.log("\n=== 1) Structure du masque (RELIEF_ONLY) ===\n");
console.log("Source:", mask.source);
console.log("Nombre de points:", mask.mask.length);
console.log("10 premiers points:", JSON.stringify(mask.mask.slice(0, 10), null, 2));
console.log("10 derniers points:", JSON.stringify(mask.mask.slice(-10), null, 2));
const elevs = mask.mask.map((m) => m.elev);
const azs = mask.mask.map((m) => m.az);
console.log("elev min/max:", Math.min(...elevs), "/", Math.max(...elevs));
console.log("az min/max:", Math.min(...azs), "/", Math.max(...azs));

console.log("\n=== 2) Horizon à 3 azimuts (Est=90°, Sud=180°, Ouest=270°) ===\n");
const hEast = getHorizonElevationAtAzimuth(mask.mask, 90);
const hSouth = getHorizonElevationAtAzimuth(mask.mask, 180);
const hWest = getHorizonElevationAtAzimuth(mask.mask, 270);
console.log("az 90° (Est):  horizonElev =", hEast.toFixed(2), "°");
console.log("az 180° (Sud): horizonElev =", hSouth.toFixed(2), "°");
console.log("az 270° (Ouest): horizonElev =", hWest.toFixed(2), "°");

console.log("\n=== 3) Soleil 7h et 18h, 21 Décembre, Chelles ===\n");
const dec21_7h = new Date(2025, 11, 21, 7, 0, 0);
const dec21_18h = new Date(2025, 11, 21, 18, 0, 0);
const pos7 = computeSunPosition(dec21_7h, LAT, LON);
const pos18 = computeSunPosition(dec21_18h, LAT, LON);
console.log("7h:  az =", pos7?.azimuthDeg?.toFixed(2), "°  elev =", pos7?.elevationDeg?.toFixed(2), "°");
console.log("18h: az =", pos18?.azimuthDeg?.toFixed(2), "°  elev =", pos18?.elevationDeg?.toFixed(2), "°");

console.log("\n=== 4) Comparaison soleil vs horizon (masqué si sunElev <= horizonElev) ===\n");
if (pos7) {
  const h7 = getHorizonElevationAtAzimuth(mask.mask, pos7.azimuthDeg);
  const masked7 = pos7.elevationDeg <= h7;
  console.log("7h:  sunElev =", pos7.elevationDeg.toFixed(2), "  horizonElev =", h7.toFixed(2), "  => masked =", masked7);
}
if (pos18) {
  const h18 = getHorizonElevationAtAzimuth(mask.mask, pos18.azimuthDeg);
  const masked18 = pos18.elevationDeg <= h18;
  console.log("18h: sunElev =", pos18.elevationDeg.toFixed(2), "  horizonElev =", h18.toFixed(2), "  => masked =", masked18);
}

console.log("\n=== 5) Mapping chart: az → x (Solteo) ===\n");
console.log("azToX(az) = az - 180, clamp [-135, 135]");
console.log("az 90 (Est)  → x =", 90 - 180, "= -90");
console.log("az 180 (Sud) → x =", 180 - 180, "= 0");
console.log("az 270 (Ouest) → x =", 270 - 180, "= 90");
