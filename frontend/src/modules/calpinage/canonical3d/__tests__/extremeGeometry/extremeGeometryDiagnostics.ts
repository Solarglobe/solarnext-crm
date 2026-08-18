import * as THREE from "three";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { GeometryTruthStatus } from "../../types/quality";
import {
  evaluateSolarSceneGeometryTruth,
  triangulateRoofPatchForMesh,
  type TriangulationTruthMethod,
} from "../../validation/geometricTruthStatus";
import type { RoofPlanePatch3D } from "../../types/roof-surface";

export type TriangulationMethod = TriangulationTruthMethod;

export interface PatchTriangulationAudit {
  readonly patchId: string;
  readonly method: TriangulationMethod;
  readonly fallbackReason: string | null;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly polygonAreaM2: number;
  readonly meshAreaM2: number;
  readonly areaDeltaM2: number;
  readonly areaDeltaMm2: number;
  readonly invertedTriangleCount: number;
  readonly degenerateTriangleCount: number;
  readonly triangleCentroidsOutsideCount: number;
  readonly selfIntersectionCount: number;
  readonly status: GeometryTruthStatus;
  readonly diagnostics: readonly string[];
}

export interface SceneExtremeGeometryAudit {
  readonly sceneId: string;
  readonly status: GeometryTruthStatus;
  readonly patchAudits: readonly PatchTriangulationAudit[];
  readonly pvPanelCount: number;
  readonly orphanPvPanelIds: readonly string[];
  readonly obstacleCount: number;
  readonly orphanObstacleIds: readonly string[];
  readonly sceneSignature: string;
}

function roundForSignature(value: number): number {
  return Number(value.toFixed(6));
}

export function stableSceneGeometrySignature(scene: SolarScene3D): string {
  const payload = {
    geometryTruthStatus: scene.metadata.geometryTruthStatus,
    patches: scene.roofModel.roofPlanePatches.map((p) => ({
      id: p.id,
      geometryTruthStatus: p.geometryTruthStatus,
      corners: p.cornersWorld.map((c) => [roundForSignature(c.x), roundForSignature(c.y), roundForSignature(c.z)]),
      normal: [roundForSignature(p.normal.x), roundForSignature(p.normal.y), roundForSignature(p.normal.z)],
      area: roundForSignature(p.surface.areaM2),
      localFrame: [
        roundForSignature(p.localFrame.origin.x),
        roundForSignature(p.localFrame.origin.y),
        roundForSignature(p.localFrame.origin.z),
        roundForSignature(p.localFrame.xAxis.x),
        roundForSignature(p.localFrame.xAxis.y),
        roundForSignature(p.localFrame.xAxis.z),
        roundForSignature(p.localFrame.yAxis.x),
        roundForSignature(p.localFrame.yAxis.y),
        roundForSignature(p.localFrame.yAxis.z),
      ],
    })),
    pv: scene.pvPanels.map((p) => ({
      id: p.id,
      roof: p.attachment.roofPlanePatchId,
      center: [roundForSignature(p.center3D.x), roundForSignature(p.center3D.y), roundForSignature(p.center3D.z)],
      corners: p.corners3D.map((c) => [roundForSignature(c.x), roundForSignature(c.y), roundForSignature(c.z)]),
    })),
    obstacles: scene.obstacleVolumes.map((o) => ({
      id: o.id,
      related: [...o.relatedPlanePatchIds],
      bounds: [
        roundForSignature(o.bounds.min.x),
        roundForSignature(o.bounds.min.y),
        roundForSignature(o.bounds.min.z),
        roundForSignature(o.bounds.max.x),
        roundForSignature(o.bounds.max.y),
        roundForSignature(o.bounds.max.z),
      ],
    })),
  };
  return JSON.stringify(payload);
}

export function auditPatchTriangulation(patch: RoofPlanePatch3D): PatchTriangulationAudit {
  const truth = triangulateRoofPatchForMesh(patch);
  const selfIntersectionDiagnostic = truth.diagnostics.find((d) => d.code === "POLYGON_SELF_INTERSECTION");
  const selfIntersectionCount =
    typeof selfIntersectionDiagnostic?.context?.selfIntersectionCount === "number"
      ? selfIntersectionDiagnostic.context.selfIntersectionCount
      : 0;
  return {
    patchId: patch.id,
    method: truth.method,
    fallbackReason: truth.diagnostics.find((d) => d.code.startsWith("TRIANGULATION_FALLBACK"))?.message ?? null,
    vertexCount: patch.cornersWorld.length,
    triangleCount: truth.triangleCount,
    polygonAreaM2: truth.polygonAreaM2,
    meshAreaM2: truth.meshAreaM2,
    areaDeltaM2: truth.areaDeltaM2,
    areaDeltaMm2: truth.areaDeltaM2 * 1_000_000,
    invertedTriangleCount: truth.invertedTriangleCount,
    degenerateTriangleCount: truth.degenerateTriangleCount,
    triangleCentroidsOutsideCount: truth.triangleCentroidsOutsideCount,
    selfIntersectionCount,
    status: truth.status,
    diagnostics: truth.diagnostics.map((d) => `${d.code}: ${d.message}`),
  };
}

export function auditExtremeGeometryScene(sceneId: string, scene: SolarScene3D): SceneExtremeGeometryAudit {
  const truth = evaluateSolarSceneGeometryTruth(scene);
  const patchAudits = scene.roofModel.roofPlanePatches.map(auditPatchTriangulation);
  const patchIds = new Set(scene.roofModel.roofPlanePatches.map((p) => p.id));
  const orphanPvPanelIds = scene.pvPanels
    .filter((p) => !patchIds.has(p.attachment.roofPlanePatchId))
    .map((p) => p.id);
  const orphanObstacleIds = scene.obstacleVolumes
    .filter((o) => o.relatedPlanePatchIds.some((id) => !patchIds.has(id)))
    .map((o) => o.id);

  return {
    sceneId,
    status: orphanPvPanelIds.length > 0 || orphanObstacleIds.length > 0 ? "INVALID" : truth.status,
    patchAudits,
    pvPanelCount: scene.pvPanels.length,
    orphanPvPanelIds,
    obstacleCount: scene.obstacleVolumes.length,
    orphanObstacleIds,
    sceneSignature: stableSceneGeometrySignature(scene),
  };
}

export function geometryToMeshAudit(geometry: THREE.BufferGeometry): {
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly triangleCount: number;
} {
  return {
    vertexCount: geometry.getAttribute("position")?.count ?? 0,
    indexCount: geometry.getIndex()?.count ?? 0,
    triangleCount: (geometry.getIndex()?.count ?? 0) / 3,
  };
}
