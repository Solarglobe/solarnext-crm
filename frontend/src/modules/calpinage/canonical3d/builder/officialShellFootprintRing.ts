/**
 * Niveau 1 — emprise **brute** du shell : contour bâti px→monde (option A).
 *
 * `buildBuildingShell3DFromCalpinageRuntime` utilise cet anneau **tel quel** en XY pour l’extrusion (voir commentaire
 * dans ce fichier) ; le Z toit est échantillonné par sommet sans recalage XY.
 */

import { extractBuildingContourPolygonPx } from "../fallback/fallbackMinimalHouse3D";
import { imagePxToWorldHorizontalM } from "./worldMapping";
import type { BuildingShellContourSource } from "../types/building-shell-3d";
import type { RoofPlanePatch3D } from "../types/roof-surface";

function shoelaceSignedAreaXY(pts: readonly { x: number; y: number }[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return s * 0.5;
}

function resolveContourPolygonPx(runtime: unknown): {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly source: BuildingShellContourSource;
} | null {
  const fromState = extractBuildingContourPolygonPx(runtime);
  if (fromState) {
    return { points: fromState.points, source: "CALPINAGE_STATE.contours" };
  }
  if (!runtime || typeof runtime !== "object") return null;
  const roof = (runtime as Record<string, unknown>).roof;
  if (roof && typeof roof === "object") {
    const cb = (roof as Record<string, unknown>).contoursBati;
    if (Array.isArray(cb) && cb.length > 0) {
      const nested = extractBuildingContourPolygonPx({ contours: cb });
      if (nested) {
        return { points: nested.points, source: "roof.contoursBati" };
      }
    }
  }
  return null;
}

export type OfficialShellFootprintRingWorld = {
  readonly ringXY: readonly { readonly x: number; readonly y: number }[];
  readonly contourSource: BuildingShellContourSource;
};

/**
 * Anneau fermé XY (m) pour la couronne du shell : **uniquement** contour bâti px→monde (option A produit).
 * @returns null si pas de contour fermé exploitable (≥ 3 points).
 */
export function resolveOfficialShellFootprintRingWorld(args: {
  readonly runtime: unknown;
  /** Conservé pour signature stable ; l’emprise ne dérive plus des patches (option A). */
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
}): OfficialShellFootprintRingWorld | null {
  const { runtime, roofPlanePatches: _patches, metersPerPixel, northAngleDeg } = args;
  void _patches;

  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  if (!Number.isFinite(northAngleDeg)) return null;

  const contourPx = resolveContourPolygonPx(runtime);
  if (!contourPx || contourPx.points.length < 3) return null;

  const ring = [...contourPx.points];
  const worldXY = ring.map((p) => imagePxToWorldHorizontalM(p.x, p.y, metersPerPixel, northAngleDeg));
  if (shoelaceSignedAreaXY(worldXY) < 0) {
    worldXY.reverse();
  }
  return { ringXY: worldXY, contourSource: contourPx.source };
}
