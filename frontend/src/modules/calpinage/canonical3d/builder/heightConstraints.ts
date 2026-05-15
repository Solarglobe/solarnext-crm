/**
 * Résolution des hauteurs Z avec hiérarchie de confiance explicite (traçabilité).
 *
 * Priorité décroissante (documentée) :
 * 1. Sommet polygone pan avec heightM explicite
 * 2. Extrémité de ligne structurante « ridge » (snap px)
 * 3. Extrémité de ligne structurante « trait » (snap px)
 * 4. Interpolation le long d’un segment ridge puis trait (projection image px)
 * 5. Moyenne des hauteurs explicites sur le pan courant (sinon défaut global du pan)
 * 6. defaultHeightM global
 */

import type { LegacyImagePoint2D, LegacyRoofGeometryInput, LegacyStructuralLine2D } from "./legacyInput";
import {
  PHASE2_IMAGE_SNAP_PX_FOR_HEIGHT,
  PHASE2_ON_SEGMENT_TOL_PX_FOR_HEIGHT,
} from "../../phase2GeometryConstants";
import {
  isRoofZPipelineDevTraceEnabled,
  roofZTraceRecordInitial,
  type RoofZPipelineDevCornerCtx,
} from "./roofZPipelineDevTrace";

/** Source pour audit / diagnostics. */
export type HeightResolutionSource =
  | "explicit_polygon_vertex"
  | "structural_ridge_endpoint"
  | "structural_trait_endpoint"
  | "structural_line_interpolated_ridge"
  | "structural_line_interpolated_trait"
  | "slope_azimuth_anchor"
  | "pan_local_mean"
  | "default_global";

export interface HeightResolutionTrace {
  readonly source: HeightResolutionSource;
  readonly tier: "high" | "medium" | "low";
}

/**
 * Poids pour fusionner le Z de plusieurs coins candidats (unification inter-pans).
 * Les sources « faîtage » priment sur les moyennes pan / défaut.
 */
export function structuralHeightUnifyWeight(trace: HeightResolutionTrace): number {
  switch (trace.source) {
    case "structural_ridge_endpoint":
    case "structural_line_interpolated_ridge":
      return 100;
    case "structural_trait_endpoint":
    case "structural_line_interpolated_trait":
      return 40;
    case "slope_azimuth_anchor":
      return 30;
    case "explicit_polygon_vertex":
      return 25;
    case "pan_local_mean":
      return 5;
    case "default_global":
      return 1;
    default:
      return 1;
  }
}

export interface StructuralSegmentPx {
  readonly lineId: string;
  readonly x0Px: number;
  readonly y0Px: number;
  readonly x1Px: number;
  readonly y1Px: number;
  readonly z0M: number;
  readonly z1M: number;
}

/** Aligné Phase 2 legacy (voir `phase2GeometryConstants.ts`). */
const PX_SNAP = PHASE2_IMAGE_SNAP_PX_FOR_HEIGHT;
const ON_SEGMENT_TOL_PX = PHASE2_ON_SEGMENT_TOL_PX_FOR_HEIGHT;

export function dist2(px: number, py: number, qx: number, qy: number): number {
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

/** Projection paramétrique t ∈ [0,1] du point sur le segment AB (image px). */
export function projectParamOnSegmentPx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { t: number; distSq: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-12) return { t: 0, distSq: dist2(px, py, ax, ay) };
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return { t, distSq: dist2(px, py, qx, qy) };
}

export interface StructuralEndpointPx {
  readonly xPx: number;
  readonly yPx: number;
  readonly zM: number;
  readonly source: "structural_ridge_endpoint" | "structural_trait_endpoint";
}

function stripClosingDuplicate(pts: readonly LegacyImagePoint2D[]): readonly LegacyImagePoint2D[] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.xPx === b.xPx && a.yPx === b.yPx) return pts.slice(0, -1);
  return pts;
}

function resolveZForImagePoint(pt: LegacyImagePoint2D, globalExplicitMeanM: number | null, defaultHeightM: number): number {
  if (typeof pt.heightM === "number" && Number.isFinite(pt.heightM)) return pt.heightM;
  if (globalExplicitMeanM != null) return globalExplicitMeanM;
  return defaultHeightM;
}

/**
 * Segments image + Z aux extrémités (pour interpolation et contraintes).
 */
export function legacyStructuralLinesToSegments(
  lines: readonly LegacyStructuralLine2D[] | undefined,
  kind: "ridge" | "trait",
  defaultHeightM: number,
  globalExplicitMeanM: number | null
): StructuralSegmentPx[] {
  if (!lines?.length) return [];
  const out: StructuralSegmentPx[] = [];
  for (const ln of lines) {
    if (ln.kind !== kind) continue;
    const z0 = resolveZForImagePoint(ln.a, globalExplicitMeanM, defaultHeightM);
    const z1 = resolveZForImagePoint(ln.b, globalExplicitMeanM, defaultHeightM);
    out.push({
      lineId: ln.id,
      x0Px: ln.a.xPx,
      y0Px: ln.a.yPx,
      x1Px: ln.b.xPx,
      y1Px: ln.b.yPx,
      z0M: z0,
      z1M: z1,
    });
  }
  return out;
}

function endpointsFromSegments(
  segments: readonly StructuralSegmentPx[],
  source: "structural_ridge_endpoint" | "structural_trait_endpoint"
): StructuralEndpointPx[] {
  const out: StructuralEndpointPx[] = [];
  for (const s of segments) {
    out.push({ xPx: s.x0Px, yPx: s.y0Px, zM: s.z0M, source });
    out.push({ xPx: s.x1Px, yPx: s.y1Px, zM: s.z1M, source });
  }
  return out;
}

function tryInterpolatedZ(px: number, py: number, segments: readonly StructuralSegmentPx[]): number | null {
  for (const s of segments) {
    const pr = projectParamOnSegmentPx(px, py, s.x0Px, s.y0Px, s.x1Px, s.y1Px);
    if (pr.distSq <= ON_SEGMENT_TOL_PX * ON_SEGMENT_TOL_PX && pr.t > 0 && pr.t < 1) {
      return s.z0M + pr.t * (s.z1M - s.z0M);
    }
  }
  return null;
}

/** Moyenne des hauteurs explicites sur le polygone pan ; sinon null. */
export function computePanExplicitMeanM(poly: readonly LegacyImagePoint2D[]): number | null {
  const known = poly
    .map((p) => (typeof p.heightM === "number" && Number.isFinite(p.heightM) ? p.heightM : null))
    .filter((h): h is number => h != null);
  if (known.length === 0) return null;
  return known.reduce((s, v) => s + v, 0) / known.length;
}

/** Moyenne globale des sommets explicitement cotés (tous pans). */
export function computeGlobalExplicitMeanFromPans(input: LegacyRoofGeometryInput): number | null {
  const vals: number[] = [];
  for (const pan of input.pans) {
    const raw = stripClosingDuplicate(pan.polygonPx);
    for (const p of raw) {
      if (typeof p.heightM === "number" && Number.isFinite(p.heightM)) vals.push(p.heightM);
    }
  }
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export interface HeightConstraintBundle {
  readonly globalExplicitMeanM: number | null;
  readonly ridgeSegments: readonly StructuralSegmentPx[];
  readonly traitSegments: readonly StructuralSegmentPx[];
  readonly ridgeEndpoints: readonly StructuralEndpointPx[];
  readonly traitEndpoints: readonly StructuralEndpointPx[];
}

export function buildHeightConstraintBundle(
  input: LegacyRoofGeometryInput,
  ridges: readonly LegacyStructuralLine2D[] | undefined,
  traits: readonly LegacyStructuralLine2D[] | undefined
): HeightConstraintBundle {
  const globalExplicitMeanM = computeGlobalExplicitMeanFromPans(input);
  const ridgeSegments = legacyStructuralLinesToSegments(ridges, "ridge", input.defaultHeightM, globalExplicitMeanM);
  const traitSegments = legacyStructuralLinesToSegments(traits, "trait", input.defaultHeightM, globalExplicitMeanM);
  return {
    globalExplicitMeanM,
    ridgeSegments,
    traitSegments,
    ridgeEndpoints: endpointsFromSegments(ridgeSegments, "structural_ridge_endpoint"),
    traitEndpoints: endpointsFromSegments(traitSegments, "structural_trait_endpoint"),
  };
}

/**
 * Résout Z pour un coin de pan (px,py) avec traces et diagnostics ciblés.
 */
export function resolveZForPanCorner(
  xPx: number,
  yPx: number,
  explicitHeightM: number | undefined,
  bundle: HeightConstraintBundle,
  panExplicitMeanM: number | null,
  defaultHeightM: number,
  devCorner?: RoofZPipelineDevCornerCtx,
): { z: number; trace: HeightResolutionTrace } {
  const dev = devCorner && isRoofZPipelineDevTraceEnabled() ? devCorner : null;

  if (typeof explicitHeightM === "number" && Number.isFinite(explicitHeightM)) {
    if (dev) {
      roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "A", explicitHeightM, {
        hasExplicitHeightM: true,
      });
    }
    return {
      z: explicitHeightM,
      trace: { source: "explicit_polygon_vertex", tier: "high" },
    };
  }

  const snap2 = PX_SNAP * PX_SNAP;
  for (const ep of bundle.ridgeEndpoints) {
    const d2 = dist2(xPx, yPx, ep.xPx, ep.yPx);
    if (d2 <= snap2) {
      if (dev) {
        roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "B", ep.zM, {
          PX_SNAP,
          distPxToRidgeEndpoint: Math.sqrt(d2),
          ridgeEndpointPx: { x: ep.xPx, y: ep.yPx },
        });
      }
      return { z: ep.zM, trace: { source: "structural_ridge_endpoint", tier: "high" } };
    }
  }
  for (const ep of bundle.traitEndpoints) {
    const d2 = dist2(xPx, yPx, ep.xPx, ep.yPx);
    if (d2 <= snap2) {
      if (dev) {
        roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "C", ep.zM, {
          PX_SNAP,
          distPxToTraitEndpoint: Math.sqrt(d2),
          traitEndpointPx: { x: ep.xPx, y: ep.yPx },
        });
      }
      return { z: ep.zM, trace: { source: "structural_trait_endpoint", tier: "high" } };
    }
  }

  const zRidge = tryInterpolatedZ(xPx, yPx, bundle.ridgeSegments);
  if (zRidge != null) {
    if (dev) {
      roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "D", zRidge, {
        ON_SEGMENT_TOL_PX,
        ridgeSegmentCount: bundle.ridgeSegments.length,
      });
    }
    return { z: zRidge, trace: { source: "structural_line_interpolated_ridge", tier: "medium" } };
  }
  const zTrait = tryInterpolatedZ(xPx, yPx, bundle.traitSegments);
  if (zTrait != null) {
    if (dev) {
      roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "E", zTrait, {
        ON_SEGMENT_TOL_PX,
        traitSegmentCount: bundle.traitSegments.length,
      });
    }
    return { z: zTrait, trace: { source: "structural_line_interpolated_trait", tier: "medium" } };
  }

  const panMean = panExplicitMeanM ?? bundle.globalExplicitMeanM ?? defaultHeightM;
  if (panExplicitMeanM != null || bundle.globalExplicitMeanM != null) {
    if (dev) {
      roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "F", panMean, {
        panExplicitMeanM,
        globalExplicitMeanM: bundle.globalExplicitMeanM,
        defaultHeightM,
      });
    }
    return { z: panMean, trace: { source: "pan_local_mean", tier: "medium" } };
  }

  if (dev) {
    roofZTraceRecordInitial(dev.panId, dev.cornerIndex, xPx, yPx, "G", defaultHeightM, {
      defaultHeightM,
    });
  }
  return { z: defaultHeightM, trace: { source: "default_global", tier: "low" } };
}
