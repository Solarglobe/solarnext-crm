/**
 * CP-FAR-C-10 — Export shading PREMIUM (traçable, structuré).
 * Aucun recalcul : copie des blocs backend normalisés.
 * Vérité globale = combined.totalLossPct (voir officialGlobalShadingLoss).
 * Contrat affichage vs export : docs/shading-kpi-contract.md §3
 */

import { applySyntheticReliefToPremiumExport } from "../dsmOverlay/syntheticReliefConfidence.js";
import { getOfficialGlobalShadingLossPct, warnIfOfficialShadingRootMismatch } from "../shading/officialGlobalShadingLoss.js";

const VALID_CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const VALID_SOURCE = ["RELIEF_ONLY", "SURFACE_DSM", "IGN_RGE_ALTI", "HTTP_GEOTIFF", "SYNTHETIC_STUB", "DSM_REAL"];

/** Aligné backend farHorizonTruth — hors pourcentages, export uniquement. */
const REAL_TERRAIN_PROVIDERS = new Set(["IGN_RGE_ALTI", "HTTP_GEOTIFF", "DSM_REAL"]);

function resolveFarHorizonKindForExport(normalized) {
  const explicit = normalized.shadingQuality?.farHorizonKind ?? normalized.far?.farHorizonKind;
  if (explicit === "UNAVAILABLE") return "UNAVAILABLE";
  if (normalized.far?.source === "UNAVAILABLE_NO_GPS" || normalized.shadingQuality?.blockingReason === "missing_gps") {
    return "UNAVAILABLE";
  }
  if (explicit === "REAL_TERRAIN" || explicit === "SYNTHETIC") return explicit;
  const src = normalized.far?.source ?? normalized.farSource ?? normalized.shadingQuality?.provider ?? null;
  return src && REAL_TERRAIN_PROVIDERS.has(src) ? "REAL_TERRAIN" : "SYNTHETIC";
}

/**
 * Construit l'objet shading pour l'export JSON (structure premium).
 * @param {object|null} normalized - state.shading.normalized (backend shape ou legacy)
 * @returns {object|null} null si normalized null, sinon { near, far, combined, confidence, source, computedAt [, perPanel, horizonMask ] }
 */
export function buildPremiumShadingExport(normalized) {
  if (normalized == null || typeof normalized !== "object") return null;
  warnIfOfficialShadingRootMismatch(normalized);

  // null conservé tel quel : les consommateurs affichent "N/A" si null (jamais "0 %")
  const near = normalized.near != null && typeof normalized.near === "object"
    ? { ...normalized.near }
    : { totalLossPct: normalized.nearLossPct != null ? Number(normalized.nearLossPct) : null };

  const far =
    normalized.far != null && typeof normalized.far === "object"
      ? { ...normalized.far }
      : {
          totalLossPct:
            normalized.farLossPct == null || normalized.farLossPct === ""
              ? null
              : Number(normalized.farLossPct) || 0,
          source: normalized.farSource ?? "RELIEF_ONLY",
        };

  const combined = normalized.combined != null && typeof normalized.combined === "object"
    ? { ...normalized.combined }
    : (() => {
        const v = getOfficialGlobalShadingLossPct(normalized);
        return {
          totalLossPct: v,
        };
      })();

  const confidence = normalized.shadingQuality?.confidence ?? normalized.far?.confidenceLevel ?? "UNKNOWN";
  const source = normalized.far?.source ?? normalized.farSource ?? "RELIEF_ONLY";
  const farHorizonKind = resolveFarHorizonKindForExport(normalized);

  let computedAt = normalized.computedAt;
  if (computedAt == null) {
    computedAt = new Date().toISOString();
  } else if (typeof computedAt === "number") {
    computedAt = new Date(computedAt).toISOString();
  } else {
    computedAt = String(computedAt);
  }

  const out = {
    near,
    far,
    combined,
    confidence,
    source,
    farHorizonKind,
    computedAt,
    // DEPRECATED — alias miroir de combined.totalLossPct (SmartPitch / export-json)
    totalLossPct: combined.totalLossPct ?? null,
  };
  if (Array.isArray(normalized.perPanel)) out.perPanel = normalized.perPanel;
  if (normalized.horizonMask != null && typeof normalized.horizonMask === "object") {
    out.horizonMask = normalized.horizonMask;
  }
  if (normalized.shadingQuality != null && typeof normalized.shadingQuality === "object") {
    out.shadingQuality = normalized.shadingQuality;
  }
  return applySyntheticReliefToPremiumExport(out);
}

export { VALID_CONFIDENCE, VALID_SOURCE };
