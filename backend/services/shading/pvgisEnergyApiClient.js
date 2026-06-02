/**
 * Client PVGIS PVcalc — production énergie de référence.
 * Endpoint  : https://re.jrc.ec.europa.eu/api/v5_3/PVcalc
 * Usage     : fournit E_m (kWh/mois pour 1 kWc, loss=0) pour convertir
 *             les facteurs d'ombrage SolarNext en kWh défendables.
 * Cache     : 30 jours par (lat, lon, tiltDeg, azimuthDeg, usehorizon).
 * Référence : https://joint-research-centre.ec.europa.eu/pvgis/getting-started-pvgis/api-non-interactive-service_en
 *
 * Convention azimut PVGIS ≠ SolarNext :
 *   PVGIS  : aspect 0 = Sud, +90 = Ouest, -90 = Est
 *   SolarNext : azimuth 0 = Nord, 180 = Sud
 *   Conversion : pvgisAspect = solarnextAzimuth - 180
 */

const PVGIS_PVCALC_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";
const PVGIS_TIMEOUT_MS  = 10_000;
const CACHE_TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30 jours
const _cache            = new Map();

function _cacheKey(lat, lon, tiltDeg, azimuthDeg, usehorizon) {
  return `${lat.toFixed(3)}|${lon.toFixed(3)}|${tiltDeg}|${azimuthDeg}|${usehorizon}`;
}

/**
 * Appelle PVGIS PVcalc et retourne la production mensuelle.
 * peakpower=1 (kWc) → valeur normalisée, multiplier côté appelant.
 * loss=0 → production brute (les pertes système sont gérées séparément).
 *
 * @param {{ lat: number, lon: number, tiltDeg: number, azimuthDeg: number, usehorizon?: 0|1 }} params
 * @returns {Promise<{ monthly: Array<{month,E_m,H_i}>, annual: {E_y} }>}
 * @throws {Error} si PVGIS retourne une erreur ou timeout
 */
async function _fetchPvgisEnergy({ lat, lon, tiltDeg, azimuthDeg, usehorizon = 0 }) {
  const aspect = azimuthDeg - 180;
  const key    = _cacheKey(lat, lon, tiltDeg, azimuthDeg, usehorizon);

  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const url = new URL(PVGIS_PVCALC_URL);
  url.searchParams.set("lat",          lat.toFixed(6));
  url.searchParams.set("lon",          lon.toFixed(6));
  url.searchParams.set("peakpower",    "1");
  url.searchParams.set("loss",         "0");
  url.searchParams.set("angle",        String(tiltDeg));
  url.searchParams.set("aspect",       String(aspect));
  url.searchParams.set("usehorizon",   String(usehorizon));
  url.searchParams.set("outputformat", "json");
  url.searchParams.set("browser",      "0");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`PVGIS PVcalc HTTP ${res.status} pour lat=${lat} lon=${lon}`);

  const body = await res.json();
  if (!Array.isArray(body?.outputs?.monthly?.fixed)) {
    throw new Error("PVGIS PVcalc: réponse inattendue — monthly.fixed absent");
  }

  const data = {
    monthly: body.outputs.monthly.fixed.map((m) => ({
      month: Number(m.month),
      E_m:   Number(m.E_m),    // kWh/mois pour 1 kWc
      H_i:   Number(m.H_i),    // kWh/m²/jour sur plan incliné
    })),
    annual: {
      E_y: Number(body.outputs?.totals?.fixed?.E_y ?? 0),
    },
  };

  _cache.set(key, { data, ts: Date.now() });
  return data;
}

export const fetchPvgisEnergy      = _fetchPvgisEnergy;
export const __testClearEnergyCache = () => _cache.clear();
