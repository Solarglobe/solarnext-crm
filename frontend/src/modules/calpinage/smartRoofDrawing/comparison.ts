import { canonicalPolygonKey, polygonArea } from "./geometry";
import {
  compileSmartRoofSketchWithLegacyEngine,
  importLegacyRoofToSmartSketch,
  type ComputePansFromGeometryCore,
  type LegacyCalpinageStateLike,
} from "./legacyBridge";
import type { SmartRoofDiagnostic } from "./types";
import type { SmartRoofPanLike } from "./panReconciliation";

export type SmartRoofComparisonClassification =
  | "incomplete_drawing"
  | "geometry_error"
  | "unsupported_case"
  | "geometry_computed"
  | "relief_indeterminate"
  | "divergence_with_current";

export interface SmartRoofSurfaceSummary {
  readonly id: string;
  readonly area: number;
  readonly key: string;
  readonly pointCount: number;
  readonly concave: boolean;
  readonly sourceSegmentIds: readonly string[];
}

export interface SmartRoofComparisonDivergence {
  readonly code: string;
  readonly message: string;
  readonly current?: unknown;
  readonly experimental?: unknown;
}

export interface SmartRoofComparisonReport {
  readonly kind: "smartRoofDrawingComparison";
  readonly drawingRevision: string;
  readonly generatedAt: string;
  readonly status: "incomplete" | "geometry_error" | "unsupported" | "computed";
  readonly classifications: readonly SmartRoofComparisonClassification[];
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly current: {
    readonly panCount: number;
    readonly totalArea: number;
    readonly surfaces: readonly SmartRoofSurfaceSummary[];
  };
  readonly experimental: {
    readonly panCount: number;
    readonly totalArea: number;
    readonly surfaces: readonly SmartRoofSurfaceSummary[];
    readonly contourCount: number;
    readonly traitCount: number;
    readonly ridgeCount: number;
    readonly panIdMapping: Readonly<Record<string, string>>;
  };
  readonly divergences: readonly SmartRoofComparisonDivergence[];
  readonly relief: {
    readonly explicitHeightCount: number;
    readonly missingExplicitHeights: boolean;
    readonly message: string;
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function diagnostic(
  severity: SmartRoofDiagnostic["severity"],
  code: string,
  message: string,
  entityIds?: readonly string[],
): SmartRoofDiagnostic {
  return { severity, code, message, ...(entityIds ? { entityIds } : {}) };
}

function panPoints(pan: SmartRoofPanLike): readonly { readonly x: number; readonly y: number }[] {
  if (Array.isArray(pan.polygon) && pan.polygon.length >= 3) return pan.polygon;
  if (Array.isArray(pan.polygonPx) && pan.polygonPx.length >= 3) return pan.polygonPx;
  return [];
}

function isConcave(points: readonly { readonly x: number; readonly y: number }[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= 1e-9) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return true;
    sign = nextSign;
  }
  return false;
}

function summarizePans(pans: readonly SmartRoofPanLike[]): readonly SmartRoofSurfaceSummary[] {
  return pans
    .map((pan, index) => {
      const points = panPoints(pan);
      return {
        id: String(pan.id ?? `pan-${index + 1}`),
        area: Number(polygonArea(points).toFixed(6)),
        key: points.length >= 3 ? canonicalPolygonKey(points, 4) : "",
        pointCount: points.length,
        concave: points.length >= 4 ? isConcave(points) : false,
        sourceSegmentIds: [...(pan.smartSourceSegmentIds ?? [])].sort(),
      };
    })
    .sort((a, b) => (a.area - b.area) || a.key.localeCompare(b.key));
}

function totalArea(surfaces: readonly SmartRoofSurfaceSummary[]): number {
  return Number(surfaces.reduce((sum, surface) => sum + surface.area, 0).toFixed(6));
}

function compareSurfaces(
  current: readonly SmartRoofSurfaceSummary[],
  experimental: readonly SmartRoofSurfaceSummary[],
): readonly SmartRoofComparisonDivergence[] {
  const divergences: SmartRoofComparisonDivergence[] = [];
  if (current.length !== experimental.length) {
    divergences.push({
      code: "PAN_COUNT_DIVERGENCE",
      message: "The experimental topology does not produce the same number of surfaces as the current path.",
      current: current.length,
      experimental: experimental.length,
    });
  }

  const currentAreas = current.map((surface) => Math.round(surface.area));
  const experimentalAreas = experimental.map((surface) => Math.round(surface.area));
  if (currentAreas.join("|") !== experimentalAreas.join("|")) {
    divergences.push({
      code: "PAN_AREA_DIVERGENCE",
      message: "The experimental topology produces different surface areas from the current path.",
      current: currentAreas,
      experimental: experimentalAreas,
    });
  }

  const currentKeys = current.map((surface) => surface.key).filter(Boolean).sort();
  const experimentalKeys = experimental.map((surface) => surface.key).filter(Boolean).sort();
  if (currentKeys.join("|") !== experimentalKeys.join("|")) {
    divergences.push({
      code: "PAN_SHAPE_DIVERGENCE",
      message: "The experimental topology produces different polygon shapes from the current path.",
    });
  }

  return divergences;
}

function drawingRevisionPayload(state: LegacyCalpinageStateLike): unknown {
  return {
    contours: state.contours ?? [],
    traits: state.traits ?? [],
    ridges: state.ridges ?? [],
    pans: (state.pans ?? []).map((pan) => ({
      id: pan.id,
      polygon: pan.polygon ?? pan.polygonPx ?? [],
      smartSourceSegmentIds: pan.smartSourceSegmentIds ?? [],
    })),
  };
}

function stableRevision(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `smart-roof-${(hash >>> 0).toString(16)}`;
}

function countExplicitHeights(state: LegacyCalpinageStateLike): number {
  let count = 0;
  const addPoint = (point: unknown): void => {
    if (!point || typeof point !== "object") return;
    const rec = point as Record<string, unknown>;
    if (typeof rec.h === "number" && Number.isFinite(rec.h)) count += 1;
    else if (typeof rec.heightM === "number" && Number.isFinite(rec.heightM)) count += 1;
  };
  for (const contour of state.contours ?? []) for (const point of contour.points ?? []) addPoint(point);
  for (const line of [...(state.traits ?? []), ...(state.ridges ?? [])]) {
    addPoint(line.a);
    addPoint(line.b);
  }
  return count;
}

export function cloneLegacyStateForSmartRoofComparison(state: LegacyCalpinageStateLike): LegacyCalpinageStateLike {
  return clone({
    contours: state.contours ?? [],
    traits: state.traits ?? [],
    ridges: state.ridges ?? [],
    pans: state.pans ?? [],
    roof: state.roof ?? {},
    placedPanels: (state as Record<string, unknown>).placedPanels ?? [],
    validatedRoofData: (state as Record<string, unknown>).validatedRoofData ?? null,
  });
}

export function runSmartRoofDrawingComparison(options: {
  readonly state: LegacyCalpinageStateLike;
  readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
  readonly modelTolerancePx?: number;
}): SmartRoofComparisonReport {
  const snapshot = cloneLegacyStateForSmartRoofComparison(options.state);
  const revision = stableRevision(drawingRevisionPayload(snapshot));
  const imported = importLegacyRoofToSmartSketch(snapshot);
  const compiled = compileSmartRoofSketchWithLegacyEngine(imported.graph, {
    computePansFromGeometryCore: options.computePansFromGeometryCore,
    previousPans: snapshot.pans ?? [],
    modelTolerancePx: options.modelTolerancePx,
  });

  const currentSurfaces = summarizePans(snapshot.pans ?? []);
  const experimentalSurfaces = summarizePans(compiled.legacyState.pans);
  const divergences = compareSurfaces(currentSurfaces, experimentalSurfaces);
  const explicitHeightCount = countExplicitHeights(snapshot);
  const missingExplicitHeights = explicitHeightCount === 0;
  const classifications = new Set<SmartRoofComparisonClassification>();

  if (compiled.status === "empty" || compiled.status === "incomplete") classifications.add("incomplete_drawing");
  if (compiled.status === "engine_error") classifications.add("geometry_error");
  if (compiled.status === "ambiguous") classifications.add("unsupported_case");
  if (compiled.legacyState.pans.length > 0) classifications.add("geometry_computed");
  if (missingExplicitHeights) classifications.add("relief_indeterminate");
  if (divergences.length > 0) classifications.add("divergence_with_current");

  const status: SmartRoofComparisonReport["status"] =
    compiled.status === "engine_error"
      ? "geometry_error"
      : compiled.status === "empty" || compiled.status === "incomplete"
        ? "incomplete"
        : compiled.status === "ambiguous"
          ? "unsupported"
          : "computed";

  return {
    kind: "smartRoofDrawingComparison",
    drawingRevision: revision,
    generatedAt: new Date().toISOString(),
    status,
    classifications: [...classifications],
    diagnostics: [
      ...imported.diagnostics,
      ...compiled.diagnostics,
      ...(missingExplicitHeights
        ? [diagnostic("info", "RELIEF_INDETERMINATE", "The topology was computed without confirmed heights; the 3D roof relief remains to be resolved.")]
        : []),
    ],
    current: {
      panCount: currentSurfaces.length,
      totalArea: totalArea(currentSurfaces),
      surfaces: currentSurfaces,
    },
    experimental: {
      panCount: experimentalSurfaces.length,
      totalArea: totalArea(experimentalSurfaces),
      surfaces: experimentalSurfaces,
      contourCount: compiled.legacyState.contours.length,
      traitCount: compiled.legacyState.traits.length,
      ridgeCount: compiled.legacyState.ridges.length,
      panIdMapping: compiled.mapping.panIdMapping,
    },
    divergences,
    relief: {
      explicitHeightCount,
      missingExplicitHeights,
      message: missingExplicitHeights
        ? "Relief not validated: no confirmed height was present in the analysed copy."
        : "Explicit heights were preserved in the analysed copy.",
    },
  };
}
