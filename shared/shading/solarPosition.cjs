/**
 * === SHADING SOURCE OF TRUTH — SOLAR POSITION ===
 * Seule source métier éditable pour computeSunPosition / getSunPosition.
 * frontend/calpinage/shading/solarPosition.js = GÉNÉRÉ (bannière SHADING_SYNC_*).
 * backend/services/shading/solarPosition.js = thin wrapper ESM → ce .cjs uniquement.
 * Sync : npm run sync:calpinage-shading-from-shared — docs/shading-governance.md
 *
 * Modèle solaire NOAA simplifié pour position du soleil (azimuth, élévation).
 * Sans dépendances externes. Pas d'exposition globale.
 *
 * @see https://gml.noaa.gov/grad/solcalc/calcdetails.html
 * @see Astronomical Algorithms, Jean Meeus
 */

const PI = Math.PI;
const DEG = PI / 180;

/**
 * Calcule la position du soleil à un instant donné.
 * @param {Date|number} date - Timestamp UTC ms ou Date : seules les composantes **UTC** de l’instant
 *   (getTime → dérivé UTC dans le moteur) déterminent la position. Pour des échantillons annuels
 *   reproductibles, construire la grille avec **Date.UTC** (voir shadingEngine.generateAnnualSamples).
 * @param {number} latDeg - Latitude en degrés [-90, 90]
 * @param {number} lonDeg - Longitude en degrés [-180, 180]
 * @param {string} [timezone] - IANA réservé ; non utilisé (pas de conversion fuseau dans ce module V1).
 * @returns {{azimuthDeg: number, elevationDeg: number}|null} null si lat/lon invalides
 */
function computeSunPosition(date, latDeg, lonDeg, timezone) {
  const ms = typeof date === "number" ? date : (date && date.getTime ? date.getTime() : NaN);
  if (Number.isNaN(ms)) return null;
  return computeSunPositionUTC(ms, latDeg, lonDeg);
}

/**
 * Calcule la position du soleil à partir d'un timestamp UTC (ms).
 * @param {number} msUtc - Timestamp UTC en millisecondes
 * @param {number} latDeg - Latitude en degrés [-90, 90]
 * @param {number} lonDeg - Longitude en degrés [-180, 180]
 * @returns {{azimuthDeg: number, elevationDeg: number}|null}
 */
function computeSunPositionUTC(msUtc, latDeg, lonDeg) {
  if (typeof latDeg !== "number" || typeof lonDeg !== "number" ||
      Number.isNaN(latDeg) || Number.isNaN(lonDeg)) return null;
  const lat = Math.max(-90, Math.min(90, latDeg));
  const lon = Math.max(-180, Math.min(180, lonDeg));
  if (lat !== latDeg || lon !== lonDeg) return null;

  const d = new Date(msUtc);
  const jd = _julianDay(d);
  const jc = _julianCentury(jd);

  const declRad = _solarDeclination(jc);
  const eqTimeMin = _equationOfTime(jc);

  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const localSolarTimeMin = utcMin + 4 * lon + eqTimeMin;
  const hourAngleDeg = (localSolarTimeMin / 4) - 180;

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

function _julianCentury(jd) {
  return (jd - 2451545) / 36525;
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
  const e = 0.016708634 - 0.000042037 * jc - 0.0000001267 * jc * jc;
  const ob = DEG * (23 + 26 / 60 + 21.448 / 3600 - 46.815 / 3600 * jc);
  const l = q + (1.914602 - 0.004817 * jc) * Math.sin(g) + 0.019993 * Math.sin(2 * g);
  return Math.asin(Math.sin(ob) * Math.sin(DEG * l));
}

function _equationOfTime(jc) {
  const g = DEG * (357.52911 + 35999.05029 * jc - 0.0001537 * jc * jc);
  const e = 0.016708634 - 0.000042037 * jc - 0.0000001267 * jc * jc;
  const ob = DEG * (23 + 26 / 60 + 21.448 / 3600 - 46.815 / 3600 * jc);
  const l =
    DEG *
    (280.46646 +
      36000.77183 * jc +
      0.0003032 * jc * jc -
      (1.914602 - 0.004817 * jc - 0.000014 * jc * jc) * Math.sin(g) -
      (0.019993 - 0.000101 * jc) * Math.sin(2 * g) -
      0.00029 * Math.sin(3 * g));
  const ra =
    Math.atan2(Math.cos(ob) * Math.sin(l), Math.cos(l)) / DEG;
  const eot = 4 * (l / DEG - 0.0057183 - ra + 0.000000001 * jc);
  return eot;
}

const _internal = {
  julianDay: _julianDay,
  julianCentury: _julianCentury,
  solarDeclination: _solarDeclination,
  equationOfTime: _equationOfTime,
};

/** getSunPosition(date, latDeg, lonDeg) → { azimuthDeg, elevationDeg } — contrat browser pour runNearWorstCase / shading. */
function getSunPosition(date, latDeg, lonDeg) {
  return computeSunPosition(date, latDeg, lonDeg);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getSunPosition,
    computeSunPosition,
    computeSunPositionUTC,
    _internal,
  };
}
if (typeof window !== "undefined") {
  window.__SHADING_SOLAR_POSITION__ = {
    getSunPosition: getSunPosition,
    computeSunPosition: computeSunPosition,
    computeSunPositionUTC: computeSunPositionUTC,
    _internal: _internal,
  };
}

/*
// --- Mini auto-tests (commentés, non exécutés) ---
// Paris (48.8566, 2.3522), 2026-06-21 12:00 local → élévation haute, az proche Sud.
// const r = computeSunPosition(new Date(2026, 5, 21, 12, 0, 0), 48.8566, 2.3522);
// Attendu: elevationDeg ~60-65°, azimuthDeg ~180° (Sud)
*/
