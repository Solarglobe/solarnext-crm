import { deriveBackendCommercialGeometryVerdict } from '../calpinage/calpinageCommercialIntegrity.js';
import { validateFlatRoofSurvey } from '../calpinage/flatRoofSurveyContract.js';
/**
 * CP-FAR-003 — Service shading backend (near + far).
 * Calcul complet côté backend uniquement.
 * Si les données nécessaires manquent, les pertes restent null avec un statut explicite.
 *
 * Gouvernance near pur : shared/shading/nearShadingCore.cjs — docs/shading-governance.md
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { computeSunPosition } from "./solarPosition.js";
import { interpolateHorizonElevation } from "../horizon/horizonMaskCore.js";
import { computeHorizonMaskAuto } from "../horizon/providers/horizonProviderSelector.js";
import { farHorizonKindFromProvider, REAL_TERRAIN_PROVIDERS } from "./farHorizonTruth.js";
import { capConfidence01ForSource, SYNTHETIC_MAX_CONFIDENCE_01 } from "./syntheticReliefConfidence.js";
import { isCompleteHorizonMask } from "./shadingAssessment.service.js";
import { SHADING_MODEL_VERSION, computeShadingInputFingerprint, aggregateShadingEnergy } from "./shadingAssessment.service.js";

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
 * Angle Nord du toit (deg) — même convention que getNorthAngleDeg (pans-bundle) / worldMapping.
 * @param {object|null} geometry
 * @returns {number}
 */
export function readNorthAngleDeg(geometry) {
  const g = geometry && typeof geometry === "object" ? geometry : null;
  if (!g) return 0;
  const candidates = [
    g.roofState && g.roofState.roof && g.roofState.roof.north,
    g.roofState && g.roofState.north,
    g.roof && g.roof.north,
    g.north,
  ];
  for (const c of candidates) {
    if (c && typeof c.angleDeg === "number" && Number.isFinite(c.angleDeg)) return c.angleDeg;
  }
  return 0;
}

/**
 * NEAR-NS-FIX — Convertit un vecteur soleil GEOGRAPHIQUE (dx=Est, dy=Nord, dz=haut)
 * vers le repere PIXEL IMAGE (x=droite, y=bas) attendu par le raycast near (polygonPx).
 * Loi alignee sur worldMapping.worldHorizontalMToImagePx (sans rotation : Est=+x, Nord=-y).
 *   dx' = dx*cos + dy*sin
 *   dy' = dx*sin - dy*cos
 * dz inchange (la ponderation et t = zTop/dz restent corrects).
 * @param {{dx:number,dy:number,dz:number}} sunDir
 * @param {number} northAngleDeg
 * @returns {{dx:number,dy:number,dz:number}}
 */
export function geoSunDirToImagePixelDir(sunDir, northAngleDeg) {
  const rad = deg2rad(typeof northAngleDeg === "number" && Number.isFinite(northAngleDeg) ? northAngleDeg : 0);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: sunDir.dx * cos + sunDir.dy * sin,
    dy: sunDir.dx * sin - sunDir.dy * cos,
    dz: sunDir.dz,
  };
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
 * Échantillons annuels de positions solaires pour le calcul far shading (computeHorizonFarLoss).
 * Retourne { azimuthDeg, elevationDeg } — filtre uniquement les instants où le soleil est levé (> 0°).
 *
 * @param {number} lat - Latitude [−90, 90]
 * @param {number} lon - Longitude [−180, 180]
 * @param {{ year?: number, stepMinutes?: number }} [config]
 * @returns {Array<{ azimuthDeg: number, elevationDeg: number }>}
 */
export function buildFarShadingSunSamples(lat, lon, config = {}) {
  const c = {
    year: config.year ?? 2026,
    stepMinutes: config.stepMinutes ?? 60,
    minSunElevationDeg: 0,
  };
  const samples = generateAnnualSamples(c, lat, lon);
  return samples.map((s) => ({ azimuthDeg: s.azimuthDeg, elevationDeg: s.elevationDeg }));
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
      if (!hasExplicit || Number(rawH) < 0) {
        warnings.push("OBSTACLE_HEIGHT_MISSING");
      }
      obstacles.push({
        id: o.id || "obs-" + obstacles.length,
        points: pts,
        polygon: pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        polygonPx: pts,
        heightM: hasExplicit ? Number(rawH) : null,
      });
    } else warnings.push("OBSTACLE_GEOMETRY_INVALID");
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
      if (mpp == null) { warnings.push("SHADING_SCALE_MISSING"); continue; }
      if (!(o.width > 0) || !((o.depth ?? o.depthM) > 0)) warnings.push("OBSTACLE_DIMENSIONS_MISSING");
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
      if (!hasExplicit || Number(rawH) < 0) {
        warnings.push("OBSTACLE_HEIGHT_MISSING");
      }
      obstacles.push({
        id: o.id || "sv-" + obstacles.length,
        polygon: polygonPx.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        polygonPx,
        heightM: hasExplicit ? Number(rawH) : null,
      });
    } else warnings.push("OBSTACLE_GEOMETRY_INVALID");
  }

  const frozenBlocks = geometry.frozenBlocks || [];
  for (const block of frozenBlocks) {
    const blockPanels = block.panels || [];
    for (const p of blockPanels) {
      const poly = p.polygonPx || p.polygon || p.points || p.projection?.points;
      if (Array.isArray(poly) && poly.length >= 3) {
        panels.push({
          ...p,
          id: p.id || "p-" + panels.length,
          polygon: poly.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 })),
          polygonPx: poly,
          points: poly,
        });
      } else warnings.push("PANEL_GEOMETRY_INVALID");
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

/**
 * Extrait la normale unitaire du premier pan depuis la géométrie.
 * Fallback plan horizontal si tiltDeg absent (rétrocompat tests).
 * @param {object|null} geometry
 * @returns {{ normalX: number, normalY: number, normalZ: number }}
 */
function _extractPanelNormal(geometry) {
  const pans =
    geometry?.roof?.pans ??
    geometry?.validatedRoofData?.pans ??
    geometry?.roofState?.pans ??
    geometry?.pans ??
    [];
  if (!Array.isArray(pans) || pans.length === 0) {
    return { normalX: 0, normalY: 0, normalZ: 1 }; // plan horizontal
  }
  const pan     = pans[0];
  const tiltDeg = pan.tiltDeg ?? pan.slopeDeg ?? pan.tilt_deg ?? pan.tilt ?? 0;
  const azDeg   = pan.orientationDeg ?? pan.azimuthDeg ?? pan.azimuth_deg ?? pan.azimuth ?? 180;
  if (!tiltDeg || tiltDeg <= 0) {
    return { normalX: 0, normalY: 0, normalZ: 1 };
  }
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const azRad   = (azDeg   * Math.PI) / 180;
  return {
    normalX: Math.sin(azRad) * Math.sin(tiltRad),
    normalY: Math.cos(azRad) * Math.sin(tiltRad),
    normalZ: Math.cos(tiltRad),
  };
}

/**
 * Extrait tiltDeg et azimuthDeg du premier pan pour le calcul PVGIS.
 * Retourne des défauts France raisonnables si geometry absente.
 */
function _extractPanFirstPan(geometry) {
  const pans =
    geometry?.roof?.pans ??
    geometry?.validatedRoofData?.pans ??
    geometry?.roofState?.pans ??
    [];
  if (!Array.isArray(pans) || pans.length === 0) {
    return { tiltDeg: 30, azimuthDeg: 180 };   // défauts France raisonnables
  }
  const p = pans[0];
  return {
    tiltDeg:    p.tiltDeg    ?? p.slopeDeg    ?? p.tilt_deg    ?? 30,
    azimuthDeg: p.orientationDeg ?? p.azimuthDeg ?? p.azimuth_deg ?? 180,
  };
}

export async function computeCalpinageShading(params) {
  const canonical = params?.geometry?.geometryContractVersion != null;
  if (canonical) {
    const g=params.geometry, scene=validateFlatRoofSurvey(g);
    // No explicit parameter or client verdict overrides canonical physical inputs.
    params={...params,lat:g.gps?.lat,lon:g.gps?.lon,panels:scene.panels,obstacles:scene.obstacles,
      metersPerPixel:g.scale?.metersPerPixel,localObstacleSurvey:g.localObstacleSurvey,irradianceSamples:g.irradianceSamples};
  }
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
  // NEAR-NS-FIX : orientation Nord du toit pour convertir les vecteurs soleil geo -> pixels image.
  const northAngleDeg = readNorthAngleDeg(geometry ?? params?.geom ?? null);

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
  const fingerprint = computeShadingInputFingerprint(canonical ? {geometry} : params);
  const assessmentBase = { modelVersion: SHADING_MODEL_VERSION, inputFingerprint: fingerprint, geometryFingerprint: computeShadingInputFingerprint({ geometry }), computedAt: new Date().toISOString() };

  if (panels.length === 0) {
    return {
      farLossPct: null,
      nearLossPct: null,
      totalLossPct: null,
      assessment: { ...assessmentBase, status: "not_calculated", nearStatus: "not_calculated", farStatus: "not_calculated", reasons: ["missing_panel_geometry"] },
    };
  }

  if (!hasGps) {
    return {
      farLossPct: null,
      nearLossPct: null,
      totalLossPct: null,
      assessment: { ...assessmentBase, status: "insufficient_data", nearStatus: "insufficient_data", farStatus: "insufficient_data", reasons: ["missing_gps"] },
      farUnavailable: true,
      blockingReason: "missing_gps",
    };
  }

  const validPolygon = (o) => {
    const poly = o?.polygonPx ?? o?.polygon ?? o?.points ?? o?.projection?.points;
    return Array.isArray(poly) && poly.length >= 3 && poly.every((p) => p && typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y)) && Math.abs(poly.reduce((sum,p,i) => sum + p.x * poly[(i+1)%poly.length].y - poly[(i+1)%poly.length].x * p.y, 0)) > 1e-8;
  };
  if (panels.some((p) => !validPolygon(p))) geometryCommercialWarnings.push("PANEL_GEOMETRY_INVALID");
  if (obstacles.some((o) => !validPolygon(o) || o.heightM == null || !Number.isFinite(Number(o.heightM)) || Number(o.heightM) < 0)) geometryCommercialWarnings.push("OBSTACLE_GEOMETRY_INVALID");
  if (metersPerPixelMeta.isDefault) geometryCommercialWarnings.push("SHADING_SCALE_MISSING");
  const survey = params.localObstacleSurvey ?? geometry?.localObstacleSurvey ?? geometry?.roofState?.localObstacleSurvey;
  // An empty default list, an orthophoto or a terrain DTM is not an obstacle survey.
  const localSurveyComplete = survey?.status === "complete" && survey?.source === "manual_survey";
  const normObstacles = nearShadingCore.normalizeObstacles(obstacles, undefined);
  const config = { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 };
  let samples = generateAnnualSamples(config, lat, lon);
  let energyInputError = null;
  const irradiation = params.irradianceSamples ?? geometry?.irradianceSamples;
  let hasAnnualIrradiance = false;
  if (irradiation != null) {
    const ms = Array.isArray(irradiation) ? irradiation.map((r) => new Date(r?.timestamp).getTime()) : [];
    const year = ms.length > 0 ? new Date(ms[0]).getUTCFullYear() : NaN;
    const expectedHours = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3600000;
    hasAnnualIrradiance = ms.length === expectedHours && ms[0] >= Date.UTC(year, 0, 1) && ms[0] < Date.UTC(year, 0, 1, 1) &&
      ms.every((t, i) => Number.isFinite(t) && (i === 0 || t - ms[i - 1] === 3600000)) &&
      irradiation.every((r) => [r.directWh, r.diffuseWh, r.reflectedWh].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0));
    if (!hasAnnualIrradiance) energyInputError = "invalid_or_incomplete_hourly_irradiance";
    else samples = irradiation.map((r) => ({ date: new Date(r.timestamp), ...computeSunPosition(new Date(r.timestamp), lat, lon), energy: r }));
  }

  let horizonMask = options.__testHorizonMaskOverride || null;
  let farMetadata = null;
  if (!horizonMask && hasGps) {
    try {
      if (options.__testForceHorizonFailure === true) {
        throw new Error("__test_force_horizon_failure");
      }
      const hdEnabled = process.env.FAR_HORIZON_HD_ENABLED === "true";
      const stepDeg = 2;
      const radius = 500;
      const effectiveStepDeg = hdEnabled
        ? Number(process.env.FAR_HORIZON_HD_STEP_DEG || 1)
        : stepDeg;
      const effectiveRadius = hdEnabled
        ? Number(process.env.FAR_HORIZON_HD_MAX_DIST_M || 4000)
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

  const validHorizonMask = !horizonMask?.error && horizonMask?.status !== "error" && horizonMask?.source !== "FAR_UNAVAILABLE_ERROR" && isCompleteHorizonMask(horizonMask?.mask);
  const farHorizonUnavailable =
    hasGps &&
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

  const includePerPanelBreakdown = options.includePerPanelBreakdown === true;
  const perPanelFarNear =
    includePerPanelBreakdown && panels.length > 0 ? new Array(panels.length).fill(0) : null;

  const monthlyBaseline = new Array(12).fill(0);
  const monthlyFar      = new Array(12).fill(0);
  const monthlyFarNear  = new Array(12).fill(0);
  const energyRows = [];
  const periodLoss = { morning: 0, midday: 0, afternoon: 0 };

  // Normale panneau pour pondération GTI (cos angle d'incidence)
  const _panelNormal = _extractPanelNormal(params.geometry ?? params.geom ?? null);

  for (const sample of samples) {
    const { date, azimuthDeg: azDeg, elevationDeg: elDeg } = sample;
    const sunDir = computeShadowRayDirection(azDeg, elDeg);
    // Pondération GTI : cos(angle d'incidence sur le plan réel du panneau)
    // Fallback horizontal (normalZ=1) si tiltDeg absent → sunDir.dz (identique à l'ancien)
    const _cosInc = sunDir.dx * _panelNormal.normalX
                  + sunDir.dy * _panelNormal.normalY
                  + sunDir.dz * _panelNormal.normalZ;
    const energy = sample.energy;
    if (energy?.directWh > 0 && elDeg <= 0) energyInputError = "direct_irradiance_when_sun_below_horizon";
    const weight = energy ? energy.directWh + energy.diffuseWh + energy.reflectedWh : Math.max(0, _cosInc);
    if (weight <= 0) continue;

    const month = date ? date.getUTCMonth() : 0;

    totalWeightBaseline += weight;
    monthlyBaseline[month] += weight;

    const horizonElev = horizonMask?.mask
      ? interpolateHorizonElevation(horizonMask.mask, azDeg)
      : 0;
    const aboveHorizon = elDeg > 0 && elDeg >= horizonElev;
    const isClear = normObstacles.length === 0 && validHorizonMask && horizonMask.mask.every((p) => p.elev === 0);
    function transmission(component, stage) {
      if (!energy || energy[`${component}Wh`] === 0) return 1;
      const value = energy[`${component}${stage}Transmission`];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
      if (isClear) return 1;
      energyInputError = "missing_diffuse_or_reflected_transmission";
      return 1; // Diagnostic only; assessment below makes every annual KPI unavailable.
    }
    const farWeight = energy ? energy.directWh * (aboveHorizon ? 1 : 0) + energy.diffuseWh * transmission("diffuse", "Far") + energy.reflectedWh * transmission("reflected", "Far") : (aboveHorizon ? weight : 0);
    totalWeightFar += farWeight;
    monthlyFar[month] += farWeight;

    let panelFractionSum = 0;
    // NEAR-NS-FIX : le raycast near travaille en pixels image (polygonPx) -> convertir le
    // vecteur soleil geographique (dy=Nord) vers le repere pixel (y=bas). Sans cela, l'axe
    // Nord/Sud etait inverse (obstacle sud ignore, obstacle nord fantome).
    const sunDirPx = geoSunDirToImagePixelDir(sunDir, northAngleDeg);
    for (let pi = 0; pi < panels.length; pi++) {
      const panel = panels[pi];
      const fraction = aboveHorizon ? nearShadingCore.computePanelShadedFraction({
        panel,
        obstacles: normObstacles,
        sunDir: sunDirPx,
        getZWorldAtXY: undefined,
        useZLocal: false,
        panelGridSize: 2,
        metersPerPixel,
      }) : 0;
      panelFractionSum += fraction;
      if (perPanelFarNear) {
        perPanelFarNear[pi] += energy ? energy.directWh * (aboveHorizon ? 1 - fraction : 0) + energy.diffuseWh * transmission("diffuse", "Combined") + energy.reflectedWh * transmission("reflected", "Combined") : farWeight * (1 - fraction);
      }
    }
    const avgFraction = panels.length > 0 ? panelFractionSum / panels.length : 0;
    const farNearWeight = energy ? energy.directWh * (aboveHorizon ? 1 - avgFraction : 0) + energy.diffuseWh * transmission("diffuse", "Combined") + energy.reflectedWh * transmission("reflected", "Combined") : farWeight * (1 - avgFraction);
    totalWeightFarNear += farNearWeight;
    monthlyFarNear[month]  += farNearWeight;
    const period = azDeg < 150 ? "morning" : azDeg > 210 ? "afternoon" : "midday";
    periodLoss[period] += weight - farNearWeight;
    if (energy) energyRows.push({ timestamp: date.toISOString(), baselineWh: weight, farWh: farWeight, combinedWh: farNearWeight, period });
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
    farLossPct: farHorizonUnavailable ? null : farLossPct,
    nearLossPct,
    totalLossPct,
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
  // monthlyFactors — API stable, toujours retourné
  result.monthlyFactors = monthlyBaseline.map((base, i) => {
    const far = monthlyFar[i];
    const fn  = monthlyFarNear[i];
    return {
      month:                i + 1,
      farLossFraction:      base > 0 ? Math.max(0, Math.min(1, 1 - far / base)) : 0,
      nearLossFraction:     far  > 0 ? Math.max(0, Math.min(1, 1 - fn  / far))  : 0,
      combinedLossFraction: base > 0 ? Math.max(0, Math.min(1, 1 - fn  / base)) : 0,
    };
  });
  // __testMonthly — compat rétrograde (stress-scenarios.test.js lit r.__testMonthly)
  result.__testMonthly = {
    monthlyBaselineEnergy: monthlyBaseline,
    monthlyFarEnergy:      monthlyFar,
    monthlyFarNearEnergy:  monthlyFarNear,
  };
  if (perPanelFarNear && panels.length > 0 && totalWeightBaseline > 0) {
    result.perPanelBreakdown = panels.map((p, i) => ({
      panelId: String(p.id ?? `p-${i}`),
      lossPct: clamp01(1 - perPanelFarNear[i] / totalWeightBaseline) * 100,
    }));
  }
  if (geometryCommercialWarnings.length > 0) {
    result.geometryCommercialWarnings = geometryCommercialWarnings;
  }

  // Preserve the geometric calculation for diagnostics; it is not annual energy.
  result.diagnostics = { geometricProxy: {
    method: "incidence_weighted_direct_beam_flat_roof", nearLossPct, farLossPct, totalLossPct,
    monthlyFactors: result.monthlyFactors, perPanel: result.perPanelBreakdown ?? [],
    periodLoss, baseline: totalWeightBaseline,
  } };
  const reasons = [];
  let nearStatus = "computed", farStatus = "computed";
  if (!localSurveyComplete) { nearStatus = "insufficient_data"; reasons.push("local_obstacle_survey_missing"); }
  const integrity = canonical ? deriveBackendCommercialGeometryVerdict(geometry) : geometry?.backendCommercialGeometry ?? geometry?.commercialGeometry;
  if (integrity?.status === 'INVALID' || integrity?.officialNearShadingAllowed === false) {
    nearStatus = 'insufficient_data'; reasons.push('commercial_geometry_invalid');
  }
  if (geometryCommercialWarnings.length > 0) { nearStatus = "insufficient_data"; reasons.push(...geometryCommercialWarnings); }
  if (normObstacles.length > 0 && _panelNormal.normalZ < 0.999999) { nearStatus = "insufficient_data"; reasons.push("sloped_roof_intersections_not_modelled"); }
  if (farHorizonUnavailable) { farStatus = "error"; reasons.push("horizon_provider_unavailable"); }
  if (!farHorizonUnavailable && !REAL_TERRAIN_PROVIDERS.has(farMetadata?.source) && !options.__testHorizonMaskOverride) {
    farStatus = 'insufficient_data'; reasons.push('horizon_source_unverified');
  }
  if (totalWeightBaseline <= 0) { nearStatus = farStatus = "insufficient_data"; reasons.push("no_reference_energy"); }
  if (canonical && !hasAnnualIrradiance) energyInputError = "hourly_irradiance_missing";
  if (!hasAnnualIrradiance) {
    if (normObstacles.length > 0) nearStatus = "insufficient_data";
    if (!farHorizonUnavailable && horizonMask.mask.some(p => p.elev > 0)) farStatus = "insufficient_data";
    if (normObstacles.length > 0 || horizonMask?.mask?.some(p => p.elev > 0)) reasons.push("hourly_irradiance_missing");
  }
  const energyResult = hasAnnualIrradiance ? aggregateShadingEnergy(energyRows) : null;
  if (hasAnnualIrradiance && (geometry?.pans?.length > 1 || geometry?.validatedRoofData?.pans?.length > 1 || geometry?.roof?.pans?.length > 1 || geometry?.roofState?.pans?.length > 1)) energyInputError = "per_plane_irradiance_not_modelled";
  if (energyInputError || (hasAnnualIrradiance && !energyResult)) {
    nearStatus = "insufficient_data";
    if (farStatus !== "error") farStatus = "insufficient_data";
    reasons.push(energyInputError ?? "invalid_energy_balance");
  }
  if (totalWeightFar <= 0) { nearStatus = "insufficient_data"; reasons.push("no_energy_after_horizon"); }
  const status = farStatus === "error" ? "error" : nearStatus === "computed" && farStatus === "computed" ? "computed" : "insufficient_data";
  result.assessment = { ...assessmentBase, geometryContractVersion: canonical ? geometry.geometryContractVersion : undefined, status, nearStatus, farStatus, reasons: [...new Set(reasons)],
    energyMethod: hasAnnualIrradiance ? "hourly_poa_components" : "zero_loss_only_no_energy_model",
    localDataSource: localSurveyComplete ? survey.source : null,
    limitations: ["flat_roof_local_raycast", "no_electrical_mismatch_or_bypass_diode_model", "no_automatic_orthophoto_shadow_detection"] };
  result.nearLossPct = nearStatus === "computed" ? nearLossPct : null;
  result.farLossPct = farStatus === "computed" ? farLossPct : null;
  result.totalLossPct = status === "computed" ? totalLossPct : null;
  if (status !== "computed") {
    result.monthlyFactors = null;
    result.perPanelBreakdown = [];
  } else if (energyResult) {
    result.monthlyFactors = energyResult.monthlyFactors;
    result.distribution = energyResult.distribution;
  }

  // POA irradiation is not electrical production. A separate monthly PVGIS series
  // would change the annual weighting; no kWh estimate without the same hourly baseline.
  result.monthlyKwhStats = null;
  result.annualLossKwh = null;

  return result;
}
