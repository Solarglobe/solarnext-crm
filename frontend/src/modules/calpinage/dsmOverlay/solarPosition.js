/**
 * DSM OVERLAY ONLY — not the official shading source of truth.
 *
 * Copie ESM du modèle NOAA alignée sur `shared/shading/solarPosition.cjs` pour entrées valides
 * (voir test `dsmSolarParityWithSharedTruth.test.js`). Ne pas utiliser pour persistance / API / JSON shading.
 *
 * Garde-fou : lat/lon hors plage sont clampées ici ; l’officiel renvoie `null` si l’entrée n’était pas strictement dans [-90,90] / [-180,180].
 *
 * @see docs/dsm-overlay-governance.md
 * @see shared/shading/solarPosition.cjs (vérité métier éditable + sync calpinage/public)
 */

const PI = Math.PI;
const DEG = PI / 180;

function _julianDay(d) {
  const a = Math.floor((14 - (d.getUTCMonth() + 1)) / 12);
  const y = d.getUTCFullYear() + 4800 - a;
  const m = d.getUTCMonth() + 1 + 12 * a - 3;
  const jdn =
    d.getUTCDate() +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045;
  const frac =
    (d.getUTCHours() - 12) / 24 +
    d.getUTCMinutes() / 1440 +
    d.getUTCSeconds() / 86400;
  return jdn + frac;
}

function _solarDeclination(jc) {
  const g = DEG * (357.52911 + 35999.05029 * jc - 0.0001537 * jc * jc);
  const q =
    280.46646 +
    36000.77183 * jc +
    0.0003032 * jc * jc -
    (1.914602 - 0.004817 * jc - 0.000014 * jc * jc) * Math.sin(g) -
    (0.019993 - 0.000101 * jc) * Math.sin(2 * g) -
    0.00029 * Math.sin(3 * g);
  const ob = DEG * (23 + 26 / 60 + 21.448 / 3600 - (46.815 / 3600) * jc);
  const l = q + (1.914602 - 0.004817 * jc) * Math.sin(g) + 0.019993 * Math.sin(2 * g);
  return Math.asin(Math.sin(ob) * Math.sin(DEG * l));
}

function _equationOfTime(jc) {
  const g = DEG * (357.52911 + 35999.05029 * jc - 0.0001537 * jc * jc);
  const ob = DEG * (23 + 26 / 60 + 21.448 / 3600 - (46.815 / 3600) * jc);
  const l =
    DEG *
    (280.46646 +
      36000.77183 * jc +
      0.0003032 * jc * jc -
      (1.914602 - 0.004817 * jc - 0.000014 * jc * jc) * Math.sin(g) -
      (0.019993 - 0.000101 * jc) * Math.sin(2 * g) -
      0.00029 * Math.sin(3 * g));
  const ra = Math.atan2(Math.cos(ob) * Math.sin(l), Math.cos(l)) / DEG;
  return 4 * (l / DEG - 0.0057183 - ra + 0.000000001 * jc);
}

/**
 * @param {Date|number} date
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {{azimuthDeg: number, elevationDeg: number}|null}
 */
export function computeSunPosition(date, latDeg, lonDeg) {
  const ms = typeof date === "number" ? date : (date && date.getTime ? date.getTime() : NaN);
  if (Number.isNaN(ms)) return null;
  if (typeof latDeg !== "number" || typeof lonDeg !== "number" || Number.isNaN(latDeg) || Number.isNaN(lonDeg)) return null;
  const lat = Math.max(-90, Math.min(90, latDeg));
  const lon = Math.max(-180, Math.min(180, lonDeg));

  const d = new Date(ms);
  const jd = _julianDay(d);
  const jc = (jd - 2451545) / 36525;
  const declRad = _solarDeclination(jc);
  const eqTimeMin = _equationOfTime(jc);

  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const localSolarTimeMin = utcMin + 4 * lon + eqTimeMin;
  const hourAngleDeg = localSolarTimeMin / 4 - 180;

  const latRad = lat * DEG;
  const haRad = hourAngleDeg * DEG;
  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
  const zenithRad = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevationRad = PI / 2 - zenithRad;
  let elevationDeg = (elevationRad * 180) / PI;
  elevationDeg = Math.max(-90, Math.min(90, elevationDeg));

  let azimuthRad;
  if (Math.sin(zenithRad) < 1e-10) {
    azimuthRad = 0;
  } else {
    const cosAz =
      (Math.sin(declRad) - Math.sin(latRad) * Math.cos(zenithRad)) /
      (Math.cos(latRad) * Math.sin(zenithRad));
    azimuthRad = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(haRad) > 0) azimuthRad = 2 * PI - azimuthRad;
  }
  let azimuthDeg = (azimuthRad * 180) / PI;
  azimuthDeg = ((azimuthDeg % 360) + 360) % 360;

  return { azimuthDeg, elevationDeg };
}
