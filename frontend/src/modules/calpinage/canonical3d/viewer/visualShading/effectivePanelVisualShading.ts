/**
 * Résolution effective pour le viewer : priorité `panelVisualShadingByPanelId` (runtime),
 * puis lecture **pure** de `nearShadingSnapshot` (fraction ombrée moyenne déjà stockée — pas de moteur).
 */

import type { PanelVisualShading } from "../../types/panelVisualShading";
import type { SolarScene3D } from "../../types/solarScene3d";
import { lossPctToQualityScore01 } from "./resolvePanelVisualShading";

export function getEffectivePanelVisualShading(panelId: string, scene: SolarScene3D): PanelVisualShading {
  const direct = scene.panelVisualShadingByPanelId?.[panelId];
  if (direct && (direct.state === "AVAILABLE" || direct.state === "INVALID")) {
    return direct;
  }

  const near = scene.nearShadingSnapshot?.panelShadingSummaryById[panelId];
  const mean = near?.meanShadedFraction;
  if (typeof mean === "number" && Number.isFinite(mean)) {
    const lossPct = Math.max(0, Math.min(100, mean * 100));
    return {
      panelId,
      lossPct,
      qualityScore01: lossPctToQualityScore01(lossPct),
      state: "AVAILABLE",
      provenance: "near_snapshot_mean_fraction",
    };
  }

  if (direct && direct.state === "MISSING") {
    return direct;
  }

  return {
    panelId,
    lossPct: null,
    qualityScore01: null,
    state: "MISSING",
  };
}

export function sceneHasAnyPanelVisualShadingData(scene: SolarScene3D): boolean {
  if (scene.panelVisualShadingByPanelId && Object.keys(scene.panelVisualShadingByPanelId).length > 0) {
    return true;
  }
  if (scene.nearShadingSnapshot && Object.keys(scene.nearShadingSnapshot.panelShadingSummaryById).length > 0) {
    return true;
  }
  return false;
}
