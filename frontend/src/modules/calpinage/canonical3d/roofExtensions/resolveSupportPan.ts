import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofExtensionSource2D } from "./roofExtensionSource";

export interface RoofExtensionWorldMapping {
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
}

export interface ResolveSupportPanResult {
  readonly patch: RoofPlanePatch3D | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

function centroid2D(points: readonly { readonly x: number; readonly y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  const k = Math.max(1, points.length);
  return { x: x / k, y: y / k };
}

function pointInPolygonXY(
  point: { readonly x: number; readonly y: number },
  polygon: readonly { readonly x: number; readonly y: number }[],
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const crosses =
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function horizontalCentroidPatch(patch: RoofPlanePatch3D): { x: number; y: number } {
  if (patch.centroid && Number.isFinite(patch.centroid.x) && Number.isFinite(patch.centroid.y)) {
    return { x: patch.centroid.x, y: patch.centroid.y };
  }
  let x = 0;
  let y = 0;
  for (const p of patch.cornersWorld) {
    x += p.x;
    y += p.y;
  }
  const k = Math.max(1, patch.cornersWorld.length);
  return { x: x / k, y: y / k };
}

function nearestPatchByCentroid(
  point: { readonly x: number; readonly y: number },
  patches: readonly RoofPlanePatch3D[],
): RoofPlanePatch3D | null {
  let best: RoofPlanePatch3D | null = null;
  let bestDist = Infinity;
  for (const patch of patches) {
    const c = horizontalCentroidPatch(patch);
    const d = Math.hypot(point.x - c.x, point.y - c.y);
    if (d < bestDist) {
      bestDist = d;
      best = patch;
    }
  }
  return best;
}

export function resolveSupportPanForRoofExtension(
  source: RoofExtensionSource2D,
  patches: readonly RoofPlanePatch3D[],
  world: RoofExtensionWorldMapping,
): ResolveSupportPanResult {
  const diagnostics: GeometryDiagnostic[] = [];
  if (patches.length === 0) {
    return {
      patch: null,
      diagnostics: [{
        code: "ROOF_EXTENSION_SUPPORT_NO_PATCHES",
        severity: "warning",
        message: `Extension ${source.id} : aucun pan support disponible.`,
        context: { extensionId: source.id },
      }],
    };
  }

  if (source.supportPanId) {
    const explicit = patches.find((p) => String(p.id) === source.supportPanId) ?? null;
    if (explicit) {
      diagnostics.push({
        code: "ROOF_EXTENSION_SUPPORT_EXPLICIT",
        severity: "info",
        message: `Extension ${source.id} : pan support resolu par id explicite.`,
        context: { extensionId: source.id, supportPanId: explicit.id },
      });
      return { patch: explicit, diagnostics };
    }
    diagnostics.push({
      code: "ROOF_EXTENSION_SUPPORT_EXPLICIT_NOT_FOUND",
      severity: "warning",
      message: `Extension ${source.id} : pan support explicite introuvable, resolution spatiale tentee.`,
      context: { extensionId: source.id, supportPanId: source.supportPanId },
    });
  }

  const cImg = centroid2D(source.contour);
  const cWorld = imagePxToWorldHorizontalM(cImg.x, cImg.y, world.metersPerPixel, world.northAngleDeg);
  const containing = patches.filter((patch) => pointInPolygonXY(cWorld, patch.cornersWorld));
  if (containing.length === 1) {
    diagnostics.push({
      code: "ROOF_EXTENSION_SUPPORT_CONTAINING_PATCH",
      severity: "info",
      message: `Extension ${source.id} : pan support resolu par inclusion du centroide.`,
      context: { extensionId: source.id, supportPanId: containing[0]!.id },
    });
    return { patch: containing[0]!, diagnostics };
  }
  if (containing.length > 1) {
    const nearestContaining = nearestPatchByCentroid(cWorld, containing);
    diagnostics.push({
      code: "ROOF_EXTENSION_SUPPORT_MULTI_PATCH_NEAREST",
      severity: "warning",
      message: `Extension ${source.id} : plusieurs pans contiennent le centroide, choix du plus proche.`,
      context: { extensionId: source.id, supportPanId: nearestContaining?.id ?? "" },
    });
    return { patch: nearestContaining, diagnostics };
  }

  const fallback = nearestPatchByCentroid(cWorld, patches);
  if (fallback) {
    diagnostics.push({
      code: "ROOF_EXTENSION_SUPPORT_NEAREST_FALLBACK",
      severity: "warning",
      message: `Extension ${source.id} : aucun pan ne contient le centroide, choix du pan le plus proche.`,
      context: { extensionId: source.id, supportPanId: fallback.id },
    });
  }
  return { patch: fallback, diagnostics };
}
