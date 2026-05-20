import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofExtensionSource2D, RoofExtensionSourcePoint2D, RoofExtensionSourceSegment2D } from "./roofExtensionSource";
import type { RoofExtensionWorldMapping } from "./resolveSupportPan";
import type {
  RoofExtensionHipsV1,
  RoofExtensionPointPxV1,
  RoofExtensionSegmentPxV1,
  RoofExtensionTopologyTypeV1,
  RoofExtensionV1,
} from "./roofExtensionV1";
import { validateRoofExtensionV1 } from "./roofExtensionV1Validation";

export interface BuildRoofExtensionV1FromSourceInput extends RoofExtensionWorldMapping {
  readonly source: RoofExtensionSource2D;
  readonly supportPatch: RoofPlanePatch3D;
}

export interface BuildRoofExtensionV1FromSourceResult {
  readonly model: RoofExtensionV1 | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

function height(value: number | null, fallback: number): number {
  return value != null && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function pointV1(point: RoofExtensionSourcePoint2D, fallbackHeightM: number): RoofExtensionPointPxV1 {
  return {
    x: point.x,
    y: point.y,
    heightRelM: height(point.heightRelM, fallbackHeightM),
  };
}

function segmentV1(segment: RoofExtensionSourceSegment2D, fallbackHeightM: number): RoofExtensionSegmentPxV1 {
  return {
    a: pointV1(segment.a, fallbackHeightM),
    b: pointV1(segment.b, fallbackHeightM),
  };
}

function signedArea(points: readonly { readonly x: number; readonly y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function distancePointToLinePx(
  point: { readonly x: number; readonly y: number },
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / len;
}

function polygonWorldAreaM2(
  footprint: readonly RoofExtensionPointPxV1[],
  world: RoofExtensionWorldMapping,
): number {
  const worldPts = footprint.map((p) => imagePxToWorldHorizontalM(p.x, p.y, world.metersPerPixel, world.northAngleDeg));
  return Math.abs(signedArea(worldPts));
}

function inferHips(source: RoofExtensionSource2D, ridgeFallbackH: number): RoofExtensionHipsV1 | null {
  if (!source.hips) return null;
  const left = source.hips.left ? segmentV1(source.hips.left, ridgeFallbackH) : undefined;
  const right = source.hips.right ? segmentV1(source.hips.right, ridgeFallbackH) : undefined;
  if (!left && !right) return null;
  return { ...(left ? { left } : {}), ...(right ? { right } : {}) };
}

function topologyForKind(source: RoofExtensionSource2D): RoofExtensionTopologyTypeV1 {
  if (source.kind === "shed") return "shed_dormer";
  if (source.kind === "flat_extension") return "flat_extension";
  return "gable_dormer";
}

function ignoredLegacyFields(source: RoofExtensionSource2D): readonly string[] {
  const out: string[] = [];
  if (source.hadLegacyCanonicalDormerGeometry) out.push("canonicalDormerGeometry");
  if (source.visualModel) out.push("visualModel");
  if (source.stage) out.push("stage");
  return out;
}

export function buildRoofExtensionV1FromSource(
  input: BuildRoofExtensionV1FromSourceInput,
): BuildRoofExtensionV1FromSourceResult {
  const { source, supportPatch } = input;
  const diagnostics: GeometryDiagnostic[] = [];
  if (!source.ridge || source.contour.length < 3) {
    return {
      model: null,
      diagnostics: [{
        code: "ROOF_EXTENSION_V1_SOURCE_INCOMPLETE",
        severity: "error",
        message: `Extension ${source.id} : source legacy incomplete, modele canonique V1 non cree.`,
        context: { extensionId: source.id },
      }],
    };
  }

  const ridgeH = height(source.ridgeHeightRelM, 1);
  const footprintPx = source.contour.map((p) => pointV1(p, 0));
  const areaPx2 = signedArea(footprintPx);
  const ridgePx = segmentV1(source.ridge, ridgeH);
  const ridgeDx = ridgePx.b.x - ridgePx.a.x;
  const ridgeDy = ridgePx.b.y - ridgePx.a.y;
  const ridgeLenPx = Math.hypot(ridgeDx, ridgeDy);
  const ridgeLenM = ridgeLenPx * input.metersPerPixel;
  const maxDepthPx = Math.max(...footprintPx.map((p) => distancePointToLinePx(p, ridgePx.a, ridgePx.b)), 0);
  const depthM = maxDepthPx * input.metersPerPixel;
  const wallHeightM = height(source.wallHeightM, Math.min(0.45, ridgeH));
  const roofHeightM = Math.max(0, ridgeH - wallHeightM);
  const pitchDeg = depthM > 1e-6 ? Math.atan2(Math.max(ridgeH - wallHeightM, 0), depthM) * 180 / Math.PI : null;
  const axisLen = ridgeLenPx || 1;
  const ridgeAxisPx = { x: ridgeDx / axisLen, y: ridgeDy / axisLen };
  const depthAxisPx = { x: -ridgeAxisPx.y, y: ridgeAxisPx.x };
  const apexPx = source.apexVertex
    ? { x: source.apexVertex.x, y: source.apexVertex.y, heightRelM: height(source.apexVertex.h ?? null, ridgeH) }
    : null;

  const model: RoofExtensionV1 = {
    version: "roof_extension_v1",
    id: source.id,
    kind: source.kind,
    supportPanId: String(supportPatch.id),
    footprintPx,
    footprintWinding: areaPx2 >= 0 ? "counter_clockwise" : "clockwise",
    ridgePx,
    hipsPx: inferHips(source, ridgeH),
    apexId: source.apexVertex?.id ?? null,
    apexPx,
    dimensions: {
      widthM: ridgeLenM,
      depthM,
      footprintAreaM2: polygonWorldAreaM2(footprintPx, input),
      wallHeightM,
      roofHeightM,
      totalHeightM: ridgeH,
    },
    orientation: {
      ridgeAxisPx,
      depthAxisPx,
      ridgeAngleDeg: Math.atan2(ridgeAxisPx.y, ridgeAxisPx.x) * 180 / Math.PI,
    },
    roof: {
      topologyType: topologyForKind(source),
      pitchDeg,
      eaveOffsetM: 0.04,
      seamOffsetM: 0.02,
    },
    render: {
      materialFamily: "roof_extension_premium",
      showDebugLines: false,
      selectable: true,
    },
    pv: {
      keepoutSource: "footprint",
      keepoutOffsetM: 0.08,
      shadowSource: "canonical_mesh",
      raycastSource: "canonical_mesh",
    },
    provenance: {
      source: "legacy_runtime_roof_extension",
      sourceIndex: source.sourceIndex,
      inferredSupportPanId: !source.supportPanId,
      ignoredLegacyFields: ignoredLegacyFields(source),
    },
  };

  diagnostics.push(...validateRoofExtensionV1({ ...input, model, supportPatch }));
  return { model, diagnostics };
}

export function roofExtensionV1ToSource2D(model: RoofExtensionV1): RoofExtensionSource2D {
  return {
    id: model.id,
    kind: model.kind,
    sourceIndex: model.provenance.sourceIndex,
    stage: null,
    visualModel: "canonical_roof_extension_v1",
    supportPanId: model.supportPanId,
    contour: model.footprintPx.map((p) => ({ x: p.x, y: p.y, heightRelM: p.heightRelM })),
    ridge: {
      a: { x: model.ridgePx.a.x, y: model.ridgePx.a.y, heightRelM: model.ridgePx.a.heightRelM },
      b: { x: model.ridgePx.b.x, y: model.ridgePx.b.y, heightRelM: model.ridgePx.b.heightRelM },
    },
    hips: model.hipsPx,
    apexVertex: model.apexPx
      ? { id: model.apexId ?? `${model.id}:canonical-apex`, x: model.apexPx.x, y: model.apexPx.y, h: model.apexPx.heightRelM }
      : null,
    ridgeHeightRelM: model.dimensions.totalHeightM,
    wallHeightM: model.dimensions.wallHeightM,
    hadLegacyCanonicalDormerGeometry: model.provenance.ignoredLegacyFields.includes("canonicalDormerGeometry"),
    warnings: [],
  };
}
