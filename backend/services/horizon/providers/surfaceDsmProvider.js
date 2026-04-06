/**
 * CP-FAR-007 — SurfaceDsmProvider (stub LiDAR-ready)
 * CP-FAR-008 — Intégration provider DSM réel (HTTP GeoTIFF) + fallback RELIEF_ONLY
 * CP-FAR-009 — Ray-casting HD optionnel (enableHD)
 */

import fs from "fs";
import path from "path";
import { validateHorizonMaskParams } from "../horizonMaskCore.js";
import * as reliefOnlyProvider from "./reliefOnlyProvider.js";
import { getTileHeights, getDsmGridForRadius } from "./dsm/dsmProviderHttpGeotiff.js";
import { dsmGridToHorizonMask } from "./dsm/dsmToHorizonMask.js";
import { fetchDsmReal } from "./dsm/dsmRealProvider.js";
import { getDsmEnvConfig } from "./dsm/dsmConfig.js";
import { getDsmTile, setDsmTile, dsmTileKey } from "./dsm/dsmTileCache.js";
import { computeHorizonRaycastHD } from "../hd/horizonRaycastHdCore.js";
import { createDsmGridSampler, getSiteElevation } from "../hd/dsmGridSampler.js";
import { wgs84ToLambert93 } from "./ign/projection2154.js";
import { getIgnDsmDataDir } from "./ign/ignRgeAltiConfig.js";
import { selectTilesForRadius } from "./ign/selectTilesForRadius.js";
import { createIgnTileLoader } from "./ign/ignTileLoader.js";
import { createIgnHeightSampler } from "./ign/heightSampler2154.js";
import { buildLocalGrid2154 } from "./ign/buildLocalGrid2154.js";
import { localGrid2154ToDsmResult } from "./dsm/dsmGridAdapterIgn2154.js";
import {
  isSurfaceDsmTerrainReady,
  surfaceDsmTerrainNotReadyNotes,
} from "../horizonDsmGate.js";

const DSM_NOT_CONFIGURED = "SURFACE_DSM provider not configured";
const DEBUG = process.env.DSM_DEBUG === "true" || process.env.FAR_DEBUG === "true";

function log(...args) {
  if (DEBUG) console.log("[DSM:Surface]", ...args);
}

const FLAT_MASK_MAX_ELEV_THRESHOLD = 0.1;

function isMaskFlat(mask) {
  if (!mask || mask.length === 0) return true;
  const maxElev = Math.max(...mask.map((m) => m.elev ?? 0));
  return maxElev <= FLAT_MASK_MAX_ELEV_THRESHOLD;
}

function getDsmConfig() {
  const enabled = process.env.HORIZON_DSM_ENABLED === "true";
  const dsmEnable = process.env.DSM_ENABLE === "true";
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const urlTemplate = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();
  const resolution = process.env.HORIZON_DSM_RESOLUTION_M;
  const confidence = process.env.HORIZON_DSM_CONFIDENCE;
  const coveragePct = process.env.HORIZON_DSM_COVERAGE_PCT;
  return {
    enabled,
    dsmEnable,
    providerType,
    urlTemplate,
    resolution_m: resolution != null && resolution !== "" ? parseFloat(resolution) : 1,
    confidence: confidence != null && confidence !== "" ? parseFloat(confidence) : 0.92,
    coveragePct: coveragePct != null && coveragePct !== "" ? parseFloat(coveragePct) : 1,
  };
}

function getHdConfig() {
  const stepDeg =
    process.env.FAR_HORIZON_HD_STEP_DEG != null && process.env.FAR_HORIZON_HD_STEP_DEG !== ""
      ? parseFloat(process.env.FAR_HORIZON_HD_STEP_DEG)
      : 1;
  const maxDist =
    process.env.FAR_HORIZON_HD_MAX_DIST_M != null && process.env.FAR_HORIZON_HD_MAX_DIST_M !== ""
      ? parseInt(process.env.FAR_HORIZON_HD_MAX_DIST_M, 10)
      : 4000;
  const gridRes =
    process.env.FAR_DSM_GRID_RES_M != null && process.env.FAR_DSM_GRID_RES_M !== ""
      ? parseInt(process.env.FAR_DSM_GRID_RES_M, 10)
      : 10;
  const nearStep =
    process.env.FAR_HORIZON_HD_NEAR_STEP_M != null && process.env.FAR_HORIZON_HD_NEAR_STEP_M !== ""
      ? parseInt(process.env.FAR_HORIZON_HD_NEAR_STEP_M, 10)
      : 5;
  const farStep =
    process.env.FAR_HORIZON_HD_FAR_STEP_M != null && process.env.FAR_HORIZON_HD_FAR_STEP_M !== ""
      ? parseInt(process.env.FAR_HORIZON_HD_FAR_STEP_M, 10)
      : 15;
  const farStart =
    process.env.FAR_HORIZON_HD_FAR_START_M != null && process.env.FAR_HORIZON_HD_FAR_START_M !== ""
      ? parseInt(process.env.FAR_HORIZON_HD_FAR_START_M, 10)
      : 500;
  const timeBudget =
    process.env.FAR_HORIZON_HD_TIME_BUDGET_MS != null && process.env.FAR_HORIZON_HD_TIME_BUDGET_MS !== ""
      ? parseInt(process.env.FAR_HORIZON_HD_TIME_BUDGET_MS, 10)
      : 3000;
  const earlyExit =
    process.env.FAR_HORIZON_HD_EARLY_EXIT_STEPS != null && process.env.FAR_HORIZON_HD_EARLY_EXIT_STEPS !== ""
      ? parseInt(process.env.FAR_HORIZON_HD_EARLY_EXIT_STEPS, 10)
      : 80;
  return { stepDeg, maxDist, gridRes, nearStep, farStep, farStart, timeBudget, earlyExit };
}

export function getMode() {
  return "SURFACE_DSM";
}

/**
 * @param {{ lat: number, lon: number, radius_m: number }} params
 * @returns {{ available: boolean, coveragePct: number, resolution_m: number|null, notes: string[] }}
 */
export function isAvailable(params) {
  const { enabled, resolution_m, coveragePct } = getDsmConfig();
  if (!enabled) {
    return {
      available: false,
      coveragePct: 0,
      resolution_m: null,
      notes: [DSM_NOT_CONFIGURED],
    };
  }
  if (!isSurfaceDsmTerrainReady()) {
    return {
      available: false,
      coveragePct: 0,
      resolution_m: null,
      notes: surfaceDsmTerrainNotReadyNotes(),
    };
  }
  return {
    available: true,
    coveragePct,
    resolution_m: resolution_m,
    notes: [],
  };
}

/**
 * Masque synthétique "urbain" distinct du relief-only.
 * Déterministe (basé lat/lon), borné.
 */
function syntheticDsmElevationAtAzimuth(azDeg, lat, lon) {
  const latFactor = 1 + (lat % 10) / 100;
  const lonFactor = 1 + (lon % 10) / 100;
  const ampSouth = 15 * latFactor;
  const ampEast = 8 * lonFactor;
  const ampWest = 6 * lonFactor;
  const sigmaSouth = 40;
  const sigmaEast = 30;
  const sigmaWest = 25;

  const distSouth = Math.min(
    Math.abs(azDeg - 180),
    Math.abs(azDeg - 180 + 360),
    Math.abs(azDeg - 180 - 360)
  );
  const distEast = Math.min(
    Math.abs(azDeg - 90),
    Math.abs(azDeg - 90 + 360),
    Math.abs(azDeg - 90 - 360)
  );
  const distWest = Math.min(
    Math.abs(azDeg - 270),
    Math.abs(azDeg - 270 + 360),
    Math.abs(azDeg - 270 - 360)
  );

  const bumpSouth = ampSouth * Math.exp(-(distSouth * distSouth) / (2 * sigmaSouth * sigmaSouth));
  const bumpEast = ampEast * Math.exp(-(distEast * distEast) / (2 * sigmaEast * sigmaEast));
  const bumpWest = ampWest * Math.exp(-(distWest * distWest) / (2 * sigmaWest * sigmaWest));

  let elev = 2.0 + bumpSouth + bumpEast + bumpWest;
  elev = Math.max(0, Math.min(50, elev));
  return elev;
}

function computeMaskStub(params) {
  validateHorizonMaskParams(params);
  const { lat, lon, radius_m, step_deg } = params;
  const { resolution_m, confidence, coveragePct } = getDsmConfig();

  const numBins = Math.round(360 / step_deg);
  const mask = [];
  for (let i = 0; i < numBins; i++) {
    const az = (i * step_deg) % 360;
    const elev = syntheticDsmElevationAtAzimuth(az, lat, lon);
    mask.push({ az, elev });
  }

  return {
    source: "SURFACE_DSM",
    radius_m,
    step_deg,
    resolution_m,
    mask,
    confidence,
    dataCoverage: {
      mode: "SURFACE_DSM",
      available: true,
      coveragePct,
      notes: [],
      ratio: coveragePct,
      effectiveRadiusMeters: radius_m,
      gridResolutionMeters: resolution_m,
      provider: "SYNTHETIC_STUB",
    },
    meta: {
      source: "SYNTHETIC_STUB",
      qualityScore: 0.5,
    },
  };
}

function latLonToTile(lat, lon, z) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, z };
}

/**
 * Fallback RELIEF_ONLY après échec ou masque plat HTTP GeoTIFF — traçabilité (pas de faux « surface réelle »).
 * @param {string} reason - ex. HTTP_GEOTIFF_FAILED | HTTP_GEOTIFF_MASK_FLAT
 */
function buildReliefFallbackWithTrace(params, reason, detailNote) {
  const base = reliefOnlyProvider.computeMask(params);
  const head = [`HTTP_GEOTIFF → RELIEF_ONLY (${reason})`];
  if (detailNote) head.push(String(detailNote).slice(0, 800));
  const notes = [...head, ...(base.dataCoverage.notes || [])];
  return {
    ...base,
    dataCoverage: {
      ...base.dataCoverage,
      notes,
    },
    meta: {
      ...(base.meta || {}),
      source: "RELIEF_ONLY",
      qualityScore: base.meta?.qualityScore ?? 0.3,
      fallbackReason: reason,
      requestedSurfaceProvider: "HTTP_GEOTIFF",
    },
  };
}

/**
 * @param {{ lat: number, lon: number, radius_m: number, step_deg: number, enableHD?: boolean, organizationId?: string }} params
 * @returns {Promise<{ source, radius_m, step_deg, resolution_m, mask, confidence, dataCoverage, meta? }>}
 */
export async function computeMask(params) {
  validateHorizonMaskParams(params);
  const { lat, lon, radius_m, step_deg, enableHD = false } = params;
  const { dsmEnable, providerType, urlTemplate, resolution_m, confidence, coveragePct } = getDsmConfig();
  const { enabled: dsmEnvEnabled, provider: dsmProvider } = getDsmEnvConfig();
  const hdEnabled = enableHD;

  // --- 1) HTTP_GEOTIFF en priorité quand configuré (surface raster réelle, traçable)
  if (providerType === "HTTP_GEOTIFF" && urlTemplate && dsmEnable) {
    log("computeMask branch=HTTP_GEOTIFF priority lat=", lat, "lon=", lon, "radius_m=", radius_m);
    try {
      const hdCfg = getHdConfig();
      const z = hdEnabled && hdCfg.maxDist > 2000 ? 13 : 15;
      const { x, y } = latLonToTile(lat, lon, z);
      const orgId = params.organizationId || "public";
      const cacheKey = dsmTileKey(orgId, z, x, y);

      let dsmResult = getDsmTile(cacheKey);
      if (!dsmResult) {
        dsmResult = hdEnabled
          ? await getDsmGridForRadius({
              lat,
              lon,
              radiusMeters: hdCfg.maxDist,
              resolutionMeters: hdCfg.gridRes,
            })
          : await getTileHeights({
              lat,
              lon,
              radiusMeters: radius_m,
              resolutionMeters: resolution_m,
            });
        setDsmTile(cacheKey, dsmResult);
      }

      const geotiffMeta = {
        providerType: "HTTP_GEOTIFF",
        dataProduct: "HTTP_GEOTIFF_DSM",
        geotiffZoom: z,
        tileX: x,
        tileY: y,
        ...(dsmResult.meta && typeof dsmResult.meta === "object" ? dsmResult.meta : {}),
      };

      if (hdEnabled) {
        const t0 = Date.now();
        const hdCfg2 = getHdConfig();
        const sampler = createDsmGridSampler(dsmResult);
        const z0 = getSiteElevation(sampler, lat, lon, dsmResult.stepMeters || 10);

        const hdResult = computeHorizonRaycastHD({
          heightSampler: sampler,
          site: { lat, lon },
          z0Meters: z0,
          stepDeg: hdCfg2.stepDeg,
          maxDistanceMeters: hdCfg2.maxDist,
          nearStepMeters: hdCfg2.nearStep,
          farStepMeters: hdCfg2.farStep,
          farStepStartMeters: hdCfg2.farStart,
          earlyExitSteps: hdCfg2.earlyExit,
        });

        const elapsed = Date.now() - t0;
        if (elapsed > hdCfg2.timeBudget) {
          log("HTTP_GEOTIFF HD time budget exceeded, fallback GRID mask elapsedMs=", elapsed);
          const { mask } = dsmGridToHorizonMask(dsmResult, lat, lon, radius_m, step_deg);
          if (isMaskFlat(mask)) {
            return buildReliefFallbackWithTrace(
              params,
              "HTTP_GEOTIFF_MASK_FLAT",
              "HD time budget exceeded; GRID mask flat (maxElev<=0.1°)"
            );
          }
          return {
            source: "SURFACE_DSM",
            radius_m,
            step_deg,
            resolution_m: dsmResult.stepMeters || resolution_m,
            mask,
            confidence,
            dataCoverage: {
              mode: "SURFACE_DSM",
              available: true,
              coveragePct,
              notes: ["HTTP_GEOTIFF: RAYCAST_HD exceeded time budget → GRID fallback"],
              ratio: coveragePct,
              effectiveRadiusMeters: radius_m,
              gridResolutionMeters: dsmResult.stepMeters || resolution_m,
              provider: "HTTP_GEOTIFF",
            },
            meta: {
              ...geotiffMeta,
              algorithm: "GRID",
              hdFallbackReason: "TIME_BUDGET_EXCEEDED",
              elapsedMs: elapsed,
            },
          };
        }

        const mask = [];
        for (let i = 0; i < hdResult.elevationsDeg.length; i++) {
          mask.push({ az: i * hdResult.stepDeg, elev: hdResult.elevationsDeg[i] });
        }

        return {
          source: "SURFACE_DSM",
          radius_m: hdResult.maxDistanceMeters,
          step_deg: hdResult.stepDeg,
          resolution_m: dsmResult.stepMeters || hdCfg2.gridRes,
          mask,
          confidence,
          dataCoverage: {
            mode: "SURFACE_DSM",
            available: true,
            coveragePct,
            notes: [],
            ratio: coveragePct,
            effectiveRadiusMeters: hdResult.maxDistanceMeters,
            gridResolutionMeters: dsmResult.stepMeters || hdCfg2.gridRes,
            provider: "HTTP_GEOTIFF",
          },
          meta: {
            ...geotiffMeta,
            algorithm: "RAYCAST_HD",
            maxDistanceMeters: hdResult.maxDistanceMeters,
            elapsedMs: elapsed,
          },
        };
      }

      const { mask } = dsmGridToHorizonMask(dsmResult, lat, lon, radius_m, step_deg);
      if (isMaskFlat(mask)) {
        log("HTTP_GEOTIFF mask flat, fallback RELIEF_ONLY");
        return buildReliefFallbackWithTrace(
          params,
          "HTTP_GEOTIFF_MASK_FLAT",
          "Horizon mask max elevation <= 0.1° (flat or noData)"
        );
      }

      return {
        source: "SURFACE_DSM",
        radius_m,
        step_deg,
        resolution_m: dsmResult.stepMeters || resolution_m,
        mask,
        confidence,
        dataCoverage: {
          mode: "SURFACE_DSM",
          available: true,
          coveragePct,
          notes: [],
          ratio: coveragePct,
          effectiveRadiusMeters: radius_m,
          gridResolutionMeters: dsmResult.stepMeters || resolution_m,
          provider: "HTTP_GEOTIFF",
        },
        meta: {
          ...geotiffMeta,
          algorithm: "GRID",
        },
      };
    } catch (err) {
      log("HTTP_GEOTIFF failed, fallback RELIEF_ONLY:", err?.message ?? err);
      return buildReliefFallbackWithTrace(params, "HTTP_GEOTIFF_FAILED", err?.message ?? String(err));
    }
  }

  // --- 2) LOCAL fixture (dev / tests) — après HTTP si non configuré
  if (dsmEnvEnabled && dsmProvider === "LOCAL") {
    try {
      const realResult = await fetchDsmReal({ lat, lon, radius_m, step_deg });
      const { mask } = dsmGridToHorizonMask(
        realResult.dsmResult,
        lat,
        lon,
        radius_m,
        step_deg
      );
      if (isMaskFlat(mask)) {
        log("DSM mask flat (maxElev<=0.1°), fallback RELIEF_ONLY");
        return reliefOnlyProvider.computeMask(params);
      }
      return {
        source: "SURFACE_DSM",
        radius_m,
        step_deg,
        resolution_m: realResult.dsmResult.stepMeters || resolution_m,
        mask,
        confidence,
        dataCoverage: {
          mode: "SURFACE_DSM",
          available: true,
          coveragePct,
          notes: [],
          ratio: coveragePct,
          effectiveRadiusMeters: radius_m,
          gridResolutionMeters: realResult.dsmResult.stepMeters || resolution_m,
          provider: "DSM_REAL",
        },
        meta: {
          source: "DSM_REAL",
          qualityScore: realResult.meta.qualityScore ?? 0.85,
        },
      };
    } catch (err) {
      log("DSM_REAL provider failed, fallback RELIEF_ONLY:", err.message);
      return reliefOnlyProvider.computeMask(params);
    }
  }

  if (providerType === "IGN_RGE_ALTI" && dsmEnable) {
    try {
      const dataDir = getIgnDsmDataDir();
      const indexPath = path.join(dataDir, "index.json");
      if (!fs.existsSync(indexPath)) throw new Error("IGN index.json absent (run build-ign-index-bboxes)");
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (!index.tiles || index.tiles.length === 0 || !index.tiles[0].bboxLambert93) {
        throw new Error("IGN index sans bbox (run build-ign-index-bboxes)");
      }
      const center = wgs84ToLambert93({ lat, lon });
      const hdCfg = getHdConfig();
      const effectiveRadius = hdEnabled ? hdCfg.maxDist : radius_m;
      const gridResM = hdEnabled ? hdCfg.gridRes : 10;
      const selected = selectTilesForRadius(center, effectiveRadius, index);
      const tileLoader = createIgnTileLoader({ dataDir });
      const samplerAsync = createIgnHeightSampler({ tilesIndex: { tiles: selected }, tileLoader });
      const t0 = Date.now();
      const localGrid = await buildLocalGrid2154(
        { centerX: center.x, centerY: center.y, radius_m: effectiveRadius, desiredRes_m: gridResM },
        samplerAsync
      );
      const dsmResult = localGrid2154ToDsmResult(localGrid);
      const elapsed = Date.now() - t0;

      if (hdEnabled) {
        const syncSampler = createDsmGridSampler(dsmResult);
        const z0 = getSiteElevation(syncSampler, lat, lon, dsmResult.stepMeters || gridResM);
        const hdResult = computeHorizonRaycastHD({
          heightSampler: syncSampler,
          site: { lat, lon },
          z0Meters: z0,
          stepDeg: hdCfg.stepDeg,
          maxDistanceMeters: hdCfg.maxDist,
          nearStepMeters: hdCfg.nearStep,
          farStepMeters: hdCfg.farStep,
          farStepStartMeters: hdCfg.farStart,
          earlyExitSteps: hdCfg.earlyExit,
        });
        const hdElapsed = Date.now() - t0;
        if (hdElapsed > hdCfg.timeBudget) {
          log("IGN HD time budget exceeded, fallback GRID mask");
          const { mask } = dsmGridToHorizonMask(dsmResult, lat, lon, radius_m, step_deg);
          if (isMaskFlat(mask)) return reliefOnlyProvider.computeMask(params);
          return {
            source: "SURFACE_DSM",
            radius_m,
            step_deg,
            resolution_m: localGrid.stepMeters,
            mask,
            confidence,
            dataCoverage: {
              mode: "SURFACE_DSM",
              available: true,
              coveragePct,
              notes: [],
              ratio: coveragePct,
              effectiveRadiusMeters: radius_m,
              gridResolutionMeters: localGrid.stepMeters,
              provider: "IGN_RGE_ALTI",
            },
            meta: { providerType: "IGN_RGE_ALTI", algorithm: "GRID", elapsedMs: hdElapsed },
          };
        }
        const mask = [];
        for (let i = 0; i < hdResult.elevationsDeg.length; i++) {
          mask.push({ az: i * hdResult.stepDeg, elev: hdResult.elevationsDeg[i] });
        }
        if (isMaskFlat(mask)) return reliefOnlyProvider.computeMask(params);
        return {
          source: "SURFACE_DSM",
          radius_m: hdResult.maxDistanceMeters,
          step_deg: hdResult.stepDeg,
          resolution_m: localGrid.stepMeters,
          mask,
          confidence,
          dataCoverage: {
            mode: "SURFACE_DSM",
            available: true,
            coveragePct,
            notes: [],
            ratio: coveragePct,
            effectiveRadiusMeters: hdResult.maxDistanceMeters,
            gridResolutionMeters: localGrid.stepMeters,
            provider: "IGN_RGE_ALTI",
          },
          meta: {
            providerType: "IGN_RGE_ALTI",
            algorithm: "RAYCAST_HD",
            elapsedMs: hdElapsed,
          },
        };
      }

      const { mask } = dsmGridToHorizonMask(dsmResult, lat, lon, radius_m, step_deg);
      if (isMaskFlat(mask)) {
        log("IGN mask flat, fallback RELIEF_ONLY");
        return reliefOnlyProvider.computeMask(params);
      }
      const validCount = Array.from(localGrid.grid).filter((v) => v !== localGrid.noDataValue && !Number.isNaN(v)).length;
      const validRatio = (localGrid.width * localGrid.height) > 0 ? validCount / (localGrid.width * localGrid.height) : 0;
      return {
        source: "SURFACE_DSM",
        radius_m,
        step_deg,
        resolution_m: localGrid.stepMeters,
        mask,
        confidence,
        dataCoverage: {
          mode: "SURFACE_DSM",
          available: true,
          coveragePct,
          notes: [],
          ratio: validRatio,
          effectiveRadiusMeters: radius_m,
          gridResolutionMeters: localGrid.stepMeters,
          provider: "IGN_RGE_ALTI",
        },
        meta: { providerType: "IGN_RGE_ALTI", algorithm: "GRID", elapsedMs: elapsed },
      };
    } catch (err) {
      log("IGN_RGE_ALTI provider failed, fallback RELIEF_ONLY:", err.message);
      const fallback = reliefOnlyProvider.computeMask(params);
      if (fallback && typeof fallback === "object") {
        fallback.meta = { ...(fallback.meta || {}), fallbackReason: "IGN_UNAVAILABLE" };
      }
      return fallback;
    }
  }

  return computeMaskStub(params);
}
