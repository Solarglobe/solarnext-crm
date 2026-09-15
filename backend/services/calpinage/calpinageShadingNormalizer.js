/**
 * CP-FAR-013 — Normalizer officiel shading V2
 * Point unique d'exposition. Supprime champs internes moteur.
 * CP-DSM-PP-001 — perPanel pass-through (source frontend, exposé backend).
 *
 * VÉRITÉ PRODUIT : `combined.totalLossPct` = perte d'ombrage globale.
 * `totalLossPct` à la racine du retour = miroir explicite de `combined.totalLossPct` (alias stable pour lecteurs legacy).
 *
 * Contrat sémantique KPI (affichage / export / legacy vs V2) : docs/shading-kpi-contract.md
 * Tests contrat : backend/tests/shading-premium-lock.test.js + shading-kpi-contract.test.js — docs/shading-governance.md
 */

import { farHorizonKindFromProvider } from "../shading/farHorizonTruth.js";
import { getShadingAssessment, getShadingComponentLossPct } from "../../../shared/shading/shadingAssessment.js";

const V2_SCHEMA_VERSION = "v2";

/** @param {unknown} v */
function clampGlobalLossPctOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * @param {object} rawShading
 * @returns {number|null}
 */
function resolveCombinedTotalLossFromRaw(rawShading) {
  if (rawShading.combined && typeof rawShading.combined === "object" && Object.prototype.hasOwnProperty.call(rawShading.combined, "totalLossPct")) {
    return clampGlobalLossPctOrNull(rawShading.combined.totalLossPct);
  }
  return clampGlobalLossPctOrNull(rawShading.totalLossPct);
}

/**
 * Normalise perPanel pour exposition backend.
 * Array stable, panelId string, lossPct number arrondi à 2 décimales.
 * @param {Array} perPanel - source perPanel (geometry.shading ou existingShading)
 * @returns {Array<{ panelId: string, lossPct: number }>}
 */
function normalizePerPanel(perPanel) {
  if (!Array.isArray(perPanel) || perPanel.length === 0) return [];
  const out = [];
  for (const p of perPanel) {
    if (!p || typeof p !== "object") continue;
    const panelId = p.panelId ?? p.id;
    if (panelId == null) continue;
    const lossPct = clampGlobalLossPctOrNull(p.lossPct);
    if (lossPct == null) continue;
    out.push({ panelId: String(panelId), lossPct });
  }
  return out;
}

/**
 * Normalise dataCoverage vers structure V2.
 * @param {object} dc
 * @returns {object}
 */
function normalizeDataCoverage(dc, farRadius) {
  if (!dc || typeof dc !== "object") return {};
  const ratio = typeof dc.ratio === "number"
    ? Math.max(0, Math.min(1, dc.ratio))
    : (typeof dc.coveragePct === "number" ? (dc.coveragePct > 1 ? dc.coveragePct / 100 : dc.coveragePct) : 1);
  return {
    ratio,
    effectiveRadiusMeters: dc.effectiveRadiusMeters ?? farRadius ?? 0,
    gridResolutionMeters: dc.gridResolutionMeters ?? 0,
    provider: dc.provider ?? "RELIEF_ONLY",
    ...(Array.isArray(dc.notes) && dc.notes.length > 0 && { notes: dc.notes }),
  };
}

/**
 * Normalise shading.far vers structure V2.
 * @param {object} far
 * @param {object} meta - farMetadata pour step_deg, resolution_m, algorithm
 * @returns {object}
 */
function normalizeFar(far, meta = {}) {
  if (!far || typeof far !== "object") {
    return {
      source: null,
      algorithm: "LEGACY",
      radius_m: null,
      step_deg: null,
      resolution_m: 0,
      totalLossPct: null,
      status: "not_calculated",
      confidenceScore: 0,
      confidenceLevel: "LOW",
      confidenceBreakdown: {},
      dataCoverage: {},
      farHorizonKind: "SYNTHETIC",
    };
  }
  const dc = far.dataCoverage || {};
  const srcForKind = far.source ?? dc.provider ?? null;
  const unavailableFar =
    far.source === "UNAVAILABLE_NO_GPS" ||
    srcForKind === "UNAVAILABLE_NO_GPS" ||
    far.source === "FAR_UNAVAILABLE_ERROR" ||
    srcForKind === "FAR_UNAVAILABLE_ERROR";
  const totalLossPct = unavailableFar ? null : clampGlobalLossPctOrNull(far.totalLossPct);
  const out = {
    source: far.source ?? null,
    farHorizonKind: far.farHorizonKind ?? farHorizonKindFromProvider(srcForKind),
    algorithm: meta.algorithm ?? far.algorithm ?? "LEGACY",
    radius_m: far.radius_m ?? null,
    step_deg: meta.step_deg ?? far.step_deg ?? null,
    resolution_m: dc.gridResolutionMeters ?? far.resolution_m ?? meta.resolution_m ?? 0,
    totalLossPct,
    status: far.status ?? "stale",
    confidenceScore: typeof far.confidenceScore === "number" ? far.confidenceScore : 0,
    confidenceLevel: far.confidenceLevel ?? "LOW",
    confidenceBreakdown: far.confidenceBreakdown && typeof far.confidenceBreakdown === "object"
      ? { ...far.confidenceBreakdown }
      : {},
    dataCoverage: normalizeDataCoverage(dc, far.radius_m),
  };
  if (far.horizonMeta && typeof far.horizonMeta === "object" && Object.keys(far.horizonMeta).length > 0) {
    out.horizonMeta = { ...far.horizonMeta };
  }
  return out;
}

/**
 * Normalise shading complet vers structure V2 officielle.
 * Supprime: farLossPct, nearLossPct (racine), confidence (ancien), champs debug.
 * @param {object} rawShading - Sortie de buildStructuredShading
 * @param {object} [meta] - farMetadata pour step_deg, resolution_m, algorithm
 * @returns {object} Structure V2 normalisée
 */
export function normalizeCalpinageShading(rawShading, meta = {}) {
  if (!rawShading || typeof rawShading !== "object") {
    return {
      near: { status: "not_calculated", totalLossPct: null },
      far: normalizeFar(null, meta),
      combined: { status: "not_calculated", totalLossPct: null },
      totalLossPct: null,
      assessment: getShadingAssessment(null),
      shadingQuality: {
        score: 0,
        grade: "UNASSESSED",
        inputs: { near: null, far: null, resolution_m: 0, coveragePct: 0 },
        farHorizonKind: "SYNTHETIC",
      },
      perPanel: [],
    };
  }

  const near = rawShading.near && typeof rawShading.near === "object"
    ? {
        totalLossPct: clampGlobalLossPctOrNull(rawShading.near.totalLossPct),
        status: rawShading.near.status ?? rawShading.assessment?.nearStatus ?? "stale",
        ...(rawShading.near.details && typeof rawShading.near.details === "object" && { details: rawShading.near.details }),
        ...(rawShading.near.canonical3d != null && { canonical3d: rawShading.near.canonical3d }),
        ...(rawShading.near.official && typeof rawShading.near.official === "object" && { official: rawShading.near.official }),
      }
    : { status: "not_calculated", totalLossPct: null };

  const far = normalizeFar(rawShading.far, meta);

  const assessment = getShadingAssessment(rawShading);
  near.status = assessment.nearStatus;
  near.totalLossPct = getShadingComponentLossPct(rawShading, "near");
  far.status = assessment.farStatus;
  far.totalLossPct = getShadingComponentLossPct(rawShading, "far");
  const combinedTotal = getShadingComponentLossPct(rawShading, "combined");
  const combined = { status: assessment.status, totalLossPct: combinedTotal };

  const rawSq = rawShading.shadingQuality && typeof rawShading.shadingQuality === "object";
  const sq = rawSq
    ? {
        score: Number(rawShading.shadingQuality.score) || 0,
        grade: rawShading.shadingQuality.grade ?? "D",
        inputs: {
          near: Number(rawShading.shadingQuality.inputs?.near) ?? 0,
          far:
            rawShading.shadingQuality.inputs?.far == null || rawShading.shadingQuality.inputs?.far === ""
              ? null
              : Number(rawShading.shadingQuality.inputs.far),
          resolution_m: Number(rawShading.shadingQuality.inputs?.resolution_m) ?? 0,
          coveragePct: Number(rawShading.shadingQuality.inputs?.coveragePct) ?? 0,
        },
        farHorizonKind:
          rawShading.shadingQuality.farHorizonKind ??
          far.farHorizonKind ??
          farHorizonKindFromProvider(rawShading.shadingQuality.provider),
        ...(rawShading.shadingQuality.provider != null && { provider: rawShading.shadingQuality.provider }),
        ...(rawShading.shadingQuality.modelType != null && { modelType: rawShading.shadingQuality.modelType }),
        ...(rawShading.shadingQuality.resolutionMeters != null && { resolutionMeters: Number(rawShading.shadingQuality.resolutionMeters) || 0 }),
        ...(rawShading.shadingQuality.effectiveRadiusMeters != null && { effectiveRadiusMeters: Number(rawShading.shadingQuality.effectiveRadiusMeters) || 0 }),
        ...(rawShading.shadingQuality.confidence != null && { confidence: rawShading.shadingQuality.confidence }),
        ...(rawShading.shadingQuality.blockingReason != null && { blockingReason: rawShading.shadingQuality.blockingReason }),
      }
    : {
        score: 0,
        grade: "D",
        inputs: { near: 0, far: 0, resolution_m: 0, coveragePct: 0 },
        farHorizonKind: far.farHorizonKind,
      };

  sq.inputs.near = near.totalLossPct;
  sq.inputs.far = far.totalLossPct;
  sq.inputs.coveragePct = far.dataCoverage?.ratio ?? null;
  if (assessment.status !== "computed") { sq.score = 0; sq.grade = "UNASSESSED"; }
  const perPanel = assessment.status === "computed" ? normalizePerPanel(rawShading.perPanel) : [];

  const horizonMask =
    rawShading.horizonMask && typeof rawShading.horizonMask === "object" && Array.isArray(rawShading.horizonMask.mask ?? rawShading.horizonMask.elevations)
      ? {
          elevations: rawShading.horizonMask.mask ?? rawShading.horizonMask.elevations,
          source: rawShading.horizonMask.source ?? null,
          farHorizonKind:
            rawShading.horizonMask.farHorizonKind ??
            farHorizonKindFromProvider(
              rawShading.horizonMask.dataCoverage?.provider ?? rawShading.horizonMask.source ?? null
            ),
          dataCoverage: rawShading.horizonMask.dataCoverage && typeof rawShading.horizonMask.dataCoverage === "object"
            ? rawShading.horizonMask.dataCoverage
            : undefined,
        }
      : undefined;

  return {
    near,
    far,
    combined,
    /** Alias miroir de `combined.totalLossPct` — même sémantique produit. */
    totalLossPct: combinedTotal,
    shadingQuality: sq,
    assessment,
    ...(rawShading.historicalResult && { historicalResult: rawShading.historicalResult }),
    ...(assessment.status === "stale" && { needs_recompute: true }),
    ...(assessment.status === "computed" && { monthlyFactors: rawShading.monthlyFactors ?? null, monthlyKwhStats: rawShading.monthlyKwhStats ?? null, annualLossKwh: rawShading.annualLossKwh ?? null }),
    ...(rawShading.diagnostics && { diagnostics: rawShading.diagnostics }),
    ...(assessment.status === "computed" && rawShading.distribution && { distribution: rawShading.distribution }),
    perPanel,
    ...(horizonMask && { horizonMask }),
  };
}

export { V2_SCHEMA_VERSION };
