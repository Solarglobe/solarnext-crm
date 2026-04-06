/**
 * Dérivation pure de `summary` et `sceneQualityGrade` à partir des issues et de la confiance déjà calculée.
 * Aucune logique parallèle au validateur — uniquement de l’agrégation lisible.
 */

import type { SolarScene3D } from "../types/solarScene3d";
import type {
  CoherenceConfidence,
  CoherenceIssue,
  CoherenceSummary,
  SceneQualityGrade,
} from "../types/scene2d3dCoherence";
import { GRADE_B_MAX_WARNINGS, GRADE_C_MAX_WARNINGS, GRADE_A_MAX_WARNINGS } from "./coherenceGradeConstants";

const GEOMETRY_ERROR_SCOPES = new Set<string>(["WORLD", "ROOF", "PAN", "OBSTACLE", "PANEL", "SHADOW_VOLUME", "SCENE"]);

export function buildCoherenceSummary(
  scene: SolarScene3D,
  issues: readonly CoherenceIssue[],
): CoherenceSummary {
  let warningCount = 0;
  let errorCount = 0;
  for (const i of issues) {
    if (i.severity === "WARNING") warningCount++;
    if (i.severity === "ERROR") errorCount++;
  }

  const codes = new Set(issues.map((i) => i.code));

  const hasBlockingGeometryErrors = issues.some(
    (i) => i.severity === "ERROR" && GEOMETRY_ERROR_SCOPES.has(i.scope),
  );

  const hasRoofSourceCoverageGap =
    codes.has("SOURCE_COVERAGE_LOW") ||
    codes.has("ROOF_OUTLINE_AREA_MISMATCH") ||
    codes.has("BBOX_2D_3D_MISMATCH");

  const hasRoofModelPatchDivergence =
    codes.has("ROOF_PATCH_SOURCE_DIVERGENCE") ||
    codes.has("ROOF_MODEL_PAN_ALIGNMENT_WEAK") ||
    codes.has("MULTIPLE_PAN_TRUTH_DETECTED") ||
    codes.has("CANONICAL_SUPPORT_REFERENCE_MISMATCH") ||
    codes.has("UNIFIED_SCENE_PATCH_ID_NOT_IN_SOURCE_TRACE") ||
    codes.has("UNIFIED_SCENE_PANEL_ID_NOT_IN_SOURCE_TRACE") ||
    codes.has("UNIFIED_SCENE_VOLUME_ID_NOT_IN_SOURCE_TRACE") ||
    codes.has("UNIFIED_SCENE_PARENT_RELATION_MISMATCH");

  const hasPanelLayoutGlobalMismatch = codes.has("PANEL_LAYOUT_GLOBAL_FOOTPRINT_MISMATCH");

  const hasMissingSceneEntitiesFromSource =
    codes.has("SOURCE_PAN_MISSING_IN_SCENE") ||
    codes.has("SOURCE_OBSTACLE_MISSING_IN_SCENE") ||
    codes.has("SOURCE_PANEL_MISSING_IN_SCENE");

  return {
    hasSourceTrace: scene.sourceTrace != null,
    hasBlockingGeometryErrors,
    hasRoofSourceCoverageGap,
    hasRoofModelPatchDivergence,
    hasPanelLayoutGlobalMismatch,
    hasMissingSceneEntitiesFromSource,
    warningCount,
    errorCount,
  };
}

/**
 * Règles explicites :
 * - F : scène avec erreurs (non cohérente au sens ERROR).
 * - D : cohérente mais confiance géométrique basse, ou trop de warnings.
 * - C : cohérente, problèmes de fidélité / couverture / divergence modérés.
 * - B : cohérente, exploitable, quelques alertes ou confiance moyenne.
 * - A : cohérente, confiance haute, peu ou pas d’alertes fidélité, trace exploitable.
 */
export function computeSceneQualityGrade(
  isCoherent: boolean,
  summary: CoherenceSummary,
  confidence: CoherenceConfidence,
): SceneQualityGrade {
  if (!isCoherent) return "F";

  const w = summary.warningCount;
  const fidelityStress =
    summary.hasRoofSourceCoverageGap ||
    summary.hasRoofModelPatchDivergence ||
    summary.hasPanelLayoutGlobalMismatch ||
    summary.hasMissingSceneEntitiesFromSource;

  if (confidence.geometryConfidence === "LOW") return "D";

  if (w > GRADE_C_MAX_WARNINGS) return "D";

  if (confidence.geometryConfidence === "MEDIUM" && (fidelityStress || w > GRADE_B_MAX_WARNINGS)) {
    return "C";
  }

  if (fidelityStress || w > GRADE_B_MAX_WARNINGS) return "C";

  if (confidence.geometryConfidence === "MEDIUM" || w > GRADE_A_MAX_WARNINGS) return "B";

  const traceOk =
    summary.hasSourceTrace &&
    (confidence.roofTraceabilityLevel === "FULL" || confidence.roofTraceabilityLevel === "PARTIAL");

  if (
    confidence.geometryConfidence === "HIGH" &&
    w <= GRADE_A_MAX_WARNINGS &&
    !fidelityStress &&
    traceOk &&
    confidence.source2DLinked
  ) {
    return "A";
  }

  return "B";
}
