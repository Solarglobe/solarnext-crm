/**
 * CP-FAR-IGN-API-01 — Provider IGN Géoplateforme Altimétrie
 * Source    : RGE ALTI (LiDAR HD progressif) via data.geopf.fr
 * Resource  : ign_rge_alti_wld (France entière + DOM + COM)
 * Méthode   : grille radiale 360°×N pts → batch POST JSON → ray-marching in-memory
 * Résolution: 1° angulaire (configurable via params.step_deg)
 * Confidence: 0.85
 * Rate limit: 5 req/s — géré par délai inter-batches + sémaphore global
 * Référence : https://data.geopf.fr/altimetrie/swagger-ui/index.html
 *             https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-altimetrique/
 */

const IGN_ALTI_BASE =
  "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const IGN_RESOURCE   = "ign_rge_alti_wld";
const IGN_BATCH_SIZE = 4800;        // < limite API 5000 pts/req
const IGN_RATE_MS    = 220;         // ~4.5 req/s (marge sous 5 req/s)
const IGN_TIMEOUT_MS = 12000;       // 12 s par batch
const IGN_MAX_RETRIES = 3;
const STEP_M         = 50;          // Pas radial 50 m → 80 pts pour 4 km
const M_PER_DEG_LAT  = 111320;

// ─── Sémaphore global — max 2 computations IGN en parallèle ─────────────────
let   _active = 0;
const _queue  = [];
const MAX_PARALLEL = 2;

async function _withSemaphore(fn) {
  if (_active >= MAX_PARALLEL) {
    await new Promise((resolve) => _queue.push(resolve));
  }
  _active++;
  try {
    return await fn();
  } finally {
    _active--;
    if (_queue.length > 0) _queue.shift()();
  }
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────
let _consecutiveErrors = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS  = 60_000;   // 1 min avant réessai
let _circuitOpenAt      = 0;

function _isCircuitOpen() {
  if (_consecutiveErrors < CIRCUIT_THRESHOLD) return false;
  if (Date.now() - _circuitOpenAt > CIRCUIT_RESET_MS) {
    _consecutiveErrors = 0;
    return false;
  }
  return true;
}

// ─── isAvailable ─────────────────────────────────────────────────────────────

/**
 * Le provider IGN est toujours disponible (ign_rge_alti_wld couvre France + DOM + COM).
 * Les sites hors couverture retournent -99999 → détectés via coverageRatio.
 */
export function isAvailable(_params) {
  if (_isCircuitOpen()) {
    return {
      available: false,
      notes: ["IGN API circuit breaker ouvert — délai de 60 s avant réessai"],
    };
  }
  return { available: true, notes: [] };
}

// ─── Destination point (approximation sphérique plate — précise à 4 km) ─────

function _destinationPoint(lat, lon, azimuthDeg, distanceM) {
  const azRad    = (azimuthDeg * Math.PI) / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return {
    lat: lat + (Math.cos(azRad) * distanceM) / M_PER_DEG_LAT,
    lon: lon + (Math.sin(azRad) * distanceM) / mPerDegLon,
  };
}

// ─── Grille radiale ───────────────────────────────────────────────────────────

function _generateRadialGrid(lat, lon, radius_m, step_deg) {
  const nRadial = Math.ceil(radius_m / STEP_M);
  const points  = [];
  for (let az = 0; az < 360; az += step_deg) {
    for (let k = 1; k <= nRadial; k++) {
      const d    = k * STEP_M;
      const dest = _destinationPoint(lat, lon, az, d);
      points.push({ lat: dest.lat, lon: dest.lon, az, dist: d });
    }
  }
  return points;
}

// ─── Fetch batch POST JSON ────────────────────────────────────────────────────

async function _fetchBatch(batch) {
  const lons = batch.map((p) => p.lon.toFixed(7)).join("|");
  const lats = batch.map((p) => p.lat.toFixed(7)).join("|");
  const body = JSON.stringify({
    lon:       lons,
    lat:       lats,
    resource:  IGN_RESOURCE,
    delimiter: "|",
    zonly:     "true",
  });

  for (let attempt = 0; attempt < IGN_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IGN_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(IGN_ALTI_BASE, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept":        "application/json",
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
      console.warn(`[IGN] 429 rate-limit, attente ${retryAfter}s (tentative ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`IGN API HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data.elevations)) {
      throw new Error("IGN API: champ elevations manquant dans la réponse");
    }
    // zonly=true → Array<number>
    return data.elevations;
  }
  throw new Error("IGN API: max retries exceeded");
}

// ─── Ray-marching in-memory ───────────────────────────────────────────────────

function _computeHorizonMask(points, elevations, z_site, step_deg) {
  const byAz = new Map();
  for (let i = 0; i < points.length; i++) {
    const z = elevations[i];
    if (z === -99999 || !Number.isFinite(z)) continue;
    const az = points[i].az;
    if (!byAz.has(az)) byAz.set(az, []);
    byAz.get(az).push({ dist: points[i].dist, z });
  }

  const mask = [];
  for (let az = 0; az < 360; az += step_deg) {
    const samples = byAz.get(az) ?? [];
    let maxElev = 0;
    for (const s of samples) {
      const elevDeg = (Math.atan2(s.z - z_site, s.dist) * 180) / Math.PI;
      if (elevDeg > maxElev) maxElev = elevDeg;
    }
    mask.push({ az, elev: Math.max(0, maxElev) });
  }
  return mask;
}

// ─── computeMask (point d'entrée public) ─────────────────────────────────────

async function _computeMaskImpl({ lat, lon, radius_m = 4000, step_deg = 1 }) {
  // 1. Altitude du site
  const siteRes = await _fetchBatch([{ lat, lon, az: 0, dist: 0 }]);
  const z_site  =
    siteRes[0] !== -99999 && Number.isFinite(siteRes[0]) ? siteRes[0] : 0;
  await new Promise((r) => setTimeout(r, IGN_RATE_MS));

  // 2. Grille radiale
  const points       = _generateRadialGrid(lat, lon, radius_m, step_deg);
  const allElevations = [];

  // 3. Batches avec rate limiting
  for (let i = 0; i < points.length; i += IGN_BATCH_SIZE) {
    const batch = points.slice(i, i + IGN_BATCH_SIZE);
    const elevs = await _fetchBatch(batch);
    allElevations.push(...elevs);
    if (i + IGN_BATCH_SIZE < points.length) {
      await new Promise((r) => setTimeout(r, IGN_RATE_MS));
    }
  }

  // 4. Couverture
  const validCount    = allElevations.filter(
    (z) => z !== -99999 && Number.isFinite(z)
  ).length;
  const coverageRatio =
    allElevations.length > 0 ? validCount / allElevations.length : 0;

  // 5. Masque d'horizon
  const mask = _computeHorizonMask(points, allElevations, z_site, step_deg);

  _consecutiveErrors = 0;

  return {
    source: "SURFACE_DSM",
    mask,
    step_deg,
    radius_m,
    confidence: 0.85,
    dataCoverage: {
      provider:             "IGN_GEOPLATEFORME",
      ratio:                coverageRatio,
      gridResolutionMeters: 1,
      effectiveRadiusMeters: radius_m,
      notes: [
        `RGE ALTI via IGN Géoplateforme API (${IGN_RESOURCE}) — couverture ${(coverageRatio * 100).toFixed(0)}%`,
      ],
    },
    meta: {
      source:       "IGN_GEOPLATEFORME",
      algorithm:    "RADIAL_BATCH_API",
      qualityScore: 0.85,
    },
  };
}

/**
 * @param {{ lat: number, lon: number, radius_m?: number, step_deg?: number }} params
 * @returns {Promise<{ source, mask, step_deg, radius_m, confidence, dataCoverage, meta }>}
 */
export async function computeMask(params) {
  if (_isCircuitOpen()) throw new Error("IGN circuit breaker ouvert");
  try {
    return await _withSemaphore(() => _computeMaskImpl(params));
  } catch (err) {
    _consecutiveErrors++;
    if (_consecutiveErrors >= CIRCUIT_THRESHOLD) _circuitOpenAt = Date.now();
    throw err;
  }
}
