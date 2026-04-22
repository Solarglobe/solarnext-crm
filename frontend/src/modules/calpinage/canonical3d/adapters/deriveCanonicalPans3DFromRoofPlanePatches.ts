/**
 * Vue **dérivée** : `CanonicalPan3D` aligné sur le RoofTruth (`roofPlanePatches`), pas sur le pipeline
 * `buildCanonicalPans3DFromRuntime` (résolveur Z / state.pans).
 *
 * Usage : chaîne produit officielle après `buildRoofModel3DFromLegacyGeometry` — une seule géométrie toit.
 */

import { worldHorizontalMToImagePx } from "../builder/worldMapping";
import { polygonArea3dIntrinsic, polygonProjectedHorizontalAreaXY } from "../builder/planePolygon3d";
import { computeOfficialPanPhysicsFromCornersWorld } from "../builder/officialPanPhysics";
import { normalize3, vec3 } from "../utils/math3";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { Vector3 } from "../types/primitives";
import {
  computeStablePan3DId,
  type CanonicalPan3D,
  type CanonicalPanBoundaryEdgeWorld,
  type CanonicalPanVertex3D,
} from "./buildCanonicalPans3DFromRuntime";

const UP_WORLD = vec3(0, 0, 1);

function area2DPxFromPoints(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return Math.abs(s) * 0.5;
}

function centroid2DPx(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const n = pts.length;
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

/**
 * Construit une liste de `CanonicalPan3D` à partir des patches du modèle toit officiel.
 * Les sommets reprennent les coins WORLD du patch ; le 2D image est obtenu par `worldHorizontalMToImagePx`.
 */
export function deriveCanonicalPans3DFromRoofPlanePatches(args: {
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
}): CanonicalPan3D[] {
  const { roofPlanePatches, metersPerPixel, northAngleDeg } = args;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0 || !Number.isFinite(northAngleDeg)) {
    return [];
  }

  const out: CanonicalPan3D[] = [];

  for (const patch of roofPlanePatches) {
    const corners = patch.cornersWorld;
    if (!Array.isArray(corners) || corners.length < 3) continue;

    const cornersVec: Vector3[] = corners.map((c) => ({ x: c.x, y: c.y, z: c.z }));
    const physics = computeOfficialPanPhysicsFromCornersWorld(cornersVec, UP_WORLD);

    const points2D: { x: number; y: number }[] = [];
    const vertices3D: CanonicalPanVertex3D[] = [];
    const n = corners.length;
    for (let i = 0; i < n; i++) {
      const c = corners[i]!;
      const { xPx, yPx } = worldHorizontalMToImagePx(c.x, c.y, metersPerPixel, northAngleDeg);
      const vid =
        Array.isArray(patch.boundaryVertexIds) && patch.boundaryVertexIds[i] != null
          ? String(patch.boundaryVertexIds[i])
          : `${String(patch.id)}-v${i}`;
      points2D.push({ x: xPx, y: yPx });
      vertices3D.push({
        vertexId: vid,
        xPx,
        yPx,
        xWorldM: c.x,
        yWorldM: c.y,
        zWorldM: c.z,
        heightM: c.z,
        source: "roof_truth_plane_patch",
        confidence: physics.confidence,
      });
    }

    const panId = String(patch.id);
    const stableId = computeStablePan3DId(panId, points2D);
    const area2d = area2DPxFromPoints(points2D);
    const centroidPx = centroid2DPx(points2D);
    const areaPlanM2 = polygonProjectedHorizontalAreaXY(cornersVec);
    const area3DM2 = polygonArea3dIntrinsic(cornersVec);
    const nu = normalize3(physics.normal) ?? { x: 0, y: 0, z: 1 };
    const isDegenerate = physics.source !== "newell_corners_world" || area2d < 1e-9 || n < 3;

    const boundaryEdgesWorld: CanonicalPanBoundaryEdgeWorld[] = [];
    for (let ei = 0; ei < n; ei++) {
      const ej = (ei + 1) % n;
      const a = vertices3D[ei]!;
      const b = vertices3D[ej]!;
      boundaryEdgesWorld.push({
        i0: ei,
        i1: ej,
        start: { x: a.xWorldM, y: a.yWorldM, z: a.zWorldM },
        end: { x: b.xWorldM, y: b.yWorldM, z: b.zWorldM },
      });
    }

    let slopeDeg = physics.slopeDeg;
    let azimuthDeg = physics.azimuthDeg;
    if (typeof patch.tiltDeg === "number" && Number.isFinite(patch.tiltDeg) && slopeDeg != null) {
      if (Math.abs(slopeDeg - patch.tiltDeg) <= 2.5) slopeDeg = patch.tiltDeg;
    }
    if (typeof patch.azimuthDeg === "number" && Number.isFinite(patch.azimuthDeg) && azimuthDeg != null) {
      const dg = Math.abs((((azimuthDeg - patch.azimuthDeg + 540) % 360) - 180) as number);
      if (dg <= 15) azimuthDeg = patch.azimuthDeg;
    }

    out.push({
      panId,
      stableId,
      points2D,
      vertices3D,
      centroid2D: centroidPx,
      centroid3D: {
        xWorldM: vertices3D.reduce((s, v) => s + v.xWorldM, 0) / n,
        yWorldM: vertices3D.reduce((s, v) => s + v.yWorldM, 0) / n,
        zWorldM: vertices3D.reduce((s, v) => s + v.zWorldM, 0) / n,
      },
      normal: { x: nu.x, y: nu.y, z: nu.z },
      slopeDeg,
      azimuthDeg,
      area2DPx: area2d > 0 ? area2d : null,
      areaPlanM2: areaPlanM2 > 0 ? areaPlanM2 : null,
      area3DM2: area3DM2 > 0 ? area3DM2 : null,
      roofKind: null,
      boundaryEdgesWorld,
      diagnostics: {
        zSourceSummary: ["roof_truth_plane_patch"],
        confidenceMin: vertices3D.length ? Math.min(...vertices3D.map((v) => v.confidence)) : 0,
        confidenceAvg: vertices3D.length ? vertices3D.reduce((s, v) => s + v.confidence, 0) / n : 0,
        isFlatLike: slopeDeg != null && slopeDeg <= 0.75,
        isDegenerate,
        warnings: isDegenerate ? ["DERIVED_PAN_DEGENERATE"] : [],
        zRangeM: Math.max(...vertices3D.map((v) => v.zWorldM)) - Math.min(...vertices3D.map((v) => v.zWorldM)),
        allHeightsEqual: vertices3D.every((v) => Math.abs(v.zWorldM - vertices3D[0]!.zWorldM) < 1e-4),
        usedFallbackForAllVertices: false,
        insufficientHeightSignal: false,
        heterogeneousZSources: false,
        planeResidualRmsM: physics.planeResidualRmsM,
        inclinedRoofGeometryTruthful: true,
      },
    });
  }

  return out;
}
