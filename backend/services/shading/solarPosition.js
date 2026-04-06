/**
 * === THIN WRAPPER ONLY — solar métier dans shared/shading/solarPosition.cjs ===
 * Ne jamais ajouter de calcul solaire ici : tout changement → shared + sync/verify frontend.
 * @see docs/shading-governance.md
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharedPath = path.join(__dirname, "../../../shared/shading/solarPosition.cjs");
const m = require(sharedPath);

export function computeSunPosition(date, latDeg, lonDeg) {
  return m.computeSunPosition(date, latDeg, lonDeg);
}

export function computeSunPositionUTC(msUtc, latDeg, lonDeg) {
  return m.computeSunPositionUTC(msUtc, latDeg, lonDeg);
}
