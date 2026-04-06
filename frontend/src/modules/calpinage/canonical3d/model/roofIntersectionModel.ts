/**
 * Intersections 3D entre pans toiture — sortie du moteur `computeRoofPlaneIntersections`.
 * Consomme uniquement le canonique + graphe + `RoofPlaneSolutionSet`.
 *
 * @see docs/architecture/roof-plane-intersections.md
 */

import type { BuildingLocalVec3, CanonicalHouseEntityId } from "./canonicalHouse3DModel";
import type { RoofPlaneEquation } from "./roofPlaneSolutionModel";
import type { RoofTopologyOfficialEdgeKind } from "./roofTopologyModel";

export const ROOF_INTERSECTION_SET_SCHEMA_ID = "roof-intersection-set-v1" as const;

/** Droite 3D : point d’ancrage + direction unitaire. */
export interface RoofIntersectionLine3D {
  readonly anchorPoint: BuildingLocalVec3;
  readonly directionUnit: BuildingLocalVec3;
}

export type RoofIntersectionResolutionMethod =
  | "two_plane_line_clip_topology_edge_xy"
  | "vertical_intersection_line_xy_degenerate"
  | "unresolved_parallel_planes"
  | "unresolved_coincident_planes"
  | "unresolved_one_or_both_planes_missing"
  | "unresolved_topology_edge_degenerate";

export type RoofSeamingLevel = "clean" | "partial" | "ambiguous" | "invalid";

export interface RoofSharedEdgeIntersectionDiagnostics {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface RoofSharedEdgeIntersection {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  /** Ordonnancement stable lexicographique des ids de pans. */
  readonly leftPatchId: CanonicalHouseEntityId;
  readonly rightPatchId: CanonicalHouseEntityId;
  readonly officialEdgeKind: RoofTopologyOfficialEdgeKind;
  readonly intersectionLine3D: RoofIntersectionLine3D | null;
  /** Portion utile sur le raccord (extrémités sur la droite d’intersection). */
  readonly sharedSegment3D: readonly [BuildingLocalVec3, BuildingLocalVec3] | null;
  readonly segmentStart3D: BuildingLocalVec3 | null;
  readonly segmentEnd3D: BuildingLocalVec3 | null;
  readonly resolutionMethod: RoofIntersectionResolutionMethod;
  readonly isConsistent: boolean;
  readonly hasGap: boolean;
  readonly hasStep: boolean;
  readonly hasOverlap: boolean;
  readonly isClipped: boolean;
  /** Distance max en plan entre les extrémités topologiques XY et la projection de la droite (m). */
  readonly gapDistanceM: number;
  /** Max |z1-z2| sur échantillons (extrémités + milieu arête) (m). */
  readonly stepDistanceM: number;
  /**
   * Plans quasi parallèles / quasi confondus : chevauchement de feuillets ou ambiguïté de couture.
   * v1 : surtout `coincident` / presque parallèle.
   */
  readonly overlapDistanceM: number;
  readonly toleranceUsed: Readonly<{
    xyAlignmentM: number;
    stepM: number;
    gapM: number;
    parallelCrossM: number;
  }>;
  readonly conflicts: readonly string[];
  readonly diagnostics: RoofSharedEdgeIntersectionDiagnostics;
}

export interface RoofIntersectionSetDiagnostics {
  readonly isValid: boolean;
  readonly sewingLevel: RoofSeamingLevel;
  readonly sharedTopologyEdgeCount: number;
  readonly computedIntersectionCount: number;
  readonly validIntersectionCount: number;
  readonly ambiguousIntersectionCount: number;
  readonly gapCount: number;
  readonly stepCount: number;
  readonly overlapCount: number;
  readonly parallelPlaneCount: number;
  readonly unresolvedNeighborPairCount: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface RoofIntersectionSet {
  readonly schemaId: typeof ROOF_INTERSECTION_SET_SCHEMA_ID;
  readonly intersections: readonly RoofSharedEdgeIntersection[];
  readonly diagnostics: RoofIntersectionSetDiagnostics;
}

export interface ComputeRoofPlaneIntersectionsInput {
  /** Obligatoire : topologie + sommets XY (positions des `topologyVertexId`). */
  readonly document: import("./canonicalHouse3DModel").CanonicalHouseDocument;
  /** Obligatoire : arêtes partagées, `incidentPatchIds`, types officiels. */
  readonly topologyGraph: import("./roofTopologyModel").RoofTopologyGraph;
  /** Obligatoire : plans résolus par pan (`solveRoofPlanes`). */
  readonly solutionSet: import("./roofPlaneSolutionModel").RoofPlaneSolutionSet;
  /** Tolérance alignement XY projection droite ↔ extrémités arête topologique (m). */
  readonly xyAlignmentToleranceM?: number;
  /** Tolérance marche Z entre les deux plans sur l’arête (m). */
  readonly stepToleranceM?: number;
  /** Synonyme documentaire de `xyAlignmentToleranceM` pour « vide » en plan. */
  readonly gapToleranceM?: number;
  /** |n1×n2| en dessous : plans parallèles (échelle normales unitaires). */
  readonly parallelCrossTolerance?: number;
  /** Longueur 3D segment / longueur arête topologique : clipping si écart > ce seuil (m). */
  readonly segmentLengthSlackM?: number;
}

export interface ComputeRoofPlaneIntersectionsResult {
  readonly intersectionSet: RoofIntersectionSet;
}

/** Utilitaire : intersection théorique de deux plans implicites (n·p+d=0), sans clip. */
export type PlaneIntersectionRayResult =
  | {
      readonly ok: true;
      readonly anchorPoint: BuildingLocalVec3;
      readonly directionUnit: BuildingLocalVec3;
    }
  | { readonly ok: false; readonly reason: "parallel" | "coincident" | "invalid_normal" };

export function intersectImplicitPlanes(
  eq1: RoofPlaneEquation,
  eq2: RoofPlaneEquation,
  parallelCrossTol: number,
): PlaneIntersectionRayResult {
  const n1 = eq1.normal;
  const n2 = eq2.normal;
  const ux = n1.y * n2.z - n1.z * n2.y;
  const uy = n1.z * n2.x - n1.x * n2.z;
  const uz = n1.x * n2.y - n1.y * n2.x;
  const crossLen = Math.hypot(ux, uy, uz);
  if (crossLen < parallelCrossTol) {
    const dotN = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    const ddiffSame = Math.abs(eq1.d - eq2.d);
    const ddiffOpp = Math.abs(eq1.d + eq2.d);
    const planeDist = dotN >= 0 ? ddiffSame : Math.min(ddiffSame, ddiffOpp);
    if (Math.abs(dotN) > 1 - 1e-7 && planeDist < parallelCrossTol * 200) {
      return { ok: false, reason: "coincident" };
    }
    return { ok: false, reason: "parallel" };
  }
  const dx = ux / crossLen;
  const dy = uy / crossLen;
  const dz = uz / crossLen;

  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const az = Math.abs(uz);
  let p0: BuildingLocalVec3;
  if (ax >= ay && ax >= az) {
    const x = 0;
    const b1 = n1.y;
    const c1 = n1.z;
    const b2 = n2.y;
    const c2 = n2.z;
    const d1 = eq1.d;
    const d2 = eq2.d;
    const det = b1 * c2 - c1 * b2;
    if (Math.abs(det) < 1e-14) return { ok: false, reason: "invalid_normal" };
    const y = (-d1 * c2 + c1 * d2) / det;
    const z = (-b1 * d2 + d1 * b2) / det;
    p0 = { x, y, z };
  } else if (ay >= ax && ay >= az) {
    const y = 0;
    const a1 = n1.x;
    const c1 = n1.z;
    const a2 = n2.x;
    const c2 = n2.z;
    const d1 = eq1.d;
    const d2 = eq2.d;
    const det = a1 * c2 - c1 * a2;
    if (Math.abs(det) < 1e-14) return { ok: false, reason: "invalid_normal" };
    const x = (-d1 * c2 + c1 * d2) / det;
    const z = (-a1 * d2 + d1 * a2) / det;
    p0 = { x, y, z };
  } else {
    const z = 0;
    const a1 = n1.x;
    const b1 = n1.y;
    const a2 = n2.x;
    const b2 = n2.y;
    const d1 = eq1.d;
    const d2 = eq2.d;
    const det = a1 * b2 - b1 * a2;
    if (Math.abs(det) < 1e-14) return { ok: false, reason: "invalid_normal" };
    const x = (-d1 * b2 + b1 * d2) / det;
    const y = (-a1 * d2 + d1 * a2) / det;
    p0 = { x, y, z };
  }
  return { ok: true, anchorPoint: p0, directionUnit: { x: dx, y: dy, z: dz } };
}
