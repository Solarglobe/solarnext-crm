/**
 * CP-FAR-004 — Construction structure JSON shading { near, far, combined }
 * CP-FAR-007 — far.source, far.dataCoverage depuis farMetadata.
 * CP-FAR-010 — far.confidenceScore, far.confidenceLevel, far.confidenceBreakdown.
 * CP-FAR-011 — shadingQuality (indice qualité premium).
 *
 * Contrat JSON exposé : couplé au normalizer — docs/shading-governance.md
 * KPI métier (near / far / combined / legacy plat) : docs/shading-kpi-contract.md
 */

import { computeFarConfidence } from "../horizon/confidence/farConfidenceModel.js";
import { computeShadingQuality } from "./quality/shadingQualityModel.js";
import { farHorizonKindFromProvider, REAL_TERRAIN_PROVIDERS } from "./farHorizonTruth.js";
import { capConfidence01ForSource, SYNTHETIC_MAX_CONFIDENCE_01 } from "./syntheticReliefConfidence.js";

/**
 * Construit la structure shading { near, far, combined }.
 * Backward compatible : conserve farLossPct, nearLossPct, totalLossPct à la racine.
 * @param {{ farLossPct, nearLossPct, totalLossPct, farMetadata?: object }} shadingResult
 * @param {boolean} hasGps
 * @param {boolean} hasPanels - true si geometry contient des panneaux (far calculé)
 * @param {Object} [existingShading] - objet shading existant à merger (champs non liés conservés)
 */
export function buildStructuredShading(shadingResult, hasGps, hasPanels, existingShading = {}) {
  const farActive = hasGps && hasPanels;
  const farUnavailableNoGps = shadingResult.farUnavailable === true;
  const meta = shadingResult.farMetadata;

  const near = {
    ...(existingShading.near && typeof existingShading.near === "object" ? existingShading.near : {}),
    totalLossPct: shadingResult.nearLossPct,
    ...(shadingResult.meta?.nearCanonical3d != null && {
      canonical3d: shadingResult.meta.nearCanonical3d,
    }),
    ...(shadingResult.meta?.nearOfficial != null && typeof shadingResult.meta.nearOfficial === "object" && {
      official: shadingResult.meta.nearOfficial,
    }),
  };

  const far = farActive
    ? (() => {
        const dc = meta?.dataCoverage || {};
        const farSource = meta?.dataCoverage?.provider ?? meta?.source ?? "RELIEF_ONLY";
        const farHorizonKind = farHorizonKindFromProvider(farSource);
        const confidenceResult = computeFarConfidence({
          source: farSource,
          algorithm: meta?.meta?.algorithm ?? "LEGACY",
          gridResolutionMeters: dc.gridResolutionMeters ?? meta?.resolution_m ?? 30,
          maxDistanceMeters: meta?.meta?.maxDistanceMeters ?? meta?.radius_m ?? 500,
          stepDeg: meta?.step_deg ?? 2,
          dataCoverageRatio: dc.ratio ?? (typeof dc.coveragePct === "number" ? (dc.coveragePct > 1 ? dc.coveragePct / 100 : dc.coveragePct) : 1),
          obstacleDistancesMeters: meta?.obstacleDistancesMeters ?? [],
          hasRealDSM: REAL_TERRAIN_PROVIDERS.has(farSource),
        });
        const builtFar = {
          source: farSource,
          farHorizonKind,
          radius_m: meta?.radius_m ?? 500,
          confidence: REAL_TERRAIN_PROVIDERS.has(farSource)
            ? (meta?.confidence ?? 0.85)
            : capConfidence01ForSource(meta?.confidence ?? SYNTHETIC_MAX_CONFIDENCE_01, farSource),
          totalLossPct: shadingResult.farLossPct,
          ...(meta?.dataCoverage && { dataCoverage: meta.dataCoverage }),
          confidenceScore: confidenceResult.score,
          confidenceLevel: confidenceResult.level,
          confidenceBreakdown: confidenceResult.breakdown,
        };
        const exFar = existingShading.far;
        if (
          exFar &&
          typeof exFar === "object" &&
          exFar.horizonMeta &&
          typeof exFar.horizonMeta === "object" &&
          exFar.source === farSource
        ) {
          builtFar.horizonMeta = { ...exFar.horizonMeta, ...builtFar.horizonMeta };
        }
        return builtFar;
      })()
    : farUnavailableNoGps
      ? {
          source: "UNAVAILABLE_NO_GPS",
          farHorizonKind: "UNAVAILABLE",
          radius_m: null,
          confidence: null,
          totalLossPct: null,
          dataCoverage: {
            ratio: 0,
            effectiveRadiusMeters: 0,
            gridResolutionMeters: 0,
            provider: "UNAVAILABLE_NO_GPS",
          },
          confidenceScore: 0,
          confidenceLevel: "LOW",
          confidenceBreakdown: {},
        }
      : {
          source: null,
          radius_m: null,
          confidence: null,
          totalLossPct: 0,
        };

  const combined = {
    ...(existingShading.combined && typeof existingShading.combined === "object" ? existingShading.combined : {}),
    totalLossPct: shadingResult.totalLossPct,
  };

  const dc = meta?.dataCoverage || {};
  const coverageRatio = dc.ratio ?? (typeof dc.coveragePct === "number" ? (dc.coveragePct > 1 ? dc.coveragePct / 100 : dc.coveragePct) : 1);
  const resolutionMeters = dc.gridResolutionMeters ?? meta?.resolution_m ?? 30;

  const sq = computeShadingQuality({
    nearLossPct: shadingResult.nearLossPct,
    farLossPct: farActive ? (shadingResult.farLossPct ?? 0) : 0,
    resolutionMeters: farActive ? resolutionMeters : 30,
    coverageRatio: farUnavailableNoGps ? 0 : farActive ? coverageRatio : 1,
  });

  const provider = farUnavailableNoGps
    ? "UNAVAILABLE_NO_GPS"
    : far?.source ?? meta?.dataCoverage?.provider ?? meta?.source ?? "RELIEF_ONLY";
  const effectiveRadiusMeters = dc.effectiveRadiusMeters ?? meta?.radius_m ?? 500;
  const farHorizonKind =
    farActive && far?.farHorizonKind != null
      ? far.farHorizonKind
      : farUnavailableNoGps
        ? "UNAVAILABLE"
        : farHorizonKindFromProvider(provider);
  let confidence = "LOW";
  if (!farUnavailableNoGps) {
    if (provider === "IGN_RGE_ALTI" && resolutionMeters <= 10) confidence = "HIGH";
    else if (provider === "HTTP_GEOTIFF") confidence = "MEDIUM";
    if (farHorizonKind === "SYNTHETIC") confidence = "LOW";
  }

  const shadingQuality = {
    ...sq,
    provider,
    farHorizonKind,
    modelType: farUnavailableNoGps ? "UNAVAILABLE" : REAL_TERRAIN_PROVIDERS.has(provider) ? "DSM" : "SYNTHETIC",
    resolutionMeters: farActive ? resolutionMeters : farUnavailableNoGps ? 0 : 30,
    effectiveRadiusMeters: farActive ? effectiveRadiusMeters : 0,
    confidence,
    ...(farUnavailableNoGps && { blockingReason: "missing_gps" }),
  };

  return {
    ...existingShading,
    farLossPct: shadingResult.farLossPct,
    nearLossPct: shadingResult.nearLossPct,
    totalLossPct: shadingResult.totalLossPct,
    near,
    far,
    combined,
    shadingQuality,
    ...(shadingResult.horizonMask && { horizonMask: shadingResult.horizonMask }),
  };
}

/**
 * Vérifie si geometry contient des panneaux (frozenBlocks).
 */
export function hasPanelsInGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;

  // 1️⃣ Format Phase 3 moderne (frozenBlocks)
  const blocks = geometry.frozenBlocks || [];
  const hasFrozenPanels = blocks.some(
    (b) => (b.panels?.length ?? 0) > 0
  );

  if (hasFrozenPanels) return true;

  // 2️⃣ Format calpinage validé (validatedRoofData)
  const pans = geometry?.validatedRoofData?.pans || [];

  const hasValidatedPanels = pans.some(
    (p) =>
      (p.panelCount ?? p.panel_count ?? 0) > 0
  );

  if (hasValidatedPanels) return true;

  return false;
}
