import {
  canonicalPolygonKey,
  DEFAULT_MODEL_TOLERANCE_PX,
  polygonArea,
  pointOnSegment,
  projectPointOnSegment,
  signedPolygonArea,
} from "./geometry";
import {
  createSmartRoofSketchGraph,
  normalizeSketchGraph,
  splitSketchSegmentAtPoint,
} from "./operations";
import { reconcileSmartRoofPanIdentities, type SmartRoofPanLike } from "./panReconciliation";
import type {
  SmartRoofDiagnostic,
  SmartRoofLegacyAttach,
  SmartRoofLineRole,
  SmartRoofNode,
  SmartRoofSegment,
  SmartRoofSketchGraph,
} from "./types";

export interface LegacyCalpinagePoint {
  readonly x: number;
  readonly y: number;
  readonly h?: number;
  readonly heightM?: number;
  readonly attach?: Record<string, unknown> | null;
  readonly [key: string]: unknown;
}

export interface LegacyCalpinageLine {
  readonly id?: string;
  readonly a?: LegacyCalpinagePoint;
  readonly b?: LegacyCalpinagePoint;
  readonly roofRole?: string;
  readonly [key: string]: unknown;
}

export interface LegacyCalpinageContour {
  readonly id?: string;
  readonly points?: readonly LegacyCalpinagePoint[];
  readonly roofRole?: string;
  readonly [key: string]: unknown;
}

export interface LegacyCalpinageStateLike {
  readonly contours?: readonly LegacyCalpinageContour[];
  readonly traits?: readonly LegacyCalpinageLine[];
  readonly ridges?: readonly LegacyCalpinageLine[];
  readonly pans?: readonly SmartRoofPanLike[];
  readonly roof?: unknown;
  readonly [key: string]: unknown;
}

export interface SmartRoofLegacyState {
  readonly contours: readonly LegacyCalpinageContour[];
  readonly traits: readonly LegacyCalpinageLine[];
  readonly ridges: readonly LegacyCalpinageLine[];
  readonly pans: readonly SmartRoofPanLike[];
  readonly roof: Record<string, unknown>;
}

export interface SmartRoofLegacyImportResult {
  readonly graph: SmartRoofSketchGraph;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly mapping: {
    readonly legacyToSmart: Readonly<Record<string, string>>;
    readonly smartToLegacy: Readonly<Record<string, string>>;
  };
}

export type ComputePansFromGeometryCore = (
  state: Record<string, unknown>,
  opts?: { readonly excludeChienAssis?: boolean; readonly topologyTolerancePx?: number },
) => unknown;

export interface SmartRoofCompileResult {
  readonly legacyState: SmartRoofLegacyState;
  readonly normalizedGraph: SmartRoofSketchGraph;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly status: "empty" | "incomplete" | "ambiguous" | "topology_ready" | "engine_error";
  readonly mapping: {
    readonly smartToLegacy: Readonly<Record<string, string>>;
    readonly legacyToSmart: Readonly<Record<string, string>>;
    readonly panIdMapping: Readonly<Record<string, string>>;
  };
}

type SmartRoofOutlineComponent = {
  readonly points: readonly SmartRoofNode[];
  readonly segmentIds: readonly string[];
  readonly inferredFromUnknown?: boolean;
};

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

function finiteHeight(point: LegacyCalpinagePoint | undefined): SmartRoofNode["height"] | undefined {
  const raw = typeof point?.h === "number" ? point.h : typeof point?.heightM === "number" ? point.heightM : null;
  if (raw == null || !Number.isFinite(raw)) return undefined;
  return { valueM: raw, source: "legacy" };
}

function lineRole(kind: "contour" | "trait" | "ridge"): SmartRoofLineRole {
  if (kind === "contour") return "outline";
  if (kind === "ridge") return "ridge";
  return "trait";
}

function attachKey(attach: Record<string, unknown> | null | undefined): string | null {
  if (!attach || typeof attach.type !== "string") return null;
  if (attach.type === "contour") return `contour:${String(attach.id)}:v:${String(attach.pointIndex)}`;
  if (attach.type === "roof_contour_edge") return `contour:${String(attach.contourId)}:s:${String(attach.segmentIndex)}:t:${String(attach.t)}`;
  if (attach.type === "trait") return `trait:${String(attach.id)}:p:${String(attach.pointIndex)}`;
  return null;
}

function validLegacyAttach(value: unknown): SmartRoofLegacyAttach | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.type !== "string") return null;
  return rec as SmartRoofLegacyAttach;
}

function legacyPointToNode(
  point: LegacyCalpinagePoint,
  id: string,
  groupId: string,
  legacyKey: string,
): SmartRoofNode {
  return {
    id,
    x: point.x,
    y: point.y,
    groupId,
    levelId: null,
    ...(finiteHeight(point) ? { height: finiteHeight(point) } : {}),
    provenance: {
      source: "legacy",
      sourceIds: [legacyKey],
    },
  };
}

function addLineSegment(
  graph: SmartRoofSketchGraph,
  segment: SmartRoofSegment,
): SmartRoofSketchGraph {
  return {
    ...graph,
    segments: [...graph.segments, segment],
  };
}

export function importLegacyRoofToSmartSketch(
  state: LegacyCalpinageStateLike,
): SmartRoofLegacyImportResult {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "legacy" } });
  const diagnostics: SmartRoofDiagnostic[] = [];
  const legacyToSmart: Record<string, string> = {};
  const smartToLegacy: Record<string, string> = {};

  const contourSegmentByLegacy = new Map<string, string>();
  const contourVertexByLegacy = new Map<string, string>();
  const nodes: SmartRoofNode[] = [];
  const addNode = (node: SmartRoofNode, legacyKey: string): string => {
    const existing = nodes.find((n) => n.id === node.id);
    if (existing) return existing.id;
    nodes.push(node);
    legacyToSmart[legacyKey] = node.id;
    smartToLegacy[node.id] = legacyKey;
    return node.id;
  };

  for (const [contourIndex, contour] of [...(state.contours ?? [])].entries()) {
    const contourId = contour.id != null ? String(contour.id) : `contour-${contourIndex}`;
    const points = contour.points ?? [];
    const groupId = `legacy-contour:${contourId}`;
    for (let i = 0; i < points.length; i++) {
      const legacyKey = `contour:${contourId}:v:${i}`;
      const nodeId = `legacy:contour:${contourId}:v:${i}`;
      contourVertexByLegacy.set(legacyKey, nodeId);
      addNode(legacyPointToNode(points[i]!, nodeId, groupId, legacyKey), legacyKey);
    }
  }

  graph = { ...graph, nodes };

  for (const [contourIndex, contour] of [...(state.contours ?? [])].entries()) {
    const contourId = contour.id != null ? String(contour.id) : `contour-${contourIndex}`;
    const points = contour.points ?? [];
    const groupId = `legacy-contour:${contourId}`;
    if (points.length < 2) continue;
    for (let i = 0; i < points.length; i++) {
      const segmentId = `legacy:contour:${contourId}:s:${i}`;
      const startNodeId = `legacy:contour:${contourId}:v:${i}`;
      const endNodeId = `legacy:contour:${contourId}:v:${(i + 1) % points.length}`;
      const legacyKey = `contour:${contourId}:s:${i}`;
      contourSegmentByLegacy.set(legacyKey, segmentId);
      legacyToSmart[legacyKey] = segmentId;
      smartToLegacy[segmentId] = legacyKey;
      graph = addLineSegment(graph, {
        id: segmentId,
        startNodeId,
        endNodeId,
        groupId,
        levelId: null,
        role: { value: "outline", source: "legacy", locked: true },
        provenance: { source: "legacy", sourceIds: [legacyKey], legacy: { kind: "contour", id: contourId, segmentIndex: i } },
      });
    }
  }

  const ensureContourEdgeNode = (
    attach: Record<string, unknown>,
    point: LegacyCalpinagePoint,
  ): string | null => {
    const contourId = String(attach.contourId);
    const segmentIndex = Number(attach.segmentIndex);
    const t = Number(attach.t);
    if (!Number.isFinite(segmentIndex) || !Number.isFinite(t)) return null;
    const contourVertexKey = t <= DEFAULT_MODEL_TOLERANCE_PX
      ? `contour:${contourId}:v:${segmentIndex}`
      : t >= 1 - DEFAULT_MODEL_TOLERANCE_PX
        ? `contour:${contourId}:v:${segmentIndex + 1}`
        : null;
    if (contourVertexKey && contourVertexByLegacy.has(contourVertexKey)) {
      return contourVertexByLegacy.get(contourVertexKey)!;
    }
    const segmentKey = `contour:${contourId}:s:${segmentIndex}`;
    const segmentId = contourSegmentByLegacy.get(segmentKey);
    if (!segmentId) return null;
    const nodeId = `legacy:contour:${contourId}:s:${segmentIndex}:t:${t.toFixed(6)}`;
    graph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        legacyPointToNode(point, nodeId, `legacy-contour:${contourId}`, `${segmentKey}:t:${t}`),
      ],
    };
    const split = splitSketchSegmentAtPoint(graph, segmentId, { x: point.x, y: point.y, nodeId });
    graph = split.graph;
    for (const [parent, children] of Object.entries(split.mapping?.segments ?? {})) {
      legacyToSmart[segmentKey] = children.join(",");
      smartToLegacy[parent] = segmentKey;
      for (const child of children) smartToLegacy[child] = segmentKey;
    }
    return nodeId;
  };

  const addStructural = (kind: "trait" | "ridge", line: LegacyCalpinageLine, index: number): void => {
    const lineId = line.id != null ? String(line.id) : `${kind}-${index}`;
    const endpointNode = (endpoint: "a" | "b", point: LegacyCalpinagePoint | undefined): string => {
      const p = point ?? { x: 0, y: 0 };
      const attach = p.attach && typeof p.attach === "object" ? p.attach : null;
      const key = attachKey(attach);
      if (key?.startsWith("contour:") && contourVertexByLegacy.has(key)) return contourVertexByLegacy.get(key)!;
      if (attach?.type === "roof_contour_edge") {
        const nodeId = ensureContourEdgeNode(attach, p);
        if (nodeId) return nodeId;
      }
      const nodeId = `legacy:${kind}:${lineId}:${endpoint}`;
      const legacyKey = `${kind}:${lineId}:${endpoint}`;
      graph = { ...graph, nodes: [...graph.nodes, legacyPointToNode(p, nodeId, `legacy-structural:${lineId}`, legacyKey)] };
      legacyToSmart[legacyKey] = nodeId;
      smartToLegacy[nodeId] = legacyKey;
      if (key) diagnostics.push(diagnostic("warning", "LEGACY_ATTACH_PRESERVED_NOT_RESOLVED", "A legacy attach was preserved as metadata but not converted to a graph connection.", [lineId]));
      return nodeId;
    };
    const startNodeId = endpointNode("a", line.a);
    const endNodeId = endpointNode("b", line.b);
    const segmentId = `legacy:${kind}:${lineId}`;
    const legacyKey = `${kind}:${lineId}`;
    legacyToSmart[legacyKey] = segmentId;
    smartToLegacy[segmentId] = legacyKey;
    graph = addLineSegment(graph, {
      id: segmentId,
      startNodeId,
      endNodeId,
      groupId: null,
      levelId: null,
      role: { value: lineRole(kind), source: "legacy", locked: true },
      startAttach: validLegacyAttach(line.a?.attach),
      endAttach: validLegacyAttach(line.b?.attach),
      provenance: { source: "legacy", sourceIds: [legacyKey], legacy: { kind, id: lineId } },
    });
  };

  for (const [index, trait] of [...(state.traits ?? [])].entries()) addStructural("trait", trait, index);
  for (const [index, ridge] of [...(state.ridges ?? [])].entries()) addStructural("ridge", ridge, index);

  return { graph, diagnostics, mapping: { legacyToSmart, smartToLegacy } };
}

function nodeHeightForLegacy(node: SmartRoofNode): { readonly h?: number } {
  return node.height && Number.isFinite(node.height.valueM) ? { h: node.height.valueM } : {};
}

function orderedOutlineComponents(
  graph: SmartRoofSketchGraph,
): SmartRoofOutlineComponent[] {
  const outlineSegments = graph.segments.filter((segment) => segment.role.value === "outline");
  const byNode = new Map<string, SmartRoofSegment[]>();
  for (const segment of outlineSegments) {
    byNode.set(segment.startNodeId, [...(byNode.get(segment.startNodeId) ?? []), segment]);
    byNode.set(segment.endNodeId, [...(byNode.get(segment.endNodeId) ?? []), segment]);
  }
  const visited = new Set<string>();
  const components: { points: SmartRoofNode[]; segmentIds: string[] }[] = [];
  for (const first of outlineSegments.sort((a, b) => a.id.localeCompare(b.id))) {
    if (visited.has(first.id)) continue;
    const pointIds = [first.startNodeId, first.endNodeId];
    const segmentIds = [first.id];
    visited.add(first.id);
    let currentNodeId = first.endNodeId;
    let previousNodeId = first.startNodeId;
    for (let guard = 0; guard < outlineSegments.length + 2; guard++) {
      const candidates = (byNode.get(currentNodeId) ?? []).filter((segment) => !visited.has(segment.id));
      const next = candidates.find((segment) => segment.startNodeId !== previousNodeId || segment.endNodeId !== previousNodeId);
      if (!next) break;
      visited.add(next.id);
      segmentIds.push(next.id);
      const nextNodeId = next.startNodeId === currentNodeId ? next.endNodeId : next.startNodeId;
      if (nextNodeId === pointIds[0]) {
        currentNodeId = nextNodeId;
        break;
      }
      pointIds.push(nextNodeId);
      previousNodeId = currentNodeId;
      currentNodeId = nextNodeId;
    }
    if (currentNodeId === pointIds[0] && pointIds.length >= 3) {
      const points = pointIds.map((id) => graph.nodes.find((node) => node.id === id)).filter(Boolean) as SmartRoofNode[];
      components.push({ points, segmentIds });
    }
  }
  return components;
}

function nodeMap(graph: SmartRoofSketchGraph): ReadonlyMap<string, SmartRoofNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function segmentPairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}

function directedPairKey(a: string, b: string): string {
  return `${a}->${b}`;
}

function angleBetweenNodes(nodes: ReadonlyMap<string, SmartRoofNode>, from: string, to: string): number {
  const a = nodes.get(from);
  const b = nodes.get(to);
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function nextFaceNeighbor(
  nodes: ReadonlyMap<string, SmartRoofNode>,
  adjacency: ReadonlyMap<string, readonly string[]>,
  vertex: string,
  incomingFrom: string,
): string | null {
  const neighbors = adjacency.get(vertex) ?? [];
  if (neighbors.length === 0) return null;
  const inAngle = angleBetweenNodes(nodes, vertex, incomingFrom);
  let best: string | null = null;
  let bestDelta = Infinity;
  for (const candidate of neighbors) {
    if (candidate === incomingFrom) continue;
    const outAngle = angleBetweenNodes(nodes, vertex, candidate);
    let delta = outAngle - inAngle;
    while (delta <= 0) delta += 2 * Math.PI;
    while (delta > 2 * Math.PI) delta -= 2 * Math.PI;
    if (delta < 1e-10) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

function componentKeysForUnknownSegments(
  segments: readonly SmartRoofSegment[],
): ReadonlyMap<string, string> {
  const adjacency = new Map<string, string[]>();
  for (const segment of segments) {
    adjacency.set(segment.startNodeId, [...(adjacency.get(segment.startNodeId) ?? []), segment.endNodeId]);
    adjacency.set(segment.endNodeId, [...(adjacency.get(segment.endNodeId) ?? []), segment.startNodeId]);
  }

  const result = new Map<string, string>();
  const visited = new Set<string>();
  for (const nodeId of [...adjacency.keys()].sort()) {
    if (visited.has(nodeId)) continue;
    const stack = [nodeId];
    const component: string[] = [];
    visited.add(nodeId);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    const key = component.sort().join("|");
    for (const id of component) result.set(id, key);
  }
  return result;
}

function inferUnknownClosedOutlineComponents(
  graph: SmartRoofSketchGraph,
  tolerance: number,
): { readonly components: readonly SmartRoofOutlineComponent[]; readonly diagnostics: readonly SmartRoofDiagnostic[] } {
  const diagnostics: SmartRoofDiagnostic[] = [];
  const unknownSegments = graph.segments.filter((segment) => segment.role.value === "unknown");
  if (unknownSegments.length === 0) return { components: [], diagnostics };

  const nodes = nodeMap(graph);
  const adjacency = new Map<string, string[]>();
  const segmentByPair = new Map<string, SmartRoofSegment>();
  for (const segment of [...unknownSegments].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!nodes.has(segment.startNodeId) || !nodes.has(segment.endNodeId)) continue;
    adjacency.set(segment.startNodeId, [...(adjacency.get(segment.startNodeId) ?? []), segment.endNodeId].sort());
    adjacency.set(segment.endNodeId, [...(adjacency.get(segment.endNodeId) ?? []), segment.startNodeId].sort());
    const key = segmentPairKey(segment.startNodeId, segment.endNodeId);
    if (!segmentByPair.has(key)) segmentByPair.set(key, segment);
  }

  type FaceCandidate = {
    readonly nodeIds: readonly string[];
    readonly points: readonly SmartRoofNode[];
    readonly segmentIds: readonly string[];
    readonly area: number;
    readonly componentKey: string;
    readonly key: string;
  };

  const componentByNode = componentKeysForUnknownSegments(unknownSegments);
  const seenFaces = new Set<string>();
  const candidates: FaceCandidate[] = [];
  const walk = (startFrom: string, startTo: string): void => {
    const path = [startFrom, startTo];
    let previous = startFrom;
    let current = startTo;
    const guardLimit = Math.max(16, unknownSegments.length * 6);
    for (let guard = 0; guard < guardLimit; guard++) {
      const next = nextFaceNeighbor(nodes, adjacency, current, previous);
      if (next == null) return;
      if (next === startFrom) {
        const points = path.map((id) => nodes.get(id)).filter(Boolean) as SmartRoofNode[];
        if (points.length < 3) return;
        const area = polygonArea(points);
        if (area <= tolerance) return;
        const key = canonicalPolygonKey(points, 5);
        if (seenFaces.has(key)) return;
        seenFaces.add(key);
        const segmentIds: string[] = [];
        for (let i = 0; i < path.length; i++) {
          const a = path[i]!;
          const b = path[(i + 1) % path.length]!;
          const segment = segmentByPair.get(segmentPairKey(a, b));
          if (segment) segmentIds.push(segment.id);
        }
        candidates.push({
          nodeIds: path,
          points,
          segmentIds,
          area,
          componentKey: componentByNode.get(startFrom) ?? startFrom,
          key,
        });
        return;
      }
      if (path.includes(next)) return;
      path.push(next);
      previous = current;
      current = next;
    }
  };

  const visitedDirected = new Set<string>();
  for (const segment of unknownSegments) {
    for (const [from, to] of [[segment.startNodeId, segment.endNodeId], [segment.endNodeId, segment.startNodeId]] as const) {
      const directed = directedPairKey(from, to);
      if (visitedDirected.has(directed)) continue;
      visitedDirected.add(directed);
      walk(from, to);
    }
  }

  const bestByComponent = new Map<string, FaceCandidate>();
  for (const candidate of candidates) {
    const current = bestByComponent.get(candidate.componentKey);
    if (!current || candidate.area > current.area + tolerance || (Math.abs(candidate.area - current.area) <= tolerance && candidate.key < current.key)) {
      bestByComponent.set(candidate.componentKey, candidate);
    }
  }

  const components = [...bestByComponent.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((candidate) => ({
      points: signedPolygonArea(candidate.points) < 0 ? [...candidate.points].reverse() : candidate.points,
      segmentIds: candidate.segmentIds,
      inferredFromUnknown: true,
    }));

  if (components.length > 0) {
    diagnostics.push(diagnostic(
      "info",
      "UNKNOWN_CLOSED_LOOP_COMPILED_AS_CONTOUR_CANDIDATE",
      "A closed loop drawn with unknown lines was sent as a temporary legacy contour candidate for topology; source line roles remain unknown.",
      components.flatMap((component) => component.segmentIds),
    ));
  }

  return { components, diagnostics };
}

function pointInPolygon2D(
  point: { readonly x: number; readonly y: number },
  polygon: readonly { readonly x: number; readonly y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y === b.y) continue;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function nestedContourDiagnostics(contours: readonly LegacyCalpinageContour[]): readonly SmartRoofDiagnostic[] {
  const diagnostics: SmartRoofDiagnostic[] = [];
  for (let i = 0; i < contours.length; i++) {
    const a = contours[i]!;
    const aPoints = a.points ?? [];
    if (aPoints.length < 3) continue;
    for (let j = i + 1; j < contours.length; j++) {
      const b = contours[j]!;
      const bPoints = b.points ?? [];
      if (bPoints.length < 3) continue;
      const aInsideB = pointInPolygon2D(aPoints[0]!, bPoints);
      const bInsideA = pointInPolygon2D(bPoints[0]!, aPoints);
      if (!aInsideB && !bInsideA) continue;
      diagnostics.push(diagnostic(
        "warning",
        "HOLE_OR_NESTED_OUTLINE_UNSUPPORTED",
        "Nested closed outlines were detected; this may be a hole, courtyard or stacked roof and is not converted silently into a validated roof.",
        [String(a.id ?? `contour-${i}`), String(b.id ?? `contour-${j}`)],
      ));
    }
  }
  return diagnostics;
}

function endpointAttach(
  node: SmartRoofNode,
  contours: readonly LegacyCalpinageContour[],
  tolerance: number,
): Record<string, unknown> | null {
  for (const contour of contours) {
    const points = contour.points ?? [];
    const contourId = contour.id != null ? String(contour.id) : "";
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      if (Math.hypot(point.x - node.x, point.y - node.y) <= tolerance) {
        return { type: "contour", id: contourId, pointIndex: i };
      }
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (!pointOnSegment(node, a, b, tolerance)) continue;
      const projection = projectPointOnSegment(node, a, b);
      return { type: "roof_contour_edge", contourId, segmentIndex: i, t: projection.t, roofRole: "contour" };
    }
  }
  return null;
}

function segmentToLegacyLine(
  segment: SmartRoofSegment,
  graph: SmartRoofSketchGraph,
  contours: readonly LegacyCalpinageContour[],
  tolerance: number,
): LegacyCalpinageLine | null {
  const a = graph.nodes.find((node) => node.id === segment.startNodeId);
  const b = graph.nodes.find((node) => node.id === segment.endNodeId);
  if (!a || !b) return null;
  const attachA = endpointAttach(a, contours, tolerance);
  const attachB = endpointAttach(b, contours, tolerance);
  return {
    id: segment.id,
    a: { x: a.x, y: a.y, ...nodeHeightForLegacy(a), ...(attachA ? { attach: attachA } : {}) },
    b: { x: b.x, y: b.y, ...nodeHeightForLegacy(b), ...(attachB ? { attach: attachB } : {}) },
    roofRole: "main",
    smartRoofRole: segment.role.value,
    smartRoofRoleSource: segment.role.source,
  };
}

function annotatePanSourceSegments<TPan extends SmartRoofPanLike>(
  pan: TPan,
  graph: SmartRoofSketchGraph,
  tolerance: number,
): TPan {
  const points = (pan.polygon ?? pan.polygonPx ?? []) as readonly { readonly x: number; readonly y: number }[];
  const ids = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    for (const segment of graph.segments) {
      const start = graph.nodes.find((node) => node.id === segment.startNodeId);
      const end = graph.nodes.find((node) => node.id === segment.endNodeId);
      if (!start || !end) continue;
      const sameForward = pointOnSegment(start, a, b, tolerance) && pointOnSegment(end, a, b, tolerance);
      const sameBackward = pointOnSegment(start, b, a, tolerance) && pointOnSegment(end, b, a, tolerance);
      if (sameForward || sameBackward) ids.add(segment.id);
    }
  }
  return { ...pan, smartSourceSegmentIds: [...ids].sort() };
}

export function compileSmartRoofSketchToLegacyState(
  graph: SmartRoofSketchGraph,
  options: { readonly modelTolerancePx?: number } = {},
): SmartRoofCompileResult {
  const tolerance = options.modelTolerancePx ?? graph.metadata?.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  const normalized = normalizeSketchGraph(graph, { modelTolerancePx: tolerance });
  const diagnostics: SmartRoofDiagnostic[] = [...normalized.diagnostics];
  const normalizedGraph = normalized.graph;
  const explicitComponents = orderedOutlineComponents(normalizedGraph);
  const inferred = explicitComponents.length === 0
    ? inferUnknownClosedOutlineComponents(normalizedGraph, tolerance)
    : { components: [] as readonly SmartRoofOutlineComponent[], diagnostics: [] as readonly SmartRoofDiagnostic[] };
  diagnostics.push(...inferred.diagnostics);
  const components = explicitComponents.length > 0 ? explicitComponents : inferred.components;
  const smartToLegacy: Record<string, string> = {};
  const legacyToSmart: Record<string, string> = {};
  const contours = components
    .filter((component) => polygonArea(component.points) > tolerance)
    .map((component, index) => {
      const id = `smart-contour-${index + 1}`;
      for (const segmentId of component.segmentIds) {
        smartToLegacy[segmentId] = `contour:${id}`;
        legacyToSmart[`contour:${id}:segment:${segmentId}`] = segmentId;
      }
      return {
        id,
        roofRole: "contour",
        smartRoofInferredFromUnknown: component.inferredFromUnknown === true,
        points: component.points.map((node) => ({ x: node.x, y: node.y, ...nodeHeightForLegacy(node) })),
        smartSourceSegmentIds: component.segmentIds,
      };
    });
  const contourSegmentIds = new Set<string>(components.flatMap((component) => component.segmentIds));
  diagnostics.push(...nestedContourDiagnostics(contours));

  if (contours.length === 0 && normalizedGraph.segments.length > 0) {
    diagnostics.push(diagnostic("warning", "OUTLINE_OPEN_INCOMPLETE", "No closed outline could be compiled; the drawing remains a valid draft but cannot publish pans yet."));
  }

  const traits: LegacyCalpinageLine[] = [];
  const ridges: LegacyCalpinageLine[] = [];

  for (const segment of normalizedGraph.segments) {
    if (segment.role.value === "outline" || contourSegmentIds.has(segment.id)) continue;
    const line = segmentToLegacyLine(segment, normalizedGraph, contours, tolerance);
    if (!line) {
      diagnostics.push(diagnostic("warning", "SEGMENT_ENDPOINT_MISSING", "Segment references a missing endpoint and was not compiled.", [segment.id]));
      continue;
    }
    if (segment.role.value === "ridge") {
      ridges.push(line);
      smartToLegacy[segment.id] = `ridge:${line.id}`;
      legacyToSmart[`ridge:${line.id}`] = segment.id;
    } else {
      if (segment.role.value === "unknown") {
        diagnostics.push(diagnostic("info", "UNKNOWN_ROLE_COMPILED_AS_TRAIT_FOR_TOPOLOGY", "Unknown structural line was sent as a legacy trait only for planar topology; it is not a confirmed roof role.", [segment.id]));
      }
      traits.push(line);
      smartToLegacy[segment.id] = `trait:${line.id}`;
      legacyToSmart[`trait:${line.id}`] = segment.id;
    }
  }

  const status = normalizedGraph.segments.length === 0
    ? "empty"
    : contours.length === 0
      ? "incomplete"
      : diagnostics.some((item) => (
          item.code === "CROSSING_NOT_CONNECTED_UNSUPPORTED" ||
          item.code === "COLINEAR_OVERLAP_REVIEW_REQUIRED" ||
          item.code === "HOLE_OR_NESTED_OUTLINE_UNSUPPORTED"
        ))
        ? "ambiguous"
        : "topology_ready";

  return {
    legacyState: { contours, traits, ridges, pans: [], roof: {} },
    normalizedGraph,
    diagnostics,
    status,
    mapping: { smartToLegacy, legacyToSmart, panIdMapping: {} },
  };
}

export function compileSmartRoofSketchWithLegacyEngine(
  graph: SmartRoofSketchGraph,
  options: {
    readonly computePansFromGeometryCore: ComputePansFromGeometryCore;
    readonly previousPans?: readonly SmartRoofPanLike[];
    readonly modelTolerancePx?: number;
  },
): SmartRoofCompileResult {
  const compiled = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: options.modelTolerancePx });
  if (compiled.status === "empty" || compiled.status === "incomplete") return compiled;

  const tempState = clone({
    ...compiled.legacyState,
    pans: [],
    obstacles: [],
    roof: { roofPans: [] },
  }) as Record<string, unknown>;

  try {
    options.computePansFromGeometryCore(tempState, {
      excludeChienAssis: true,
      topologyTolerancePx: options.modelTolerancePx,
    });
  } catch (error) {
    return {
      ...compiled,
      legacyState: { ...compiled.legacyState, pans: [] },
      status: "engine_error",
      diagnostics: [
        ...compiled.diagnostics,
        diagnostic("error", "LEGACY_ENGINE_ERROR", error instanceof Error ? error.message : String(error)),
      ],
    };
  }

  const rawPans = Array.isArray(tempState.pans) ? (tempState.pans as SmartRoofPanLike[]) : [];
  const pansWithSources = rawPans.map((pan) => annotatePanSourceSegments(pan, compiled.normalizedGraph, options.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX));
  const reconciled = reconcileSmartRoofPanIdentities(options.previousPans ?? [], pansWithSources);
  const noPansDiagnostics = rawPans.length === 0 && compiled.legacyState.contours.length > 0
    ? [diagnostic("warning", "LEGACY_ENGINE_NO_PANS", "Legacy pan engine returned no pans for a closed outline; source drawing is preserved for review.")]
    : [];
  return {
    ...compiled,
    legacyState: {
      ...compiled.legacyState,
      pans: reconciled.pans,
      roof: {
        roofPans: reconciled.pans.map((pan) => ({
          id: pan.id,
          polygonPx: pan.polygon ?? pan.polygonPx ?? [],
        })),
      },
    },
    diagnostics: [...compiled.diagnostics, ...noPansDiagnostics, ...reconciled.diagnostics],
    status: noPansDiagnostics.length > 0 || compiled.status === "ambiguous" ? "ambiguous" : "topology_ready",
    mapping: {
      ...compiled.mapping,
      panIdMapping: reconciled.panIdMapping,
    },
  };
}
