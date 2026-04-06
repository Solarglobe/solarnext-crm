/**
 * Construit le contenu du panneau d’inspection à partir de `SolarScene3D` + sélection (lecture seule).
 */

import type { GeometryProvenance } from "../../types/provenance";
import type { RoofObstacleKind } from "../../types/obstacle";
import type { SolarScene3D } from "../../types/solarScene3d";
import { getEffectivePanelVisualShading } from "../visualShading/effectivePanelVisualShading";
import {
  formatAngleDeg,
  formatAreaM2,
  formatConfidenceFr,
  formatDimsM,
  formatLengthM,
  formatPercentFr,
} from "./formatInspectionValue";
import type { InspectionRow, SceneInspectionSelection, SceneInspectionViewModel } from "./sceneInspectionTypes";
import { azimuthDegFromOutwardNormalWorld, tiltDegFromOutwardNormalWorld } from "./tiltAzimuthFromNormal";

function formatObstacleKindFr(k: RoofObstacleKind): string {
  const map: Record<RoofObstacleKind, string> = {
    chimney: "Cheminée",
    skylight: "Fenêtre de toit",
    hvac: "VMC / HVAC",
    parapet: "Acrotère",
    antenna: "Antenne",
    tree_proxy: "Arbre (proxy)",
    other: "Autre",
  };
  return map[k] ?? k;
}

function formatExtensionKindFr(k: string): string {
  const map: Record<string, string> = {
    dormer: "Lucarne",
    chien_assis: "Chien-assis",
    shed: "Bâti / appentis",
    other: "Extension",
  };
  return map[k] ?? k;
}

function formatProvenanceFr(p: GeometryProvenance): string {
  switch (p.source) {
    case "contour2d":
      return `Contour 2D · ${p.contourId}`;
    case "ridge2d":
      return `Faîtage 2D · ${p.ridgeId}`;
    case "trait2d":
      return `Trait 2D · ${p.traitId}`;
    case "extension2d":
      return `Extension 2D · ${p.extensionId}`;
    case "obstacle2d":
      return `Obstacle 2D · ${p.obstacleId}`;
    case "intersection_generated":
      return `Intersection · ${p.operation}`;
    case "solver":
      return `Solveur · ${p.solverStep}`;
    case "import":
      return `Import · ${p.format}`;
    case "manual_adjustment":
      return "Ajustement manuel";
    default:
      return "—";
  }
}

function collectCoherenceForPan(scene: SolarScene3D, panId: string): string[] {
  const issues = scene.coherence?.issues ?? [];
  return issues
    .filter((i) => i.scope === "PAN" && String(i.entityId ?? "") === String(panId))
    .map((i) => `[${i.severity}] ${i.code} : ${i.message}`);
}

function collectCoherenceForPanel(scene: SolarScene3D, panelId: string): string[] {
  const issues = scene.coherence?.issues ?? [];
  return issues
    .filter((i) => i.scope === "PANEL" && String(i.entityId ?? "") === String(panelId))
    .map((i) => `[${i.severity}] ${i.code} : ${i.message}`);
}

function collectCoherenceForObstacle(scene: SolarScene3D, volumeId: string): string[] {
  const issues = scene.coherence?.issues ?? [];
  return issues
    .filter((i) => i.scope === "OBSTACLE" && String(i.entityId ?? "") === String(volumeId))
    .map((i) => `[${i.severity}] ${i.code} : ${i.message}`);
}

function countPanelsOnPan(scene: SolarScene3D, panId: string): number {
  return scene.pvPanels.filter((p) => String(p.attachment.roofPlanePatchId) === String(panId)).length;
}

function countObstaclesOnPan(scene: SolarScene3D, panId: string): number {
  let n = 0;
  for (const v of scene.obstacleVolumes) {
    if (v.relatedPlanePatchIds.some((id) => String(id) === String(panId))) n++;
  }
  for (const v of scene.extensionVolumes) {
    if (v.relatedPlanePatchIds.some((id) => String(id) === String(panId))) n++;
  }
  return n;
}

export function buildSceneInspectionViewModel(
  scene: SolarScene3D,
  selection: SceneInspectionSelection,
): SceneInspectionViewModel {
  const rows: InspectionRow[] = [];
  const warnings: string[] = [];

  if (selection.kind === "PAN") {
    const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(selection.id));
    if (!patch) {
      return {
        title: "Pan introuvable",
        rows: [{ label: "ID", value: selection.id }],
        warnings: ["Ce pan n’existe pas dans roofModel.roofPlanePatches."],
      };
    }

    const tilt =
      patch.tiltDeg != null && Number.isFinite(patch.tiltDeg)
        ? patch.tiltDeg
        : tiltDegFromOutwardNormalWorld(patch.normal);
    const az =
      patch.azimuthDeg != null && Number.isFinite(patch.azimuthDeg)
        ? patch.azimuthDeg
        : azimuthDegFromOutwardNormalWorld(patch.normal);

    rows.push({ label: "Type", value: "Pan de toiture" });
    rows.push({ label: "ID", value: String(patch.id) });
    rows.push({ label: "Pan ID", value: String(patch.id) });
    rows.push({
      label: "Pente",
      value:
        patch.tiltDeg != null
          ? formatAngleDeg(patch.tiltDeg)
          : tilt != null
            ? `${formatAngleDeg(tilt)} (à partir de la normale)`
            : "—",
    });
    rows.push({
      label: "Azimut",
      value:
        patch.azimuthDeg != null
          ? formatAngleDeg(patch.azimuthDeg)
          : az != null
            ? `${formatAngleDeg(az)} (à partir de la normale)`
            : "—",
    });
    rows.push({ label: "Surface", value: formatAreaM2(patch.surface?.areaM2) });
    rows.push({ label: "Z centroïde", value: formatLengthM(patch.centroid.z) });
    rows.push({ label: "Panneaux sur ce pan", value: String(countPanelsOnPan(scene, String(patch.id))) });
    rows.push({ label: "Obstacles / ext. liés", value: String(countObstaclesOnPan(scene, String(patch.id))) });
    rows.push({ label: "Rôle topologique", value: patch.topologyRole });
    rows.push({ label: "Confiance géométrique", value: formatConfidenceFr(patch.quality.confidence) });
    rows.push({ label: "Statut cohérence scène", value: scene.coherence?.isCoherent === true ? "OK" : "À vérifier" });

    for (const d of patch.quality.diagnostics) {
      warnings.push(`[${d.severity}] ${d.code} : ${d.message}`);
    }
    warnings.push(...collectCoherenceForPan(scene, String(patch.id)));

    if (patch.tiltDeg != null && patch.tiltDeg < 3) {
      warnings.push("Pente très faible — vérification conseillée.");
    }

    return { title: "Inspection — pan", rows, warnings };
  }

  if (selection.kind === "PV_PANEL") {
    const panel = scene.pvPanels.find((p) => String(p.id) === String(selection.id));
    if (!panel) {
      return {
        title: "Panneau introuvable",
        rows: [{ label: "ID", value: selection.id }],
        warnings: [],
      };
    }

    const panId = String(panel.attachment.roofPlanePatchId);
    const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === panId);

    const tilt =
      patch && patch.tiltDeg != null && Number.isFinite(patch.tiltDeg)
        ? patch.tiltDeg
        : patch
          ? tiltDegFromOutwardNormalWorld(patch.normal)
          : null;
    const az =
      patch && patch.azimuthDeg != null && Number.isFinite(patch.azimuthDeg)
        ? patch.azimuthDeg
        : patch
          ? azimuthDegFromOutwardNormalWorld(patch.normal)
          : null;

    const eff = getEffectivePanelVisualShading(String(panel.id), scene);
    let shadingLine = "Donnée non disponible";
    if (eff.state === "AVAILABLE" && eff.lossPct != null) {
      shadingLine =
        eff.provenance === "near_snapshot_mean_fraction"
          ? `Indicateur scène 3D : ${formatPercentFr(eff.lossPct)}`
          : `Perte shading : ${formatPercentFr(eff.lossPct)}`;
    } else if (eff.state === "INVALID") {
      shadingLine = "Donnée présente mais invalide";
    }

    rows.push({ label: "Type", value: "Panneau PV" });
    rows.push({ label: "ID", value: String(panel.id) });
    rows.push({ label: "Pan associé", value: panId });
    rows.push({
      label: "Orientation",
      value: panel.pose.orientation === "portrait" ? "Portrait" : "Paysage",
    });
    rows.push({
      label: "Pente (plan pan)",
      value: patch?.tiltDeg != null ? formatAngleDeg(patch.tiltDeg) : tilt != null ? formatAngleDeg(tilt) : "—",
    });
    rows.push({
      label: "Azimut (plan pan)",
      value: patch?.azimuthDeg != null ? formatAngleDeg(patch.azimuthDeg) : az != null ? formatAngleDeg(az) : "—",
    });
    rows.push({ label: "Dimensions", value: formatDimsM(panel.widthM, panel.heightM) });
    rows.push({
      label: "Distance au plan (signée)",
      value: formatLengthM(panel.attachment.signedDistanceCenterToPlaneM),
    });
    rows.push({ label: "Rotation en plan", value: formatAngleDeg(panel.pose.rotationDegInPlane) });
    if (panel.pose.blockGroupId != null) {
      rows.push({ label: "Groupe / bloc", value: String(panel.pose.blockGroupId) });
    }
    rows.push({ label: "Shading (lecture)", value: shadingLine });
    rows.push({
      label: "Qualité visuelle shading",
      value:
        eff.state === "AVAILABLE" && eff.qualityScore01 != null
          ? `${(eff.qualityScore01 * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} / 100`
          : "—",
    });
    rows.push({ label: "Rattachement", value: panel.attachment.kind });
    rows.push({ label: "Confiance", value: formatConfidenceFr(panel.quality.confidence) });
    rows.push({ label: "Statut cohérence scène", value: scene.coherence?.isCoherent === true ? "OK" : "À vérifier" });

    for (const d of panel.quality.diagnostics) {
      warnings.push(`[${d.severity}] ${d.code} : ${d.message}`);
    }
    warnings.push(...collectCoherenceForPanel(scene, String(panel.id)));

    return { title: "Inspection — panneau PV", rows, warnings };
  }

  if (selection.kind === "OBSTACLE") {
    const v = scene.obstacleVolumes.find((o) => String(o.id) === String(selection.id));
    if (!v) {
      return {
        title: "Obstacle introuvable",
        rows: [{ label: "ID", value: selection.id }],
        warnings: [],
      };
    }

    const dx = v.bounds.max.x - v.bounds.min.x;
    const dy = v.bounds.max.y - v.bounds.min.y;
    const panLink =
      v.relatedPlanePatchIds.length > 0 ? v.relatedPlanePatchIds.map(String).join(", ") : "—";

    rows.push({ label: "Type", value: "Obstacle volumique" });
    rows.push({ label: "ID", value: String(v.id) });
    rows.push({ label: "Sous-type", value: formatObstacleKindFr(v.kind) });
    rows.push({ label: "Pan(s) lié(s)", value: panLink });
    rows.push({ label: "Hauteur", value: formatLengthM(v.heightM) });
    rows.push({ label: "Élévation base", value: formatLengthM(v.baseElevationM) });
    rows.push({ label: "Dimensions (AABB XY)", value: formatDimsM(dx, dy) });
    rows.push({ label: "Mode d’extrusion", value: v.extrusion.mode });
    rows.push({ label: "Rôle structurel", value: v.structuralRole });
    rows.push({ label: "Source", value: formatProvenanceFr(v.provenance) });
    rows.push({ label: "Confiance", value: formatConfidenceFr(v.quality.confidence) });

    for (const d of v.quality.diagnostics) {
      warnings.push(`[${d.severity}] ${d.code} : ${d.message}`);
    }
    warnings.push(...collectCoherenceForObstacle(scene, String(v.id)));

    return { title: "Inspection — obstacle", rows, warnings };
  }

  /* EXTENSION */
  const ex = scene.extensionVolumes.find((x) => String(x.id) === String(selection.id));
  if (!ex) {
    return {
      title: "Extension introuvable",
      rows: [{ label: "ID", value: selection.id }],
      warnings: [],
    };
  }

  const dx = ex.bounds.max.x - ex.bounds.min.x;
  const dy = ex.bounds.max.y - ex.bounds.min.y;
  const panLink =
    ex.relatedPlanePatchIds.length > 0 ? ex.relatedPlanePatchIds.map(String).join(", ") : "—";

  rows.push({ label: "Type", value: "Volume d’extension" });
  rows.push({ label: "ID", value: String(ex.id) });
  rows.push({ label: "Sous-type", value: formatExtensionKindFr(String(ex.kind)) });
  rows.push({ label: "Pan(s) lié(s)", value: panLink });
  rows.push({ label: "Hauteur", value: formatLengthM(ex.heightM) });
  rows.push({ label: "Élévation base", value: formatLengthM(ex.baseElevationM) });
  rows.push({ label: "Dimensions (AABB XY)", value: formatDimsM(dx, dy) });
  rows.push({ label: "Mode d’extrusion", value: ex.extrusion.mode });
  rows.push({ label: "Source", value: formatProvenanceFr(ex.provenance) });
  rows.push({ label: "Confiance", value: formatConfidenceFr(ex.quality.confidence) });

  for (const d of ex.quality.diagnostics) {
    warnings.push(`[${d.severity}] ${d.code} : ${d.message}`);
  }
  warnings.push(...collectCoherenceForObstacle(scene, String(ex.id)));

  return { title: "Inspection — extension", rows, warnings };
}
