/**
 * Assemblage de `RoofRidge3D` à partir des lignes structurantes legacy et des arêtes 3D fusionnées.
 * Priorité d’annotation d’arête : ridges puis traits (une arête ne garde qu’une ridge 3D « gagnante »).
 */

import type { RoofEdge3D, RoofEdgeSemantic } from "../types/edge";
import type { GeometryProvenance } from "../types/provenance";
import type { GeometryDiagnostic } from "../types/quality";
import type { RoofRidge3D } from "../types/ridge";
import type { Vector3 } from "../types/primitives";
import type { HeightConstraintBundle, StructuralSegmentPx } from "./heightConstraints";
import type { LegacyStructuralLine2D } from "./legacyInput";
import { imagePxToWorldHorizontalM } from "./worldMapping";
import { collectEdgeIdsAlongStructuralSegmentXY, STRUCTURAL_LINE_MATCH_TOL_M } from "./structuralLines";

export interface RidgeAssemblyResult {
  readonly roofRidges: readonly RoofRidge3D[];
  readonly edgeAnnotationById: ReadonlyMap<string, { ridgeLineId: string; semantic: RoofEdgeSemantic }>;
}

function segmentForLine(
  line: LegacyStructuralLine2D,
  bundle: HeightConstraintBundle
): StructuralSegmentPx | undefined {
  const pool = line.kind === "ridge" ? bundle.ridgeSegments : bundle.traitSegments;
  return pool.find((s) => s.lineId === line.id);
}

function worldEndpointsFromSegment(
  seg: StructuralSegmentPx,
  metersPerPixel: number,
  northAngleDeg: number
): { sa: Vector3; sb: Vector3 } {
  const xy0 = imagePxToWorldHorizontalM(seg.x0Px, seg.y0Px, metersPerPixel, northAngleDeg);
  const xy1 = imagePxToWorldHorizontalM(seg.x1Px, seg.y1Px, metersPerPixel, northAngleDeg);
  return {
    sa: { x: xy0.x, y: xy0.y, z: seg.z0M },
    sb: { x: xy1.x, y: xy1.y, z: seg.z1M },
  };
}

function provenanceFromStructuralLine(ln: LegacyStructuralLine2D): GeometryProvenance {
  return ln.kind === "ridge"
    ? { source: "ridge2d", ridgeId: ln.id }
    : { source: "trait2d", traitId: ln.id };
}

function processStructuralLines(
  lines: readonly LegacyStructuralLine2D[] | undefined,
  kind: "ridge" | "trait",
  bundle: HeightConstraintBundle,
  mergedEdges: readonly RoofEdge3D[],
  vertexPositions: ReadonlyMap<string, Vector3>,
  metersPerPixel: number,
  northAngleDeg: number,
  diagnostics: GeometryDiagnostic[],
  outRidges: RoofRidge3D[],
  edgeWinners: Map<string, { ridgeLineId: string; semantic: RoofEdgeSemantic }>
): void {
  for (const ln of lines ?? []) {
    if (ln.kind !== kind) continue;
    const seg = segmentForLine(ln, bundle);
    if (!seg) {
      diagnostics.push({
        code: "STRUCTURAL_LINE_SEGMENT_MISSING",
        severity: "warning",
        message: `Ligne structurante ${ln.id} : segment introuvable après normalisation`,
        context: { lineId: ln.id },
      });
      continue;
    }
    const { sa, sb } = worldEndpointsFromSegment(seg, metersPerPixel, northAngleDeg);
    const edgeIds = collectEdgeIdsAlongStructuralSegmentXY(
      mergedEdges,
      vertexPositions,
      sa,
      sb,
      STRUCTURAL_LINE_MATCH_TOL_M
    );
    if (edgeIds.length === 0) {
      diagnostics.push({
        code: "STRUCTURAL_LINE_NO_EDGE_MATCH",
        severity: "warning",
        message: `Ligne structurante ${ln.id} : aucune arête 3D alignée en XY (tol ${STRUCTURAL_LINE_MATCH_TOL_M} m)`,
        context: { lineId: ln.id },
      });
      continue;
    }
    const ridgeId = `ridge3d-${ln.id}`;
    const structuralKind = kind === "ridge" ? "main_ridge" : "break_line";
    outRidges.push({
      id: ridgeId,
      roofEdgeIds: edgeIds,
      structuralKind,
      provenance: provenanceFromStructuralLine(ln),
    });
    const semantic: RoofEdgeSemantic =
      kind === "ridge" ? { kind: "ridge" } : { kind: "internal_split" };
    for (const eid of edgeIds) {
      if (!edgeWinners.has(eid)) {
        edgeWinners.set(eid, { ridgeLineId: ridgeId, semantic });
      }
    }
  }
}

/**
 * Construit les ridges 3D et les annotations d’arêtes (ridges d’abord, traits ensuite).
 */
export function assembleRoofRidges3DFromStructuralInput(
  ridges: readonly LegacyStructuralLine2D[] | undefined,
  traits: readonly LegacyStructuralLine2D[] | undefined,
  bundle: HeightConstraintBundle,
  mergedEdges: readonly RoofEdge3D[],
  vertexPositions: ReadonlyMap<string, Vector3>,
  metersPerPixel: number,
  northAngleDeg: number,
  diagnostics: GeometryDiagnostic[]
): RidgeAssemblyResult {
  const outRidges: RoofRidge3D[] = [];
  const edgeWinners = new Map<string, { ridgeLineId: string; semantic: RoofEdgeSemantic }>();

  processStructuralLines(
    ridges,
    "ridge",
    bundle,
    mergedEdges,
    vertexPositions,
    metersPerPixel,
    northAngleDeg,
    diagnostics,
    outRidges,
    edgeWinners
  );
  processStructuralLines(
    traits,
    "trait",
    bundle,
    mergedEdges,
    vertexPositions,
    metersPerPixel,
    northAngleDeg,
    diagnostics,
    outRidges,
    edgeWinners
  );

  return { roofRidges: outRidges, edgeAnnotationById: edgeWinners };
}
