/**
 * Fetch des données TMY (Typical Meteorological Year) depuis PVGIS API v5.2.
 *
 * Endpoint : https://re.jrc.ec.europa.eu/api/v5_2/seriescalc
 * Données retournées : GHI, DHI, T2m sur 8760h (année type)
 *
 * Cache local : backend/weather/cache/{lat}_{lng}.json (TTL 30 jours via mtime)
 * Fallback : null si API inaccessible ou timeout
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'cache');
const PVGIS_URL = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

/**
 * Génère la clé de cache à partir des coordonnées (arrondi à 4 décimales).
 */
function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(4)}_${Number(lng).toFixed(4)}`;
}

/**
 * Lit le cache si valide (< 30 jours), retourne null sinon.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {object|null}
 */
function readCache(lat, lng) {
  try {
    const filePath = path.join(CACHE_DIR, `${cacheKey(lat, lng)}.json`);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Écrit les données dans le cache.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} data
 */
function writeCache(lat, lng, data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const filePath = path.join(CACHE_DIR, `${cacheKey(lat, lng)}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.warn('[TMY] Erreur écriture cache:', e.message);
  }
}

/**
 * Fetch les données TMY depuis PVGIS API v5.2.
 * Retourne null en cas d'erreur (timeout, API down, données manquantes).
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ ghi8760: number[], dhi8760: number[], tAir8760: number[], windSpeed8760: number[] } | null>}
 */
export async function fetchTMY(lat, lng) {
  // 1. Vérifier le cache
  const cached = readCache(lat, lng);
  if (cached) return cached;

  // 2. Fetch PVGIS avec AbortSignal.timeout
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    outputformat: 'json',
    usehorizon: '1',
    pvcalculation: '0',
    components: '1',
  });

  let json;
  try {
    const response = await fetch(`${PVGIS_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.warn(`[TMY] PVGIS HTTP ${response.status} pour lat=${lat} lon=${lng}`);
      return null;
    }
    json = await response.json();
  } catch (e) {
    console.warn('[TMY] Fetch PVGIS échoué:', e.message);
    return null;
  }

  // 3. Parser json.outputs.hourly
  const hourly = json?.outputs?.hourly;
  if (!Array.isArray(hourly) || hourly.length < 8760) {
    console.warn('[TMY] Données PVGIS insuffisantes (< 8760 h)');
    return null;
  }

  // Tronquer à 8760 en cas d'année bissextile (8784h)
  const entries = hourly.slice(0, 8760);

  // 4. Mapper les champs
  const ghi8760 = new Array(8760);
  const dhi8760 = new Array(8760);
  const tAir8760 = new Array(8760);
  const windSpeed8760 = new Array(8760);

  for (let i = 0; i < 8760; i++) {
    const e = entries[i];
    ghi8760[i] = Number(e['G(h)']) || 0;
    dhi8760[i] = Number(e['Gd(h)']) || 0;
    tAir8760[i] = Number(e['T2m']) || 0;
    windSpeed8760[i] = Number(e['WS10m']) || 0;
  }

  const result = { ghi8760, dhi8760, tAir8760, windSpeed8760 };

  // 5. Cacher le résultat
  writeCache(lat, lng, result);

  return result;
}
