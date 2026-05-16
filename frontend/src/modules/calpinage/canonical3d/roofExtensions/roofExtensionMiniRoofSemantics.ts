import type {
  RoofExtensionMiniRoofEdgeRole,
  RoofExtensionMiniRoofSemantics,
} from "../types/roof-extension-volume";
import type { DormerTopologyMesh } from "./buildDormerTopologyFromOutline";
import type { RoofExtensionSource2D } from "./roofExtensionSource";

function parseIndexedId(id: string, marker: string): number | null {
  const markerAt = id.lastIndexOf(marker);
  if (markerAt < 0) return null;
  const raw = id.slice(markerAt + marker.length).split(":")[0];
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function segmentParallelScore(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  ridgeA: { readonly x: number; readonly y: number },
  ridgeB: { readonly x: number; readonly y: number },
): number {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const rx = ridgeB.x - ridgeA.x;
  const ry = ridgeB.y - ridgeA.y;
  const sl = Math.hypot(sx, sy);
  const rl = Math.hypot(rx, ry);
  if (sl <= 1e-9 || rl <= 1e-9) return 0;
  return Math.abs((sx * rx + sy * ry) / (sl * rl));
}

function wallRoleForFace(source: RoofExtensionSource2D, faceId: string): "cheek_wall" | "front_wall" | "rear_wall" {
  const index = parseIndexedId(faceId, ":face:wall:");
  const ridge = source.ridge;
  if (index == null || !ridge || source.contour.length < 2) return "cheek_wall";
  const a = source.contour[index % source.contour.length]!;
  const b = source.contour[(index + 1) % source.contour.length]!;
  const parallel = segmentParallelScore(a, b, ridge.a, ridge.b);
  if (parallel < 0.78) return "cheek_wall";

  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  const rx = ridge.b.x - ridge.a.x;
  const ry = ridge.b.y - ridge.a.y;
  const side = rx * (my - ridge.a.y) - ry * (mx - ridge.a.x);
  return side >= 0 ? "front_wall" : "rear_wall";
}

function edgeRolesForId(edgeId: string): readonly RoofExtensionMiniRoofEdgeRole[] {
  if (edgeId.includes(":edge:ridge")) return ["ridge"];
  if (edgeId.includes(":edge:hip:")) return ["hip"];
  if (edgeId.includes(":edge:base:")) return ["support_seam", "base_keepout"];
  if (edgeId.includes(":edge:outline:")) return ["mini_roof_eave"];
  if (edgeId.includes(":edge:lateral:")) return ["side_wall_edge"];
  return ["unknown"];
}

export function buildRoofExtensionMiniRoofSemantics(
  source: RoofExtensionSource2D,
  mesh: DormerTopologyMesh,
  supportPlanePatchId: string,
): RoofExtensionMiniRoofSemantics {
  const faceRoles = mesh.faces.map((face) => {
    if (face.id.includes(":face:base")) {
      return { faceId: face.id, role: "support_footprint" as const };
    }
    if (face.id.includes(":face:wall:")) {
      return { faceId: face.id, role: wallRoleForFace(source, face.id) };
    }
    if (face.id.includes(":face:roof:ridge:")) {
      return { faceId: face.id, role: "ridge_cap" as const };
    }
    if (face.id.includes(":face:roof:")) {
      return { faceId: face.id, role: "mini_roof_plane" as const };
    }
    return { faceId: face.id, role: "unknown" as const };
  });

  const edgeRoles = mesh.edges.map((edge) => ({
    edgeId: edge.id,
    roles: edgeRolesForId(edge.id),
  }));

  const hasCheeks =
    faceRoles.some((x) => x.role === "cheek_wall") ||
    mesh.faces.some((face) => face.id.includes(":face:roof:left:") || face.id.includes(":face:roof:right:"));
  const hasRidge = edgeRoles.some((x) => x.roles.includes("ridge"));
  const hasMiniRoofPlanes = faceRoles.some((x) => x.role === "mini_roof_plane" || x.role === "ridge_cap");
  const hasSupportSeam = edgeRoles.some((x) => x.roles.includes("support_seam"));
  const diagnostics: string[] = [];
  if (!hasCheeks) diagnostics.push("MINI_ROOF_CHEEKS_NOT_EXPLICIT");
  if (!hasRidge) diagnostics.push("MINI_ROOF_RIDGE_NOT_EXPLICIT");
  if (!hasMiniRoofPlanes) diagnostics.push("MINI_ROOF_PLANES_NOT_EXPLICIT");
  if (!hasSupportSeam) diagnostics.push("MINI_ROOF_SUPPORT_SEAM_NOT_EXPLICIT");

  return {
    version: "roof_extension_mini_roof_semantics_v1",
    hasCheeks,
    hasRidge,
    hasMiniRoofPlanes,
    hasSupportSeam,
    faceRoles,
    edgeRoles,
    keepout: {
      source: "footprint",
      footprintWorldVertexIds: mesh.vertices
        .filter((vertex) => vertex.id.includes(":base:"))
        .map((vertex) => vertex.id),
      supportPlanePatchId,
    },
    diagnostics,
  };
}
