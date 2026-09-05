import {
  DEFAULT_MODEL_TOLERANCE_PX,
  DEFAULT_SCREEN_SNAP_TOLERANCE_PX,
  distance,
  projectPointOnSegment,
} from "./geometry";
import {
  addSketchNode,
  addSketchSegment,
  connectSegmentEndpointToNode,
  createSmartRoofSketchGraph,
  moveSketchNode,
  removeSketchSegment,
  setAllSketchNodeHeights,
  setSketchNodeHeight,
  setSketchNodeHeightsForGroup,
  setSketchSegmentHeight,
  setSketchSegmentRole,
  splitSketchSegmentAtPoint,
} from "./operations";
import {
  compileSmartRoofSketchWithLegacyEngine,
  importLegacyRoofToSmartSketch,
  type ComputePansFromGeometryCore,
  type LegacyCalpinageStateLike,
  type SmartRoofCompileResult,
} from "./legacyBridge";
import { prepareSmartRoofDrawingApplication, type SmartRoofApplicationCandidate } from "./application";
import { readSmartRoofPersistedDrawing } from "./persistence";
import type {
  SmartRoofDiagnostic,
  SmartRoofHeight,
  SmartRoofLineRole,
  SmartRoofNode,
  SmartRoofOperationResult,
  SmartRoofSegment,
  SmartRoofSketchGraph,
} from "./types";

export type SmartRoofDraftTool = "select" | "draw";
export type SmartRoofDraftStatus =
  | "empty"
  | "draft"
  | "computed"
  | "incomplete"
  | "ambiguous"
  | "engine_error"
  | "source_stale";

export type SmartRoofDraftSnap =
  | { readonly kind: "node"; readonly point: { readonly x: number; readonly y: number }; readonly nodeId: string; readonly distancePx: number }
  | { readonly kind: "segment"; readonly point: { readonly x: number; readonly y: number }; readonly segmentId: string; readonly t: number; readonly distancePx: number }
  | { readonly kind: "free"; readonly point: { readonly x: number; readonly y: number }; readonly distancePx: number };

export type SmartRoofDraftSelection =
  | { readonly type: "node"; readonly nodeId: string }
  | { readonly type: "segment"; readonly segmentId: string };

export interface SmartRoofDraftCompileSnapshot {
  readonly revision: string;
  readonly result: SmartRoofCompileResult;
  readonly status: SmartRoofDraftStatus;
  readonly message: string;
}

export interface SmartRoofDrawingDraftSession {
  readonly sourceRevision: string;
  readonly sourceImportCount: number;
  readonly graph: SmartRoofSketchGraph;
  readonly activeGroupId: string | null;
  readonly tool: SmartRoofDraftTool;
  readonly chain:
    | {
        readonly startNodeId: string;
        readonly lastNodeId: string;
      }
    | null;
  readonly hover: SmartRoofDraftSnap | null;
  readonly selected: SmartRoofDraftSelection | null;
  readonly drag:
    | {
        readonly nodeId: string;
        readonly previewPoint: { readonly x: number; readonly y: number };
      }
    | null;
  readonly undoStack: readonly SmartRoofSketchGraph[];
  readonly redoStack: readonly SmartRoofSketchGraph[];
  readonly compile: SmartRoofDraftCompileSnapshot;
  readonly applicationCandidate: SmartRoofApplicationCandidate | null;
  readonly dirty: boolean;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
}

export interface SmartRoofDrawingDraftRuntimeApi {
  readonly getState: () => SmartRoofDrawingDraftSession;
  readonly setTool: (tool: SmartRoofDraftTool) => SmartRoofDrawingDraftSession;
  readonly updateHover: (point: { readonly x: number; readonly y: number }, viewportScale: number) => SmartRoofDrawingDraftSession;
  readonly pointerDown: (point: { readonly x: number; readonly y: number }, viewportScale: number) => SmartRoofDrawingDraftSession;
  readonly pointerMove: (point: { readonly x: number; readonly y: number }, viewportScale: number) => SmartRoofDrawingDraftSession;
  readonly pointerUp: (point: { readonly x: number; readonly y: number }) => SmartRoofDrawingDraftSession;
  readonly finishChain: () => SmartRoofDrawingDraftSession;
  readonly cancelOrSelect: () => SmartRoofDrawingDraftSession;
  readonly deleteSelection: () => SmartRoofDrawingDraftSession;
  readonly setSelectedNodeHeight: (height: SmartRoofHeight | null) => SmartRoofDrawingDraftSession;
  readonly setSelectedSegmentHeight: (height: SmartRoofHeight | null) => SmartRoofDrawingDraftSession;
  readonly setAllNodeHeights: (height: SmartRoofHeight | null) => SmartRoofDrawingDraftSession;
  readonly startNewGroup: (label?: string) => SmartRoofDrawingDraftSession;
  readonly setSelectedSegmentRole: (role: SmartRoofLineRole) => SmartRoofDrawingDraftSession;
  readonly prepareApplication: (state?: LegacyCalpinageStateLike) => SmartRoofApplicationCandidate;
  readonly undo: () => SmartRoofDrawingDraftSession;
  readonly redo: () => SmartRoofDrawingDraftSession;
  readonly checkSourceRevision: (state: LegacyCalpinageStateLike) => SmartRoofDrawingDraftSession;
  readonly dispose: () => void;
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

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function smartRoofLegacyDrawingRevision(state: LegacyCalpinageStateLike): string {
  return `legacy-${stableHash({
    contours: state.contours ?? [],
    traits: state.traits ?? [],
    ridges: state.ridges ?? [],
    pans: (state.pans ?? []).map((pan) => ({
      id: pan.id,
      polygon: pan.polygon ?? pan.polygonPx ?? pan.points ?? [],
      smartSourceSegmentIds: pan.smartSourceSegmentIds ?? [],
    })),
  })}`;
}

export function smartRoofDraftGraphRevision(graph: SmartRoofSketchGraph): string {
  return `draft-${stableHash({
    schemaVersion: graph.schemaVersion,
    groups: graph.groups,
    nodes: graph.nodes,
    segments: graph.segments,
  })}`;
}

function nodeById(graph: SmartRoofSketchGraph, id: string): SmartRoofNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

function nextUnusedId(prefix: string, items: readonly { readonly id: string }[]): string {
  const used = new Set(items.map((item) => item.id));
  let index = items.length + 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function screenToleranceToModel(screenTolerancePx: number, viewportScale: number): number {
  const scale = Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1;
  return screenTolerancePx / scale;
}

export function findSmartRoofDraftSnap(
  graph: SmartRoofSketchGraph,
  point: { readonly x: number; readonly y: number },
  options: {
    readonly viewportScale?: number;
    readonly screenSnapTolerancePx?: number;
    readonly activeGroupId?: string | null;
  } = {},
): SmartRoofDraftSnap {
  const viewportScale = options.viewportScale ?? 1;
  const screenTolerancePx = options.screenSnapTolerancePx ?? DEFAULT_SCREEN_SNAP_TOLERANCE_PX;
  const modelTolerance = screenToleranceToModel(screenTolerancePx, viewportScale);
  const activeGroupId = options.activeGroupId ?? null;
  const hasGroupFilter = activeGroupId != null;
  const isSnapCandidateInActiveGroup = (value: string | null | undefined): boolean => (
    !hasGroupFilter || (value ?? null) === activeGroupId
  );

  let bestNode: { node: SmartRoofNode; distancePx: number } | null = null;
  for (const node of graph.nodes) {
    if (!isSnapCandidateInActiveGroup(node.groupId)) continue;
    const dModel = distance(point, node);
    if (dModel > modelTolerance) continue;
    const dPx = dModel * viewportScale;
    if (!bestNode || dPx < bestNode.distancePx || (Math.abs(dPx - bestNode.distancePx) <= 1e-9 && node.id < bestNode.node.id)) {
      bestNode = { node, distancePx: dPx };
    }
  }

  let bestSegment: {
    segment: SmartRoofSegment;
    projection: ReturnType<typeof projectPointOnSegment>;
    distancePx: number;
    endpointClearancePx: number;
  } | null = null;
  for (const segment of graph.segments) {
    if (!isSnapCandidateInActiveGroup(segment.groupId)) continue;
    const a = nodeById(graph, segment.startNodeId);
    const b = nodeById(graph, segment.endNodeId);
    if (!a || !b) continue;
    const projection = projectPointOnSegment(point, a, b);
    if (projection.t <= 0 || projection.t >= 1) continue;
    if (projection.distance > modelTolerance) continue;
    const dPx = projection.distance * viewportScale;
    const endpointClearancePx = Math.min(distance(projection, a), distance(projection, b)) * viewportScale;
    if (!bestSegment || dPx < bestSegment.distancePx || (Math.abs(dPx - bestSegment.distancePx) <= 1e-9 && segment.id < bestSegment.segment.id)) {
      bestSegment = { segment, projection, distancePx: dPx, endpointClearancePx };
    }
  }

  const endpointGuardPx = Math.min(screenTolerancePx / 2, 8);
  const segmentIsClearlyCloser = bestSegment && (
    !bestNode ||
    (
      bestSegment.endpointClearancePx >= endpointGuardPx &&
      bestSegment.distancePx + 0.5 < bestNode.distancePx
    )
  );
  if (bestSegment && segmentIsClearlyCloser) {
    return {
      kind: "segment",
      point: { x: bestSegment.projection.x, y: bestSegment.projection.y },
      segmentId: bestSegment.segment.id,
      t: bestSegment.projection.t,
      distancePx: bestSegment.distancePx,
    };
  }

  if (bestNode) {
    return {
      kind: "node",
      point: { x: bestNode.node.x, y: bestNode.node.y },
      nodeId: bestNode.node.id,
      distancePx: bestNode.distancePx,
    };
  }

  return { kind: "free", point: { x: point.x, y: point.y }, distancePx: Infinity };
}

function compileDraft(
  graph: SmartRoofSketchGraph,
  options: {
    readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
    readonly previousPans?: LegacyCalpinageStateLike["pans"];
    readonly modelTolerancePx?: number;
  },
): SmartRoofDraftCompileSnapshot {
  const revision = smartRoofDraftGraphRevision(graph);
  const result = compileSmartRoofSketchWithLegacyEngine(graph, {
    computePansFromGeometryCore: options.computePansFromGeometryCore,
    previousPans: options.previousPans,
    modelTolerancePx: options.modelTolerancePx,
  });
  const panCount = result.legacyState.pans.length;
  const status: SmartRoofDraftStatus =
    result.status === "empty"
      ? "empty"
      : result.status === "incomplete"
        ? "incomplete"
        : result.status === "ambiguous"
          ? "ambiguous"
          : result.status === "engine_error"
            ? "engine_error"
            : panCount > 0
              ? "computed"
              : "draft";
  const interpretedNodes = result.normalizedGraph?.nodes ?? graph.nodes;
  const hasRelief = interpretedNodes.some((node) => node.height && Number.isFinite(node.height.valueM));
  const hasEstimatedRelief = result.diagnostics.some((item) => (
    item.code === "SMART_ROOF_RELIEF_ESTIMATED_FLAT" ||
    item.code === "SMART_ROOF_RELIEF_ESTIMATED_PITCHED"
  ));
  const message = status === "empty"
    ? "Dessin en cours - aucun segment"
    : status === "incomplete"
      ? "Dessin en cours - contour ouvert"
      : status === "ambiguous"
        ? "Geometrie a verifier"
        : status === "engine_error"
          ? "Erreur de calcul geometrique"
          : `${panCount} surface${panCount > 1 ? "s" : ""} detectee${panCount > 1 ? "s" : ""}${hasEstimatedRelief ? " - relief estime" : hasRelief ? "" : " - relief a preciser"}`;
  return { revision, result, status, message };
}

function withCompiled(
  session: SmartRoofDrawingDraftSession,
  graph: SmartRoofSketchGraph,
  options: {
    readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
    readonly previousPans?: LegacyCalpinageStateLike["pans"];
    readonly modelTolerancePx?: number;
    readonly pushUndo?: boolean;
    readonly dirty?: boolean;
    readonly selected?: SmartRoofDraftSelection | null;
    readonly chain?: SmartRoofDrawingDraftSession["chain"];
    readonly hover?: SmartRoofDraftSnap | null;
    readonly redoStack?: readonly SmartRoofSketchGraph[];
    readonly diagnostics?: readonly SmartRoofDiagnostic[];
  },
): SmartRoofDrawingDraftSession {
  const undoStack = options.pushUndo ? [...session.undoStack, clone(session.graph)].slice(-50) : session.undoStack;
  const compile = compileDraft(graph, options);
  return {
    ...session,
    graph,
    selected: options.selected !== undefined ? options.selected : session.selected,
    chain: options.chain !== undefined ? options.chain : session.chain,
    hover: options.hover !== undefined ? options.hover : session.hover,
    undoStack,
    redoStack: options.redoStack !== undefined ? options.redoStack : (options.pushUndo ? [] : session.redoStack),
    compile,
    applicationCandidate: null,
    dirty: options.dirty ?? session.dirty,
    diagnostics: [...compile.result.diagnostics, ...(options.diagnostics ?? [])],
  };
}

function withGraphOperation(
  session: SmartRoofDrawingDraftSession,
  operation: SmartRoofOperationResult,
  options: {
    readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
    readonly previousPans?: LegacyCalpinageStateLike["pans"];
    readonly modelTolerancePx?: number;
    readonly selected?: SmartRoofDraftSelection | null;
    readonly chain?: SmartRoofDrawingDraftSession["chain"];
    readonly hover?: SmartRoofDraftSnap | null;
  },
): SmartRoofDrawingDraftSession {
  return withCompiled(session, operation.graph, {
    ...options,
    pushUndo: true,
    dirty: true,
    diagnostics: operation.diagnostics,
  });
}

function resolveSnapAsNode(
  graph: SmartRoofSketchGraph,
  snap: SmartRoofDraftSnap,
  modelTolerancePx: number,
  activeGroupId: string | null,
): { readonly graph: SmartRoofSketchGraph; readonly nodeId: string; readonly diagnostics: readonly SmartRoofDiagnostic[] } {
  if (snap.kind === "node") return { graph, nodeId: snap.nodeId, diagnostics: [] };
  if (snap.kind === "segment") {
    const nodeId = nextUnusedId(`${snap.segmentId}:draft-junction`, graph.nodes);
    const split = splitSketchSegmentAtPoint(graph, snap.segmentId, { x: snap.point.x, y: snap.point.y, nodeId }, { modelTolerancePx });
    const resolved = Object.keys(split.mapping?.nodes ?? {})[0] ?? nodeId;
    return { graph: split.graph, nodeId: resolved, diagnostics: split.diagnostics };
  }
  const nodeId = nextUnusedId("draft-node", graph.nodes);
  const added = addSketchNode(graph, {
    id: nodeId,
    x: snap.point.x,
    y: snap.point.y,
    groupId: activeGroupId,
    provenance: { source: "draft" },
  });
  return { graph: added.graph, nodeId, diagnostics: added.diagnostics };
}

function addUnknownSegmentBetweenNodes(
  graph: SmartRoofSketchGraph,
  startNodeId: string,
  endNodeId: string,
  groupId: string | null,
): SmartRoofOperationResult {
  const start = nodeById(graph, startNodeId);
  const end = nodeById(graph, endNodeId);
  if (!start || !end) {
    return { graph, diagnostics: [diagnostic("error", "DRAFT_ENDPOINT_MISSING", "Draft segment endpoint was missing.", [startNodeId, endNodeId])] };
  }
  if (distance(start, end) <= DEFAULT_MODEL_TOLERANCE_PX) {
    return { graph, diagnostics: [diagnostic("warning", "ZERO_LENGTH_SEGMENT_SKIPPED", "Zero-length draft segment was ignored.", [startNodeId, endNodeId])] };
  }
  return addSketchSegment(graph, {
    id: nextUnusedId("draft-segment", graph.segments),
    start: { nodeId: startNodeId },
    end: { nodeId: endNodeId },
    groupId: groupId ?? start.groupId ?? end.groupId ?? null,
    levelId: start.levelId ?? end.levelId ?? null,
    role: { value: "unknown", source: "unset" },
    provenance: { source: "draft", parentNodeIds: [startNodeId, endNodeId] },
  });
}

function groupUngroupedElementsForDistinctVolume(
  graph: SmartRoofSketchGraph,
): { readonly graph: SmartRoofSketchGraph; readonly diagnostics: readonly SmartRoofDiagnostic[] } {
  const hasUngroupedNodes = graph.nodes.some((node) => (node.groupId ?? null) === null);
  const hasUngroupedSegments = graph.segments.some((segment) => (segment.groupId ?? null) === null);
  if (!hasUngroupedNodes && !hasUngroupedSegments) return { graph, diagnostics: [] };
  if (graph.nodes.length === 0 && graph.segments.length === 0) return { graph, diagnostics: [] };

  const groupId = nextUnusedId("draft-volume", graph.groups);
  const groupLabel = `Volume ${graph.groups.length + 1}`;
  return {
    graph: {
      ...graph,
      groups: [
        ...graph.groups,
        {
          id: groupId,
          label: groupLabel,
          kind: "building",
          parentGroupId: null,
        },
      ],
      nodes: graph.nodes.map((node) => (
        (node.groupId ?? null) === null ? { ...node, groupId } : node
      )),
      segments: graph.segments.map((segment) => (
        (segment.groupId ?? null) === null ? { ...segment, groupId } : segment
      )),
    },
    diagnostics: [
      diagnostic(
        "info",
        "SMART_ROOF_PREVIOUS_VOLUME_GROUPED",
        "Le volume deja dessine a ete conserve comme volume distinct avant de commencer le suivant.",
        [groupId],
      ),
    ],
  };
}

function startDraftGroup(
  graph: SmartRoofSketchGraph,
  label?: string,
): { readonly graph: SmartRoofSketchGraph; readonly groupId: string; readonly diagnostics: readonly SmartRoofDiagnostic[] } {
  const grouped = groupUngroupedElementsForDistinctVolume(graph);
  const baseGraph = grouped.graph;
  const groupId = nextUnusedId("draft-volume", baseGraph.groups);
  const fallbackLabel = `Volume ${baseGraph.groups.length + 1}`;
  return {
    groupId,
    graph: {
      ...baseGraph,
      groups: [
        ...baseGraph.groups,
        {
          id: groupId,
          label: label && label.trim() ? label.trim() : fallbackLabel,
          kind: "building",
          parentGroupId: null,
        },
      ],
    },
    diagnostics: [
      ...grouped.diagnostics,
      diagnostic(
        "info",
        "SMART_ROOF_VOLUME_GROUP_STARTED",
        "Un volume distinct a ete cree : les accroches restent locales pour eviter de fusionner deux toitures accolees a hauteurs differentes.",
        [groupId],
      ),
    ],
  };
}

function ensureActiveGroupExists(
  session: SmartRoofDrawingDraftSession,
): SmartRoofDrawingDraftSession {
  if (session.activeGroupId == null) return session;
  if (session.graph.groups.some((group) => group.id === session.activeGroupId)) return session;
  return { ...session, activeGroupId: null };
}

function initialSession(options: {
  readonly sourceState: LegacyCalpinageStateLike;
  readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
  readonly modelTolerancePx?: number;
}): SmartRoofDrawingDraftSession {
  const persistedRead = readSmartRoofPersistedDrawing((options.sourceState as Record<string, unknown>).smartRoofDrawing);
  const imported = persistedRead.persisted ? null : importLegacyRoofToSmartSketch(options.sourceState);
  const graph = persistedRead.persisted
    ? persistedRead.persisted.graph
    : imported!.graph.segments.length || imported!.graph.nodes.length
      ? imported!.graph
      : createSmartRoofSketchGraph({ metadata: { createdFrom: "empty", modelTolerancePx: options.modelTolerancePx } });
  const compile = compileDraft(graph, {
    computePansFromGeometryCore: options.computePansFromGeometryCore,
    previousPans: options.sourceState.pans,
    modelTolerancePx: options.modelTolerancePx,
  });
  return {
    sourceRevision: smartRoofLegacyDrawingRevision(options.sourceState),
    sourceImportCount: persistedRead.persisted ? 0 : 1,
    graph,
    activeGroupId: null,
    tool: "draw",
    chain: null,
    hover: null,
    selected: null,
    drag: null,
    undoStack: [],
    redoStack: [],
    compile,
    applicationCandidate: null,
    dirty: false,
    diagnostics: [...persistedRead.diagnostics, ...(imported?.diagnostics ?? []), ...compile.result.diagnostics],
  };
}

export function createSmartRoofDrawingDraftRuntimeApi(options: {
  readonly sourceState: LegacyCalpinageStateLike;
  readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
  readonly modelTolerancePx?: number;
  readonly screenSnapTolerancePx?: number;
}): SmartRoofDrawingDraftRuntimeApi {
  const modelTolerancePx = options.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  const screenSnapTolerancePx = options.screenSnapTolerancePx ?? DEFAULT_SCREEN_SNAP_TOLERANCE_PX;
  const sourceSnapshot = clone(options.sourceState);
  let disposed = false;
  let session = initialSession({
    sourceState: sourceSnapshot,
    computePansFromGeometryCore: options.computePansFromGeometryCore,
    modelTolerancePx,
  });

  const assertAlive = (): void => {
    if (disposed) throw new Error("Smart roof drawing draft runtime has been disposed.");
  };
  const compileOptions = () => ({
    computePansFromGeometryCore: options.computePansFromGeometryCore,
    previousPans: sourceSnapshot.pans,
    modelTolerancePx,
  });
  const snapAt = (point: { readonly x: number; readonly y: number }, viewportScale: number) => (
    findSmartRoofDraftSnap(session.graph, point, {
      viewportScale,
      screenSnapTolerancePx,
      activeGroupId: session.activeGroupId,
    })
  );

  return {
    getState() {
      assertAlive();
      return session;
    },
    setTool(tool) {
      assertAlive();
      session = { ...session, tool, chain: tool === "draw" ? session.chain : null, drag: null };
      return session;
    },
    updateHover(point, viewportScale) {
      assertAlive();
      session = { ...session, hover: snapAt(point, viewportScale) };
      return session;
    },
    pointerDown(point, viewportScale) {
      assertAlive();
      const snap = snapAt(point, viewportScale);
      if (session.tool === "draw") {
        const beforeGraph = session.graph;
        const resolved = resolveSnapAsNode(beforeGraph, snap, modelTolerancePx, session.activeGroupId);
        if (!session.chain) {
          const changed = resolved.graph !== beforeGraph;
          session = changed
            ? withCompiled(session, resolved.graph, {
                ...compileOptions(),
                pushUndo: true,
                dirty: true,
                selected: { type: "node", nodeId: resolved.nodeId },
                chain: { startNodeId: resolved.nodeId, lastNodeId: resolved.nodeId },
                hover: snap,
                diagnostics: resolved.diagnostics,
              })
            : {
                ...session,
                selected: { type: "node", nodeId: resolved.nodeId },
                chain: { startNodeId: resolved.nodeId, lastNodeId: resolved.nodeId },
                hover: snap,
              };
          return session;
        }

        const addingFrom = session.chain.lastNodeId;
        const closingLoop = resolved.nodeId === session.chain.startNodeId && addingFrom !== resolved.nodeId;
        const withEndNode = resolved.graph;
        const addedSegment = addUnknownSegmentBetweenNodes(withEndNode, addingFrom, resolved.nodeId, session.activeGroupId);
        session = withGraphOperation(session, {
          graph: addedSegment.graph,
          diagnostics: [...resolved.diagnostics, ...addedSegment.diagnostics],
          mapping: addedSegment.mapping,
        }, {
          ...compileOptions(),
          selected: addedSegment.graph.segments.length > 0
            ? { type: "segment", segmentId: addedSegment.graph.segments[addedSegment.graph.segments.length - 1]!.id }
            : session.selected,
          chain: closingLoop ? null : { startNodeId: session.chain.startNodeId, lastNodeId: resolved.nodeId },
          hover: snap,
        });
        return session;
      }

      if (snap.kind === "node") {
        session = {
          ...session,
          hover: snap,
          selected: { type: "node", nodeId: snap.nodeId },
          drag: { nodeId: snap.nodeId, previewPoint: snap.point },
        };
        return session;
      }
      if (snap.kind === "segment") {
        session = { ...session, hover: snap, selected: { type: "segment", segmentId: snap.segmentId }, drag: null };
        return session;
      }
      session = { ...session, hover: snap, selected: null, drag: null };
      return session;
    },
    pointerMove(point, viewportScale) {
      assertAlive();
      const hover = snapAt(point, viewportScale);
      if (session.drag && session.tool === "select") {
        session = { ...session, hover, drag: { ...session.drag, previewPoint: hover.point } };
        return session;
      }
      session = { ...session, hover };
      return session;
    },
    pointerUp(point) {
      assertAlive();
      if (!session.drag || session.tool !== "select") return session;
      const drag = session.drag;
      const start = nodeById(session.graph, drag.nodeId);
      const previewPoint = drag.previewPoint ?? point;
      if (!start || distance(start, previewPoint) <= modelTolerancePx) {
        session = { ...session, drag: null };
        return session;
      }
      const moved = moveSketchNode(session.graph, drag.nodeId, previewPoint);
      session = withGraphOperation(session, moved, {
        ...compileOptions(),
        selected: { type: "node", nodeId: drag.nodeId },
        chain: null,
        hover: { kind: "node", point: previewPoint, nodeId: drag.nodeId, distancePx: 0 },
      });
      session = { ...session, drag: null };
      return session;
    },
    finishChain() {
      assertAlive();
      session = { ...session, chain: null, hover: null };
      return session;
    },
    cancelOrSelect() {
      assertAlive();
      if (session.chain) {
        session = { ...session, chain: null, hover: null };
      } else {
        session = { ...session, tool: "select", drag: null, hover: null };
      }
      return session;
    },
    deleteSelection() {
      assertAlive();
      if (!session.selected || session.selected.type !== "segment") return session;
      const removed = removeSketchSegment(session.graph, session.selected.segmentId);
      session = withGraphOperation(session, removed, {
        ...compileOptions(),
        selected: null,
        chain: null,
        hover: null,
      });
      return session;
    },
    setSelectedNodeHeight(height) {
      assertAlive();
      if (!session.selected || session.selected.type !== "node") return session;
      const changed = setSketchNodeHeight(session.graph, session.selected.nodeId, height);
      session = withGraphOperation(session, changed, {
        ...compileOptions(),
        selected: session.selected,
        chain: null,
        hover: null,
      });
      return session;
    },
    setSelectedSegmentHeight(height) {
      assertAlive();
      if (!session.selected || session.selected.type !== "segment") return session;
      const changed = setSketchSegmentHeight(session.graph, session.selected.segmentId, height, {
        applyToEndpoints: true,
        overrideLockedEndpoints: true,
      });
      session = withGraphOperation(session, changed, {
        ...compileOptions(),
        selected: session.selected,
        chain: null,
        hover: null,
      });
      return session;
    },
    setAllNodeHeights(height) {
      assertAlive();
      const changed = session.activeGroupId == null
        ? setAllSketchNodeHeights(session.graph, height)
        : setSketchNodeHeightsForGroup(session.graph, session.activeGroupId, height);
      session = withGraphOperation(session, changed, {
        ...compileOptions(),
        selected: session.selected,
        chain: null,
        hover: null,
      });
      return session;
    },
    startNewGroup(label) {
      assertAlive();
      const started = startDraftGroup(session.graph, label);
      session = withCompiled(session, started.graph, {
        ...compileOptions(),
        pushUndo: true,
        dirty: true,
        selected: null,
        chain: null,
        hover: null,
        diagnostics: started.diagnostics,
      });
      session = { ...session, activeGroupId: started.groupId, tool: "draw" };
      return session;
    },
    setSelectedSegmentRole(role) {
      assertAlive();
      if (!session.selected || session.selected.type !== "segment") return session;
      const changed = setSketchSegmentRole(session.graph, session.selected.segmentId, {
        value: role,
        source: role === "unknown" ? "unset" : "manual",
      });
      session = withGraphOperation(session, changed, {
        ...compileOptions(),
        selected: session.selected,
        chain: null,
        hover: null,
      });
      return session;
    },
    prepareApplication(state) {
      assertAlive();
      const currentState = state ?? sourceSnapshot;
      const candidate = prepareSmartRoofDrawingApplication({
        graph: session.graph,
        sourceState: currentState,
        sourceRevision: session.sourceRevision,
        currentSourceRevision: smartRoofLegacyDrawingRevision(currentState),
        draftRevision: session.compile.revision,
        computePansFromGeometryCore: options.computePansFromGeometryCore,
        modelTolerancePx,
      });
      session = {
        ...session,
        applicationCandidate: candidate,
        diagnostics: [...session.diagnostics, ...candidate.diagnostics],
      };
      return candidate;
    },
    undo() {
      assertAlive();
      if (session.undoStack.length === 0) return session;
      const previous = session.undoStack[session.undoStack.length - 1]!;
      const remaining = session.undoStack.slice(0, -1);
      session = withCompiled(session, clone(previous), {
        ...compileOptions(),
        pushUndo: false,
        dirty: true,
        selected: null,
        chain: null,
        hover: null,
        redoStack: [...session.redoStack, clone(session.graph)].slice(-50),
      });
      session = { ...session, undoStack: remaining };
      session = ensureActiveGroupExists(session);
      return session;
    },
    redo() {
      assertAlive();
      if (session.redoStack.length === 0) return session;
      const current = clone(session.graph);
      const next = session.redoStack[session.redoStack.length - 1]!;
      const remaining = session.redoStack.slice(0, -1);
      session = withCompiled(session, clone(next), {
        ...compileOptions(),
        pushUndo: false,
        dirty: true,
        selected: null,
        chain: null,
        hover: null,
        redoStack: remaining,
      });
      session = { ...session, undoStack: [...session.undoStack, current].slice(-50) };
      session = ensureActiveGroupExists(session);
      return session;
    },
    checkSourceRevision(state) {
      assertAlive();
      const currentRevision = smartRoofLegacyDrawingRevision(state);
      if (currentRevision === session.sourceRevision) return session;
      session = {
        ...session,
        compile: { ...session.compile, status: "source_stale", message: "Dessin source modifie - quittez puis rouvrez l'essai" },
        diagnostics: [
          ...session.diagnostics,
          diagnostic("warning", "DRAFT_SOURCE_REVISION_STALE", "The active drawing changed after the draft session was opened; the draft remains isolated and must not be mixed silently."),
        ],
      };
      return session;
    },
    dispose() {
      disposed = true;
      session = {
        ...session,
        graph: createSmartRoofSketchGraph(),
        chain: null,
        hover: null,
        selected: null,
        drag: null,
        undoStack: [],
        redoStack: [],
        applicationCandidate: null,
      };
    },
  };
}

export function connectDraftEndpointToNode(
  graph: SmartRoofSketchGraph,
  segmentId: string,
  endpoint: "start" | "end",
  targetNodeId: string,
): SmartRoofOperationResult {
  return connectSegmentEndpointToNode(graph, segmentId, endpoint, targetNodeId);
}
