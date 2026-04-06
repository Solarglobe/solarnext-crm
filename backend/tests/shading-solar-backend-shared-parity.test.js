/**
 * TEST anti-drift solar : backend ESM solarPosition.js === shared/shading/solarPosition.cjs (mêmes sorties).
 * Usage: cd backend && node tests/shading-solar-backend-shared-parity.test.js
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { computeSunPosition } from "../services/shading/solarPosition.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shared = require(path.join(__dirname, "../../shared/shading/solarPosition.cjs"));

const samples = [
  [Date.UTC(2026, 5, 21, 12, 0, 0, 0), 48.8566, 2.3522],
  [Date.UTC(2026, 0, 15, 10, 30, 0, 0), 45.0, 5.0],
];

let failed = 0;
for (const [ms, lat, lon] of samples) {
  const d = new Date(ms);
  const a = computeSunPosition(d, lat, lon);
  const b = shared.computeSunPosition(d, lat, lon);
  if (!a || !b) {
    console.log("❌ null inattendu", { a, b });
    failed++;
    continue;
  }
  const da = Math.abs(a.azimuthDeg - b.azimuthDeg);
  const de = Math.abs(a.elevationDeg - b.elevationDeg);
  if (da > 1e-10 || de > 1e-10) {
    console.log("❌ écart solar", { lat, lon, da, de, a, b });
    failed++;
  }
}

if (failed) {
  process.exit(1);
}
console.log("✅ shading-solar-backend-shared-parity (" + samples.length + " échantillons)");
process.exit(0);
