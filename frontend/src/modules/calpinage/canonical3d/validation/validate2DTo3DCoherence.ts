/**
 * Validation pure de cohérence 2D → 3D sur une `SolarScene3D` **déjà assemblée**.
 * Inclut : cohérence structurelle interne + fidélité à la trace source (si fournie) + `confidence`.
 */

import type { SolarScene3D } from "../types/solarScene3d";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import type {
  CoherenceConfidence,
  CoherenceIssue,
  CoherenceScope,
  Validate2DTo3DCoherenceResult,
  Validate2DTo3DCoherenceStats,
} from "../types/scene2d3dCoherence";
import { dot3, length3, normalize3, signedDistanceToPlane } from "../utils/math3";
import {
  COHERENCE_MAX_PANEL_CORNER_OFF_PATCH_PLANE_M,
  COHERENCE_MAX_PANEL_OFF_PLANE_M,
  COHERENCE_MIN_NORMAL_LENGTH,
  COHERENCE_MIN_PANEL_DIM_M,
  COHERENCE_MIN_PANEL_PATCH_NORMAL_DOT,
  COHERENCE_MIN_PATCH_AREA_M2,
  COHERENCE_MIN_VOLUME_HEIGHT_M,
} from "./coherenceConstants";
import { polygonHorizontalAreaM2FromImagePx } from "../builder/worldMapping";
import { appendUnifiedBusinessSceneIssues } from "./validateUnifiedBusinessScene";
import { appendUnifiedWorldAlignmentIssues } from "./validateUnifiedWorldAlignment";
import {
  FIDELITY_PANEL_LAYOUT_AREA_RATIO_WARN_ABOVE,
  FIDELITY_PATCH_JACCARD_ERROR_BELOW,
  FIDELITY_PATCH_JACCARD_WARN_BELOW,
  FIDELITY_ROOF_AREA_RATIO_MAX,
  FIDELITY_ROOF_AREA_RATIO_MIN,
  FIDELITY_SOURCE_COVERAGE_WARN_BELOW,
} from "./fidelityConstants";
import { buildCoherenceSummary, computeSceneQualityGrade } from "./coherenceDerive";

export type {
  CoherenceIssue,
  CoherenceScope,
  CoherenceSeverity,
  CoherenceConfidence,
  CoherenceSummary,
  Scene2DSourceTrace,
  SceneQualityGrade,
  Validate2DTo3DCoherenceResult,
  Validate2DTo3DCoherenceStats,
} from "../types/scene2d3dCoherence";

function isFinite3(p: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function jaccardStringSets(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function bboxHorizFromPatches(patches: readonly RoofPlanePatch3D[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  areaApprox: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of patches) {
    for (const c of p.cornersWorld) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  return { minX, minY, maxX, maxY, areaApprox: Math.max(0, w) * Math.max(0, h) };
}

function bboxHorizFromPanels(panels: readonly PvPanelSurface3D[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  areaApprox: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    const c = p.center3D;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  if (!Number.isFinite(minX) || panels.length === 0) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  return { minX, minY, maxX, maxY, areaApprox: Math.max(0, w) * Math.max(0, h) };
}

function validateWorld(scene: SolarScene3D, issues: CoherenceIssue[]): void {
  const w = scene.worldConfig;
  if (w == null) {
    issues.push({
      code: "WORLD_CONFIG_ABSENT",
      severity: "WARNING",
      scope: "WORLD",
      message:
        "worldConfig absent sur la scène — repère image→monde non vérifiable sur ce snapshot (acceptable si export partiel).",
    });
    return;
  }
  if (typeof w.metersPerPixel !== "number" || !Number.isFinite(w.metersPerPixel) || w.metersPerPixel <= 0) {
    issues.push({
      code: "WORLD_MPP_INVALID",
      severity: "ERROR",
      scope: "WORLD",
      message: "metersPerPixel doit être un nombre fini > 0",
      details: { metersPerPixel: w.metersPerPixel },
    });
  }
  if (typeof w.northAngleDeg !== "number" || !Number.isFinite(w.northAngleDeg)) {
    issues.push({
      code: "WORLD_NORTH_INVALID",
      severity: "ERROR",
      scope: "WORLD",
      message: "northAngleDeg doit être un nombre fini (aucun nord implicite)",
      details: { northAngleDeg: w.northAngleDeg },
    });
  }
  if (w.referenceFrame !== "LOCAL_IMAGE_ENU") {
    issues.push({
      code: "WORLD_FRAME_MISMATCH",
      severity: "ERROR",
      scope: "WORLD",
      message:
        'Repère monde unique : referenceFrame doit être "LOCAL_IMAGE_ENU" pour le pipeline calpinage canonique',
      details: { referenceFrame: w.referenceFrame },
    });
  }
}

function validatePatch(patch: RoofPlanePatch3D, issues: CoherenceIssue[]): void {
  const id = String(patch.id);
  const corners = patch.cornersWorld;
  if (!Array.isArray(corners) || corners.length < 3) {
    issues.push({
      code: "PAN_DEGENERATE_VERTICES",
      severity: "ERROR",
      scope: "PAN",
      message: `Pan ${id}: moins de 3 sommets monde`,
      entityId: id,
      details: { vertexCount: corners?.length ?? 0 },
    });
    return;
  }
  if (patch.boundaryVertexIds && patch.boundaryVertexIds.length !== corners.length) {
    issues.push({
      code: "PAN_BOUNDARY_VERTEX_MISMATCH",
      severity: "ERROR",
      scope: "PAN",
      message: `Pan ${id}: boundaryVertexIds et cornersWorld de longueurs différentes`,
      entityId: id,
    });
  }
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!;
    if (!isFinite3(c)) {
      issues.push({
        code: "PAN_VERTEX_NON_FINITE",
        severity: "ERROR",
        scope: "PAN",
        message: `Pan ${id}: sommet ${i} non fini`,
        entityId: id,
        details: { index: i, corner: c },
      });
      break;
    }
  }
  const nlen = length3(patch.normal);
  if (!Number.isFinite(nlen) || nlen < COHERENCE_MIN_NORMAL_LENGTH) {
    issues.push({
      code: "PAN_NORMAL_INVALID",
      severity: "ERROR",
      scope: "PAN",
      message: `Pan ${id}: normale nulle ou non finie`,
      entityId: id,
    });
  }
  const a = patch.surface?.areaM2;
  if (typeof a === "number" && Number.isFinite(a) && a < COHERENCE_MIN_PATCH_AREA_M2) {
    issues.push({
      code: "PAN_AREA_NEAR_ZERO",
      severity: "ERROR",
      scope: "PAN",
      message: `Pan ${id}: surface déclarée quasi nulle`,
      entityId: id,
      details: { areaM2: a },
    });
  }
}

function validatePanel(
  panel: PvPanelSurface3D,
  patchById: ReadonlyMap<string, RoofPlanePatch3D>,
  issues: CoherenceIssue[],
): void {
  const pid = String(panel.id);
  const patchId = String(panel.attachment.roofPlanePatchId);
  const patch = patchById.get(patchId);
  if (!patch) {
    issues.push({
      code: "PANEL_PARENT_PAN_UNRESOLVED",
      severity: "ERROR",
      scope: "PANEL",
      message: `Panneau ${pid}: roofPlanePatchId « ${patchId} » absent des pans de la scène (support canonique introuvable)`,
      entityId: pid,
      details: { roofPlanePatchId: patchId },
    });
  }
  if (panel.attachment.kind === "plane_patch_not_found") {
    issues.push({
      code: "PANEL_PLANE_PATCH_NOT_FOUND",
      severity: "ERROR",
      scope: "PANEL",
      message: `Panneau ${pid}: ancrage « plane_patch_not_found » — pas de correspondance toiture`,
      entityId: pid,
    });
  }
  if (panel.widthM < COHERENCE_MIN_PANEL_DIM_M || panel.heightM < COHERENCE_MIN_PANEL_DIM_M) {
    issues.push({
      code: "PANEL_DIM_INVALID",
      severity: "ERROR",
      scope: "PANEL",
      message: `Panneau ${pid}: dimensions module non strictement positives`,
      entityId: pid,
      details: { widthM: panel.widthM, heightM: panel.heightM },
    });
  }
  for (let i = 0; i < panel.corners3D.length; i++) {
    const c = panel.corners3D[i]!;
    if (!isFinite3(c)) {
      issues.push({
        code: "PANEL_CORNER_NON_FINITE",
        severity: "ERROR",
        scope: "PANEL",
        message: `Panneau ${pid}: coin ${i} non fini`,
        entityId: pid,
      });
      break;
    }
  }
  const d = Math.abs(panel.attachment.signedDistanceCenterToPlaneM);
  if (Number.isFinite(d) && d > COHERENCE_MAX_PANEL_OFF_PLANE_M) {
    issues.push({
      code: "PANEL_FAR_FROM_PLANE",
      severity: "WARNING",
      scope: "PANEL",
      message: `Panneau ${pid}: centre éloigné du plan du pan (> ${COHERENCE_MAX_PANEL_OFF_PLANE_M} m)`,
      entityId: pid,
      details: { signedDistanceCenterToPlaneM: panel.attachment.signedDistanceCenterToPlaneM },
    });
  }

  if (patch && panel.attachment.kind !== "plane_patch_not_found") {
    const pn = normalize3(panel.outwardNormal);
    const nn = normalize3(patch.normal);
    if (pn && nn) {
      const align = dot3(pn, nn);
      if (align < COHERENCE_MIN_PANEL_PATCH_NORMAL_DOT) {
        issues.push({
          code: "PANEL_PARENT_PATCH_MISMATCH",
          severity: "ERROR",
          scope: "PANEL",
          message: `Panneau ${pid}: normale module vs normale du patch parent — pas le même demi-espace / support plan`,
          entityId: pid,
          details: { roofPlanePatchId: patchId, normalDot: align },
        });
      }
    }
    let maxCornerDist = 0;
    for (const c of panel.corners3D) {
      const dist = Math.abs(signedDistanceToPlane(c, patch.equation));
      if (Number.isFinite(dist)) maxCornerDist = Math.max(maxCornerDist, dist);
    }
    if (maxCornerDist > COHERENCE_MAX_PANEL_CORNER_OFF_PATCH_PLANE_M) {
      issues.push({
        code: "PANEL_Z_SUPPORT_MISMATCH",
        severity: "WARNING",
        scope: "PANEL",
        message: `Panneau ${pid}: au moins un coin s’écarte du plan du patch parent (> ${COHERENCE_MAX_PANEL_CORNER_OFF_PATCH_PLANE_M} m)`,
        entityId: pid,
        details: { roofPlanePatchId: patchId, maxCornerDistanceToPatchPlaneM: maxCornerDist },
      });
    }
  }
}

function validateObstacleLikeVolume(
  vol: RoofObstacleVolume3D | RoofExtensionVolume3D,
  patchIds: ReadonlySet<string>,
  issues: CoherenceIssue[],
  kind: "obstacle" | "extension",
): void {
  const id = String(vol.id);
  const scope: CoherenceScope = "SHADOW_VOLUME";
  if (!vol.vertices?.length || !vol.faces?.length) {
    issues.push({
      code: "SHADOW_VOLUME_DEGENERATE_MESH",
      severity: "ERROR",
      scope,
      message: `${kind} volume ${id}: maillage vide ou sans faces`,
      entityId: id,
      details: { vertexCount: vol.vertices?.length ?? 0, faceCount: vol.faces?.length ?? 0 },
    });
  }
  if (!Number.isFinite(vol.heightM) || vol.heightM < COHERENCE_MIN_VOLUME_HEIGHT_M) {
    issues.push({
      code: "SHADOW_VOLUME_HEIGHT_INVALID",
      severity: "ERROR",
      scope,
      message: `${kind} volume ${id}: hauteur invalide`,
      entityId: id,
      details: { heightM: vol.heightM },
    });
  }
  if (!Number.isFinite(vol.volumeM3) || vol.volumeM3 < 0) {
    issues.push({
      code: "SHADOW_VOLUME_METRIC_INVALID",
      severity: "WARNING",
      scope,
      message: `${kind} volume ${id}: volumeM3 absent ou négatif`,
      entityId: id,
      details: { volumeM3: vol.volumeM3 },
    });
  }
  for (const pid of vol.relatedPlanePatchIds) {
    const ps = String(pid);
    if (!patchIds.has(ps)) {
      const code =
        kind === "obstacle" ? "OBSTACLE_PARENT_PATCH_MISMATCH" : "ROOF_EXTENSION_PARENT_PATCH_MISMATCH";
      const scopeVol: CoherenceScope = kind === "obstacle" ? "OBSTACLE" : "SHADOW_VOLUME";
      issues.push({
        code,
        severity: "ERROR",
        scope: scopeVol,
        message: `${kind} ${id}: relatedPlanePatchId « ${ps} » absent des roofPlanePatches (support canonique)`,
        entityId: id,
        details: { relatedPlanePatchId: ps },
      });
    }
  }
  const primary = vol.roofAttachment.primaryPlanePatchId;
  const relatedSet = new Set(vol.relatedPlanePatchIds.map(String));
  if (primary != null && !patchIds.has(String(primary))) {
    issues.push({
      code: "OBSTACLE_PRIMARY_PATCH_UNKNOWN",
      severity: "ERROR",
      scope: "OBSTACLE",
      message: `${kind} ${id}: primaryPlanePatchId ne correspond à aucun pan`,
      entityId: id,
      details: { primaryPlanePatchId: primary },
    });
  }
  const primaryStr = primary != null ? String(primary) : null;
  if (primaryStr && relatedSet.size > 0 && !relatedSet.has(primaryStr)) {
    const code =
      kind === "obstacle" ? "OBSTACLE_SUPPORT_GEOMETRY_DIVERGENCE" : "ROOF_EXTENSION_SUPPORT_DIVERGENCE";
    const scopeVol: CoherenceScope = kind === "obstacle" ? "OBSTACLE" : "SHADOW_VOLUME";
    issues.push({
      code,
      severity: "ERROR",
      scope: scopeVol,
      message: `${kind} ${id}: primaryPlanePatchId absent de relatedPlanePatchIds — ancrage support incohérent`,
      entityId: id,
      details: { primaryPlanePatchId: primaryStr, relatedPlanePatchIds: [...relatedSet] },
    });
  }
  if (vol.roofAttachment.anchorKind === "primary_plane_not_found") {
    issues.push({
      code: "OBSTACLE_ANCHOR_PLANE_NOT_FOUND",
      severity: "ERROR",
      scope: "OBSTACLE",
      message: `${kind} ${id}: ancrage toiture « primary_plane_not_found »`,
      entityId: id,
    });
  }
}

function validateSourceFidelity(scene: SolarScene3D, issues: CoherenceIssue[]): void {
  const st = scene.sourceTrace;
  const patches = scene.roofModel.roofPlanePatches;
  const patchIds = new Set(patches.map((p) => String(p.id)));

  if (!st) {
    issues.push({
      code: "ROOF_SOURCE_TRACE_TOO_WEAK",
      severity: "WARNING",
      scope: "SOURCE",
      message:
        "Aucune sourceTrace — impossible de vérifier la fidélité au dessin 2D source (cohérence structurelle seulement).",
    });
    return;
  }

  const weakTrace =
    st.sourcePanIds.length === 0 &&
    st.sourceObstacleIds.length === 0 &&
    st.sourcePanelIds.length === 0 &&
    (st.roofOutline2D?.contourPx?.length ?? 0) < 3;
  if (weakTrace) {
    issues.push({
      code: "ROOF_SOURCE_TRACE_TOO_WEAK",
      severity: "WARNING",
      scope: "SOURCE",
      message: "sourceTrace présente mais sans ids ni contour exploitable — traçabilité produit faible.",
    });
  }

  for (const id of st.sourcePanIds) {
    if (!patchIds.has(String(id))) {
      issues.push({
        code: "SOURCE_PAN_MISSING_IN_SCENE",
        severity: "WARNING",
        scope: "SOURCE",
        message: `Pan source « ${id} » absent des roofPlanePatches de la scène finale`,
        entityId: id,
      });
    }
  }

  const volIds = new Set([
    ...scene.obstacleVolumes.map((v) => String(v.id)),
    ...scene.extensionVolumes.map((v) => String(v.id)),
  ]);
  for (const id of st.sourceObstacleIds) {
    if (!volIds.has(String(id))) {
      issues.push({
        code: "SOURCE_OBSTACLE_MISSING_IN_SCENE",
        severity: "WARNING",
        scope: "SOURCE",
        message: `Obstacle source « ${id} » absent des volumes scène`,
        entityId: id,
      });
    }
  }

  const panelIds = new Set(scene.pvPanels.map((p) => String(p.id)));
  for (const id of st.sourcePanelIds) {
    if (!panelIds.has(String(id))) {
      issues.push({
        code: "SOURCE_PANEL_MISSING_IN_SCENE",
        severity: "WARNING",
        scope: "SOURCE",
        message: `Panneau source « ${id} » absent de pvPanels`,
        entityId: id,
      });
    }
  }

  const srcPanSet = new Set(st.sourcePanIds.map(String));
  const jScene = jaccardStringSets(srcPanSet, patchIds);
  if (srcPanSet.size > 0 && jScene < FIDELITY_PATCH_JACCARD_ERROR_BELOW) {
    issues.push({
      code: "ROOF_PATCH_SOURCE_DIVERGENCE",
      severity: "ERROR",
      scope: "SOURCE",
      message: "Divergence forte entre ids pans source et patches présents en scène (Jaccard trop bas).",
      details: { jaccardSourceVsScene: jScene },
    });
  } else if (srcPanSet.size > 0 && jScene < FIDELITY_PATCH_JACCARD_WARN_BELOW) {
    issues.push({
      code: "ROOF_PATCH_SOURCE_DIVERGENCE",
      severity: "WARNING",
      scope: "SOURCE",
      message: "Alignement partiel pans source ↔ patches scène — vérifier le chemin toiture.",
      details: { jaccardSourceVsScene: jScene },
    });
  }

  if (st.expectedRoofPlanePatchIds && st.expectedRoofPlanePatchIds.length > 0) {
    const expSet = new Set(st.expectedRoofPlanePatchIds.map(String));
    const jLegacy = jaccardStringSets(expSet, patchIds);
    if (jLegacy < FIDELITY_PATCH_JACCARD_ERROR_BELOW) {
      issues.push({
        code: "ROOF_PATCH_SOURCE_DIVERGENCE",
        severity: "ERROR",
        scope: "SOURCE",
        message: "Les patches scène ne recouvrent pas les ids attendus du roof model (divergence forte).",
        details: { jaccardExpectedVsScene: jLegacy },
      });
    }
    const jAlign = jaccardStringSets(srcPanSet, expSet);
    if (srcPanSet.size > 0 && expSet.size > 0) {
      if (jAlign < FIDELITY_PATCH_JACCARD_ERROR_BELOW) {
        issues.push({
          code: "MULTIPLE_PAN_TRUTH_DETECTED",
          severity: "ERROR",
          scope: "SCENE",
          message:
            "sourcePanIds et expectedRoofPlanePatchIds divergent fortement — double vérité de pans (toiture vs trace).",
          details: { jaccardSourcePanVsExpectedPatch: jAlign },
        });
      } else if (jAlign < FIDELITY_PATCH_JACCARD_WARN_BELOW) {
        issues.push({
          code: "ROOF_MODEL_PAN_ALIGNMENT_WEAK",
          severity: "WARNING",
          scope: "SOURCE",
          message:
            "Ids pans adaptateur vs ids patches toiture legacy — alignement faible (double chemin toiture).",
          details: { jaccardCanonicalVsLegacy: jAlign },
        });
      }
    }

    const sceneOnly = [...patchIds].filter((id) => !expSet.has(id));
    const expectedOnly = [...expSet].filter((id) => !patchIds.has(id));
    if (sceneOnly.length > 0 && expectedOnly.length > 0) {
      issues.push({
        code: "CANONICAL_SUPPORT_REFERENCE_MISMATCH",
        severity: "WARNING",
        scope: "SCENE",
        message:
          "Patches présents en scène et ids attendus du modèle se chevauchent sans inclusion réciproque — références de support hétérogènes.",
        details: {
          sceneOnlyPatchIdsSample: sceneOnly.slice(0, 12),
          expectedOnlyPatchIdsSample: expectedOnly.slice(0, 12),
        },
      });
    }
  }

  const mpp = scene.worldConfig?.metersPerPixel;
  const areaPx = st.metrics?.roofOutlineArea2DPx;
  const areaM2FromTrace = st.metrics?.roofOutlineHorizontalAreaM2;
  let expectedFootprintM2: number | undefined;
  let footprintExpectedFrom: "trace_m2" | "contour_world_m2" | "px_mpp2_fallback" | undefined;
  if (typeof areaM2FromTrace === "number" && Number.isFinite(areaM2FromTrace) && areaM2FromTrace > 0) {
    expectedFootprintM2 = areaM2FromTrace;
    footprintExpectedFrom = "trace_m2";
  } else if (typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0) {
    const contourPx = st.roofOutline2D?.contourPx;
    if (Array.isArray(contourPx) && contourPx.length >= 3) {
      const wc = scene.worldConfig;
      const north =
        wc && typeof wc.northAngleDeg === "number" && Number.isFinite(wc.northAngleDeg) ? wc.northAngleDeg : 0;
      const aContour = polygonHorizontalAreaM2FromImagePx(contourPx, mpp, north);
      if (aContour > 0) {
        expectedFootprintM2 = aContour;
        footprintExpectedFrom = "contour_world_m2";
      }
    }
  }
  if (
    expectedFootprintM2 == null &&
    typeof mpp === "number" &&
    Number.isFinite(mpp) &&
    mpp > 0 &&
    typeof areaPx === "number" &&
    areaPx > 0
  ) {
    expectedFootprintM2 = areaPx * mpp * mpp;
    footprintExpectedFrom = "px_mpp2_fallback";
  }
  if (expectedFootprintM2 != null && expectedFootprintM2 > 0 && patches.length > 0) {
    let sumPatch = 0;
    for (const p of patches) {
      const a = p.surface?.areaM2;
      if (typeof a === "number" && Number.isFinite(a)) sumPatch += a;
    }
    const ratio = sumPatch / expectedFootprintM2;
    if (ratio < FIDELITY_ROOF_AREA_RATIO_MIN || ratio > FIDELITY_ROOF_AREA_RATIO_MAX) {
      issues.push({
        code: "ROOF_OUTLINE_AREA_MISMATCH",
        severity: "WARNING",
        scope: "SOURCE",
        message:
          "Somme des aires pans 3D vs emprise contour (aire horizontale monde : trace, contour via mapping officiel, ou repli px×mpp²) — écart global suspect (heuristique).",
        details: {
          sumPatchAreaM2: sumPatch,
          expectedFootprintM2,
          ratio,
          expectedFrom: footprintExpectedFrom ?? "unknown",
        },
      });
    }
  }

  const bbP = bboxHorizFromPatches(patches);
  const bbPv = bboxHorizFromPanels(scene.pvPanels);
  if (bbP && bbPv && bbP.areaApprox > 1e-6 && scene.pvPanels.length > 0) {
    const r = bbPv.areaApprox / bbP.areaApprox;
    if (r > FIDELITY_PANEL_LAYOUT_AREA_RATIO_WARN_ABOVE) {
      issues.push({
        code: "PANEL_LAYOUT_GLOBAL_FOOTPRINT_MISMATCH",
        severity: "WARNING",
        scope: "SOURCE",
        message:
          "Dispersion des centres panneaux (bbox XY) grande vs emprise pans — incohérence d’ensemble possible.",
        details: { panelBboxAreaRatio: r },
      });
    }
  }

  const covPan =
    st.sourcePanIds.length === 0
      ? 1
      : st.sourcePanIds.filter((id) => patchIds.has(String(id))).length / st.sourcePanIds.length;
  const covObs =
    st.sourceObstacleIds.length === 0
      ? 1
      : st.sourceObstacleIds.filter((id) => volIds.has(String(id))).length / st.sourceObstacleIds.length;
  const covPv =
    st.sourcePanelIds.length === 0
      ? 1
      : st.sourcePanelIds.filter((id) => panelIds.has(String(id))).length / st.sourcePanelIds.length;
  const cov = (covPan + covObs + covPv) / 3;
  if (cov < FIDELITY_SOURCE_COVERAGE_WARN_BELOW && (st.sourcePanIds.length + st.sourceObstacleIds.length + st.sourcePanelIds.length) > 0) {
    issues.push({
      code: "SOURCE_COVERAGE_LOW",
      severity: "WARNING",
      scope: "SOURCE",
      message: "Couverture ids source → scène inférieure au seuil — scène possiblement amputée.",
      details: { sourceCoverageRatio: cov, covPan, covObs, covPv },
    });
  }
}

function countErrorsByScope(issues: readonly CoherenceIssue[], scope: CoherenceScope): number {
  return issues.filter((i) => i.scope === scope && i.severity === "ERROR").length;
}

function buildConfidence(scene: SolarScene3D, issues: readonly CoherenceIssue[]): CoherenceConfidence {
  const st = scene.sourceTrace;
  const errN = issues.filter((i) => i.severity === "ERROR").length;
  const warnN = issues.filter((i) => i.severity === "WARNING").length;

  const hasContour = (st?.roofOutline2D?.contourPx?.length ?? 0) >= 3;
  const hasSrcIds =
    (st?.sourcePanIds?.length ?? 0) > 0 ||
    (st?.sourceObstacleIds?.length ?? 0) > 0 ||
    (st?.sourcePanelIds?.length ?? 0) > 0;
  const hasExpected = (st?.expectedRoofPlanePatchIds?.length ?? 0) > 0;

  let roofTraceabilityLevel: CoherenceConfidence["roofTraceabilityLevel"] = "NONE";
  if (hasContour && hasSrcIds) roofTraceabilityLevel = "FULL";
  else if (hasSrcIds) roofTraceabilityLevel = "PARTIAL";
  else if (hasExpected) roofTraceabilityLevel = "LEGACY_ONLY";

  const source2DLinked = hasContour || (hasSrcIds && hasExpected);

  const patchIds = new Set(scene.roofModel.roofPlanePatches.map((p) => String(p.id)));
  const volIds = new Set([
    ...scene.obstacleVolumes.map((v) => String(v.id)),
    ...scene.extensionVolumes.map((v) => String(v.id)),
  ]);
  const pvIds = new Set(scene.pvPanels.map((p) => String(p.id)));

  const panIds = st?.sourcePanIds ?? [];
  const obsIds = st?.sourceObstacleIds ?? [];
  const panPlIds = st?.sourcePanelIds ?? [];

  const covPan = panIds.length === 0 ? 1 : panIds.filter((id) => patchIds.has(String(id))).length / panIds.length;
  const covObs = obsIds.length === 0 ? 1 : obsIds.filter((id) => volIds.has(String(id))).length / obsIds.length;
  const covPv = panPlIds.length === 0 ? 1 : panPlIds.filter((id) => pvIds.has(String(id))).length / panPlIds.length;
  const sourceCoverageRatio =
    st && (panIds.length + obsIds.length + panPlIds.length) > 0 ? (covPan + covObs + covPv) / 3 : undefined;

  let geometryConfidence: CoherenceConfidence["geometryConfidence"] = "HIGH";
  if (errN > 0) geometryConfidence = "LOW";
  else if (!st) geometryConfidence = "MEDIUM";
  else if (warnN > 6 || (sourceCoverageRatio != null && sourceCoverageRatio < 0.6)) geometryConfidence = "LOW";
  else if (warnN > 0 || (sourceCoverageRatio != null && sourceCoverageRatio < FIDELITY_SOURCE_COVERAGE_WARN_BELOW)) {
    geometryConfidence = "MEDIUM";
  }

  return {
    source2DLinked,
    roofTraceabilityLevel,
    geometryConfidence,
    ...(sourceCoverageRatio !== undefined ? { sourceCoverageRatio } : {}),
  };
}

/**
 * Valide la cohérence d’ensemble d’une scène 3D finale (données réellement injectées dans `SolarScene3D`).
 */
export function validate2DTo3DCoherence(scene: SolarScene3D): Validate2DTo3DCoherenceResult {
  const issues: CoherenceIssue[] = [];

  validateWorld(scene, issues);
  appendUnifiedWorldAlignmentIssues(scene, issues);

  const patches = scene.roofModel.roofPlanePatches;
  const patchIds = new Set(patches.map((p) => String(p.id)));
  const patchById = new Map<string, RoofPlanePatch3D>(patches.map((p) => [String(p.id), p]));

  if (patches.length === 0) {
    issues.push({
      code: "ROOF_NO_PLANE_PATCHES",
      severity: "ERROR",
      scope: "ROOF",
      message: "Modèle toiture sans aucun roofPlanePatch — pas de coque 3D exploitable",
    });
  }

  for (const p of patches) {
    validatePatch(p, issues);
  }

  for (const panel of scene.pvPanels) {
    validatePanel(panel, patchById, issues);
  }

  for (const v of scene.obstacleVolumes) {
    validateObstacleLikeVolume(v, patchIds, issues, "obstacle");
  }
  for (const v of scene.extensionVolumes) {
    validateObstacleLikeVolume(v, patchIds, issues, "extension");
  }

  validateSourceFidelity(scene, issues);
  appendUnifiedBusinessSceneIssues(scene, issues);

  const hasError = issues.some((i) => i.severity === "ERROR");
  const isCoherent = !hasError;

  const stats: Validate2DTo3DCoherenceStats = {
    roofCount: scene.roofModel ? 1 : 0,
    panCount: patches.length,
    obstacleCount: scene.obstacleVolumes.length,
    panelCount: scene.pvPanels.length,
    shadowVolumeCount: scene.obstacleVolumes.length + scene.extensionVolumes.length,
    invalidPanCount: countErrorsByScope(issues, "PAN"),
    invalidObstacleCount: countErrorsByScope(issues, "OBSTACLE"),
    invalidPanelCount: countErrorsByScope(issues, "PANEL"),
    invalidShadowVolumeCount: countErrorsByScope(issues, "SHADOW_VOLUME"),
  };

  const confidence = buildConfidence(scene, issues);
  const summary = buildCoherenceSummary(scene, issues);
  const sceneQualityGrade = computeSceneQualityGrade(isCoherent, summary, confidence);

  return {
    isCoherent,
    issues,
    stats,
    confidence,
    summary,
    sceneQualityGrade,
  };
}
