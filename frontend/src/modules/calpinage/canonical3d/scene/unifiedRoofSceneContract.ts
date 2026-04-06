/**
 * Contrat « scène métier unique » (Prompt 33) — lecture 2D / 3D du même graphe d’entités.
 *
 * Ce fichier **fige les identités et relations** ; il ne duplique pas la géométrie.
 * Implémentations : `buildCanonicalScene3DInput`, `buildSolarScene3DFromCalpinageRuntime`, `SolarScene3DViewer`.
 */

import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import type { RoofModel3D } from "../types/model";
import type { SolarScene3D } from "../types/solarScene3d";
import type { Scene2DSourceTrace } from "../types/scene2d3dCoherence";

// ─── Vérité officielle par famille (IDs / emplacement) ─────────────────────

/**
 * **Contours (enveloppe bâtiment / toiture en 2D)**
 * - Vérité dessin / édition : runtime `contours[]` (ex. `roofRole: "contour" | "roof"`, points px).
 * - Projection dans la scène 3D agrégée : `SolarScene3D.sourceTrace.roofOutline2D.contourPx` (trace dérivée, pas double stockage métier).
 * - ID : pas d’id stable unique imposé côté trace v1 ; l’enveloppe est identifiée par sa place dans la trace + métriques.
 */
export type UnifiedRoofSceneContourOfficial = {
  readonly kind: "runtime_contour_then_source_trace";
  readonly traceField: "sourceTrace.roofOutline2D";
};

/**
 * **Pans**
 * - Objet métier souverain : **`panId`** (string stable côté calpinage, ex. `roof.roofPans[].id`).
 * - Géométrie 3D canonique : `RoofPlanePatch3D` avec **`id === panId`** (builder `buildRoofModel3DFromLegacyGeometry`).
 * - Ne pas introduire un second id « métier » parallèle ; `expectedRoofPlanePatchIds` dans la trace aligne le toit legacy sur ce même id.
 */
export type UnifiedRoofScenePanOfficialId = string;

/**
 * **Faîtages / lignes structurantes 2D**
 * - Saisie : runtime (ridges / traits) passés au mapper legacy (`mapCalpinageRoofToLegacyRoofGeometryInput`).
 * - Objet 3D : **`RoofRidge3D` / contraintes dans `RoofModel3D`** — **dérivés** du solveur (pas d’entités jumelles avec ids divergents dans `Scene2DSourceTrace` aujourd’hui).
 */
export type UnifiedRoofSceneStructuralLinesRole = "derived_in_roof_model";

/**
 * **Arêtes de toiture**
 * - **`RoofEdge3D`** (+ sommets `roofVertices`) dans `RoofModel3D` : **dérivées** topologiques des pans / fusion sommets.
 */
export type UnifiedRoofSceneEdgesRole = "derived_in_roof_model";

/**
 * **Obstacles**
 * - ID métier officiel : **`obstacleId`** (adaptateur canonique, ex. `CanonicalObstacle3D.obstacleId`).
 * - Volume 3D : `RoofObstacleVolume3D.id` / extension `RoofExtensionVolume3D.id` **=== obstacleId**.
 * - Parent métier : `relatedPlanePatchIds[]` + `roofAttachment.primaryPlanePatchId` → **référencent des `panId` / patch ids**.
 */
export type UnifiedRoofSceneObstacleOfficialId = string;

/**
 * **Panneaux**
 * - ID métier officiel : **`panel.id`** (placement canonique / moteur), inchangé dans `PvPanelSurface3D.id`.
 * - Rattachement au pan : **`attachment.roofPlanePatchId` === panId** du pan support.
 */
export type UnifiedRoofScenePanelOfficialId = string;

// ─── Vue agrégée « une seule scène » (lecture) ───────────────────────────────

/**
 * Vue logique unique : mêmes ids que le runtime et la trace, géométrie résolue dans `SolarScene3D`.
 * Utile tests / outils / inspection — ne pas persister comme second state éditable.
 */
export type UnifiedRoofSceneReadModel = {
  readonly sourceTrace: Scene2DSourceTrace | undefined;
  readonly roofModel: RoofModel3D;
  readonly obstacleVolumes: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly pvPanels: readonly PvPanelSurface3D[];
  /** Index pans par id métier (= id patch). */
  readonly pansById: ReadonlyMap<UnifiedRoofScenePanOfficialId, RoofPlanePatch3D>;
};

export function deriveUnifiedRoofSceneReadModel(scene: SolarScene3D): UnifiedRoofSceneReadModel {
  const pansById = new Map<string, RoofPlanePatch3D>();
  for (const p of scene.roofModel.roofPlanePatches) {
    pansById.set(String(p.id), p);
  }
  return {
    sourceTrace: scene.sourceTrace,
    roofModel: scene.roofModel,
    obstacleVolumes: scene.obstacleVolumes,
    extensionVolumes: scene.extensionVolumes,
    pvPanels: scene.pvPanels,
    pansById,
  };
}
