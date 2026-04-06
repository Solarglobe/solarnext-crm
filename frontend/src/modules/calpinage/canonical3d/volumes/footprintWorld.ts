/**
 * Normalisation d’empreintes vers un polygone horizontal en WORLD (Z uniforme).
 */

import type { WorldPosition3D } from "../types/coordinates";
import type { LegacyVolumeFootprintSource, VolumeImagePoint2D } from "./volumeInput";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";

function stripClosingDuplicateWorld(pts: readonly WorldPosition3D[]): readonly WorldPosition3D[] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.x === b.x && a.y === b.y && a.z === b.z) return pts.slice(0, -1);
  return pts;
}

export interface FootprintWorldResult {
  readonly footprintHorizontal: readonly WorldPosition3D[];
  readonly baseElevationM: number;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

function meanZ(pts: readonly WorldPosition3D[]): number {
  let s = 0;
  for (const p of pts) s += p.z;
  return s / pts.length;
}

function stripClosingDuplicate(pts: readonly VolumeImagePoint2D[]): readonly VolumeImagePoint2D[] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.xPx === b.xPx && a.yPx === b.yPx) return pts.slice(0, -1);
  return pts;
}

/**
 * Produit un polygone horizontal : tous les Z = baseElevationM (moyenne si mode world avec Z variables).
 */
export function resolveFootprintHorizontalWorld(
  footprint: LegacyVolumeFootprintSource,
  defaultBaseZ: number
): FootprintWorldResult {
  const diagnostics: { code: string; message: string }[] = [];
  if (footprint.mode === "world") {
    const raw = stripClosingDuplicateWorld(footprint.footprintWorld);
    if (raw.length < 3) {
      return { footprintHorizontal: [], baseElevationM: defaultBaseZ, diagnostics: [{ code: "FOOTPRINT_TOO_SMALL", message: "<3 points" }] };
    }
    const mz = meanZ(raw);
    const spread = Math.max(...raw.map((p) => Math.abs(p.z - mz)));
    if (spread > 0.02) {
      diagnostics.push({
        code: "FOOTPRINT_Z_SPREAD_SNAPPED",
        message: `Empreinte WORLD : écart Z max ${spread.toFixed(4)} m — aplani sur Z=moyenne`,
      });
    }
    const footprintHorizontal = raw.map((p) => ({ x: p.x, y: p.y, z: mz }));
    return { footprintHorizontal, baseElevationM: mz, diagnostics };
  }

  const poly = stripClosingDuplicate(footprint.polygonPx);
  if (poly.length < 3) {
    return { footprintHorizontal: [], baseElevationM: footprint.baseElevationM, diagnostics: [{ code: "FOOTPRINT_TOO_SMALL", message: "<3 points" }] };
  }
  const z = footprint.baseElevationM;
  const out: WorldPosition3D[] = [];
  for (const p of poly) {
    const xy = imagePxToWorldHorizontalM(p.xPx, p.yPx, footprint.metersPerPixel, footprint.northAngleDeg);
    out.push({ x: xy.x, y: xy.y, z });
  }
  return { footprintHorizontal: out, baseElevationM: z, diagnostics };
}
