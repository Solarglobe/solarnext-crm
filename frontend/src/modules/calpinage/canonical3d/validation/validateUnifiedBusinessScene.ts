/**
 * Garde-fous « scène métier unique » (Prompt 33) : entités 3D présentes mais absentes de la trace 2D source,
 * ou relations parent (pan) incohérentes au-delà des checks géométriques existants.
 *
 * Les absences « trace annonce X mais scène n’a pas X » restent dans `validateSourceFidelity` (SOURCE_*_MISSING_IN_SCENE).
 */

import type { SolarScene3D } from "../types/solarScene3d";
import type { CoherenceIssue } from "../types/scene2d3dCoherence";

function nonEmptyTrace(st: NonNullable<SolarScene3D["sourceTrace"]>): boolean {
  return (
    st.sourcePanIds.length > 0 ||
    st.sourceObstacleIds.length > 0 ||
    st.sourcePanelIds.length > 0
  );
}

/**
 * Détecte des entités résolues en 3D qui ne sont **pas** déclarées dans `sourceTrace` alors que la trace liste
 * au moins une entité de la même famille — signe de divergence 2D↔3D ou de trace incomplète.
 */
export function appendUnifiedBusinessSceneIssues(scene: SolarScene3D, issues: CoherenceIssue[]): void {
  const st = scene.sourceTrace;
  if (!st || !nonEmptyTrace(st)) return;

  const srcPans = new Set(st.sourcePanIds.map(String));
  const srcObs = new Set(st.sourceObstacleIds.map(String));
  const srcPanels = new Set(st.sourcePanelIds.map(String));

  if (st.sourcePanIds.length > 0) {
    for (const p of scene.roofModel.roofPlanePatches) {
      const id = String(p.id);
      if (!srcPans.has(id)) {
        issues.push({
          code: "UNIFIED_SCENE_PATCH_ID_NOT_IN_SOURCE_TRACE",
          severity: "WARNING",
          scope: "SOURCE",
          message: `Patch toiture « ${id} » présent en scène 3D mais absent de sourceTrace.sourcePanIds — objet non relié au même inventaire 2D.`,
          entityId: id,
          details: { patchId: id },
        });
      }
    }
  }

  if (st.sourceObstacleIds.length > 0) {
    for (const v of scene.obstacleVolumes) {
      const id = String(v.id);
      if (!srcObs.has(id)) {
        issues.push({
          code: "UNIFIED_SCENE_VOLUME_ID_NOT_IN_SOURCE_TRACE",
          severity: "WARNING",
          scope: "SOURCE",
          message: `Obstacle volume « ${id} » présent en 3D mais absent de sourceTrace.sourceObstacleIds.`,
          entityId: id,
          details: { volumeId: id },
        });
      }
    }
    for (const v of scene.extensionVolumes) {
      const id = String(v.id);
      if (!srcObs.has(id)) {
        issues.push({
          code: "UNIFIED_SCENE_VOLUME_ID_NOT_IN_SOURCE_TRACE",
          severity: "WARNING",
          scope: "SOURCE",
          message: `Extension volume « ${id} » présente en 3D mais absente de sourceTrace.sourceObstacleIds.`,
          entityId: id,
          details: { volumeId: id },
        });
      }
    }
  }

  if (st.sourcePanelIds.length > 0) {
    for (const panel of scene.pvPanels) {
      const id = String(panel.id);
      if (!srcPanels.has(id)) {
        issues.push({
          code: "UNIFIED_SCENE_PANEL_ID_NOT_IN_SOURCE_TRACE",
          severity: "WARNING",
          scope: "SOURCE",
          message: `Panneau « ${id} » présent en pvPanels mais absent de sourceTrace.sourcePanelIds — identité métier 2D/3D divergente.`,
          entityId: id,
          details: { panelId: id },
        });
      }
    }
  }

  /** Rattachement panneau → pan : le patch support doit être dans l’inventaire pans tracé côté 2D. */
  if (st.sourcePanIds.length > 0) {
    const srcPanSet = new Set(st.sourcePanIds.map(String));
    for (const panel of scene.pvPanels) {
      const patchId = String(panel.attachment.roofPlanePatchId);
      if (!srcPanSet.has(patchId)) {
        issues.push({
          code: "UNIFIED_SCENE_PARENT_RELATION_MISMATCH",
          severity: "WARNING",
          scope: "PANEL",
          message: `Panneau « ${panel.id} » : roofPlanePatchId « ${patchId} » absent de sourceTrace.sourcePanIds — support hors liste pans source.`,
          entityId: String(panel.id),
          details: { roofPlanePatchId: patchId },
        });
      }
    }
    for (const v of scene.obstacleVolumes) {
      for (const rid of v.relatedPlanePatchIds) {
        const r = String(rid);
        if (!srcPanSet.has(r)) {
          issues.push({
            code: "UNIFIED_SCENE_PARENT_RELATION_MISMATCH",
            severity: "WARNING",
            scope: "OBSTACLE",
            message: `Obstacle « ${v.id} » : relatedPlanePatchId « ${r} » absent de sourceTrace.sourcePanIds.`,
            entityId: String(v.id),
            details: { relatedPlanePatchId: r },
          });
        }
      }
    }
    for (const v of scene.extensionVolumes) {
      for (const rid of v.relatedPlanePatchIds) {
        const r = String(rid);
        if (!srcPanSet.has(r)) {
          issues.push({
            code: "UNIFIED_SCENE_PARENT_RELATION_MISMATCH",
            severity: "WARNING",
            scope: "OBSTACLE",
            message: `Extension « ${v.id} » : relatedPlanePatchId « ${r} » absent de sourceTrace.sourcePanIds.`,
            entityId: String(v.id),
            details: { relatedPlanePatchId: r },
          });
        }
      }
    }
  }
}
