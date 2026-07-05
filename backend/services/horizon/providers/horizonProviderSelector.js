/**
 * CP-FAR-SELECTOR-02 — Sélecteur provider horizon
 * Priorités :
 *   1. HTTP_GEOTIFF (si DSM_PROVIDER_TYPE=HTTP_GEOTIFF + URL + DSM_ENABLE=true)
 *   2. IGN Géoplateforme API (France + DOM + COM, ign_rge_alti_wld, 1m)
 *   3. PVGIS (fallback mondial, SRTM 90m, 48 azimuts 7.5°)
 *   4. UNAVAILABLE (honnête — aucun horizon fictif)
 *
 * Aucun RELIEF_ONLY. Aucune gaussienne synthétique.
 */

import * as surfaceDsmProvider       from "./surfaceDsmProvider.js";
import * as ignGeoplatformeApiProvider from "./ignGeoplatformeApiProvider.js";
import * as pvgisHorizonProvider      from "./pvgisHorizonProvider.js";
import { isSurfaceProductEnabled, getLidarSurfaceDataDir } from "./dsm/dsmConfig.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _buildUnavailable(reason) {
  const msg = String(reason ?? "UNKNOWN").slice(0, 300);
  console.warn("[HORIZON] UNAVAILABLE:", msg);
  return {
    source: "FAR_UNAVAILABLE_ERROR",
    mask:   [],
    confidence: 0,
    dataCoverage: {
      provider:             "FAR_UNAVAILABLE_ERROR",
      ratio:                0,
      gridResolutionMeters: 0,
      effectiveRadiusMeters: 0,
      notes:                [msg],
    },
    meta: { source: "FAR_UNAVAILABLE_ERROR", fallbackReason: msg },
  };
}

/**
 * Un masque est valide si :
 *  - il a au moins un point
 *  - ce n'est pas un état UNAVAILABLE
 *  - la couverture terrain dépasse 5 % (sinon site hors couverture IGN → PVGIS)
 */
function _isValidMask(result) {
  if (result == null) return false;
  if (result.source === "FAR_UNAVAILABLE_ERROR") return false;
  if (!Array.isArray(result.mask) || result.mask.length === 0) return false;
  const ratio = result.dataCoverage?.ratio;
  if (typeof ratio === "number" && ratio < 0.05) return false;
  return true;
}

function _isHttpGeotiffConfigured() {
  return (
    (process.env.DSM_PROVIDER_TYPE ?? "").toUpperCase() === "HTTP_GEOTIFF" &&
    Boolean(process.env.DSM_GEOTIFF_URL_TEMPLATE) &&
    process.env.DSM_ENABLE === "true"
  );
}

// CP-FAR-MNS-01 — MNS/MNH LiDAR HD (dalles GeoTIFF L93 locales) : sursol inclus.
// Activé uniquement si DSM_PRODUCT=MNS|MNH + répertoire dalles + DSM_ENABLE=true.
function _isLocalSurfaceConfigured() {
  return (
    isSurfaceProductEnabled() &&
    Boolean(getLidarSurfaceDataDir()) &&
    process.env.DSM_ENABLE === "true"
  );
}

function _isUnitHorizonFixtureEnabled() {
  return process.env.SOLARNEXT_UNIT_HORIZON_FIXTURE === "true";
}

function _buildUnitHorizonFixture(params) {
  const step = Number(params?.step_deg || 2);
  const radius = Number(params?.radius_m || 500);
  const count = Math.max(1, Math.round(360 / step));
  const mask = Array.from({ length: count + 1 }, (_, i) => {
    const az = -180 + i * step;
    const elev = Number((3 + 1.5 * Math.sin((az * Math.PI) / 180)).toFixed(3));
    return { az, elev };
  });

  return {
    source: "PVGIS_HORIZON",
    mask,
    radius_m: radius,
    step_deg: step,
    resolution_m: 90,
    confidence: 0.55,
    dataCoverage: {
      provider: "PVGIS_HORIZON",
      ratio: 1,
      gridResolutionMeters: 90,
      effectiveRadiusMeters: radius,
      notes: ["Unit test deterministic horizon fixture"],
    },
    meta: {
      source: "PVGIS_HORIZON",
      algorithm: "UNIT_TEST_FIXTURE",
      fixture: true,
    },
  };
}

async function _tryProvider(label, provider, params) {
  try {
    const result = await provider.computeMask(params);
    if (_isValidMask(result)) {
      const prov = result.meta?.source ?? result.dataCoverage?.provider ?? label;
      console.log(
        `[HORIZON] ✓ ${prov} — ${result.mask.length} azimuts — confidence=${result.confidence}`
      );
      return result;
    }
    const ratio = result?.dataCoverage?.ratio;
    console.log(
      `[HORIZON] ${label}: masque vide ou couverture insuffisante (ratio=${ratio ?? "n/a"}), provider suivant`
    );
    return null;
  } catch (err) {
    console.warn(`[HORIZON] ${label} erreur: ${err.message}`);
    return null;
  }
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

/**
 * Retourne toujours un objet valide — jamais undefined.
 * @param {{ lat: number, lon: number, radius_m?: number, step_deg?: number, enableHD?: boolean }} params
 * @returns {Promise<{ source, mask, step_deg, confidence, dataCoverage, meta }>}
 */
export async function computeHorizonMaskAuto(params) {
  const { lat, lon } = params ?? {};
  if (typeof lat !== "number" || typeof lon !== "number") {
    return _buildUnavailable("INVALID_COORDS");
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return _buildUnavailable("INVALID_COORDS");
  }

  // 1) HTTP_GEOTIFF — uniquement si configuré explicitement
  if (_isHttpGeotiffConfigured()) {
    const result = await _tryProvider("HTTP_GEOTIFF", surfaceDsmProvider, params);
    if (result) return result;
  }

  // 1bis) MNS/MNH LiDAR HD (dalles GeoTIFF locales) — SURSOL inclus (arbres + bâti).
  //       En tête de l'API RGE ALTI (terrain seul) : là où le LiDAR couvre, on voit
  //       la végétation ; sinon on cascade vers le terrain nu (honnête, cf. ci-dessous).
  if (_isLocalSurfaceConfigured()) {
    const result = await _tryProvider("IGN_LIDAR_MNS", surfaceDsmProvider, params);
    if (result) return result;
  }

  if (_isUnitHorizonFixtureEnabled()) {
    return _buildUnitHorizonFixture(params);
  }

  // 2) IGN Géoplateforme — France + DOM + COM (ign_rge_alti_wld, TERRAIN nu — sol seul)
  //    Sites hors couverture retournent -99999 → coverageRatio < 5% → provider suivant
  if (ignGeoplatformeApiProvider.isAvailable({ lat, lon }).available) {
    const result = await _tryProvider("IGN_GEOPLATEFORME", ignGeoplatformeApiProvider, params);
    if (result) return result;
  }

  // 3) PVGIS — fallback mondial (SRTM 90m, 48 azimuts 7.5°)
  if (pvgisHorizonProvider.isAvailable({ lat, lon }).available) {
    const result = await _tryProvider("PVGIS_HORIZON", pvgisHorizonProvider, params);
    if (result) return result;
  }

  return _buildUnavailable("ALL_PROVIDERS_FAILED");
}

/**
 * Alias rétrocompat — utilisé dans quelques tests qui appellent selectBestProvider().
 */
export function selectBestProvider(params) {
  return { computeMask: (p) => computeHorizonMaskAuto(p ?? params) };
}
