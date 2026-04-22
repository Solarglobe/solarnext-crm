/**
 * Maison 3D minimale officielle : repli déterministe quand seul le contour bâti est exploitable.
 * Toit plat horizontal à hauteur standard — prism vertical pour murs + sol (volume obstacle).
 *
 * Stratégie produit : toit plat (un seul pan horizontal) + prisme monde +Z — robuste, toujours générable,
 * pas d’hypothèse sur les faîtages ni pans réels.
 */

import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { LegacyImagePoint2D, LegacyPanInput, LegacyRoofGeometryInput } from "../builder/legacyInput";
import type { CanonicalPan3D, CanonicalPanVertex3D } from "../adapters/buildCanonicalPans3DFromRuntime";
import { computeStablePan3DId } from "../adapters/buildCanonicalPans3DFromRuntime";
import type { CanonicalScene3DInput } from "../adapters/buildCanonicalScene3DInput";
import {
  mapStructuralRidges,
  mapStructuralTraits,
} from "../../integration/mapCalpinageToCanonicalNearShading";

export const FALLBACK_MINIMAL_WALL_HEIGHT_M = 2.8;

export const FALLBACK_BUILDING_PAN_ID = "fallback-building-footprint";

export type RoofGeometrySource = "REAL_ROOF_PANS" | "FALLBACK_BUILDING_CONTOUR";

export type MinimalHouse3DBuildDiagnostics = {
  readonly canBuildMinimalHouse3D: boolean;
  readonly hasBuildingContour: boolean;
  readonly hasRealRoofPans: boolean;
  readonly roofGeometrySource: RoofGeometrySource;
  readonly fallbackReason: string | null;
};

function filterChienAssis<T extends { roofRole?: unknown }>(items: readonly T[]): T[] {
  return items.filter((x) => (x.roofRole as string | undefined) !== "chienAssis");
}

function stripClosingDuplicate2D(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a && b && a.x === b.x && a.y === b.y) return pts.slice(0, -1);
  return pts;
}

/**
 * true si le runtime expose au moins une entrée dans state.pans (prioritaire) ou roof.roofPans (miroir).
 */
export function calpinageStateHasRoofPanArrays(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  const pans = s.pans;
  if (Array.isArray(pans) && pans.length > 0) return true;
  const roof = s.roof;
  if (roof && typeof roof === "object") {
    const rp = (roof as Record<string, unknown>).roofPans;
    if (Array.isArray(rp) && rp.length > 0) return true;
  }
  return false;
}

/** `state.pans` absent ou vide alors que le miroir `roof.roofPans` contient des entrées (interdit en produit strict). */
export function calpinageRoofMirrorHasPansButStatePansEmpty(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  const live = s.pans;
  if (Array.isArray(live) && live.length > 0) return false;
  const roof = s.roof;
  if (roof && typeof roof === "object") {
    const rp = (roof as Record<string, unknown>).roofPans;
    return Array.isArray(rp) && rp.length > 0;
  }
  return false;
}

/** Intent toit : au moins une entrée dans `state.pans` OU données uniquement dans le miroir. */
export function calpinageProductRoofPanIntent(state: unknown): boolean {
  return calpinageStateHasRoofPanArrays(state);
}

/**
 * Premier contour bâti fermé exploitable (même logique métier que le parseur document, avec closed omis = fermé).
 *
 * Rôles acceptés : `contour` (outil contour bâti), `roof`, chaîne vide (live sans roofRole), `main` (reload legacy
 * `loadCalpinageState` avant fix — à garder pour JSON déjà persistés). `chienAssis` est filtré en amont.
 */
export function extractBuildingContourPolygonPx(
  state: unknown,
): { readonly points: readonly { readonly x: number; readonly y: number }[]; readonly contourIndex: number } | null {
  if (!state || typeof state !== "object") return null;
  const contours = (state as Record<string, unknown>).contours;
  if (!Array.isArray(contours)) return null;
  const list = filterChienAssis(contours as { roofRole?: string }[]);
  for (let ci = 0; ci < list.length; ci++) {
    const c = list[ci] as Record<string, unknown>;
    const ptsRaw = c.points;
    if (!Array.isArray(ptsRaw) || ptsRaw.length < 3) continue;
    const role = typeof c.roofRole === "string" ? c.roofRole : "";
    const isBuildingFootprintRole =
      role === "contour" || role === "roof" || role === "" || role === "main";
    if (!isBuildingFootprintRole) continue;
    const closedExplicit = c.closed;
    const treatClosed = closedExplicit === true || closedExplicit === undefined;
    if (!treatClosed) continue;
    const poly: { x: number; y: number }[] = [];
    let ok = true;
    for (const p of ptsRaw) {
      if (!p || typeof p !== "object") {
        ok = false;
        break;
      }
      const pr = p as Record<string, unknown>;
      const x = typeof pr.x === "number" && Number.isFinite(pr.x) ? pr.x : NaN;
      const y = typeof pr.y === "number" && Number.isFinite(pr.y) ? pr.y : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        ok = false;
        break;
      }
      poly.push({ x, y });
    }
    if (!ok) continue;
    const stripped = stripClosingDuplicate2D(poly);
    if (stripped.length >= 3) {
      return { points: stripped, contourIndex: ci };
    }
  }
  return null;
}

function polygonArea2DPx(pts: ReadonlyArray<{ x: number; y: number }>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return Math.abs(s) * 0.5;
}

function centroid2D(pts: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const n = pts.length;
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

/**
 * Pan canonique 3D : toit plat horizontal à z = wallHeightM (côté absolu runtime), empreinte = contour px.
 */
export function buildFallbackCanonicalPan3DFromContourPx(args: {
  readonly contourPx: readonly { readonly x: number; readonly y: number }[];
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly wallHeightM?: number;
}): CanonicalPan3D {
  const wallH = typeof args.wallHeightM === "number" && Number.isFinite(args.wallHeightM) && args.wallHeightM > 0
    ? args.wallHeightM
    : FALLBACK_MINIMAL_WALL_HEIGHT_M;
  const poly = [...args.contourPx];
  const panId = FALLBACK_BUILDING_PAN_ID;
  const stableId = computeStablePan3DId(panId, poly);
  const area2d = polygonArea2DPx(poly);
  const centroidPx = centroid2D(poly);
  const mpp = args.metersPerPixel;
  const north = args.northAngleDeg;

  const vertices3D: CanonicalPanVertex3D[] = poly.map((p, vi) => {
    const xyW = imagePxToWorldHorizontalM(p.x, p.y, mpp, north);
    return {
      vertexId: `${stableId}:v${vi}`,
      xPx: p.x,
      yPx: p.y,
      xWorldM: xyW.x,
      yWorldM: xyW.y,
      zWorldM: wallH,
      heightM: wallH,
      source: "fallback_building_contour_roof",
      confidence: 1,
    };
  });

  const nVert = vertices3D.length;
  const boundaryEdgesWorld = [];
  for (let ei = 0; ei < nVert; ei++) {
    const ej = (ei + 1) % nVert;
    const a = vertices3D[ei]!;
    const b = vertices3D[ej]!;
    boundaryEdgesWorld.push({
      i0: ei,
      i1: ej,
      start: { x: a.xWorldM, y: a.yWorldM, z: a.zWorldM },
      end: { x: b.xWorldM, y: b.yWorldM, z: b.zWorldM },
    });
  }

  return {
    panId,
    stableId,
    points2D: poly.map((p) => ({ x: p.x, y: p.y })),
    vertices3D,
    centroid2D: centroidPx,
    centroid3D: {
      xWorldM: vertices3D.reduce((s, v) => s + v.xWorldM, 0) / Math.max(1, nVert),
      yWorldM: vertices3D.reduce((s, v) => s + v.yWorldM, 0) / Math.max(1, nVert),
      zWorldM: wallH,
    },
    normal: { x: 0, y: 0, z: 1 },
    slopeDeg: 0,
    azimuthDeg: null,
    area2DPx: area2d > 0 ? area2d : null,
    areaPlanM2: null,
    area3DM2: null,
    roofKind: "fallback_flat",
    boundaryEdgesWorld,
    diagnostics: {
      zSourceSummary: ["fallback_building_contour_roof"],
      confidenceMin: 1,
      confidenceAvg: 1,
      isFlatLike: true,
      isDegenerate: nVert < 3 || area2d < 1e-9,
      warnings: [],
      zRangeM: 0,
      allHeightsEqual: true,
      usedFallbackForAllVertices: true,
      insufficientHeightSignal: false,
      heterogeneousZSources: false,
      planeResidualRmsM: 0,
      inclinedRoofGeometryTruthful: false,
    },
  };
}

/**
 * Legacy pour `buildRoofModel3DFromLegacyGeometry` à partir d’une scène canonique déjà peuplée (pans réels ou fallback).
 */
export function legacyRoofGeometryInputFromCanonicalScenePans(
  scene: CanonicalScene3DInput,
  structural:
    | { readonly ridges?: readonly unknown[]; readonly traits?: readonly unknown[] }
    | null
    | undefined,
  defaultHeightM: number,
): LegacyRoofGeometryInput | null {
  const pansCanon = scene.roof.pans;
  if (pansCanon.length === 0) return null;
  const w = scene.world;
  if (typeof w.metersPerPixel !== "number" || !Number.isFinite(w.metersPerPixel) || w.metersPerPixel <= 0) {
    return null;
  }
  if (typeof w.northAngleDeg !== "number" || !Number.isFinite(w.northAngleDeg)) return null;

  const pans: LegacyPanInput[] = pansCanon.map((p, i) => {
    const polygonPx: LegacyImagePoint2D[] = p.vertices3D.map((v) => {
      const base = { xPx: v.xPx, yPx: v.yPx } as LegacyImagePoint2D;
      if (typeof v.heightM === "number" && Number.isFinite(v.heightM)) {
        return { ...base, heightM: v.heightM };
      }
      return base;
    });
    return {
      id: p.panId,
      sourceIndex: i,
      polygonPx,
    };
  });

  const ridges = mapStructuralRidges(structural?.ridges);
  const traits = mapStructuralTraits(structural?.traits);

  return {
    metersPerPixel: w.metersPerPixel,
    northAngleDeg: w.northAngleDeg,
    defaultHeightM,
    pans,
    ...(ridges.length > 0 ? { ridges } : {}),
    ...(traits.length > 0 ? { traits } : {}),
  };
}

export function computeMinimalHouse3DEligibility(args: {
  readonly state: unknown;
  readonly worldResolved: boolean;
}): Pick<MinimalHouse3DBuildDiagnostics, "hasBuildingContour" | "hasRealRoofPans" | "canBuildMinimalHouse3D"> {
  const hasReal = calpinageStateHasRoofPanArrays(args.state);
  const contour = extractBuildingContourPolygonPx(args.state);
  const hasBuildingContour = contour != null;
  const canBuildMinimalHouse3D = args.worldResolved && hasBuildingContour;
  return { hasBuildingContour, hasRealRoofPans: hasReal, canBuildMinimalHouse3D };
}
