import {
  canonicalPolygonKey,
  DEFAULT_MODEL_TOLERANCE_PX,
  distance,
  pointOnSegment,
} from "./geometry";
import {
  computePanOrientation,
  computePanSlopeComputedDeg,
  type CalpinageStateLike as PanPhysicalStateLike,
} from "../../../../calpinage/state/panPhysical";
import {
  imagePxToWorldHorizontalM,
  polygonHorizontalAreaM2FromImagePx,
} from "../canonical3d/builder/worldMapping";
import { polygonArea3dIntrinsic } from "../canonical3d/builder/planePolygon3d";
import type {
  LegacyCalpinagePoint,
  LegacyCalpinageStateLike,
  SmartRoofCompileResult,
  SmartRoofLegacyState,
  ComputePansFromGeometryCore,
} from "./legacyBridge";
import { compileSmartRoofSketchWithLegacyEngine } from "./legacyBridge";
import type { SmartRoofPanLike } from "./panReconciliation";
import { buildSmartRoofPersistedDrawing, type SmartRoofPersistedDrawing } from "./persistence";
import type {
  SmartRoofDiagnostic,
  SmartRoofHeight,
  SmartRoofHeightSource,
  SmartRoofNode,
  SmartRoofSketchGraph,
} from "./types";

export type SmartRoofApplicationStatus = "ready" | "blocked" | "error";

export interface SmartRoofApplicationCandidate {
  readonly kind: "smartRoofDrawingApplicationCandidate";
  readonly status: SmartRoofApplicationStatus;
  readonly draftRevision: string;
  readonly sourceRevision: string;
  readonly generatedAtIso: string;
  readonly graph: SmartRoofSketchGraph;
  readonly normalizedGraph: SmartRoofSketchGraph;
  readonly compile: SmartRoofCompileResult;
  readonly legacyState: SmartRoofLegacyState;
  readonly persistedDrawing: SmartRoofPersistedDrawing;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly blockingDiagnostics: readonly SmartRoofDiagnostic[];
  readonly warnings: readonly SmartRoofDiagnostic[];
  readonly panIdMapping: Readonly<Record<string, string>>;
  readonly panelPolicy: {
    readonly status: "none" | "preserve" | "blocked";
    readonly affectedPanIds: readonly string[];
    readonly diagnostics: readonly SmartRoofDiagnostic[];
  };
}

function diagnostic(
  severity: SmartRoofDiagnostic["severity"],
  code: string,
  message: string,
  entityIds?: readonly string[],
): SmartRoofDiagnostic {
  return { severity, code, message, ...(entityIds ? { entityIds } : {}) };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function panPoints(pan: SmartRoofPanLike): readonly LegacyCalpinagePoint[] {
  if (Array.isArray(pan.polygon) && pan.polygon.length >= 3) return pan.polygon as readonly LegacyCalpinagePoint[];
  if (Array.isArray(pan.polygonPx) && pan.polygonPx.length >= 3) return pan.polygonPx as readonly LegacyCalpinagePoint[];
  if (Array.isArray((pan as { points?: unknown }).points) && (pan as { points?: unknown[] }).points!.length >= 3) {
    return (pan as { points: readonly LegacyCalpinagePoint[] }).points;
  }
  return [];
}

function nodeById(graph: SmartRoofSketchGraph, id: string): SmartRoofNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

function finiteHeight(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function heightValue(point: LegacyCalpinagePoint): number | null {
  return finiteHeight(point.h) ?? finiteHeight(point.heightM);
}

function isEstimatedHeightSource(source: unknown): source is SmartRoofHeightSource {
  return source === "default" || source === "estimated" || source === "deduced";
}

function reliefStatusForSources(
  isFlat: boolean,
  sources: readonly unknown[],
): "explicit_flat" | "estimated_flat" | "explicit_vertices" | "estimated_vertices" {
  return isFlat
    ? sources.some(isEstimatedHeightSource) ? "estimated_flat" : "explicit_flat"
    : sources.some(isEstimatedHeightSource) ? "estimated_vertices" : "explicit_vertices";
}

function readMetersPerPixel(sourceState: LegacyCalpinageStateLike): number {
  const root = asRecord(sourceState);
  const roof = asRecord(root?.roof);
  const scale = asRecord(roof?.scale);
  const roofRoof = asRecord(roof?.roof);
  const nestedScale = asRecord(roofRoof?.scale);
  return finitePositiveNumber(scale?.metersPerPixel)
    ?? finitePositiveNumber(nestedScale?.metersPerPixel)
    ?? 1;
}

function readNorthAngleDeg(sourceState: LegacyCalpinageStateLike): number {
  const root = asRecord(sourceState);
  const roof = asRecord(root?.roof);
  const north = asRecord(roof?.north);
  const roofRoof = asRecord(roof?.roof);
  const nestedNorth = asRecord(roofRoof?.north);
  const value = finiteHeight(north?.angleDeg) ?? finiteHeight(nestedNorth?.angleDeg);
  return value ?? 0;
}

function buildStateForPanPhysics(
  sourceState: LegacyCalpinageStateLike,
  pans: readonly SmartRoofPanLike[],
): PanPhysicalStateLike {
  const metersPerPixel = readMetersPerPixel(sourceState);
  const northAngleDeg = readNorthAngleDeg(sourceState);
  return {
    pans: pans as unknown as PanPhysicalStateLike["pans"],
    roof: {
      scale: { metersPerPixel },
      north: { angleDeg: northAngleDeg },
      roof: { north: { angleDeg: northAngleDeg } },
    },
  };
}

function computePanMetrics(
  pan: SmartRoofPanLike,
  sourceState: LegacyCalpinageStateLike,
): {
  readonly projectedSurfaceM2: number;
  readonly inclinedSurfaceM2: number;
  readonly slopeDeg: number;
  readonly orientation: ReturnType<typeof computePanOrientation>;
} {
  const points = panPoints(pan);
  const metersPerPixel = readMetersPerPixel(sourceState);
  const northAngleDeg = readNorthAngleDeg(sourceState);
  const projectedSurfaceM2 = polygonHorizontalAreaM2FromImagePx(points, metersPerPixel, northAngleDeg);
  const worldPoints = points.map((point) => {
    const horizontal = imagePxToWorldHorizontalM(point.x, point.y, metersPerPixel, northAngleDeg);
    return { x: horizontal.x, y: horizontal.y, z: heightValue(point) ?? 0 };
  });
  const inclinedSurfaceM2 = polygonArea3dIntrinsic(worldPoints);
  const stateForPhysics = buildStateForPanPhysics(sourceState, [pan]);
  const slopeDeg = computePanSlopeComputedDeg(pan as unknown as PanPhysicalStateLike["pans"][number], stateForPhysics);
  const orientation = computePanOrientation(pan as unknown as PanPhysicalStateLike["pans"][number], stateForPhysics);
  return {
    projectedSurfaceM2,
    inclinedSurfaceM2,
    slopeDeg,
    orientation,
  };
}

function heightForPointFromGraph(
  graph: SmartRoofSketchGraph,
  point: { readonly x: number; readonly y: number },
  tolerance: number,
  sourceSegmentIds: readonly string[] = [],
): { readonly height: SmartRoofHeight; readonly sourceId: string } | null {
  const sourceIds = new Set(sourceSegmentIds.map(String));
  const sourceSegments = graph.segments
    .filter((segment) => sourceIds.has(segment.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const segment of sourceSegments) {
    const a = nodeById(graph, segment.startNodeId);
    const b = nodeById(graph, segment.endNodeId);
    if (!a || !b) continue;
    if (a.height && Number.isFinite(a.height.valueM) && distance(point, a) <= tolerance) return { height: a.height, sourceId: a.id };
    if (b.height && Number.isFinite(b.height.valueM) && distance(point, b) <= tolerance) return { height: b.height, sourceId: b.id };
    if (segment.height && Number.isFinite(segment.height.valueM) && pointOnSegment(point, a, b, tolerance)) return { height: segment.height, sourceId: segment.id };
    if (
      a.height &&
      b.height &&
      Number.isFinite(a.height.valueM) &&
      Number.isFinite(b.height.valueM) &&
      Math.abs(a.height.valueM - b.height.valueM) <= 1e-6 &&
      pointOnSegment(point, a, b, tolerance)
    ) {
      return { height: a.height, sourceId: `${a.id}:${b.id}` };
    }
  }

  let bestNode: { readonly node: SmartRoofNode; readonly d: number } | null = null;
  for (const node of graph.nodes) {
    if (!node.height || !Number.isFinite(node.height.valueM)) continue;
    const d = distance(point, node);
    if (d > tolerance) continue;
    if (!bestNode || d < bestNode.d || (Math.abs(d - bestNode.d) <= 1e-9 && node.id < bestNode.node.id)) {
      bestNode = { node, d };
    }
  }
  if (bestNode) return { height: bestNode.node.height!, sourceId: bestNode.node.id };

  for (const segment of graph.segments) {
    if (!segment.height || !Number.isFinite(segment.height.valueM)) continue;
    const a = nodeById(graph, segment.startNodeId);
    const b = nodeById(graph, segment.endNodeId);
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b, tolerance)) return { height: segment.height, sourceId: segment.id };
  }

  return null;
}

function annotatePanRelief<TPan extends SmartRoofPanLike>(
  pan: TPan,
  graph: SmartRoofSketchGraph,
  tolerance: number,
  sourceState: LegacyCalpinageStateLike,
): { readonly pan: TPan; readonly diagnostics: readonly SmartRoofDiagnostic[]; readonly missingCount: number } {
  const diagnostics: SmartRoofDiagnostic[] = [];
  const points = panPoints(pan);
  if (points.length < 3) {
    return {
      pan,
      diagnostics: [diagnostic("error", "SMART_ROOF_PAN_POLYGON_MISSING", "A detected surface has no usable polygon.", [String(pan.id ?? "")].filter(Boolean))],
      missingCount: 1,
    };
  }
  const nextPoints = points.map((point, index) => {
    const existingHeight = heightValue(point);
    if (existingHeight != null) return { ...point, h: existingHeight, smartRoofHeightSource: "legacy" };
    const resolved = heightForPointFromGraph(graph, point, tolerance, (pan as { smartSourceSegmentIds?: readonly string[] }).smartSourceSegmentIds ?? []);
    if (resolved) return { ...point, h: resolved.height.valueM, smartRoofHeightSource: resolved.height.source, smartRoofHeightSourceId: resolved.sourceId };
    diagnostics.push(diagnostic(
      "error",
      "SMART_ROOF_RELIEF_MISSING_HEIGHT",
      "Preciser la hauteur de ce sommet ou renseigner une hauteur plate pour le dessin.",
      [String(pan.id ?? ""), `vertex-${index}`].filter(Boolean),
    ));
    return { ...point };
  });
  const heights = nextPoints.map((point) => heightValue(point)).filter((value): value is number => value != null);
  const missingCount = nextPoints.length - heights.length;
  if (missingCount > 0) {
    return {
      pan: { ...pan, points: nextPoints, polygon: nextPoints, polygonPx: nextPoints } as TPan,
      diagnostics,
      missingCount,
    };
  }
  const isFlat = heights.every((value) => Math.abs(value - heights[0]!) <= 1e-6);
  const panWithPoints = { ...pan, points: nextPoints, polygon: nextPoints, polygonPx: nextPoints } as TPan;
  const metrics = computePanMetrics(panWithPoints, sourceState);
  const heightSources = nextPoints.map((point) => (point as Record<string, unknown>).smartRoofHeightSource).filter(Boolean);
  const reliefStatus = reliefStatusForSources(isFlat, heightSources);
  const physical = {
    ...(asRecord((panWithPoints as Record<string, unknown>).physical) ?? {}),
    slope: {
      mode: "auto",
      computedDeg: metrics.slopeDeg,
      valueDeg: metrics.slopeDeg,
    },
    orientation: {
      azimuthDeg: metrics.orientation?.azimuthDeg ?? null,
      label: metrics.orientation?.label ?? null,
    },
    slopeDirectionLabel: metrics.orientation?.slopeDirectionLabel ?? null,
  };
  const nextPanBase = {
    ...panWithPoints,
    surfaceM2: metrics.projectedSurfaceM2,
    surface: metrics.projectedSurfaceM2,
    projectedSurfaceM2: metrics.projectedSurfaceM2,
    surfaceProjectedM2: metrics.projectedSurfaceM2,
    inclinedSurfaceM2: metrics.inclinedSurfaceM2,
    surfaceInclinedM2: metrics.inclinedSurfaceM2,
    azimuthDeg: metrics.orientation?.azimuthDeg ?? (panWithPoints as Record<string, unknown>).azimuthDeg,
    orientationDeg: metrics.orientation?.azimuthDeg ?? (panWithPoints as Record<string, unknown>).orientationDeg,
    roofType: isFlat ? "FLAT" : (pan as Record<string, unknown>).roofType ?? "PITCHED",
  } as TPan;
  const nextPan = isFlat
    ? ({
        ...nextPanBase,
        inclinedSurfaceM2: metrics.projectedSurfaceM2,
        surfaceInclinedM2: metrics.projectedSurfaceM2,
        tiltDeg: 0,
        pitchDeg: 0,
        slopeDeg: 0,
        physical: {
          ...physical,
          slope: { mode: "auto", computedDeg: 0, valueDeg: 0 },
        },
        smartRoofRelief: {
          status: reliefStatus,
          heightM: heights[0],
          heightSources,
          projectedSurfaceM2: metrics.projectedSurfaceM2,
          inclinedSurfaceM2: metrics.projectedSurfaceM2,
          slopeDeg: 0,
          orientationDeg: metrics.orientation?.azimuthDeg ?? null,
          metersPerPixel: readMetersPerPixel(sourceState),
          northAngleDeg: readNorthAngleDeg(sourceState),
        },
      } as TPan)
    : ({
        ...nextPanBase,
        physical,
        tiltDeg: metrics.slopeDeg,
        pitchDeg: metrics.slopeDeg,
        slopeDeg: metrics.slopeDeg,
        smartRoofRelief: {
          status: reliefStatus,
          heightSources,
          projectedSurfaceM2: metrics.projectedSurfaceM2,
          inclinedSurfaceM2: metrics.inclinedSurfaceM2,
          slopeDeg: metrics.slopeDeg,
          orientationDeg: metrics.orientation?.azimuthDeg ?? null,
          metersPerPixel: readMetersPerPixel(sourceState),
          northAngleDeg: readNorthAngleDeg(sourceState),
        },
      } as TPan);
  return { pan: nextPan, diagnostics, missingCount: 0 };
}

function transferSafePanSettings<TPan extends SmartRoofPanLike>(
  previousPans: readonly SmartRoofPanLike[],
  nextPans: readonly TPan[],
): { readonly pans: readonly TPan[]; readonly diagnostics: readonly SmartRoofDiagnostic[] } {
  const previousById = new Map<string, SmartRoofPanLike>();
  for (const pan of previousPans) {
    const id = String(pan.id ?? "");
    if (id) previousById.set(id, pan);
  }
  const diagnostics: SmartRoofDiagnostic[] = [];
  const transferred = nextPans.map((pan) => {
    const previous = previousById.get(String(pan.id ?? ""));
    if (!previous) return pan;
    const sameGeometry = canonicalPolygonKey(panPoints(previous), 4) === canonicalPolygonKey(panPoints(pan), 4);
    const previousRecord = previous as Record<string, unknown>;
    const nextRecord = pan as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof previousRecord.name === "string") patch.name = previousRecord.name;
    if (sameGeometry) {
      for (const key of ["roofType", "flatRoofConfig", "heightModel", "manualHeightModel", "smartRoofRelief"]) {
        if (previousRecord[key] !== undefined && nextRecord[key] === undefined) patch[key] = clone(previousRecord[key]);
      }
      if (previousRecord.physical && nextRecord.physical === undefined) patch.physical = clone(previousRecord.physical);
    } else if (previousRecord.flatRoofConfig || previousRecord.physical) {
      diagnostics.push(diagnostic(
        "warning",
        "SMART_ROOF_PAN_PARAMETERS_RECHECK_REQUIRED",
        "Le pan conserve son identite, mais sa geometrie a change : les parametres dependants de la surface devront etre recalcules ou verifies.",
        [String(pan.id ?? "")],
      ));
    }
    return Object.keys(patch).length ? ({ ...pan, ...patch } as TPan) : pan;
  });
  return { pans: transferred, diagnostics };
}

function collectPanIdsFromUnknown(value: unknown, acc: Set<string>, depth = 0): void {
  if (depth > 5 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPanIdsFromUnknown(item, acc, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  for (const key of ["panId", "roofPanId", "sourcePanId", "roofPlanePatchId"]) {
    const raw = rec[key];
    if (typeof raw === "string" && raw) acc.add(raw);
  }
  for (const key of ["pan", "attachment", "panels"]) collectPanIdsFromUnknown(rec[key], acc, depth + 1);
}

function collectPanelPanIds(sourceState: LegacyCalpinageStateLike): readonly string[] {
  const ids = new Set<string>();
  for (const key of ["placedPanels", "pvBlocks", "frozenBlocks", "activePlacementBlock", "phase3"]) {
    collectPanIdsFromUnknown((sourceState as Record<string, unknown>)[key], ids);
  }
  return [...ids].sort();
}

function buildPanelPolicy(input: {
  readonly sourceState: LegacyCalpinageStateLike;
  readonly previousPans: readonly SmartRoofPanLike[];
  readonly nextPans: readonly SmartRoofPanLike[];
  readonly compileDiagnostics: readonly SmartRoofDiagnostic[];
}): SmartRoofApplicationCandidate["panelPolicy"] {
  const panelPanIds = collectPanelPanIds(input.sourceState);
  if (panelPanIds.length === 0) return { status: "none", affectedPanIds: [], diagnostics: [] };

  const diagnostics: SmartRoofDiagnostic[] = [];
  const nextIds = new Set(input.nextPans.map((pan) => String(pan.id ?? "")).filter(Boolean));
  for (const panId of panelPanIds) {
    if (!nextIds.has(panId)) {
      diagnostics.push(diagnostic(
        "error",
        "SMART_ROOF_PANEL_PAN_UNMATCHED",
        "Un panneau reference un pan qui n'existe plus dans le candidat. Le transfert automatique est bloque.",
        [panId],
      ));
    }
  }

  const ambiguousCodes = new Set([
    "PAN_SPLIT_OR_MERGE_REVIEW_REQUIRED",
    "PAN_ID_MATCH_AMBIGUOUS",
    "PREVIOUS_PAN_UNMATCHED_REVIEW_REQUIRED",
  ]);
  for (const item of input.compileDiagnostics) {
    if (!ambiguousCodes.has(item.code)) continue;
    const entityIds = (item.entityIds ?? []).map(String);
    if (entityIds.length === 0 || entityIds.some((id) => panelPanIds.includes(id))) {
      diagnostics.push(diagnostic(
        "error",
        "SMART_ROOF_PANEL_TRANSFER_AMBIGUOUS",
        "Des panneaux sont rattaches a un pan dont la division, fusion ou disparition demande une revision manuelle.",
        entityIds.length ? entityIds : panelPanIds,
      ));
    }
  }

  const previousById = new Map<string, SmartRoofPanLike>();
  for (const pan of input.previousPans) {
    const id = String(pan.id ?? "");
    if (id) previousById.set(id, pan);
  }
  const nextById = new Map<string, SmartRoofPanLike>();
  for (const pan of input.nextPans) {
    const id = String(pan.id ?? "");
    if (id) nextById.set(id, pan);
  }
  for (const panId of panelPanIds) {
    const previous = previousById.get(panId);
    const next = nextById.get(panId);
    if (!previous || !next) continue;
    if (canonicalPolygonKey(panPoints(previous), 4) !== canonicalPolygonKey(panPoints(next), 4)) {
      diagnostics.push(diagnostic(
        "error",
        "SMART_ROOF_PANEL_REVALIDATION_REQUIRED",
        "Ce pan porte deja des panneaux et sa surface a change. L'application est bloquee tant que le transfert/recontrole automatique n'est pas supporte.",
        [panId],
      ));
    }
  }

  return {
    status: diagnostics.length ? "blocked" : "preserve",
    affectedPanIds: panelPanIds,
    diagnostics,
  };
}

function hardBlockDiagnostics(result: SmartRoofCompileResult): readonly SmartRoofDiagnostic[] {
  const blockingCodes = new Set([
    "CROSSING_NOT_CONNECTED_UNSUPPORTED",
    "COLINEAR_OVERLAP_REVIEW_REQUIRED",
    "HOLE_OR_NESTED_OUTLINE_UNSUPPORTED",
    "LEGACY_ENGINE_NO_PANS",
    "LEGACY_ENGINE_ERROR",
  ]);
  return result.diagnostics.filter((item) => item.severity === "error" || blockingCodes.has(item.code));
}

export function prepareSmartRoofDrawingApplication(input: {
  readonly graph: SmartRoofSketchGraph;
  readonly sourceState: LegacyCalpinageStateLike;
  readonly sourceRevision: string;
  readonly currentSourceRevision?: string;
  readonly draftRevision: string;
  readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
  readonly modelTolerancePx?: number;
}): SmartRoofApplicationCandidate {
  const tolerance = input.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  const generatedAtIso = new Date().toISOString();
  const previousPans = clone(input.sourceState.pans ?? []) as readonly SmartRoofPanLike[];
  const compile = compileSmartRoofSketchWithLegacyEngine(input.graph, {
    computePansFromGeometryCore: input.computePansFromGeometryCore,
    previousPans,
    modelTolerancePx: tolerance,
  });
  const diagnostics: SmartRoofDiagnostic[] = [];
  if (input.currentSourceRevision && input.currentSourceRevision !== input.sourceRevision) {
    diagnostics.push(diagnostic(
      "error",
      "DRAFT_SOURCE_REVISION_STALE",
      "L'etude active a change depuis l'ouverture du brouillon. Quittez puis rouvrez l'essai pour eviter d'ecraser un autre dessin.",
    ));
  }
  diagnostics.push(...compile.diagnostics);

  if (compile.status === "empty" || compile.status === "incomplete") {
    diagnostics.push(diagnostic("error", "SMART_ROOF_DRAWING_INCOMPLETE", "Le dessin reste incomplet : fermez au moins un contour avant application."));
  }
  if (compile.legacyState.pans.length === 0) {
    diagnostics.push(diagnostic("error", "SMART_ROOF_NO_SURFACE_TO_APPLY", "Aucune surface exploitable n'a ete calculee pour l'application."));
  }

  const reliefResults = compile.legacyState.pans.map((pan) => annotatePanRelief(pan, compile.normalizedGraph, tolerance, input.sourceState));
  const reliefDiagnostics = reliefResults.flatMap((item) => item.diagnostics);
  diagnostics.push(...reliefDiagnostics);

  const settingTransfer = transferSafePanSettings(previousPans, reliefResults.map((item) => item.pan));
  diagnostics.push(...settingTransfer.diagnostics);

  const panelPolicy = buildPanelPolicy({
    sourceState: input.sourceState,
    previousPans,
    nextPans: settingTransfer.pans,
    compileDiagnostics: compile.diagnostics,
  });
  diagnostics.push(...panelPolicy.diagnostics);

  const blockDiagnostics = [
    ...hardBlockDiagnostics(compile),
    ...diagnostics.filter((item) => item.severity === "error"),
  ];
  const uniqueBlocking = blockDiagnostics.filter((item, index, list) => (
    index === list.findIndex((other) => other.code === item.code && JSON.stringify(other.entityIds ?? []) === JSON.stringify(item.entityIds ?? []))
  ));
  const legacyState: SmartRoofLegacyState = {
    ...compile.legacyState,
    pans: settingTransfer.pans,
    roofExtensions: compile.legacyState.roofExtensions,
    roof: {
      ...(clone(input.sourceState.roof ?? {}) as Record<string, unknown>),
      ...(compile.legacyState.roof ?? {}),
      roofPans: settingTransfer.pans.map((pan) => ({
        id: pan.id,
        polygonPx: pan.polygon ?? pan.polygonPx ?? panPoints(pan),
      })),
    },
  };
  const status: SmartRoofApplicationStatus = uniqueBlocking.length ? "blocked" : "ready";
  const persistedDrawing = buildSmartRoofPersistedDrawing({
    graph: compile.normalizedGraph,
    sourceRevision: input.currentSourceRevision ?? input.sourceRevision,
    draftRevision: input.draftRevision,
    panIdMapping: compile.mapping.panIdMapping,
    diagnostics: diagnostics.filter((item) => item.severity !== "info"),
    appliedAtIso: generatedAtIso,
  });

  return {
    kind: "smartRoofDrawingApplicationCandidate",
    status,
    draftRevision: input.draftRevision,
    sourceRevision: input.sourceRevision,
    generatedAtIso,
    graph: clone(input.graph),
    normalizedGraph: compile.normalizedGraph,
    compile: { ...compile, legacyState },
    legacyState,
    persistedDrawing,
    diagnostics,
    blockingDiagnostics: uniqueBlocking,
    warnings: diagnostics.filter((item) => item.severity === "warning"),
    panIdMapping: compile.mapping.panIdMapping,
    panelPolicy,
  };
}
