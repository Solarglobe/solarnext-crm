/**
 * Audit : cohérence Z entre extrémités de lignes structurantes (faîtages / traits) et sommets pans 3D.
 */

import { isValidBuildingHeightM } from "../../core/heightResolver";
import type { CanonicalPan3D } from "../adapters/buildCanonicalPans3DFromRuntime";
import type { HeightStateContext } from "../../core/heightResolver";

function extractHeightStateContextFromCalpinageStateLocal(state: unknown): HeightStateContext | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  const structural = (s.structural && typeof s.structural === "object" ? s.structural : {}) as Record<
    string,
    unknown
  >;
  const contours = (Array.isArray(s.contours) ? s.contours : structural.contours) as HeightStateContext["contours"];
  const ridges = (Array.isArray(s.ridges) ? s.ridges : structural.ridges) as HeightStateContext["ridges"];
  const traits = (Array.isArray(s.traits) ? s.traits : structural.traits) as HeightStateContext["traits"];
  return { contours, ridges, traits };
}

const DEFAULT_TOL_PX = 1.5;
const Z_TOL_M = 0.05;

function nearestPanVertexZ(
  xPx: number,
  yPx: number,
  pans: readonly CanonicalPan3D[],
  tolPx: number,
): { readonly z: number; readonly d: number } | null {
  let best: { z: number; d: number } | null = null;
  for (const p of pans) {
    for (const v of p.vertices3D) {
      const d = Math.hypot(v.xPx - xPx, v.yPx - yPx);
      if (d <= tolPx && (best === null || d < best.d)) {
        best = { z: v.zWorldM, d };
      }
    }
  }
  return best;
}

/**
 * Compare les `h` stockés sur ridges/traits aux Z des pans au même pixel (diagnostic uniquement).
 */
export function auditStructuralLinesAgainstCanonicalPans(
  state: unknown,
  pans: readonly CanonicalPan3D[],
  tolPx: number = DEFAULT_TOL_PX,
): string[] {
  const warnings: string[] = [];
  if (!state || typeof state !== "object" || pans.length === 0) return warnings;

  const ctx = extractHeightStateContextFromCalpinageStateLocal(state);
  const ridges = ctx?.ridges?.filter((r) => r?.roofRole !== "chienAssis") ?? [];
  const traits = ctx?.traits?.filter((t) => t?.roofRole !== "chienAssis") ?? [];

  const checkEndpoint = (x: unknown, y: unknown, h: unknown, label: string, lineId: string): void => {
    if (typeof x !== "number" || typeof y !== "number") return;
    if (!isValidBuildingHeightM(h)) return;
    const near = nearestPanVertexZ(x, y, pans, tolPx);
    if (!near) {
      warnings.push(`STRUCTURAL_POINT_UNRESOLVED:${label}:${lineId} @(${x.toFixed(1)},${y.toFixed(1)})px`);
      return;
    }
    if (Math.abs(near.z - h) > Z_TOL_M) {
      warnings.push(
        `RIDGE_Z_INCONSISTENT:${label}:${lineId} structH=${h.toFixed(3)}m panZ=${near.z.toFixed(3)}m Δ=${Math.abs(near.z - h).toFixed(3)}m`,
      );
    }
  };

  for (const r of ridges) {
    const id = typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : "ridge";
    const a = (r as { a?: { x?: number; y?: number; h?: number } }).a;
    const b = (r as { b?: { x?: number; y?: number; h?: number } }).b;
    if (a) checkEndpoint(a.x, a.y, a.h, "ridgeA", id);
    if (b) checkEndpoint(b.x, b.y, b.h, "ridgeB", id);
  }

  for (const t of traits) {
    const id = typeof (t as { id?: unknown }).id === "string" ? (t as { id: string }).id : "trait";
    const a = (t as { a?: { x?: number; y?: number; h?: number } }).a;
    const b = (t as { b?: { x?: number; y?: number; h?: number } }).b;
    if (a) checkEndpoint(a.x, a.y, a.h, "traitA", id);
    if (b) checkEndpoint(b.x, b.y, b.h, "traitB", id);
  }

  return warnings;
}
