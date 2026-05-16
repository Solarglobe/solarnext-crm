import { getPremiumRoofObstacleSpec } from "../../../catalog/roofObstaclePremiumCatalog";
import type { RoofObstacleVolume3D } from "../../types/roof-obstacle-volume";
import type { InspectionRow, SceneInspectionHero, SceneInspectionTone } from "./sceneInspectionTypes";
import { formatAreaM2, formatConfidenceFr, formatDimsM, formatLengthM } from "./formatInspectionValue";

export interface ObstacleInspection3DModel {
  readonly hero: SceneInspectionHero;
  readonly rows: readonly InspectionRow[];
  readonly warnings: readonly string[];
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case "physical_roof_body":
      return "Obstacle physique";
    case "roof_window_flush":
      return "Fenetre de toit affleurante";
    case "keepout_surface":
      return "Zone de non-pose";
    case "abstract_shadow_volume":
      return "Volume d'ombre";
    default:
      return "Obstacle";
  }
}

function toneForObstacle(v: RoofObstacleVolume3D, warnings: readonly string[]): SceneInspectionTone {
  if (warnings.some((w) => w.includes("approximatif") || w.includes("fallback") || w.includes("incomplet"))) return "warning";
  if (v.quality.confidence === "low" || v.quality.confidence === "unknown") return "danger";
  if (v.quality.confidence === "medium") return "warning";
  return "ok";
}

function isApproximateVolume(v: RoofObstacleVolume3D): boolean {
  const anchor = v.roofAttachment.anchorKind;
  return (
    v.quality.confidence !== "high" ||
    anchor === "fallback_world_vertical" ||
    anchor === "primary_plane_not_found" ||
    anchor === "no_plane_context" ||
    v.quality.diagnostics.some((d) => /fallback|projection|skipped|triangulation/i.test(`${d.code} ${d.message}`))
  );
}

export function buildObstacleInspection3DModel(v: RoofObstacleVolume3D): ObstacleInspection3DModel {
  const premium = getPremiumRoofObstacleSpec(v.visualKey);
  const dx = v.bounds.max.x - v.bounds.min.x;
  const dy = v.bounds.max.y - v.bounds.min.y;
  const impactedArea = v.footprintWorld.length >= 3 ? Math.max(0, (dx || 0) * (dy || 0)) : null;
  const castsShading = premium?.shading.castsNearShading ?? v.visualRole !== "keepout_surface";
  const blocksPlacement = premium?.shading.blocksPvPlacement ?? v.visualRole !== "abstract_shadow_volume";
  const includeRaycast = premium?.shading.includeIn3DRaycast ?? v.visualRole !== "keepout_surface";
  const warnings: string[] = [];

  if (isApproximateVolume(v)) {
    warnings.push("Volume approximatif : verifiez hauteur, pan support et emprise avant validation PV.");
  }
  if (v.heightM <= 0.05 && v.visualRole !== "roof_window_flush" && v.visualRole !== "keepout_surface") {
    warnings.push("Hauteur tres faible pour un obstacle physique.");
  }
  if (v.visualRole === "abstract_shadow_volume") {
    warnings.push("Volume d'ombre abstrait : utile pour l'analyse, pas un objet toiture physique.");
  }
  if (v.visualRole === "keepout_surface") {
    warnings.push("Keepout sans volume physique : bloque la pose mais ne doit pas ombrer.");
  }

  const diagWarnings = v.quality.diagnostics
    .filter((d) => d.severity === "warning" || d.severity === "error")
    .map((d) => `[${d.severity}] ${d.code} : ${d.message}`);

  const tone = toneForObstacle(v, warnings);
  const hero: SceneInspectionHero = {
    eyebrow: "Inspection obstacle 3D",
    title: premium?.business.label ?? roleLabel(v.visualRole),
    subtitle: `${roleLabel(v.visualRole)} - ${formatLengthM(v.heightM)} - ${formatConfidenceFr(v.quality.confidence)}`,
    tone,
    badges: [
      { label: castsShading ? "Shading" : "Sans shading", tone: castsShading ? "warning" : "neutral" },
      { label: blocksPlacement ? "Keepout PV" : "Pose PV possible", tone: blocksPlacement ? "warning" : "ok" },
      { label: includeRaycast ? "Raycast 3D" : "Hors raycast", tone: includeRaycast ? "ok" : "neutral" },
    ],
  };

  const rows: InspectionRow[] = [
    { label: "Type obstacle", value: premium?.business.label ?? roleLabel(v.visualRole) },
    { label: "ID", value: String(v.id) },
    { label: "Hauteur", value: formatLengthM(v.heightM) },
    { label: "Confiance geometrique", value: formatConfidenceFr(v.quality.confidence) },
    { label: "Role shading", value: castsShading ? "Ombrant" : "Non ombrant" },
    { label: "Role keepout", value: blocksPlacement ? "Bloque la pose PV" : "N'interdit pas la pose PV" },
    { label: "Surface impactee", value: formatAreaM2(impactedArea) },
    { label: "Dimensions XY", value: formatDimsM(dx, dy) },
    { label: "Base Z", value: formatLengthM(v.baseElevationM) },
    { label: "Mode extrusion", value: v.extrusion.mode },
    { label: "Ancrage toiture", value: v.roofAttachment.anchorKind },
    { label: "Role rendu", value: roleLabel(v.visualRole) },
  ];

  if (premium) {
    rows.push({ label: "Asset 3D", value: premium.rendering3d.detailProfile });
    rows.push({ label: "Materiau", value: premium.rendering3d.materialProfile });
  }
  if (v.relatedPlanePatchIds.length > 0) {
    rows.push({ label: "Pan(s) lie(s)", value: v.relatedPlanePatchIds.map(String).join(", ") });
  }

  return {
    hero,
    rows,
    warnings: [...warnings, ...diagWarnings],
  };
}
