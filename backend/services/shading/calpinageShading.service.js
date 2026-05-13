/**
 * CP-FAR-003 — Service shading backend (near + far).
 * Calcul complet côté backend uniquement.
 * Si GPS absent (mais panneaux présents): farLossPct = null, far indisponible, totalLossPct = near stocké.
 *
 * Gouvernance near pur : shared/shading/nearShadingCore.cjs — docs/shading-governance.md
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { computeSunPosition } from "./solarPosition.js";
import { interpolateHorizonElevation } from "../horizon/horizonMaskCore.js";
import { computeHorizonMaskAuto } from "../horizon/providers/horizonProviderSelector.js";
import { ensureIgnTileAvailable } from "../dsmDynamic/ignDynamicLoader.js";
import { farHorizonKindFromProvider, REAL_TERRAIN_PROVIDERS } from "./farHorizonTruth.js";
import { capConfidence01ForSource, SYNTHETIC_MAX_CONFIDENCE_01 } from "./syntheticReliefConfidence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const nearShadingCore = require(path.join(__dirname, "../../../shared/shading/nearShadingCore.cjs"));

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function computeShadowRayDirection(azimuthDeg, elevationDeg) {
  const azRad = deg2rad(azimuthDeg);
  const elRad = deg2rad(elevationDeg);
  const dx = Math.sin(azRad) * Math.cos(elRad);
  const dy = Math.cos(azRad) * Math.cos(elRad);
  const dz = Math.sin(elRad);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-12) return { dx: 0, dy: 0, dz: 1 };
  return { dx: dx / len, dy: dy / len, dz: dz / len };
}

/**
 * m/px pour near shading (polygonPx). Priorité : param explicite → geometry.scale.
 * Sans échelle : 1 (compat anciens jeux de tests « 1 px ≈ 1 m »).
 * @returns {{ value: number, isDefault: boolean }}
 */
export function resolveMetersPerPixelFromParamsWithMeta(params) {
  const p = params && typeof params === "object" ? params : {};
  const direct = p.metersPerPixel;
  if (typeof direct === "number" && direct > 0 && Number.isFinite(direct)) {
    return { value: direct, isDefault: false };
  }
  const g = p.geometry;
  if (g && typeof g === "object") {
    const m =
      g.roofState?.scale?.metersPerPixel ??
      g.scale?.metersPerPixel ??
      g.roof?.scale?.metersPerPixel;
    if (typeof m === "number" && m > 0 && Number.isFinite(m)) {
      return { value: m, isDefault: false };
    }
  }
  return { value: 1, isDefault: true };
}

export function resolveMetersPerPixelFromParams(params) {
  return resolveMetersPerPixelFromParamsWithMeta(params).value;
}

/** Cache échantillons annuels (lat/lon/year/step/seuil) — évite recalculs dans la même instance Node. */
const _annualSolarSampleCache = new Map();
const _annualSolarSampleCacheMax = 48;

/**
 * Grille annuelle en **UTC civil** (Date.UTC) : déterministe quel que soit le TZ du serveur.
 * Chaque instant reste physiquement cohérent avec computeSunPosition (composantes UTC).
 */
function generateAnnualSamples(opts, latDeg, lonDeg) {
  const year = opts?.year ?? 2026;
  const stepMinutes = opts?.stepMinutes ?? 60;
  const minSunElevationDeg = Math.max(0, opts?.minSunElevationDeg ?? 3);

  const cacheKey = `${year}|${stepMinutes}|${minSunElevationDeg}|${Number(latDeg).toFixed(5)}|${Number(lonDeg).toFixed(5)}`;
  if (_annualSolarSampleCache.has(cacheKey)) {
    return _annualSolarSampleCache.get(cacheKey);
  }

  const samples = [];
  const startMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(year, 11, 31, 23, 59, 0, 0);
  const stepMs = stepMinutes * 60 * 1000;

  for (let t = startMs; t <= endMs; t += stepMs) {
    const date = new Date(t);
    const sunPos = computeSunPosition(date, latDeg, lonDeg);
    if (!sunPos || sunPos.elevationDeg < minSunElevationDeg) continue;
    samples.push({
      date,
      azimuthDeg: sunPos.azimuthDeg,
      elevationDeg: sunPos.elevationDeg,
    });
  }

  if (_annualSolarSampleCache.size >= _annualSolarSampleCacheMax) {
    const firstK = _annualSolarSampleCache.keys().next().value;
    _annualSolarSampleCache.delete(firstK);
  }
  _annualSolarSampleCache.set(cacheKey, samples);
  return samples;
}

/**
 * Retourne les vecteurs solaires annuels (même logique que la boucle near).
 * Utilisé pour les tests de parité front/back (nearShadingCore).
 * @param {number} lat
 * @param {number} lon
 * @param {{ year?: number, stepMinutes?: number, minSunElevationDeg?: number }} [config]
 * @returns {Array<{ dx: number, dy: number, dz: number }>}
 */
export function getAnnualSunVectorsForNear(lat, lon, config = {}) {
  const c = {
    year: config.year ?? 2026,
    stepMinutes: config.stepMinutes ?? 60,
    minSunElevationDeg: Math.max(0, config.minSunElevationDeg ?? 3),
  };
  const samples = generateAnnualSamples(c, lat, lon);
  return samples.map((s) => computeShadowRayDirection(s.azimuthDeg, s.elevationDeg));
}

/**
 * Extrait panels et obstacles depuis geometry (format calpinage).
 * @param {number} metersPerPixel - requis pour construire un footprint depuis width/depth en mètres
 * @param {boolean} [strictCommercial] — étude client : hauteur / échelle implicites → warnings (calcul inchangé, pas de faux « connu »).
 */
function extractFromGeometry(geometry, metersPerPixel, strictCommercial = false) {
  const panels = [];
  const obstacles = [];
  const warnings = [];

  const roofState = geometry.roofState || {};
  const obsList = roofState.obstacles || geometry.obstacles || [];
  for (const o of obsList) {
    if (!o) continue;
    const pts = o.points || o.polygon || o.polygonPx;
    if (Array.isArray(pts) && pts.length >= 3) {
      const rawH = o.heightM ?? o.heightRelM ?? o.height;
      const hasExplicit =
        rawH != null &&
        rawH !== "" &&
        Number.isFinite(Number(rawH));
      if (strictCommercial && !hasExplicit) {
        warnings.push("OBSTACLE_HEIGHT_MISSING");
      }
      obstacles.push({
        id: o.id || "obs-" + obstacles.length,
        points: pts,
        polygon: pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        polygonPx: pts,
        heightM: hasExplicit ? Number(rawH) : 1,
      });
    }
  }

  const shadowVolumes = geometry.shadowVolumes || [];
  const roofExtensions = geometry.roofExtensions || [];
  const mpp =
    typeof metersPerPixel === "number" && metersPerPixel > 0 && Number.isFinite(metersPerPixel)
      ? metersPerPixel
      : null;

  for (const o of [...shadowVolumes, ...roofExtensions]) {
    if (!o) continue;
    let polygonPx = o.polygonPx || o.points || o.polygon;
    if (!polygonPx && o.x != null && o.y != null) {
      if (mpp == null) continue;
      const wPx = (o.width || 0.6) / mpp;
      const dPx = (o.depth || o.depthM || 0.6) / mpp;
      const hw = wPx / 2;
      const hd = dPx / 2;
      polygonPx = [
        { x: o.x - hw, y: o.y - hd },
        { x: o.x + hw, y: o.y - hd },
        { x: o.x + hw, y: o.y + hd },
        { x: o.x - hw, y: o.y + hd },
      ];
    }
    if (Array.isArray(polygonPx) && polygonPx.length >= 3) {
      const rawH = o.heightM ?? o.ridgeHeightRelM ?? o.heightRelM;
      const hasExplicit =
        rawH != null &&
        rawH !== "" &&
        Number.isFinite(Number(rawH));
      if (strictCommercial && !hasExplicit) {
        warnings.push("OBSTACLE_HEIGHT_MISSING");
      }
      obstacles.push({
        id: o.id || "sv-" + obstacles.length,
        polygon: polygonPx.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        polygonPx,
        heightM: hasExplicit ? Number(rawH) : 1,
      });
    }
  }

  const frozenBlocks = geometry.frozenBlocks || [];
  for (const block of frozenBlocks) {
    const blockPanels = block.panels || [];
    for (const p of blockPanels) {
      const poly = p.polygonPx || p.polygon || p.points || p.projection?.points;
      if (Array.isArray(poly) && poly.length >= 3) {
        panels.push({
          id: p.id || "p-" + panels.length,
          polygon: poly.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 })),
          polygonPx: poly,
          points: poly,
        });
      }
    }
  }

  return { panels, obstacles, warnings };
}

/**
 * Calcule shading complet (near + far).
 * @param {Object} params
 * @param {number} [params.lat] - Latitude (requis pour far)
 * @param {number} [params.lon] - Longitude (requis pour far)
 * @param {Array} [params.panels] - Panels avec polygon/polygonPx
 * @param {Array} [params.obstacles] - Obstacles avec polygon, heightM
 * @param {Object} [params.geometry] - Geometry calpinage (extraction auto)
 * @param {Object} [params.options] - options.__testHorizonMaskOverride, options.__testReturnMonthly, options.includePerPanelBreakdown
 * @param {number} [params.storedNearLossPct] - Si pas de panels, utiliser cette valeur
 * @param {number} [params.metersPerPixel] - m/px (near shading). Sinon dérivé de geometry ou 1.
 * @returns {{ farLossPct, nearLossPct, totalLossPct, perPanelBreakdown?, [__testMonthly]? }}
 */
export async function computeCalpinageShading(params) {
  const {
    lat,
    lon,
    panels: panelsParam,
    obstacles: obstaclesParam,
    geometry,
    options = {},
    storedNearLossPct = 0,
  } = params || {};

  const metersPerPixelMeta = resolveMetersPerPixelFromParamsWithMeta(params);
  const metersPerPixel = metersPerPixelMeta.value;

  let panels = Array.isArray(panelsParam) ? panelsParam : [];
  let obstacles = Array.isArray(obstaclesParam) ? obstaclesParam : [];
  const geometryCommercialWarnings = [];

  if (panels.length === 0 && geometry && typeof geometry === "object") {
    const extracted = extractFromGeometry(
      geometry,
      metersPerPixel,
      options.strictCommercialShading === true
    );
    panels = extracted.panels;
    obstacles = extracted.obstacles;
    for (const w of extracted.warnings || []) {
      if (w && !geometryCommercialWarnings.includes(w)) geometryCommercialWarnings.push(w);
    }
  }

  if (
    options.strictCommercialShading === true &&
    metersPerPixelMeta.isDefault &&
    panels.length > 0
  ) {
    if (!geometryCommercialWarnings.includes("SHADING_SCALE_MISSING")) {
      geometryCommercialWarnings.push("SHADING_SCALE_MISSING");
    }
  }

  const hasGps = typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

  if (panels.length === 0) {
    return {
      farLossPct: 0,
      nearLossPct: storedNearLossPct,
      totalLossPct: storedNearLossPct,
    };
  }

  if (!hasGps) {
    return {
      farLossPct: null,
      nearLossPct: storedNearLossPct,
      totalLossPct: storedNearLossPct,
      farUnavailable: true,
      blockingReason: "missing_gps",
    };
  }

  const normObstacles = nearShadingCore.normalizeObstacles(obstacles, undefined);
  const config = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };
  const samples = generateAnnualSamples(config, lat, lon);

  let horizonMask = options.__testHorizonMaskOverride || null;
  let farMetadata = null;
  if (!horizonMask && hasGps) {
    if (process.env.DSM_PROVIDER_TYPE === "IGN_RGE_ALTI") {
      try {
        await ensureIgnTileAvailable(lat, lon);
      } catch (err) {
        console.warn("[IGN DYNAMIC] Tile ensure failed, fallback will handle.", err?.message ?? err);
      }
    }
    try {
      if (options.__testForceHorizonFailure === true) {
        throw new Error("__test_force_horizon_failure");
      }
      const hdEnabled = process.env.FAR_HORIZON_HD_ENABLE === "true";
      const stepDeg = 2;
      const radius = 500;
      const effectiveStepDeg = hdEnabled
        ? Number(process.env.FAR_HORIZON_HD_STEP_DEG || 1)
        : stepDeg;
      const effectiveRadius = hdEnabled
        ? Number(process.env.FAR_HORIZON_HD_RADIUS_M || 800)
        : radius;
      const t0 = performance.now();
      const result = await computeHorizonMaskAuto({
        lat,
        lon,
        radius_m: effectiveRadius,
        step_deg: effectiveStepDeg,
        enableHD: hdEnabled,
      });
      const duration = performance.now() - t0;
      console.log(
        "[HORIZON] mode=" + (hdEnabled ? "HD" : "STD") +
        " step=" + effectiveStepDeg +
        " radius=" + effectiveRadius +
        " duration=" + Math.round(duration) + " ms"
      );
      horizonMask = result;
      const dc = result.dataCoverage || {};
      const farSource = dc.provider ?? result.source;
      farMetadata = {
        source: farSource,
        confidence: result.confidence,
        radius_m: result.radius_m,
        step_deg: result.step_deg,
        resolution_m: result.resolution_m,
        meta: result.meta,
        dataCoverage: {
          ...dc,
          ratio: dc.ratio ?? (typeof dc.coveragePct === "number" ? (dc.coveragePct > 1 ? dc.coveragePct / 100 : dc.coveragePct) : 1),
          effectiveRadiusMeters: dc.effectiveRadiusMeters ?? result.radius_m,
          gridResolutionMeters: dc.gridResolutionMeters ?? result.resolution_m,
          missingTilesCount: dc.missingTilesCount,
          provider:
            dc.provider ??
            (result.meta?.source === "SYNTHETIC_STUB"
              ? "SYNTHETIC_STUB"
              : result.source === "RELIEF_ONLY"
                ? "RELIEF_ONLY"
                : "HTTP_GEOTIFF"),
        },
      };
    } catch (err) {
      horizonMask = null;
      console.warn("[HORIZON] computeHorizonMaskAuto failed:", err?.message ?? err);
    }
  }

  const validHorizonMask =
    horizonMask &&
    Array.isArray(horizonMask.mask) &&
    horizonMask.mask.length > 0;
  const farHorizonUnavailable =
    hasGps &&
    options.__testHorizonMaskOverride == null &&
    !validHorizonMask;
  if (horizonMask && options.__testHorizonMaskOverride) {
    const dc = horizonMask.dataCoverage || {};
    const farSource = dc.provider ?? horizonMask.source ?? horizonMask.meta?.source ?? "RELIEF_ONLY";
    farMetadata = {
      source: farSource,
      confidence: REAL_TERRAIN_PROVIDERS.has(farSource)
        ? (horizonMask.confidence ?? 0.85)
        : capConfidence01ForSource(horizonMask.confidence ?? SYNTHETIC_MAX_CONFIDENCE_01, farSource),
      radius_m: horizonMask.radius_m ?? 500,
      step_deg: horizonMask.step_deg ?? 2,
      resolution_m: horizonMask.resolution_m ?? 30,
      meta: horizonMask.meta,
      dataCoverage: {
        ...dc,
        ratio: dc.ratio ?? (typeof dc.coveragePct === "number" ? (dc.coveragePct > 1 ? dc.coveragePct / 100 : dc.coveragePct) : 1),
        effectiveRadiusMeters: dc.effectiveRadiusMeters ?? horizonMask.radius_m ?? 500,
        gridResolutionMeters: dc.gridResolutionMeters ?? horizonMask.resolution_m ?? 30,
        missingTilesCount: dc.missingTilesCount,
        provider: dc.provider ?? horizonMask.source ?? "RELIEF_ONLY",
      },
    };
  }

  let totalWeightBaseline = 0;
  let totalWeightFar = 0;
  let totalWeightFarNear = 0;

  const returnMonthly = options.__testReturnMonthly === true;
  const includePerPanelBreakdown = options.includePerPanelBreakdown === true;
  const perPanelFarNear =
    includePerPanelBreakdown && panels.length > 0 ? new Array(panels.length).fill(0) : null;

  const monthlyBaseline = returnMonthly ? new Array(12).fill(0) : null;
  const monthlyFar = returnMonthly ? new Array(12).fill(0) : null;
  const monthlyFarNear = returnMonthly ? new Array(12).fill(0) : null;

  for (const sample of samples) {
    const { date, azimuthDeg: azDeg, elevationDeg: elDeg } = sample;
    const sunDir = computeShadowRayDirection(azDeg, elDeg);
    const weight = Math.max(0, sunDir.dz);
    if (weight <= 0) continue;

    const month = date ? date.getUTCMonth() : 0;

    totalWeightBaseline += weight;
    if (returnMonthly) monthlyBaseline[month] += weight;

    const horizonElev = horizonMask?.mask
      ? interpolateHorizonElevation(horizonMask.mask, azDeg)
      : 0;
    const aboveHorizon = elDeg >= horizonElev;

    if (!aboveHorizon) continue;

    totalWeightFar += weight;
    if (returnMonthly) monthlyFar[month] += weight;

    let panelFractionSum = 0;
    for (let pi = 0; pi < panels.length; pi++) {
      const panel = panels[pi];
      const fraction = nearShadingCore.computePanelShadedFraction({
        panel,
        obstacles: normObstacles,
        sunDir,
        getZWorldAtXY: undefined,
        useZLocal: false,
        panelGridSize: 2,
        metersPerPixel,
      });
      panelFractionSum += fraction;
      if (perPanelFarNear) {
        perPanelFarNear[pi] += weight * (1 - fraction);
      }
    }
    const avgFraction = panels.length > 0 ? panelFractionSum / panels.length : 0;
    const farNearWeight = weight * (1 - avgFraction);
    totalWeightFarNear += farNearWeight;
    if (returnMonthly) monthlyFarNear[month] += farNearWeight;
  }

  let farLossPct = 0;
  let nearLossPct = 0;
  let totalLossPct = 0;

  if (totalWeightBaseline <= 0) {
    farLossPct = 0;
    nearLossPct = 0;
    totalLossPct = 0;
  } else {
    farLossPct = clamp01(1 - totalWeightFar / totalWeightBaseline) * 100;
    nearLossPct = totalWeightFar > 0
      ? clamp01(1 - totalWeightFarNear / totalWeightFar) * 100
      : 0;
    totalLossPct = clamp01(1 - totalWeightFarNear / totalWeightBaseline) * 100;
  }

  const result = {
    farLossPct: farHorizonUnavailable ? null : Number(farLossPct.toFixed(3)),
    nearLossPct: Number(nearLossPct.toFixed(3)),
    totalLossPct: Number(totalLossPct.toFixed(3)),
  };
  if (farHorizonUnavailable) {
    result.farHorizonStatus = "FAR_UNAVAILABLE_ERROR";
    result.farShadingUnavailable = true;
    result.farMetadata = {
      source: "FAR_UNAVAILABLE_ERROR",
      confidence: null,
      radius_m: null,
      step_deg: null,
      resolution_m: 0,
      meta: { reason: "horizon_mask_unavailable" },
      dataCoverage: {
        ratio: 0,
        effectiveRadiusMeters: 0,
        gridResolutionMeters: 0,
        provider: "FAR_UNAVAILABLE_ERROR",
      },
    };
  } else if (farMetadata) {
    result.farMetadata = farMetadata;
  }
  if (horizonMask && Array.isArray(horizonMask.mask) && horizonMask.mask.length > 0) {
    const horizonProv = farMetadata?.source ?? farMetadata?.dataCoverage?.provider ?? "RELIEF_ONLY";
    result.horizonMask = {
      mask: horizonMask.mask,
      source: farMetadata?.source ?? horizonMask.source ?? "RELIEF_ONLY",
      dataCoverage: farMetadata?.dataCoverage ?? null,
      farHorizonKind: farHorizonKindFromProvider(horizonProv),
    };
  }
  if (returnMonthly && monthlyBaseline && monthlyFar && monthlyFarNear) {
    result.__testMonthly = {
      monthlyBaselineEnergy: monthlyBaseline,
      monthlyFarEnergy: monthlyFar,
      monthlyFarNearEnergy: monthlyFarNear,
    };
  }
  if (perPanelFarNear && panels.length > 0 && totalWeightBaseline > 0) {
    result.perPanelBreakdown = panels.map((p, i) => ({
      panelId: String(p.id ?? `p-${i}`),
      lossPct: Number((clamp01(1 - perPanelFarNear[i] / totalWeightBaseline) * 100).toFixed(2)),
    }));
  }
  if (geometryCommercialWarnings.length > 0) {
    result.geometryCommercialWarnings = geometryCommercialWarnings;
  }
  return result;
}
