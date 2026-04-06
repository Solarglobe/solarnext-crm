/**
 * Ombrage officiel serveur (parallèle au legacy payload) — même entrée que computeCalpinageShading + normalize.
 * Ne remplace aucun KPI consommé par le moteur ; exposé sous feature flag USE_OFFICIAL_SHADING.
 */

import { computeCalpinageShading } from "../shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "./calpinageShadingNormalizer.js";

const OFFICIAL_SOURCE = "SERVER_CANONICAL";
const OFFICIAL_VERSION = "OFFICIAL_V1";

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function absDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b);
}

/**
 * Construit l’objet officiel à partir du résultat déjà calculé de computeCalpinageShading
 * (évite un second appel coûteux — horizon / near identiques au legacy brut).
 * existingShading vide : pas de fusion avec geometry.shading (vérité 100 % serveur sur ce run).
 *
 * @param {object} shadingResult - retour computeCalpinageShading (avec perPanelBreakdown si demandé)
 * @param {boolean} hasGps
 * @param {boolean} hasPanels
 * @returns {object}
 */
export function buildOfficialShadingFromComputeResult(shadingResult, hasGps, hasPanels) {
  const rawBase = buildStructuredShading(shadingResult, hasGps, hasPanels, {});
  if (Array.isArray(shadingResult.perPanelBreakdown) && shadingResult.perPanelBreakdown.length > 0) {
    rawBase.perPanel = shadingResult.perPanelBreakdown.map((r) => ({
      panelId: String(r.panelId),
      lossPct: typeof r.lossPct === "number" ? r.lossPct : Number(r.lossPct) || 0,
    }));
  }
  const meta = shadingResult.farMetadata
    ? {
        step_deg: shadingResult.farMetadata.step_deg,
        resolution_m: shadingResult.farMetadata.resolution_m,
        algorithm: shadingResult.farMetadata.meta?.algorithm,
      }
    : {};
  const normalized = normalizeCalpinageShading(rawBase, meta);
  const computedAt = new Date().toISOString();
  return {
    totalLossPct: normalized.totalLossPct,
    near: normalized.near,
    far: normalized.far,
    combined: normalized.combined,
    perPanel: normalized.perPanel ?? [],
    meta: {
      source: OFFICIAL_SOURCE,
      version: OFFICIAL_VERSION,
      computedAt,
    },
  };
}

/**
 * Pipeline complet async (tests / appels isolés).
 * @param {{ geometry: object, lat: number, lon: number, storedNearLossPct?: number }} params
 */
export async function computeOfficialShading(params) {
  const { geometry, lat, lon, storedNearLossPct = 0 } = params || {};
  const shadingResult = await computeCalpinageShading({
    lat,
    lon,
    geometry,
    storedNearLossPct,
    options: { includePerPanelBreakdown: true },
  });
  const hasGps =
    lat != null &&
    lon != null &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
  const hasPanels = hasPanelsInGeometry(geometry);
  return buildOfficialShadingFromComputeResult(shadingResult, hasGps, hasPanels);
}

/**
 * @param {object} legacy - snapshot KPI legacy (après normalize + éventuel pondéré pans)
 * @param {object} official - sortie buildOfficialShadingFromComputeResult
 * @returns {{ totalLossPct: number|null, near: number|null, far: number|null, combined: number|null, maxPanelDiff: number }}
 */
export function computeShadingOfficialDiff(legacy, official) {
  const lTot = numOrNull(legacy?.totalLossPct);
  const oTot = numOrNull(official?.totalLossPct);
  const lNear = numOrNull(legacy?.near?.totalLossPct);
  const oNear = numOrNull(official?.near?.totalLossPct);
  const lFar = numOrNull(legacy?.far?.totalLossPct);
  const oFar = numOrNull(official?.far?.totalLossPct);
  const lComb = numOrNull(legacy?.combined?.totalLossPct);
  const oComb = numOrNull(official?.combined?.totalLossPct);

  const legacyMap = new Map();
  for (const p of legacy?.perPanel || []) {
    if (p && p.panelId != null) legacyMap.set(String(p.panelId), Number(p.lossPct) || 0);
  }
  const officialMap = new Map();
  for (const p of official?.perPanel || []) {
    if (p && p.panelId != null) officialMap.set(String(p.panelId), Number(p.lossPct) || 0);
  }
  let maxPanelDiff = 0;
  const ids = new Set([...legacyMap.keys(), ...officialMap.keys()]);
  for (const id of ids) {
    const a = legacyMap.get(id) ?? 0;
    const b = officialMap.get(id) ?? 0;
    maxPanelDiff = Math.max(maxPanelDiff, Math.abs(a - b));
  }

  return {
    totalLossPct: absDiff(lTot, oTot),
    near: absDiff(lNear, oNear),
    far: absDiff(lFar, oFar),
    combined: absDiff(lComb, oComb),
    maxPanelDiff,
  };
}

/**
 * Logs si écarts significatifs entre legacy et officiel.
 * @param {object} diff - computeShadingOfficialDiff
 * @param {{ studyId?: string, versionId?: number|string }} [ctx]
 */
export function logShadingOfficialDriftIfNeeded(diff, ctx = {}) {
  const dTot = diff?.totalLossPct;
  const dPan = diff?.maxPanelDiff;
  const tag = "[SHADING_OFFICIAL_DRIFT]";
  if (dTot != null && dTot > 1) {
    console.warn(tag, "totalLossPct delta > 1%", { ...ctx, deltaPct: dTot });
  }
  if (typeof dPan === "number" && dPan > 2) {
    console.warn(tag, "maxPanelDiff > 2%", { ...ctx, maxPanelDiff: dPan });
  }
}

export function isUseOfficialShadingEnabled() {
  return String(process.env.USE_OFFICIAL_SHADING || "").toLowerCase() === "true";
}
