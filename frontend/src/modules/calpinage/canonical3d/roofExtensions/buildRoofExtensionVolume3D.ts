import type { WorldPosition3D } from "../types/coordinates";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { GeometryDiagnostic, QualityBlock } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { VolumeRoofAttachment } from "../types/volume-roof-attachment";
import { projectRoofExtensionToSupportPlane } from "./projectRoofExtensionToSupportPlane";
import type { RoofExtensionWorldMapping } from "./resolveSupportPan";
import type { RoofExtensionSource2D } from "./roofExtensionSource";
import { buildDormerTopologyFromOutline } from "./buildDormerTopologyFromOutline";
import { buildRoofExtensionMiniRoofSemantics } from "./roofExtensionMiniRoofSemantics";

export interface BuildRoofExtensionVolume3DResult {
  readonly volume: RoofExtensionVolume3D | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

function meanElevation(points: readonly WorldPosition3D[]): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.z, 0) / points.length;
}

function sourceDiagnostics(source: RoofExtensionSource2D): GeometryDiagnostic[] {
  return source.warnings.map((code) => ({
    code,
    severity: code === "LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED" ? "info" : "warning",
    message:
      code === "LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED"
        ? `Extension ${source.id} : ancienne canonicalDormerGeometry ignoree, contour/ridge runtime utilises.`
        : `Extension ${source.id} : geometrie source incomplete (${code}).`,
    context: { extensionId: source.id },
  }));
}

function roofAttachment(patch: RoofPlanePatch3D): VolumeRoofAttachment {
  return {
    primaryPlanePatchId: patch.id,
    affectedPlanePatchIds: [patch.id],
    anchorKind: "anchored_single_plane",
    relationHint: "extrusion_along_pan_normal",
    extrusionChoice: "along_pan_normal",
    maxPreProjectionPlaneDistanceM: 0,
  };
}

function qualityFor(diagnostics: readonly GeometryDiagnostic[]): QualityBlock {
  if (diagnostics.some((d) => d.severity === "error")) return { confidence: "low", diagnostics };
  if (diagnostics.some((d) => d.severity === "warning")) return { confidence: "medium", diagnostics };
  return { confidence: "high", diagnostics };
}

export function buildRoofExtensionVolume3D(
  source: RoofExtensionSource2D,
  patch: RoofPlanePatch3D,
  world: RoofExtensionWorldMapping,
): BuildRoofExtensionVolume3DResult {
  const diagnostics: GeometryDiagnostic[] = sourceDiagnostics(source);
  if (source.contour.length < 3 || !source.ridge) {
    return { volume: null, diagnostics };
  }

  const projected = projectRoofExtensionToSupportPlane(source, patch, world);
  if (!projected) {
    diagnostics.push({
      code: "ROOF_EXTENSION_PROJECTION_FAILED",
      severity: "warning",
      message: `Extension ${source.id} : projection sur pan support impossible, mesh non genere.`,
      context: { extensionId: source.id, supportPanId: patch.id },
    });
    return { volume: null, diagnostics };
  }
  diagnostics.push(...projected.diagnostics);

  const mesh = buildDormerTopologyFromOutline(source, projected);
  if (!mesh) {
    diagnostics.push({
      code: "ROOF_EXTENSION_TOPOLOGY_FAILED",
      severity: "warning",
      message: `Extension ${source.id} : topologie dormer invalide, mesh non genere.`,
      context: { extensionId: source.id, supportPanId: patch.id },
    });
    return { volume: null, diagnostics };
  }

  const topologyVersion: "roof_extension_topology_v2" | "roof_extension_topology_v3" =
    mesh.meshStrategy === "hips_aware" ? "roof_extension_topology_v3" : "roof_extension_topology_v2";
  const miniRoof = buildRoofExtensionMiniRoofSemantics(source, mesh, patch.id);

  const footprintWorld = projected.contour.map((p) => p.base);
  const volume: RoofExtensionVolume3D = {
    id: source.id,
    kind: source.kind,
    structuralRole: "roof_extension",
    baseElevationM: meanElevation(footprintWorld),
    heightM: projected.maxHeightRelM,
    extrusion: {
      mode: "along_pan_normal",
      directionWorld: { ...projected.supportNormal },
    },
    footprintWorld,
    vertices: mesh.vertices,
    edges: mesh.edges,
    faces: mesh.faces,
    bounds: mesh.bounds,
    centroid: mesh.centroid,
    surfaceAreaM2: mesh.surfaceAreaM2,
    volumeM3: mesh.volumeM3,
    relatedPlanePatchIds: [patch.id],
    roofAttachment: roofAttachment(patch),
    provenance: { source: "extension2d", extensionId: source.id },
    quality: qualityFor(diagnostics),
    topology: {
      version: topologyVersion,
      meshStrategy: mesh.meshStrategy,
      source: "roofExtensions.runtime.contour_ridge",
      heightReference: "support_plane_normal",
      supportPlanePatchId: patch.id,
      supportPlaneNormal: { ...projected.supportNormal },
      ignoredLegacyCanonicalDormerGeometry: source.hadLegacyCanonicalDormerGeometry,
      sourceContourPx: source.contour.map((p) => ({
        x: p.x,
        y: p.y,
        heightRelM: p.heightRelM ?? 0,
      })),
      sourceRidgePx: {
        a: {
          x: source.ridge.a.x,
          y: source.ridge.a.y,
          heightRelM: projected.ridge.a.heightRelM,
        },
        b: {
          x: source.ridge.b.x,
          y: source.ridge.b.y,
          heightRelM: projected.ridge.b.heightRelM,
        },
      },
      ...(source.apexVertex
        ? {
            apexVertexPx: {
              id: source.apexVertex.id,
              x: source.apexVertex.x,
              y: source.apexVertex.y,
              heightRelM:
                source.apexVertex.h ??
                projected.apex?.heightRelM ??
                projected.maxHeightRelM,
            },
          }
        : {}),
      miniRoof,
    },
  };

  return { volume, diagnostics };
}
