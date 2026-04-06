/**
 * CP-DSM — Test numérique interpolation horizon
 * Usage: cd backend && node scripts/test-horizon-math.js
 *
 * Cas 1 : Horizon constant 10° → soleil 8° masked, 12° visible
 * Cas 2 : Horizon 5° à 0°, 15° à 90° → interpolation à 45° = 10°
 */

import { getHorizonElevationAtAzimuth } from "../services/horizon/horizonInterpolation.js";

let pass = true;

function assert(cond, msg) {
  if (!cond) {
    console.error("  ❌", msg);
    pass = false;
  } else {
    console.log("  ✅", msg);
  }
}

console.log("\n=== Test horizon math ===\n");

const EPS = 1e-10;

const maskConstant10 = [{ az: 0, elev: 10 }, { az: 360, elev: 10 }];
const h8 = getHorizonElevationAtAzimuth(maskConstant10, 180);
const h12 = getHorizonElevationAtAzimuth(maskConstant10, 90);
assert(Math.abs(h8 - 10) < EPS, `Horizon constant à 180° = 10° (got ${h8})`);
assert(Math.abs(h12 - 10) < EPS, `Horizon constant à 90° = 10° (got ${h12})`);

const sun8 = 8;
const sun12 = 12;
const masked8 = sun8 <= h8;
const visible12 = sun12 > h12;
assert(masked8 === true, `Soleil 8° <= horizon 10° → masked (got ${masked8})`);
assert(visible12 === true, `Soleil 12° > horizon 10° → visible (got ${visible12})`);

console.log("\n--- Cas 2 : Interpolation linéaire ---\n");

const maskLinear = [
  { az: 0, elev: 5 },
  { az: 90, elev: 15 },
];
const h45 = getHorizonElevationAtAzimuth(maskLinear, 45);
const expected45 = 10;
assert(Math.abs(h45 - expected45) < EPS, `Interpolation à 45° = 10° (got ${h45}, expected ${expected45})`);

const t = (45 - 0) / (90 - 0);
const elevManual = 5 + t * (15 - 5);
assert(Math.abs(h45 - elevManual) < EPS, `Formule t=(az-az1)/(az2-az1), elev=elev1+t*(elev2-elev1) → ${elevManual}`);

console.log("\n--- Résultat ---\n");
if (pass) {
  console.log("HORIZON_MATH_PASS\n");
  process.exit(0);
} else {
  console.error("HORIZON_MATH_FAIL\n");
  process.exit(1);
}
