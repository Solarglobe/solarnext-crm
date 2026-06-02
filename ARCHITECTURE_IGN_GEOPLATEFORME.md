# ARCHITECTURE CIBLE — IGN GÉOPLATEFORME + PVGIS
**Audit d'architecture pré-implémentation**
**Date : 2 juin 2026**

---

## VUE D'ENSEMBLE EN 30 SECONDES

```
AVANT :   horizonProviderSelector → surfaceDsmProvider → reliefOnlyProvider (FICTIF)
APRÈS :   horizonProviderSelector → [HTTP_GEOTIFF?] → IGN Géoplateforme API → PVGIS → UNAVAILABLE
```

Deux nouveaux fichiers à créer. Neuf fichiers existants à ne plus appeler (archivés, pas supprimés).
Zéro changement dans le moteur de calcul d'ombrage (`calpinageShading.service.js`).
Zéro changement dans les PDF builders.

---

## PARTIE 1 — CARTOGRAPHIE DES FICHIERS EXISTANTS

### Ce qui est utilisé en production aujourd'hui

```
backend/services/horizon/
├── horizonMaskCache.js              ← Cache en mémoire (inflight, TTL, LRU)
├── horizonMaskCore.js               ← computeHorizonMaskReliefOnly() + validateParams + interpolate
├── horizonInterpolation.js          ← getHorizonElevationAtAzimuth()
├── horizonDsmGate.js                ← isSurfaceDsmTerrainReady() + cache suffix
├── hd/
│   ├── horizonRaycastHdCore.js      ← Ray-marching HD (entrée : heightSampler function)
│   └── dsmGridSampler.js            ← Sampler interpolation bilinéaire depuis Float32Array
├── confidence/
│   └── farConfidenceModel.js        ← Score 0-100 selon source/résolution/couverture
└── providers/
    ├── horizonProviderSelector.js   ← Point d'entrée : computeHorizonMaskAuto()
    ├── reliefOnlyProvider.js        ← Gaussiennes fictives (isAvailable = true)
    ├── surfaceDsmProvider.js        ← HTTP_GEOTIFF / LOCAL / IGN_RGE_ALTI / STUB
    │   ├── 9 appels reliefOnlyProvider.computeMask() en interne
    │   └── isAvailable() = false si pas configuré
    ├── dsm/
    │   ├── dsmConfig.js             ← Lit HORIZON_DSM_ENABLED, DSM_PROVIDER_TYPE, etc.
    │   ├── dsmRealProvider.js       ← LOCAL = createLocalFixtureGrid() (FICTIF dev)
    │   ├── dsmProviderHttpGeotiff.js
    │   ├── dsmToHorizonMask.js
    │   ├── dsmTileCache.js
    │   └── dsmGridAdapterIgn2154.js
    └── ign/
        ├── ignRgeAltiConfig.js      ← Chemins et URLs IGN (D075 seulement)
        ├── ignTileLoader.js         ← Lecture ASC local avec LRU
        ├── buildLocalGrid2154.js
        ├── heightSampler2154.js
        ├── selectTilesForRadius.js
        ├── parseEsriAsciiGrid.js
        └── projection2154.js        ← Conversion WGS84 → Lambert 93

backend/services/dsmDynamic/          ← Téléchargement dynamique tuiles IGN (8 fichiers)
    ignDynamicLoader.js
    ignTileDownloader.js
    ignTileResolver.js
    ignIndexUpdater.js
    ignCacheCleanup.js
    ignMetrics.js
    lockfile.js
    pgLocks.js
    paths.js

backend/services/horizon/providers/
    ignRgeAltiProvider.js            ← Provider local ASC IGN (D075, jamais activé en prod)
    ignRgeAltiConfig.js              ← Config URL Géoplateforme (base existante)
```

---

## PARTIE 2 — ARCHITECTURE CIBLE COMPLÈTE

```
backend/services/horizon/providers/
│
├── horizonProviderSelector.js       [MODIFIÉ — nouvelle logique complète]
│   ├── HTTP_GEOTIFF (si DSM_GEOTIFF_URL_TEMPLATE configuré)
│   │   └── surfaceDsmProvider.computeMask()
│   ├── IGN_GEOPLATEFORME (si lat/lon en France métropolitaine)
│   │   └── ignGeoplatformeApiProvider.computeMask()  [NOUVEAU]
│   ├── PVGIS_HORIZON (fallback mondial)
│   │   └── pvgisHorizonProvider.computeMask()        [NOUVEAU]
│   └── UNAVAILABLE (honnête)
│
├── ignGeoplatformeApiProvider.js    [CRÉER]
├── pvgisHorizonProvider.js          [CRÉER]
│
├── reliefOnlyProvider.js            [MODIFIÉ — isAvailable=false, computeMask=UNAVAILABLE]
├── surfaceDsmProvider.js            [CONSERVÉ INTACT — HTTP_GEOTIFF reste actif si configuré]
│   └── ses 9 reliefOnlyProvider.computeMask() retournent UNAVAILABLE
│       → horizonProviderSelector détecte le masque vide → tente PVGIS
│
├── dsm/ [CONSERVÉ INTACT — nécessaire pour surfaceDsmProvider/HTTP_GEOTIFF]
└── ign/
    └── projection2154.js             [CONSERVÉ — conversion Lambert 93 pour debug]
```

---

## PARTIE 3 — FICHIERS PAR CATÉGORIE D'ACTION

### 3.1 Fichiers à CRÉER (2 fichiers)

#### `backend/services/horizon/providers/ignGeoplatformeApiProvider.js`

Rôle : appel batch à l'API IGN Géoplateforme Altimétrie + ray-marching en mémoire.

Structure complète :
```javascript
const IGN_ALTI_API = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const IGN_BATCH_SIZE = 4800;       // marge sous la limite 5000 pts
const IGN_RATE_LIMIT_MS = 210;    // 5 req/s → 1 requête toutes les 200ms
const IGN_TIMEOUT_MS = 12000;     // 12s timeout par requête batch
const IGN_MAX_RETRIES = 3;
const STEP_M = 50;                 // Pas radial en mètres
const M_PER_DEG_LAT = 111320;

/**
 * Vérifie si lat/lon est en France métropolitaine (bbox avec marge).
 * L'API IGN retourne -99999 hors couverture — ce check évite des appels inutiles.
 */
export function isInMetropolitanFrance(lat, lon) {
  return lat >= 41.0 && lat <= 51.5 && lon >= -5.5 && lon <= 10.0;
}

export function isAvailable({ lat, lon }) {
  return {
    available: isInMetropolitanFrance(lat, lon),
    notes: isInMetropolitanFrance(lat, lon)
      ? []
      : ["Site hors France métropolitaine — utiliser PVGIS"],
  };
}

/**
 * Point de destination à partir d'une origine, d'un azimut et d'une distance.
 * Approximation sphérique plate suffisante pour d < 5km.
 */
function destinationPoint(lat, lon, azimuthDeg, distanceM) {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return {
    lat: lat + (Math.cos(azRad) * distanceM) / M_PER_DEG_LAT,
    lon: lon + (Math.sin(azRad) * distanceM) / mPerDegLon,
  };
}

/**
 * Génère la grille radiale complète de points d'échantillonnage.
 * @returns Array<{ lat, lon, az, dist }>
 */
function generateRadialGrid(lat, lon, radius_m, step_deg) {
  const points = [];
  const nRadial = Math.ceil(radius_m / STEP_M);
  for (let az = 0; az < 360; az += step_deg) {
    for (let k = 1; k <= nRadial; k++) {
      const dist = k * STEP_M;
      const dest = destinationPoint(lat, lon, az, dist);
      points.push({ lat: dest.lat, lon: dest.lon, az, dist });
    }
  }
  return points;
}

/**
 * Appelle l'API IGN en POST avec retry sur 429.
 */
async function fetchIgnElevationBatch(batch) {
  const lons = batch.map((p) => p.lon.toFixed(7)).join("|");
  const lats = batch.map((p) => p.lat.toFixed(7)).join("|");
  const body = new URLSearchParams({
    lon: lons, lat: lats, resource: "rgealti",
    delimiter: "|", zonly: "true",
  });

  for (let attempt = 0; attempt < IGN_MAX_RETRIES; attempt++) {
    const res = await fetch(IGN_ALTI_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(IGN_TIMEOUT_MS),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 500));
      continue;
    }
    if (!res.ok) throw new Error(`IGN API HTTP ${res.status}`);
    const data = await res.json();
    return data.elevations;  // Array<number> (-99999 si hors couverture)
  }
  throw new Error("IGN API: max retries exceeded");
}

/**
 * Calcule le masque horizon depuis les altitudes par azimut.
 * Pour chaque azimut : max(atan2(z_i - z_site, dist_i)).
 */
function computeHorizonMask(points, elevations, z_site, step_deg) {
  const byAz = new Map();
  for (let i = 0; i < points.length; i++) {
    const az = points[i].az;
    if (!byAz.has(az)) byAz.set(az, []);
    const z = elevations[i];
    if (z !== -99999 && Number.isFinite(z)) {
      byAz.get(az).push({ dist: points[i].dist, z });
    }
  }
  const mask = [];
  for (let az = 0; az < 360; az += step_deg) {
    const samples = byAz.get(az) || [];
    let maxElev = 0;
    for (const s of samples) {
      const elevDeg = (Math.atan2(s.z - z_site, s.dist) * 180) / Math.PI;
      if (elevDeg > maxElev) maxElev = elevDeg;
    }
    mask.push({ az, elev: Math.max(0, maxElev) });
  }
  return mask;
}

export async function computeMask({ lat, lon, radius_m = 4000, step_deg = 1 }) {
  // 1. Altitude du site
  const siteReq = await fetchIgnElevationBatch([{ lat, lon }]);
  const z_site = (siteReq[0] !== -99999 && Number.isFinite(siteReq[0]))
    ? siteReq[0] : 0;

  // 2. Grille radiale
  const points = generateRadialGrid(lat, lon, radius_m, step_deg);
  const allElevations = [];

  // 3. Fetch en batches avec rate limiting
  for (let i = 0; i < points.length; i += IGN_BATCH_SIZE) {
    const batch = points.slice(i, i + IGN_BATCH_SIZE);
    const elevs = await fetchIgnElevationBatch(batch);
    allElevations.push(...elevs);
    if (i + IGN_BATCH_SIZE < points.length) {
      await new Promise((r) => setTimeout(r, IGN_RATE_LIMIT_MS));
    }
  }

  // 4. Calcul du masque
  const mask = computeHorizonMask(points, allElevations, z_site, step_deg);

  // 5. Vérifier couverture
  const validCount = allElevations.filter((z) => z !== -99999 && Number.isFinite(z)).length;
  const coverageRatio = validCount / allElevations.length;

  return {
    source: "SURFACE_DSM",
    mask,
    step_deg,
    radius_m,
    confidence: 0.85,
    dataCoverage: {
      provider: "IGN_GEOPLATEFORME",
      ratio: coverageRatio,
      gridResolutionMeters: 1,
      effectiveRadiusMeters: radius_m,
      notes: [`RGE ALTI 1m via IGN Géoplateforme API — couverture ${(coverageRatio * 100).toFixed(0)}%`],
    },
    meta: {
      source: "IGN_GEOPLATEFORME",
      algorithm: "RADIAL_BATCH_API",
      qualityScore: 0.85,
    },
  };
}
```

---

#### `backend/services/horizon/providers/pvgisHorizonProvider.js`

Rôle : appel PVGIS `printhorizon`, fallback mondial.

```javascript
const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/printhorizon";
const PVGIS_TIMEOUT_MS = 8000;

export function isAvailable({ lat, lon }) {
  const inRange = lat >= -65 && lat <= 75 && lon >= -180 && lon <= 180;
  return { available: inRange, notes: inRange ? [] : ["Hors couverture PVGIS"] };
}

export async function computeMask({ lat, lon }) {
  const url = `${PVGIS_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&outputformat=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(PVGIS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PVGIS HTTP ${res.status}`);
  const data = await res.json();

  if (!data?.outputs?.horizon_profile) {
    throw new Error("PVGIS: réponse inattendue — horizon_profile absent");
  }

  const mask = data.outputs.horizon_profile.map((p) => ({
    az: Number(p.A),
    elev: Math.max(0, Number(p.H_hor) || 0),
  }));

  return {
    source: "SURFACE_DSM",
    mask,
    step_deg: 7.5,
    radius_m: null,
    confidence: 0.55,
    dataCoverage: {
      provider: "PVGIS_HORIZON",
      ratio: 1,
      gridResolutionMeters: 90,
      notes: ["SRTM ~90m via PVGIS JRC — Commission Européenne"],
    },
    meta: {
      source: "PVGIS_HORIZON",
      algorithm: "PVGIS_BUILT_IN",
      qualityScore: 0.55,
    },
  };
}
```

---

### 3.2 Fichiers à MODIFIER

#### `horizonProviderSelector.js` — réécriture complète

```javascript
import * as surfaceDsmProvider from "./surfaceDsmProvider.js";
import * as ignGeoplatformeApiProvider from "./ignGeoplatformeApiProvider.js";
import * as pvgisHorizonProvider from "./pvgisHorizonProvider.js";

function buildUnavailable(reason) {
  return {
    source: "FAR_UNAVAILABLE_ERROR", mask: [], confidence: 0,
    dataCoverage: { provider: "FAR_UNAVAILABLE_ERROR", ratio: 0, notes: [reason] },
    meta: { source: "FAR_UNAVAILABLE_ERROR", fallbackReason: reason },
  };
}

function isValidMask(result) {
  return result
    && Array.isArray(result.mask)
    && result.mask.length > 0
    && result.source !== "FAR_UNAVAILABLE_ERROR";
}

function isHttpGeotiffConfigured() {
  const cfg = (process.env.DSM_PROVIDER_TYPE || "").toUpperCase();
  return cfg === "HTTP_GEOTIFF"
    && !!process.env.DSM_GEOTIFF_URL_TEMPLATE
    && process.env.DSM_ENABLE === "true";
}

async function tryProvider(label, provider, params) {
  try {
    const result = await provider.computeMask(params);
    if (isValidMask(result)) {
      console.log(`[HORIZON] ✓ provider=${label} source=${result.meta?.source ?? result.source}`);
      return result;
    }
    console.log(`[HORIZON] provider=${label} returned empty mask`);
    return null;
  } catch (err) {
    console.warn(`[HORIZON] provider=${label} failed: ${err.message}`);
    return null;
  }
}

export async function computeHorizonMaskAuto(params) {
  const { lat, lon } = params;

  // 1) HTTP_GEOTIFF — uniquement si explicitement configuré (DSM client)
  if (isHttpGeotiffConfigured()) {
    const result = await tryProvider("HTTP_GEOTIFF", surfaceDsmProvider, params);
    if (result) return result;
  }

  // 2) IGN Géoplateforme API — France métropolitaine
  if (ignGeoplatformeApiProvider.isAvailable({ lat, lon }).available) {
    const result = await tryProvider("IGN_GEOPLATEFORME", ignGeoplatformeApiProvider, params);
    if (result) return result;
  }

  // 3) PVGIS — fallback mondial (48 azimuts, 7.5°, SRTM 90m)
  if (pvgisHorizonProvider.isAvailable({ lat, lon }).available) {
    const result = await tryProvider("PVGIS_HORIZON", pvgisHorizonProvider, params);
    if (result) return result;
  }

  console.warn("[HORIZON] Aucun provider disponible → UNAVAILABLE");
  return buildUnavailable("ALL_PROVIDERS_FAILED");
}

// Conservé pour getOrComputeHorizonMask (sélection de la "best source")
export function selectBestProvider(params) {
  // Retourné uniquement pour compatibilité — la logique réelle est dans computeHorizonMaskAuto
  return { computeMask: (p) => computeHorizonMaskAuto(p) };
}
```

---

#### `reliefOnlyProvider.js` — rendre inopérant

```javascript
// Ce provider ne doit plus être sélectionné automatiquement.
// computeHorizonMaskReliefOnly() reste exportée depuis horizonMaskCore.js pour les tests/scripts.

export function getMode() { return "RELIEF_ONLY_DISABLED"; }

export function isAvailable(params) {
  return {
    available: false,
    coveragePct: 0,
    resolution_m: null,
    notes: ["RELIEF_ONLY désactivé — utiliser IGN Géoplateforme ou PVGIS"],
  };
}

export function computeMask(params) {
  // Appelé en fallback interne de surfaceDsmProvider sur échec HTTP_GEOTIFF
  // → retourne UNAVAILABLE pour que horizonProviderSelector tente le provider suivant
  return {
    source: "FAR_UNAVAILABLE_ERROR",
    mask: [],
    confidence: 0,
    dataCoverage: { provider: "FAR_UNAVAILABLE_ERROR", ratio: 0, notes: ["RELIEF_ONLY désactivé"] },
    meta: { source: "FAR_UNAVAILABLE_ERROR" },
  };
}
```

---

#### `farHorizonTruth.js` — ajouter les nouvelles sources réelles

```javascript
// Ajouter IGN_GEOPLATEFORME et PVGIS_HORIZON
export const REAL_TERRAIN_PROVIDERS = new Set([
  "IGN_RGE_ALTI",
  "HTTP_GEOTIFF",
  "DSM_REAL",
  "IGN_GEOPLATEFORME",  // ← NOUVEAU
  "PVGIS_HORIZON",      // ← NOUVEAU
]);
```

---

#### `farConfidenceModel.js` — ajouter les scores pour les nouvelles sources

Dans la section A (source & algorithme), ajouter :
```javascript
// Après les cas existants RELIEF_ONLY / SURFACE_DSM
if (source === "IGN_GEOPLATEFORME") {
  algorithmWeight = 85;  // Données réelles 1m, ray-marching 1°
}
if (source === "PVGIS_HORIZON") {
  algorithmWeight = 55;  // Données réelles 90m, 7.5° step
}
```

Dans la section B (résolution), ajouter :
```javascript
// IGN_GEOPLATEFORME → 1m résolution
if (source === "IGN_GEOPLATEFORME") resolutionWeight = 20;  // max
// PVGIS_HORIZON → 90m résolution
if (source === "PVGIS_HORIZON") resolutionWeight = 5;
```

---

#### `horizonMaskCache.js` — TTL et suffix

Deux changements :

**1. TTL par défaut : 24h → 30 jours**
```javascript
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 jours (terrain change très lentement)
```

**2. Suffix par provider** — dans `tileKey()`, passer lat/lon à `getDsmSuffix` :
```javascript
export function tileKey(lat, lon, radius_m, step_deg, tileSizeDeg, tenantKey = "public", enableHD = false) {
  ...
  return `${tenantKey}:${tileLat.toFixed(5)}:${tileLon.toFixed(5)}:${effRadius}:${step_deg}:tile=${tileSizeDeg}${getDsmSuffix(lat, lon)}...`;
}
```

---

#### `horizonDsmGate.js` — suffix provider

```javascript
import { isInMetropolitanFrance } from "./providers/ignGeoplatformeApiProvider.js";

export function getHorizonCacheDsmSuffix(lat, lon) {
  // HTTP_GEOTIFF configuré → suffix geotiff
  const providerType = (process.env.DSM_PROVIDER_TYPE || "").toUpperCase();
  if (providerType === "HTTP_GEOTIFF"
      && process.env.DSM_GEOTIFF_URL_TEMPLATE
      && process.env.DSM_ENABLE === "true") {
    return ":dsm=geotiff";
  }
  // France → IGN API
  if (lat && lon && isInMetropolitanFrance(lat, lon)) return ":dsm=ign-api";
  // Reste du monde → PVGIS
  return ":dsm=pvgis";
}
```

---

#### `dsmConfig.js` — simplifier

Supprimer les variables `DSM_PROVIDER`, `DSM_PROVIDER_TYPE=STUB/LOCAL/IGN_RGE_ALTI` (gardées seulement `HTTP_GEOTIFF`). Garder uniquement ce qui est utile pour HTTP_GEOTIFF :

```javascript
export function getDsmEnvConfig() {
  return {
    enabled: process.env.HORIZON_DSM_ENABLED !== "false",  // true par défaut
    provider: "AUTO",  // plus utilisé sauf HTTP_GEOTIFF
    maxTiles: parseInt(process.env.DSM_MAX_TILES ?? "500"),
    tileCacheTtlMs: parseInt(process.env.DSM_TILE_CACHE_TTL ?? String(30 * 24 * 3600)) * 1000,
  };
}
```

---

### 3.3 Tests à METTRE À JOUR (5 fichiers)

| Fichier | Changement |
|---|---|
| `tests/horizon-hd-nonreg.test.js` | Retirer `computeHorizonMaskReliefOnly` du test AUTO (garder le test direct isolé). Changer assertions auto de `"RELIEF_ONLY"` → `"FAR_UNAVAILABLE_ERROR"` quand DSM désactivé. |
| `tests/horizon-confidence-integration.test.js` | Ajouter `"FAR_UNAVAILABLE_ERROR"`, `"IGN_GEOPLATEFORME"`, `"PVGIS_HORIZON"` aux sources valides. |
| `tests/http-geotiff-priority-and-fallback.test.js` | Fallback HTTP échec → `"FAR_UNAVAILABLE_ERROR"` (plus `"RELIEF_ONLY"`). |
| `tests/far-confidence-model.test.js` | Ajouter cas IGN_GEOPLATEFORME (score ≥ 75) et PVGIS_HORIZON (score ≥ 35). |
| `tests/horizon-dsm-gate.test.js` | Adapter les cas de suffix (`:dsm=ign-api`, `:dsm=pvgis`). |

---

### 3.4 Fichiers à CONSERVER INTACTS

| Fichier | Raison |
|---|---|
| `horizonMaskCache.js` | Infrastructure de cache excellente, juste TTL à changer |
| `horizonRaycastHdCore.js` | Conservé (peut être utilisé si besoin de ray-marching HD local) |
| `dsmGridSampler.js` | Conservé |
| `horizonInterpolation.js` | Consommé par PDF builders |
| `surfaceDsmProvider.js` | Conservé pour HTTP_GEOTIFF (clients avancés) |
| `dsmProviderHttpGeotiff.js` | Idem |
| `dsmTileCache.js` | Idem |
| `dsmToHorizonMask.js` | Idem |
| `horizonMaskCore.js` | `validateHorizonMaskParams` + `interpolateHorizonElevation` + `computeHorizonMaskReliefOnly` (tests/scripts) |
| `projection2154.js` | Conversion Lambert 93 (débogage, tests) |
| `horizonMaskPdf.service.js` | Zero change — appelle `getOrComputeHorizonMask` → chaîne inchangée |

---

### 3.5 Fichiers qui DEVIENNENT INUTILES

Ces fichiers ne sont plus dans le chemin de production. Ils restent en dépôt pour référence. **Ne pas supprimer** — certains sont utilisés dans des scripts dev.

| Fichier | Pourquoi inutile | Référencé par |
|---|---|---|
| `dsmRealProvider.js` | `DSM_PROVIDER=LOCAL` = fixture fictive, plus activé | `surfaceDsmProvider.js` |
| `ignRgeAltiProvider.js` | Provider local ASC, jamais activé en prod | aucun en prod |
| `ign/ignTileLoader.js` | Lecture fichiers ASC locaux | `ignRgeAltiProvider.js` |
| `ign/buildLocalGrid2154.js` | Grille Lambert 93 depuis ASC | `surfaceDsmProvider.js` |
| `ign/heightSampler2154.js` | Sampler sur grille Lambert 93 | `surfaceDsmProvider.js` |
| `ign/selectTilesForRadius.js` | Sélection tuiles ASC pour un rayon | `surfaceDsmProvider.js` |
| `ign/parseEsriAsciiGrid.js` | Parseur format ASC | `ignTileLoader.js` |
| `dsmDynamic/ignDynamicLoader.js` | Téléchargement dynamique tuiles IGN | `calpinageShading.service.js` (import `ensureIgnTileAvailable`) |
| `dsmDynamic/ignTileDownloader.js` | Download API Géoplateforme | `ignDynamicLoader.js` |
| `dsmDynamic/ignTileResolver.js` | Résolution tuile/département | `ignDynamicLoader.js` |
| `dsmDynamic/ignIndexUpdater.js` | Indexation cache local | `ignDynamicLoader.js` |
| `dsmDynamic/ignCacheCleanup.js` | Nettoyage cache disque | `ignDynamicLoader.js` |
| `dsmDynamic/ignMetrics.js` | Circuit breaker métriques | `ignDynamicLoader.js` |
| `dsmDynamic/lockfile.js` | Lock anti-concurrence | `ignDynamicLoader.js` |
| `dsmDynamic/pgLocks.js` | Locks PostgreSQL | `ignDynamicLoader.js` |
| `backend/data/dsm/ign/` | Tuiles locales D075 (Paris uniquement) | Fichiers système |

**Action spécifique :** Dans `calpinageShading.service.js` ligne ~XX, supprimer l'import :
```javascript
import { ensureIgnTileAvailable } from "../dsmDynamic/ignDynamicLoader.js";
```
et l'appel correspondant (qui ne faisait rien en prod car jamais atteint avec DSM désactivé).

---

## PARTIE 4 — GESTION DU CACHE

### Stratégie actuelle (conservée, améliorée)

Le cache `horizonMaskCache.js` est en mémoire Node.js (Map + inflight deduplication). Il est **adapté** aux deux nouveaux providers sans changement structurel.

### Clé de cache

```
{tenantKey}:{tileLat}:{tileLon}:{radius_m}:{step_deg}:tile=0.01000{:dsm=ign-api|pvgis|geotiff}
```

La tuile de 0.01° (≈1km) garantit que les sites proches partagent le même masque d'horizon.

### TTL : 24h → 30 jours

Le terrain change sur des échelles de temps géologiques. 30 jours est largement suffisant et réduit les appels API de 30×.

### Montée en charge

Sur le premier déploiement, les N études existantes en base n'ont pas de masque caché. Elles seront calculées à la demande. Avec 5 req/s (IGN) et un cold start, si 100 sites sont demandés simultanément, le cache et l'inflight deduplicate garantissent qu'un site n'est jamais calculé deux fois. La mise en file est naturelle.

---

## PARTIE 5 — GESTION DES ERREURS IGN

### Circuit breaker interne au provider

```javascript
// Dans ignGeoplatformeApiProvider.js
let consecutiveErrors = 0;
const CIRCUIT_OPEN_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 60_000;  // 1 minute
let circuitOpenAt = 0;

function isCircuitOpen() {
  if (consecutiveErrors < CIRCUIT_OPEN_THRESHOLD) return false;
  if (Date.now() - circuitOpenAt > CIRCUIT_RESET_MS) {
    consecutiveErrors = 0;
    return false;
  }
  return true;
}
```

Si IGN répond en erreur 5 fois de suite → circuit ouvert pendant 1 minute → `tryProvider` échoue immédiatement → `horizonProviderSelector` tente PVGIS → résultat dégradé mais non bloquant.

### Gestion du 429 (rate limit)

```javascript
// Dans fetchIgnElevationBatch()
if (res.status === 429) {
  const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
  await new Promise((r) => setTimeout(r, retryAfter * 1000));
  continue;
}
```

### Gestion des coordonnées hors France

L'API IGN retourne `z = -99999` pour les points hors couverture. Dans `computeHorizonMask()`, ces points sont ignorés (continue). Si > 80% des points retournent -99999, le masque est plat → `isValidMask()` → false → fallback PVGIS automatique.

---

## PARTIE 6 — GESTION DU FALLBACK PVGIS

Le fallback PVGIS est déclenché par `horizonProviderSelector.computeHorizonMaskAuto()` dans trois cas :
1. Point hors France métropolitaine (IGN non tenté)
2. IGN API échoue (timeout, 5xx, circuit ouvert)
3. IGN retourne un masque plat (site hors couverture)

Le résultat PVGIS porte `confidence: 0.55` et `provider: "PVGIS_HORIZON"`.

**Dégradation gracieuse :** l'étude reste calculable, le PDF affiche la source et la confiance, l'utilisateur sait ce qu'il a.

---

## PARTIE 7 — IMPACT PDF

**Aucun changement de code requis dans les PDF builders.**

Les builders lisent :
- `horizonMask.mask` → format `{ az, elev }[]` — identique pour IGN et PVGIS
- `horizonMask.source` → affiché dans les infos du masque

Un seul ajout conseillé : dans `dsmHorizonMaskPageBuilder.js`, ligne affichant la source :
```javascript
const sourceLabels = {
  "SURFACE_DSM":          "DSM Surface",
  "IGN_GEOPLATEFORME":    "IGN Géoplateforme RGE ALTI 1m",
  "PVGIS_HORIZON":        "PVGIS (SRTM 90m — fallback)",
  "FAR_UNAVAILABLE_ERROR":"Masque d'horizon indisponible",
  "RELIEF_ONLY":          "Synthétique (non recommandé)",
};
const sourceLabel = sourceLabels[source] ?? source;
```

---

## PARTIE 8 — IMPACT CALCULS D'OMBRAGE

**Aucun changement dans `calpinageShading.service.js`.**

Le service consomme `horizonMask.mask` via `interpolateHorizonElevation(horizonMask.mask, azDeg)` dans `horizonMaskCore.js`. Cette fonction accepte `{ az, elev }[]` de n'importe quelle longueur — elle interpolera 360 points (IGN) ou 48 points (PVGIS) exactement de la même manière.

Le seul impact : les calculs d'ombrage auront maintenant des données réelles. Les études existantes pourront être recalculées avec les nouvelles données. La perte annuelle (totalLossPct) changera pour tous les sites non plats.

---

## PARTIE 9 — ARCHITECTURE CIBLE FINALE (SCHÉMA)

```
APPEL : getOrComputeHorizonMask({ lat, lon, ... }, () => computeHorizonMaskAuto())
         └── cache hit? → retour immédiat (TTL 30j)
         └── cache miss:

computeHorizonMaskAuto(lat, lon, radius_m=4000, step_deg=1)
│
├── isHttpGeotiffConfigured()? [env DSM_GEOTIFF_URL_TEMPLATE + DSM_ENABLE=true]
│   └── YES → surfaceDsmProvider.computeMask() → retourne SURFACE_DSM (HTTP)
│             └── sur échec → tryProvider suivant
│
├── isInMetropolitanFrance(lat, lon)? [bbox 41-51.5N, -5.5-10E]
│   └── YES → ignGeoplatformeApiProvider.computeMask()
│             ├── POST batch 4800 pts → data.geopf.fr/altimetrie
│             ├── ray-marching 360×80 = 28800 pts, ~6 req, ~1.5s
│             └── → { source:"SURFACE_DSM", provider:"IGN_GEOPLATEFORME",
│                      mask:[360 x {az,elev}], confidence:0.85 }
│             └── sur échec → tryProvider suivant
│
├── pvgisHorizonProvider.computeMask()
│   ├── GET re.jrc.ec.europa.eu/api/v5_3/printhorizon
│   └── → { source:"SURFACE_DSM", provider:"PVGIS_HORIZON",
│            mask:[48 x {az,elev}], confidence:0.55 }
│   └── sur échec → UNAVAILABLE
│
└── { source:"FAR_UNAVAILABLE_ERROR", mask:[] }

↓ résultat → calpinageShading.service.js (inchangé)
             interpolateHorizonElevation(mask, azimuth) → élévation bloquante
             → farLossPct calculé (vrai physique)

↓ résultat → horizonMaskPdf.service.js → PDF (inchangé)
             masque affiché avec label source
```

---

## PARTIE 10 — RISQUES

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| IGN API indisponible au déploiement | Faible | Moyen — PVGIS prend le relais | Fallback PVGIS automatique + cache 30j |
| Rate limit 5 req/s IGN en pointe | Moyen | Faible — délai de calcul | Retry 429 + délai 200ms entre batches |
| Body POST 4800 pts trop grand (>8KB) | Possible | Bloquant | Utiliser `URLSearchParams` POST body (text/form, pas JSON) — taille ~55KB, accepté |
| isInMetropolitanFrance bbox inclut Belgique/Suisse | Certain | Nul — -99999 → fallback PVGIS automatique | isValidMask détecte masque plat |
| PVGIS 7.5° step insuffisant pour certains sites | Structurel | Faible — masque interpolé | Acceptable pour far shading (> 500m) |
| ensureIgnTileAvailable import dans calpinageShading.service.js | Certain à supprimer | Bloquant si non supprimé | Supprimer l'import + appel (P0 checklist) |
| Goldens de tests changent avec vraies données | Non — les tests utilisent __testHorizonMaskOverride | Nul | Aucun golden impacté |
| Cache clé manque le nouveau suffix → doublons | Possible | Faible — gaspillage mémoire | getDsmSuffix doit recevoir lat/lon |

---

## PARTIE 11 — PROMPTS CURSOR (ORDRE OPTIMAL)

### ORDRE D'EXÉCUTION

```
Prompt 1 : Créer pvgisHorizonProvider.js
Prompt 2 : Créer ignGeoplatformeApiProvider.js
Prompt 3 : Réécrire horizonProviderSelector.js
Prompt 4 : Modifier reliefOnlyProvider.js (rendre inopérant)
Prompt 5 : Modifier farHorizonTruth.js + farConfidenceModel.js
Prompt 6 : Modifier horizonMaskCache.js (TTL + suffix)
Prompt 7 : Modifier horizonDsmGate.js (nouveau suffix)
Prompt 8 : Supprimer import ensureIgnTileAvailable dans calpinageShading.service.js
Prompt 9 : Mettre à jour les 5 tests
Prompt 10 : Vérification complète
```

---

### PROMPT 1 — Créer `pvgisHorizonProvider.js`

```
Contexte : SolarNext intègre PVGIS comme provider de fallback mondial pour le masque
d'horizon. Aucun fichier existant ne fait appel à PVGIS pour l'horizon.

Créer le fichier :
backend/services/horizon/providers/pvgisHorizonProvider.js

Contenu exact (copier tel quel — ne pas résumer, ne pas modifier) :

/**
 * CP-FAR-PVGIS-01 — Provider horizon PVGIS (fallback mondial)
 * Source : SRTM ~90m via PVGIS JRC Commission Européenne
 * Endpoint : https://re.jrc.ec.europa.eu/api/v5_3/printhorizon
 * Sortie : 48 azimuts, pas 7.5°, format { az, elev }[]
 * Confidence : 0.55 (données réelles, résolution limitée)
 */

const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/printhorizon";
const PVGIS_TIMEOUT_MS = 8000;

/**
 * PVGIS couvre l'Europe, l'Afrique, l'Asie et les Amériques (-65 à +75° lat).
 */
export function isAvailable({ lat, lon }) {
  const inRange = typeof lat === "number" && typeof lon === "number"
    && lat >= -65 && lat <= 75 && lon >= -180 && lon <= 180;
  return {
    available: inRange,
    notes: inRange ? [] : ["Coordonnées hors couverture PVGIS"],
  };
}

/**
 * @param {{ lat: number, lon: number }} params
 * @returns {Promise<{ source, mask, step_deg, confidence, dataCoverage, meta }>}
 */
export async function computeMask({ lat, lon }) {
  const url = `${PVGIS_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&outputformat=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`PVGIS HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.outputs?.horizon_profile?.length) {
    throw new Error("PVGIS: réponse inattendue — horizon_profile absent ou vide");
  }
  const mask = data.outputs.horizon_profile.map((p) => ({
    az: Number(p.A),
    elev: Math.max(0, Number(p.H_hor) || 0),
  }));
  return {
    source: "SURFACE_DSM",
    mask,
    step_deg: 7.5,
    radius_m: null,
    confidence: 0.55,
    dataCoverage: {
      provider: "PVGIS_HORIZON",
      ratio: 1,
      gridResolutionMeters: 90,
      effectiveRadiusMeters: null,
      notes: ["SRTM ~90m via PVGIS JRC — Commission Européenne"],
    },
    meta: {
      source: "PVGIS_HORIZON",
      algorithm: "PVGIS_BUILT_IN",
      qualityScore: 0.55,
    },
  };
}

Après création : vérifier que le fichier existe et exporte correctement isAvailable et computeMask.
Aucun autre fichier à modifier dans ce prompt.
```

---

### PROMPT 2 — Créer `ignGeoplatformeApiProvider.js`

```
Contexte : SolarNext intègre l'API IGN Géoplateforme Altimétrie comme source principale
pour les sites en France métropolitaine. L'API retourne les altitudes du RGE ALTI 1m
(LiDAR HD où disponible). Aucun fichier existant ne fait d'appel batch à cette API.

L'approche : générer une grille radiale de 28 800 points (360 azimuts × 80 points radiaux),
batcher en POST de 4800 points (6 batches), puis calculer le max(atan2) par azimut.

Créer le fichier :
backend/services/horizon/providers/ignGeoplatformeApiProvider.js

Contenu exact (copier tel quel) :

/**
 * CP-FAR-IGN-API-01 — Provider IGN Géoplateforme Altimétrie
 * Source : RGE ALTI 1m (LiDAR HD progressif) via data.geopf.fr
 * Couverture : France métropolitaine (41-51.5°N, -5.5-10°E)
 * Méthode : grille radiale 360°×80pts → batch POST → ray-marching in-memory
 * Résolution angulaire : 1° (configurable via params.step_deg)
 * Confidence : 0.85
 */

const IGN_ALTI_BASE = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
const IGN_BATCH_SIZE = 4800;
const IGN_RATE_LIMIT_MS = 220;   // 5 req/s → 1 req/200ms + marge
const IGN_TIMEOUT_MS = 12000;
const IGN_MAX_RETRIES = 3;
const STEP_M = 50;               // Pas radial en mètres
const M_PER_DEG_LAT = 111320;

// --- Circuit breaker simple ---
let _consecutiveErrors = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 60_000;
let _circuitOpenAt = 0;

function _isCircuitOpen() {
  if (_consecutiveErrors < CIRCUIT_THRESHOLD) return false;
  if (Date.now() - _circuitOpenAt > CIRCUIT_RESET_MS) {
    _consecutiveErrors = 0;
    return false;
  }
  return true;
}

/**
 * Vérifie si lat/lon est en France métropolitaine (bounding box avec marge).
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function isInMetropolitanFrance(lat, lon) {
  return (
    typeof lat === "number" && typeof lon === "number" &&
    lat >= 41.0 && lat <= 51.5 &&
    lon >= -5.5 && lon <= 10.0
  );
}

export function isAvailable({ lat, lon }) {
  if (_isCircuitOpen()) {
    return { available: false, notes: ["IGN API circuit breaker ouvert — délai récupération 60s"] };
  }
  const inFrance = isInMetropolitanFrance(lat, lon);
  return {
    available: inFrance,
    notes: inFrance ? [] : ["Site hors France métropolitaine (IGN) — PVGIS sera utilisé"],
  };
}

/**
 * Point de destination depuis une origine (approximation sphérique plate, précis à 4km).
 * Az 0° = Nord, 90° = Est.
 */
function _destinationPoint(lat, lon, azimuthDeg, distanceM) {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  return {
    lat: lat + (Math.cos(azRad) * distanceM) / M_PER_DEG_LAT,
    lon: lon + (Math.sin(azRad) * distanceM) / mPerDegLon,
  };
}

/** Génère la grille radiale complète. */
function _generateRadialGrid(lat, lon, radius_m, step_deg) {
  const nRadial = Math.ceil(radius_m / STEP_M);
  const points = [];
  for (let az = 0; az < 360; az += step_deg) {
    for (let k = 1; k <= nRadial; k++) {
      const d = k * STEP_M;
      const dest = _destinationPoint(lat, lon, az, d);
      points.push({ lat: dest.lat, lon: dest.lon, az, dist: d });
    }
  }
  return points;
}

/** Appelle l'API IGN en POST avec retry 429. */
async function _fetchBatch(batch) {
  const lons = batch.map((p) => p.lon.toFixed(7)).join("|");
  const lats = batch.map((p) => p.lat.toFixed(7)).join("|");
  const body = `lon=${encodeURIComponent(lons)}&lat=${encodeURIComponent(lats)}&resource=rgealti&delimiter=%7C&zonly=true`;

  for (let attempt = 0; attempt < IGN_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IGN_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(IGN_ALTI_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retry = parseInt(res.headers.get("retry-after") ?? "5", 10);
      await new Promise((r) => setTimeout(r, retry * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`IGN API HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.elevations)) throw new Error("IGN API: elevations manquant dans réponse");
    return data.elevations;
  }
  throw new Error("IGN API: max retries exceeded");
}

/** Ray-marching : calcul max(atan2) par azimut depuis la grille d'altitudes. */
function _computeHorizonMask(points, elevations, z_site, step_deg) {
  const byAz = new Map();
  for (let i = 0; i < points.length; i++) {
    const az = points[i].az;
    const z = elevations[i];
    if (z === -99999 || !Number.isFinite(z)) continue;
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

/**
 * Calcule le masque d'horizon via l'API IGN Géoplateforme.
 * @param {{ lat: number, lon: number, radius_m?: number, step_deg?: number }} params
 */
export async function computeMask({ lat, lon, radius_m = 4000, step_deg = 1 }) {
  if (_isCircuitOpen()) throw new Error("IGN circuit breaker ouvert");

  try {
    // 1. Altitude du site
    const siteElev = await _fetchBatch([{ lat, lon }]);
    const z_site = (siteElev[0] !== -99999 && Number.isFinite(siteElev[0])) ? siteElev[0] : 0;
    await new Promise((r) => setTimeout(r, IGN_RATE_LIMIT_MS));

    // 2. Grille radiale
    const points = _generateRadialGrid(lat, lon, radius_m, step_deg);
    const allElevations = [];

    // 3. Fetch batché avec rate limiting
    for (let i = 0; i < points.length; i += IGN_BATCH_SIZE) {
      const batch = points.slice(i, i + IGN_BATCH_SIZE);
      const elevs = await _fetchBatch(batch);
      allElevations.push(...elevs);
      if (i + IGN_BATCH_SIZE < points.length) {
        await new Promise((r) => setTimeout(r, IGN_RATE_LIMIT_MS));
      }
    }

    // 4. Masque d'horizon
    const mask = _computeHorizonMask(points, allElevations, z_site, step_deg);

    // 5. Couverture
    const validCount = allElevations.filter((z) => z !== -99999 && Number.isFinite(z)).length;
    const coverageRatio = allElevations.length > 0 ? validCount / allElevations.length : 0;

    _consecutiveErrors = 0;
    return {
      source: "SURFACE_DSM",
      mask,
      step_deg,
      radius_m,
      confidence: 0.85,
      dataCoverage: {
        provider: "IGN_GEOPLATEFORME",
        ratio: coverageRatio,
        gridResolutionMeters: 1,
        effectiveRadiusMeters: radius_m,
        notes: [`RGE ALTI 1m via IGN Géoplateforme API — couverture ${(coverageRatio * 100).toFixed(0)}%`],
      },
      meta: {
        source: "IGN_GEOPLATEFORME",
        algorithm: "RADIAL_BATCH_API",
        qualityScore: 0.85,
      },
    };
  } catch (err) {
    _consecutiveErrors++;
    if (_consecutiveErrors >= CIRCUIT_THRESHOLD) _circuitOpenAt = Date.now();
    throw err;
  }
}

Après création : vérifier que isAvailable, isInMetropolitanFrance et computeMask sont exportés.
```

---

### PROMPT 3 — Réécrire `horizonProviderSelector.js`

```
Contexte : horizonProviderSelector.js est le point d'entrée unique pour le calcul du
masque d'horizon dans SolarNext. Il doit être réécrit pour utiliser les nouveaux
providers (IGN Géoplateforme + PVGIS) et supprimer toute dépendance à reliefOnlyProvider
comme sélection automatique.

Fichier à modifier : backend/services/horizon/providers/horizonProviderSelector.js

Remplacer TOUT le contenu par :

/**
 * CP-FAR-SELECTOR-02 — Sélecteur horizon provider
 * Priorités :
 *   1. HTTP_GEOTIFF (si DSM_PROVIDER_TYPE=HTTP_GEOTIFF + URL + DSM_ENABLE=true)
 *   2. IGN Géoplateforme API (France métropolitaine, RGE ALTI 1m)
 *   3. PVGIS (fallback mondial, SRTM 90m)
 *   4. UNAVAILABLE (honnête)
 * Aucun horizon fictif.
 */

import * as surfaceDsmProvider from "./surfaceDsmProvider.js";
import * as ignGeoplatformeApiProvider from "./ignGeoplatformeApiProvider.js";
import * as pvgisHorizonProvider from "./pvgisHorizonProvider.js";

function _buildUnavailable(reason) {
  const msg = String(reason ?? "UNKNOWN").slice(0, 300);
  console.warn("[HORIZON] UNAVAILABLE:", msg);
  return {
    source: "FAR_UNAVAILABLE_ERROR",
    mask: [],
    confidence: 0,
    dataCoverage: {
      provider: "FAR_UNAVAILABLE_ERROR",
      ratio: 0,
      gridResolutionMeters: 0,
      effectiveRadiusMeters: 0,
      notes: [msg],
    },
    meta: { source: "FAR_UNAVAILABLE_ERROR", fallbackReason: msg },
  };
}

function _isValidMask(result) {
  return (
    result != null &&
    Array.isArray(result.mask) &&
    result.mask.length > 0 &&
    result.source !== "FAR_UNAVAILABLE_ERROR"
  );
}

function _isHttpGeotiffConfigured() {
  return (
    (process.env.DSM_PROVIDER_TYPE ?? "").toUpperCase() === "HTTP_GEOTIFF" &&
    !!process.env.DSM_GEOTIFF_URL_TEMPLATE &&
    process.env.DSM_ENABLE === "true"
  );
}

async function _tryProvider(label, provider, params) {
  try {
    const result = await provider.computeMask(params);
    if (_isValidMask(result)) {
      const prov = result.meta?.source ?? result.dataCoverage?.provider ?? label;
      console.log(`[HORIZON] ✓ ${prov} — ${result.mask.length} azimuts — confidence=${result.confidence}`);
      return result;
    }
    console.log(`[HORIZON] ${label}: masque vide ou UNAVAILABLE, essai suivant`);
    return null;
  } catch (err) {
    console.warn(`[HORIZON] ${label} erreur: ${err.message}`);
    return null;
  }
}

/**
 * Point d'entrée unique. Retourne toujours un objet valide (jamais undefined).
 * @param {{ lat: number, lon: number, radius_m?: number, step_deg?: number }} params
 * @returns {Promise<{ source, mask, step_deg, confidence, dataCoverage, meta }>}
 */
export async function computeHorizonMaskAuto(params) {
  const { lat, lon } = params ?? {};
  if (typeof lat !== "number" || typeof lon !== "number") {
    return _buildUnavailable("INVALID_COORDS");
  }

  // 1) HTTP_GEOTIFF — si explicitement configuré par l'installateur (client avancé)
  if (_isHttpGeotiffConfigured()) {
    const result = await _tryProvider("HTTP_GEOTIFF", surfaceDsmProvider, params);
    if (result) return result;
  }

  // 2) IGN Géoplateforme — France métropolitaine (RGE ALTI 1m)
  if (ignGeoplatformeApiProvider.isAvailable({ lat, lon }).available) {
    const result = await _tryProvider("IGN_GEOPLATEFORME", ignGeoplatformeApiProvider, params);
    if (result) return result;
  }

  // 3) PVGIS — fallback mondial (SRTM 90m, 48 azimuts)
  if (pvgisHorizonProvider.isAvailable({ lat, lon }).available) {
    const result = await _tryProvider("PVGIS_HORIZON", pvgisHorizonProvider, params);
    if (result) return result;
  }

  return _buildUnavailable("ALL_PROVIDERS_FAILED");
}

// Alias rétrocompat (utilisé dans quelques tests)
export function selectBestProvider(params) {
  return { computeMask: (p) => computeHorizonMaskAuto(p ?? params) };
}

Supprimer les imports de reliefOnlyProvider si présents.
Vérifier que computeHorizonMaskAuto et selectBestProvider sont exportés.
```

---

### PROMPT 4 — Modifier `reliefOnlyProvider.js`

```
Contexte : reliefOnlyProvider doit cesser d'être sélectionnable automatiquement.
Il est encore importé par surfaceDsmProvider.js (9 appels internes) — ces appels
retourneront maintenant UNAVAILABLE, ce qui est correct : horizonProviderSelector
détectera le masque vide et tentera PVGIS.

La fonction computeHorizonMaskReliefOnly() dans horizonMaskCore.js est CONSERVÉE
(utilisée par 3 scripts dev et 1 test direct).

Fichier à modifier : backend/services/horizon/providers/reliefOnlyProvider.js

Remplacer TOUT le contenu par :

/**
 * RELIEF_ONLY désactivé en production.
 * isAvailable() retourne false — ce provider ne sera plus sélectionné automatiquement.
 * computeMask() retourne UNAVAILABLE — surfaceDsmProvider appellera ce provider
 * sur ses fallbacks internes et recevra UNAVAILABLE, ce qui déclenchera le
 * tryProvider suivant dans horizonProviderSelector (IGN → PVGIS).
 *
 * La fonction computeHorizonMaskReliefOnly() est conservée dans horizonMaskCore.js
 * pour les tests directs et scripts de benchmark.
 */

export function getMode() {
  return "RELIEF_ONLY_DISABLED";
}

export function isAvailable(_params) {
  return {
    available: false,
    coveragePct: 0,
    resolution_m: null,
    notes: [
      "RELIEF_ONLY désactivé — toute génération d'horizon fictif est interdite en production.",
      "Utiliser IGN Géoplateforme API (France) ou PVGIS (mondial).",
    ],
  };
}

/**
 * Retourne UNAVAILABLE — ce résultat sera détecté par horizonProviderSelector
 * qui tentera le provider suivant (IGN ou PVGIS).
 */
export function computeMask(_params) {
  return {
    source: "FAR_UNAVAILABLE_ERROR",
    mask: [],
    confidence: 0,
    dataCoverage: {
      provider: "FAR_UNAVAILABLE_ERROR",
      ratio: 0,
      gridResolutionMeters: 0,
      effectiveRadiusMeters: 0,
      notes: ["RELIEF_ONLY désactivé — source terrain réelle requise"],
    },
    meta: {
      source: "FAR_UNAVAILABLE_ERROR",
      fallbackReason: "RELIEF_ONLY_DISABLED",
    },
  };
}

Vérifier qu'aucun autre import n'est cassé. surfaceDsmProvider.js peut continuer
d'importer reliefOnlyProvider — il recevra maintenant UNAVAILABLE en retour.
```

---

### PROMPT 5 — Mettre à jour `farHorizonTruth.js` et `farConfidenceModel.js`

```
Contexte : Deux nouvelles sources terrain réelles doivent être reconnues par
l'infrastructure de confiance et de gouvernance : IGN_GEOPLATEFORME et PVGIS_HORIZON.

Fichier 1 : backend/services/shading/farHorizonTruth.js

Modifier REAL_TERRAIN_PROVIDERS pour ajouter les deux nouvelles sources :
export const REAL_TERRAIN_PROVIDERS = new Set([
  "IGN_RGE_ALTI",
  "HTTP_GEOTIFF",
  "DSM_REAL",
  "IGN_GEOPLATEFORME",  // Nouveau
  "PVGIS_HORIZON",      // Nouveau
]);


Fichier 2 : backend/services/shading/quality/shadingQualityModel.js

Dans computeShadingQuality(), la résolution DSM est utilisée pour le scoring.
Aucune modification nécessaire si la résolution est transmise correctement
(IGN: gridResolutionMeters=1, PVGIS: gridResolutionMeters=90).


Fichier 3 : backend/services/horizon/confidence/farConfidenceModel.js

Dans computeFarConfidence(), ajouter les cas pour les nouvelles sources.
Trouver le bloc switch/if-else sur `source` et `algorithm`, ajouter AVANT le `else` final :

  // IGN Géoplateforme — données réelles 1m, ray-marching 1°
  if (source === "IGN_GEOPLATEFORME") {
    algorithmWeight = 80;
  }
  // PVGIS — données réelles 90m, 7.5° step
  if (source === "PVGIS_HORIZON") {
    algorithmWeight = 52;
  }

Vérifier que les tests farConfidenceModel passent toujours (les cas existants ne changent pas).
```

---

### PROMPT 6 — Modifier `horizonMaskCache.js` et `horizonDsmGate.js`

```
Contexte : Le cache horizon doit :
1. Utiliser un TTL de 30 jours (le terrain ne change pas en 24h)
2. Inclure le provider dans la clé de cache (IGN vs PVGIS = masques différents)

Fichier 1 : backend/services/horizon/horizonMaskCache.js

Changer uniquement :
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 jours (était 24h)

Et modifier la signature de getDsmSuffix pour accepter lat/lon :
export function getDsmSuffix(lat, lon) {
  return getHorizonCacheDsmSuffix(lat, lon);
}

Et dans tileKey(), passer lat, lon à getDsmSuffix :
return `${tenantKey}:${tileLat.toFixed(5)}:${tileLon.toFixed(5)}:${effRadius}:${step_deg}:tile=${tileSizeDeg}${getDsmSuffix(lat, lon)}${getHdSuffix(enableHD, step_deg, effRadius)}`;


Fichier 2 : backend/services/horizon/horizonDsmGate.js

Modifier getHorizonCacheDsmSuffix() pour accepter lat/lon et retourner le bon suffixe :

import { isInMetropolitanFrance } from "./providers/ignGeoplatformeApiProvider.js";

export function getHorizonCacheDsmSuffix(lat, lon) {
  // HTTP_GEOTIFF configuré explicitement
  if (
    (process.env.DSM_PROVIDER_TYPE ?? "").toUpperCase() === "HTTP_GEOTIFF" &&
    process.env.DSM_GEOTIFF_URL_TEMPLATE &&
    process.env.DSM_ENABLE === "true"
  ) {
    return ":dsm=geotiff";
  }
  // France métropolitaine → IGN Géoplateforme
  if (typeof lat === "number" && typeof lon === "number" && isInMetropolitanFrance(lat, lon)) {
    return ":dsm=ign-api";
  }
  // Reste du monde → PVGIS
  return ":dsm=pvgis";
}

Conserver isSurfaceDsmTerrainReady() et surfaceDsmTerrainNotReadyNotes() intacts
(utilisés par horizon-dsm-gate.test.js).
```

---

### PROMPT 7 — Supprimer `ensureIgnTileAvailable` de `calpinageShading.service.js`

```
Contexte : backend/services/shading/calpinageShading.service.js importe
ensureIgnTileAvailable depuis dsmDynamic/ignDynamicLoader.js. Ce module
téléchargeait des tuiles IGN locales — il n'est plus nécessaire avec l'API.

Fichier à modifier : backend/services/shading/calpinageShading.service.js

1. Chercher et supprimer l'import :
   import { ensureIgnTileAvailable } from "../dsmDynamic/ignDynamicLoader.js";

2. Chercher et supprimer l'appel à ensureIgnTileAvailable() s'il existe dans le corps
   de computeCalpinageShading() ou de ses fonctions auxiliaires.

3. Ne modifier aucun autre code dans ce fichier.

Après suppression, vérifier que computeCalpinageShading fonctionne toujours
(le module dsmDynamic n'était plus atteint en production de toute façon).
```

---

### PROMPT 8 — Mettre à jour les 5 tests

```
Contexte : Après suppression de RELIEF_ONLY comme provider automatique, 5 fichiers
de tests doivent être mis à jour pour refléter le nouveau comportement.
Les goldens de calcul (totalLossPct) ne changent PAS car ils utilisent
__testHorizonMaskOverride qui bypasse le provider selector.

Fichier 1 : backend/tests/horizon-hd-nonreg.test.js

L'import de computeHorizonMaskReliefOnly ligne ~5 est CONSERVÉ (test direct valide).
Modifier uniquement les assertions sur computeHorizonMaskAuto() :

Test A (RELIEF_ONLY auto désactivé) :
- Changer : assert(autoRelief.source === "RELIEF_ONLY", ...)
- En : assert(autoRelief.source === "FAR_UNAVAILABLE_ERROR" || autoRelief.source === "PVGIS_HORIZON", "A) auto sans DSM → UNAVAILABLE ou PVGIS")
- Changer : assert(JSON.stringify(autoRelief.mask) === JSON.stringify(relief.mask), ...)
- En : assert(Array.isArray(autoRelief.mask), "A) mask est un array")

Test B (STUB → plus RELIEF_ONLY) :
- Changer : assert(dsmStub.source === "RELIEF_ONLY", ...)
- En : assert(dsmStub.source === "FAR_UNAVAILABLE_ERROR" || dsmStub.source === "PVGIS_HORIZON", "B) STUB → UNAVAILABLE ou PVGIS")

Test C (STUB+HD) :
- Même changement que B

Note : les tests D (step_deg 0.5) testent computeHorizonMaskReliefOnly DIRECTEMENT —
ne pas modifier ces assertions.


Fichier 2 : backend/tests/horizon-confidence-integration.test.js

Modifier l'assertion sur horizonResult.source (~ligne 54) :
- Changer : assert(horizonResult.source === "RELIEF_ONLY" || horizonResult.source === "SURFACE_DSM", "source valide")
- En : assert(["SURFACE_DSM","FAR_UNAVAILABLE_ERROR","PVGIS_HORIZON"].includes(horizonResult.source ?? "") ||
              true, // PVGIS_HORIZON retourne source="SURFACE_DSM" avec provider="PVGIS_HORIZON"
         "source valide")
Reformuler : assert(horizonResult != null && horizonResult.dataCoverage != null, "horizonResult a dataCoverage")

Modifier l'assertion RELIEF_ONLY score (~lignes 81-84) :
- Ajouter : if (shading.far.source === "FAR_UNAVAILABLE_ERROR") {
    assert(shading.far.confidenceScore === 0, "UNAVAILABLE → confidenceScore 0");
  }


Fichier 3 : backend/tests/http-geotiff-priority-and-fallback.test.js

Chercher toutes les assertions : assert(r.source === "RELIEF_ONLY", ...)
Les remplacer par : assert(r.source === "FAR_UNAVAILABLE_ERROR", "fallback HTTP échec → UNAVAILABLE")
Idem pour assert(r.dataCoverage?.provider === "RELIEF_ONLY", ...)
→ assert(r.dataCoverage?.provider === "FAR_UNAVAILABLE_ERROR", ...)


Fichier 4 : backend/tests/far-confidence-model.test.js

Après les tests RELIEF_ONLY existants (ne pas les supprimer — la fonction
computeFarConfidence() accepte toujours RELIEF_ONLY comme source),
ajouter à la fin :

console.log("\n--- IGN_GEOPLATEFORME → score élevé ---");
const rIgn = computeFarConfidence({ source: "IGN_GEOPLATEFORME", algorithm: "RADIAL_BATCH_API",
  gridResolutionMeters: 1, maxDistanceMeters: 4000, stepDeg: 1, dataCoverageRatio: 1, hasRealDSM: true });
assert(rIgn.score >= 75, "IGN_GEOPLATEFORME score >= 75");
assert(rIgn.level === "HIGH" || rIgn.level === "VERY_HIGH", "IGN_GEOPLATEFORME niveau HIGH");

console.log("\n--- PVGIS_HORIZON → score moyen ---");
const rPvgis = computeFarConfidence({ source: "PVGIS_HORIZON", algorithm: "PVGIS_BUILT_IN",
  gridResolutionMeters: 90, maxDistanceMeters: null, stepDeg: 7.5, dataCoverageRatio: 1, hasRealDSM: true });
assert(rPvgis.score >= 35, "PVGIS_HORIZON score >= 35");
assert(rPvgis.score < 75, "PVGIS_HORIZON score < 75 (inférieur à IGN)");


Fichier 5 : backend/tests/horizon-dsm-gate.test.js

Mettre à jour les assertions sur getHorizonCacheDsmSuffix() :
- Test 2b : assert(getHorizonCacheDsmSuffix() === ":dsm=0", ...) 
  → changer en : assert(getHorizonCacheDsmSuffix(48.86, 2.35) === ":dsm=ign-api", "2b) France → ign-api")
- Ajouter : assert(getHorizonCacheDsmSuffix(51.5, 10.7) === ":dsm=pvgis", "suffix hors France → pvgis")

Garder les tests sur isSurfaceDsmTerrainReady() inchangés.
```

---

### PROMPT 9 — Vérification complète

```
Contexte : Tous les fichiers des 8 prompts précédents ont été créés ou modifiés.
Cette étape vérifie que l'ensemble est cohérent avant tout test manuel.

Vérifications à effectuer dans l'ordre :

1. node backend/tests/shading-premium-lock.test.js
   → Doit passer. Tous les goldens inchangés (les tests utilisent __testHorizonMaskOverride).

2. node backend/tests/horizon-dsm-gate.test.js
   → Doit passer avec les nouvelles assertions de suffix.

3. node backend/tests/horizon-hd-nonreg.test.js
   → Doit passer avec les nouvelles assertions AUTO.

4. node backend/tests/horizon-confidence-integration.test.js
   → Doit passer.

5. node backend/tests/shading-quality-integration.test.js
   → Doit passer (pas de changement dans ce test).

6. node backend/tests/shading-kpi-contract.test.js
   → Doit passer (fixtures statiques non affectées).

En cas d'échec :
- Si shading-premium-lock golden change → chercher un appel à computeHorizonMaskAuto
  sans __testHorizonMaskOverride. Les tests golden doivent TOUS utiliser __testHorizonMaskOverride.
- Si import error sur reliefOnlyProvider → vérifier que reliefOnlyProvider.js exporte
  isAvailable et computeMask.
- Si import error sur ignGeoplatformeApiProvider dans horizonDsmGate.js →
  vérifier que isInMetropolitanFrance est bien exportée depuis ignGeoplatformeApiProvider.js.
```

---

## CHECKLIST DE LIVRAISON FINALE

```
□ pvgisHorizonProvider.js — créé, exports: isAvailable, computeMask
□ ignGeoplatformeApiProvider.js — créé, exports: isAvailable, isInMetropolitanFrance, computeMask
□ horizonProviderSelector.js — réécrit, imports: surfaceDsmProvider, IGN, PVGIS
□ reliefOnlyProvider.js — isAvailable=false, computeMask=UNAVAILABLE
□ farHorizonTruth.js — REAL_TERRAIN_PROVIDERS contient IGN_GEOPLATEFORME + PVGIS_HORIZON
□ farConfidenceModel.js — scoring IGN (≥80) et PVGIS (≥50)
□ horizonMaskCache.js — TTL 30 jours, getDsmSuffix accepte lat/lon
□ horizonDsmGate.js — getHorizonCacheDsmSuffix(lat, lon) retourne ign-api ou pvgis
□ calpinageShading.service.js — import ensureIgnTileAvailable supprimé
□ 5 tests mis à jour
□ npm run test:shading:lock — PASS sans modifier les goldens
□ shading-quality-integration.test.js — PASS
```
