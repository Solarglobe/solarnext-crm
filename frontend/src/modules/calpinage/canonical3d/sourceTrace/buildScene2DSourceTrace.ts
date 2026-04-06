/**
 * Construction d’une trace source 2D officielle — légère, sans copier tout le state calpinage.
 * Utilisée par le pipeline runtime → `SolarScene3D` pour audit fidélité.
 */

import type { CanonicalScene3DInput } from "../adapters/buildCanonicalScene3DInput";
import type { Scene2DSourceTrace } from "../types/scene2d3dCoherence";

const TRACE_SCHEMA = "scene-2d-source-trace-v1" as const;

function polygonArea2DPx(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return Math.abs(s) * 0.5;
}

function bbox2D(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Extrait le premier contour « toiture » exploitable depuis `runtime.contours` (forme calpinage usuelle).
 */
function extractRoofOutlineContourPx(runtime: unknown): ReadonlyArray<{ x: number; y: number }> | undefined {
  if (!runtime || typeof runtime !== "object") return undefined;
  const contours = (runtime as Record<string, unknown>).contours;
  if (!Array.isArray(contours)) return undefined;
  for (const c of contours) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const role = String(o.roofRole ?? "");
    if (role !== "contour" && role !== "roof") continue;
    const pts = o.points as ReadonlyArray<{ x?: number; y?: number }> | undefined;
    if (!Array.isArray(pts) || pts.length < 3) continue;
    const out: { x: number; y: number }[] = [];
    for (const p of pts) {
      const x = typeof p.x === "number" ? p.x : NaN;
      const y = typeof p.y === "number" ? p.y : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      out.push({ x, y });
    }
    return out;
  }
  return undefined;
}

export type BuildScene2DSourceTraceInput = {
  readonly runtime: unknown;
  readonly canonicalScene: CanonicalScene3DInput;
  /** Ids `roofPlanePatch.id` issus du builder toiture legacy (chemin A). */
  readonly roofPlanePatchIds: readonly string[];
};

/**
 * Assemble la trace minimale pour la scène 3D : ids source + métriques 2D optionnelles + alignement attendu patches.
 */
export function buildScene2DSourceTraceFromCalpinage(input: BuildScene2DSourceTraceInput): Scene2DSourceTrace {
  const { canonicalScene, roofPlanePatchIds, runtime } = input;

  const sourcePanIds = canonicalScene.roof.pans.map((p) => String(p.panId));
  const sourceObstacleIds = canonicalScene.obstacles.items.map((o) => String(o.obstacleId));
  const sourcePanelIds = canonicalScene.panels.items.map((p) => String(p.id));

  const contourPx = extractRoofOutlineContourPx(runtime);
  let roofOutlineArea2DPx: number | undefined;
  let roofOutlineBBox2D:
    | { minX: number; minY: number; maxX: number; maxY: number }
    | undefined;
  if (contourPx && contourPx.length >= 3) {
    roofOutlineArea2DPx = polygonArea2DPx(contourPx);
    roofOutlineBBox2D = bbox2D(contourPx);
  }

  return {
    schemaVersion: TRACE_SCHEMA,
    ...(contourPx && contourPx.length >= 3
      ? {
          roofOutline2D: {
            contourPx: [...contourPx],
            vertexCount: contourPx.length,
          },
        }
      : {}),
    sourcePanIds: [...sourcePanIds],
    sourceObstacleIds: [...sourceObstacleIds],
    sourcePanelIds: [...sourcePanelIds],
    expectedRoofPlanePatchIds: [...roofPlanePatchIds.map(String)],
    metrics: {
      ...(typeof roofOutlineArea2DPx === "number" && roofOutlineArea2DPx > 0
        ? { roofOutlineArea2DPx }
        : {}),
      ...(roofOutlineBBox2D != null ? { roofOutlineBBox2D } : {}),
      sourcePanCount: sourcePanIds.length,
      sourceObstacleCount: sourceObstacleIds.length,
      sourcePanelCount: sourcePanelIds.length,
    },
  };
}
