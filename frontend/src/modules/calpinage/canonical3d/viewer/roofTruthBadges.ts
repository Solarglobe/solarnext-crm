import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { SolarScene3D } from "../types/solarScene3d";

export type RoofTruthBadgeClass = "TRUTHFUL" | "PARTIAL" | "FALLBACK" | "INCOHERENT";

export type RoofTruthBadgeTone = "measured" | "deduced" | "generic" | "incoherent";

export interface RoofTruthBadgeModel {
  readonly panId: string;
  readonly truthClass: RoofTruthBadgeClass;
  readonly tone: RoofTruthBadgeTone;
  readonly label: string;
  readonly title: string;
}

const TRUTH_BADGE_COPY: Record<
  RoofTruthBadgeClass,
  { readonly tone: RoofTruthBadgeTone; readonly label: string; readonly summary: string }
> = {
  TRUTHFUL: {
    tone: "measured",
    label: "Mesuré",
    summary: "hauteurs explicites ou suffisamment contraintes",
  },
  PARTIAL: {
    tone: "deduced",
    label: "Déduit",
    summary: "géométrie déduite depuis des contraintes partielles",
  },
  FALLBACK: {
    tone: "generic",
    label: "Générique",
    summary: "hauteur ou plan générique utilisé",
  },
  INCOHERENT: {
    tone: "incoherent",
    label: "Incohérent",
    summary: "géométrie à reprendre avant usage fiable",
  },
};

export function resolveRoofTruthBadge(scene: SolarScene3D, patch: RoofPlanePatch3D): RoofTruthBadgeModel {
  const panId = String(patch.id);
  const phaseA = scene.metadata.roofQualityPhaseA?.panChecks.find((p) => String(p.panId) === panId);
  const phaseB = scene.metadata.roofQualityPhaseB?.panTechnical.find((p) => String(p.panId) === panId);
  const truthClass = phaseA?.truthClass ?? phaseB?.truthClass ?? inferTruthClassFromPatchQuality(patch);
  const copy = TRUTH_BADGE_COPY[truthClass];
  const titleParts = [`Pan ${panId} - ${copy.label}`, copy.summary];
  if (phaseA?.hintFr) titleParts.push(phaseA.hintFr);
  if (phaseB) {
    titleParts.push(
      [
        Number.isFinite(phaseB.planeResidualRmsMm)
          ? `RMS plan ${formatMetric(phaseB.planeResidualRmsMm)} mm`
          : null,
        Number.isFinite(phaseB.cornerZSpanMm)
          ? `ΔZ coins ${formatMetric(phaseB.cornerZSpanMm)} mm`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  return {
    panId,
    truthClass,
    tone: copy.tone,
    label: copy.label,
    title: titleParts.filter(Boolean).join(" · "),
  };
}

function inferTruthClassFromPatchQuality(patch: RoofPlanePatch3D): RoofTruthBadgeClass {
  const codes = new Set(patch.quality.diagnostics.map((d) => d.code));
  const hasError = patch.quality.diagnostics.some((d) => d.severity === "error");
  if (hasError || codes.has("PLANE_HIGH_RESIDUAL") || codes.has("NON_PLANAR_PATCH")) return "INCOHERENT";
  if (
    codes.has("HEIGHT_FALLBACK_DEFAULT_ON_CORNERS") ||
    codes.has("HEIGHT_FALLBACK_DEFAULT") ||
    patch.quality.confidence === "low"
  ) {
    return "FALLBACK";
  }
  if (
    codes.has("PLANE_MODERATE_RESIDUAL") ||
    codes.has("HEIGHT_INTERPOLATED_ON_CORNERS") ||
    patch.quality.confidence === "medium" ||
    patch.quality.confidence === "unknown"
  ) {
    return "PARTIAL";
  }
  return "TRUTHFUL";
}

function formatMetric(value: number): string {
  return value.toLocaleString("fr-FR", {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  });
}
