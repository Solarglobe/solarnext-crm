import {
  DEFAULT_MODEL_TOLERANCE_PX,
  areColinearOverlapping,
  distance,
  lineIntersectionParameter,
  pointOnSegment,
  projectPointOnSegment,
  sameConnectivityLevel,
} from "./geometry";
import type {
  SmartRoofDiagnostic,
  SmartRoofEndpoint,
  SmartRoofHeight,
  SmartRoofLineRoleInfo,
  SmartRoofNode,
  SmartRoofOperationResult,
  SmartRoofSegment,
  SmartRoofSketchGraph,
} from "./types";
import { SMART_ROOF_SKETCH_SCHEMA_VERSION } from "./types";

type MutableGraph = {
  schemaVersion: typeof SMART_ROOF_SKETCH_SCHEMA_VERSION;
  groups: SmartRoofSketchGraph["groups"];
  nodes: SmartRoofNode[];
  segments: SmartRoofSegment[];
  metadata?: SmartRoofSketchGraph["metadata"];
};

function cloneGraph(graph: SmartRoofSketchGraph): MutableGraph {
  return JSON.parse(JSON.stringify(graph)) as MutableGraph;
}

function diag(
  severity: SmartRoofDiagnostic["severity"],
  code: string,
  message: string,
  entityIds?: readonly string[],
): SmartRoofDiagnostic {
  return { severity, code, message, ...(entityIds ? { entityIds } : {}) };
}

function nextId(prefix: string, existing: readonly { readonly id: string }[]): string {
  const used = new Set(existing.map((item) => item.id));
  let i = existing.length + 1;
  let id = `${prefix}-${i}`;
  while (used.has(id)) {
    i += 1;
    id = `${prefix}-${i}`;
  }
  return id;
}

function nodeById(graph: MutableGraph, id: string): SmartRoofNode {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Smart roof node not found: ${id}`);
  return node;
}

function segmentById(graph: MutableGraph, id: string): SmartRoofSegment {
  const segment = graph.segments.find((s) => s.id === id);
  if (!segment) throw new Error(`Smart roof segment not found: ${id}`);
  return segment;
}

function replaceSegment(graph: MutableGraph, segment: SmartRoofSegment): void {
  const index = graph.segments.findIndex((s) => s.id === segment.id);
  if (index === -1) throw new Error(`Smart roof segment not found: ${segment.id}`);
  graph.segments[index] = segment;
}

function defaultRole(role?: Partial<SmartRoofLineRoleInfo>): SmartRoofLineRoleInfo {
  return {
    value: role?.value ?? "unknown",
    source: role?.source ?? "unset",
    ...(role?.locked !== undefined ? { locked: role.locked } : {}),
  };
}

function compatibleRoles(a: SmartRoofLineRoleInfo, b: SmartRoofLineRoleInfo): boolean {
  if (a.value === b.value) return true;
  if (a.value === "unknown" && !a.locked) return true;
  if (b.value === "unknown" && !b.locked) return true;
  return false;
}

function mergeRoles(a: SmartRoofLineRoleInfo, b: SmartRoofLineRoleInfo): SmartRoofLineRoleInfo {
  if (a.value !== "unknown") return a;
  return b;
}

function compatibleHeights(a: SmartRoofNode, b: SmartRoofNode, tolerance: number): boolean {
  if (!a.height || !b.height) return true;
  return Math.abs(a.height.valueM - b.height.valueM) <= tolerance;
}

function mergeNodeTarget(a: SmartRoofNode, b: SmartRoofNode): SmartRoofNode {
  return {
    ...a,
    height: a.height ?? b.height,
    provenance: {
      source: a.provenance?.source ?? b.provenance?.source,
      sourceIds: [...new Set([...(a.provenance?.sourceIds ?? []), ...(b.provenance?.sourceIds ?? [])])],
      parentNodeIds: [...new Set([a.id, b.id, ...(a.provenance?.parentNodeIds ?? []), ...(b.provenance?.parentNodeIds ?? [])])],
    },
  };
}

function rewriteNodeReferences(graph: MutableGraph, fromNodeId: string, toNodeId: string): void {
  graph.segments = graph.segments.map((segment) => ({
    ...segment,
    startNodeId: segment.startNodeId === fromNodeId ? toNodeId : segment.startNodeId,
    endNodeId: segment.endNodeId === fromNodeId ? toNodeId : segment.endNodeId,
  }));
}

function removeOrphanNodes(graph: MutableGraph): void {
  const used = new Set<string>();
  for (const segment of graph.segments) {
    used.add(segment.startNodeId);
    used.add(segment.endNodeId);
  }
  graph.nodes = graph.nodes.filter((node) => used.has(node.id));
}

function makeChildSegmentId(graph: MutableGraph, parentId: string, index: number): string {
  const base = `${parentId}:part-${index}`;
  if (!graph.segments.some((s) => s.id === base)) return base;
  return nextId(base, graph.segments);
}

export function createSmartRoofSketchGraph(
  input: Partial<SmartRoofSketchGraph> = {},
): SmartRoofSketchGraph {
  return {
    schemaVersion: SMART_ROOF_SKETCH_SCHEMA_VERSION,
    groups: input.groups ? [...input.groups] : [],
    nodes: input.nodes ? [...input.nodes] : [],
    segments: input.segments ? [...input.segments] : [],
    metadata: input.metadata ?? { createdFrom: "empty" },
  };
}

export function addSketchNode(
  graph: SmartRoofSketchGraph,
  input: {
    readonly id?: string;
    readonly x: number;
    readonly y: number;
    readonly groupId?: string | null;
    readonly levelId?: string | null;
    readonly height?: SmartRoofNode["height"];
    readonly provenance?: SmartRoofNode["provenance"];
  },
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const id = input.id ?? nextId("node", next.nodes);
  if (next.nodes.some((node) => node.id === id)) throw new Error(`Duplicate smart roof node id: ${id}`);
  next.nodes.push({
    id,
    x: input.x,
    y: input.y,
    groupId: input.groupId ?? null,
    levelId: input.levelId ?? null,
    ...(input.height ? { height: input.height } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  });
  return { graph: next, diagnostics: [] };
}

export function addSketchSegment(
  graph: SmartRoofSketchGraph,
  input: {
    readonly id?: string;
    readonly start:
      | { readonly nodeId: string }
      | { readonly x: number; readonly y: number; readonly id?: string; readonly groupId?: string | null; readonly levelId?: string | null; readonly height?: SmartRoofNode["height"] };
    readonly end:
      | { readonly nodeId: string }
      | { readonly x: number; readonly y: number; readonly id?: string; readonly groupId?: string | null; readonly levelId?: string | null; readonly height?: SmartRoofNode["height"] };
    readonly groupId?: string | null;
    readonly levelId?: string | null;
    readonly role?: Partial<SmartRoofLineRoleInfo>;
    readonly provenance?: SmartRoofSegment["provenance"];
  },
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const ensureNode = (endpoint: typeof input.start): string => {
    if ("nodeId" in endpoint) {
      nodeById(next, endpoint.nodeId);
      return endpoint.nodeId;
    }
    const id = endpoint.id ?? nextId("node", next.nodes);
    if (next.nodes.some((node) => node.id === id)) throw new Error(`Duplicate smart roof node id: ${id}`);
    next.nodes.push({
      id,
      x: endpoint.x,
      y: endpoint.y,
      groupId: endpoint.groupId ?? input.groupId ?? null,
      levelId: endpoint.levelId ?? input.levelId ?? null,
      ...(endpoint.height ? { height: endpoint.height } : {}),
      provenance: input.provenance,
    });
    return id;
  };

  const segmentId = input.id ?? nextId("segment", next.segments);
  if (next.segments.some((segment) => segment.id === segmentId)) {
    throw new Error(`Duplicate smart roof segment id: ${segmentId}`);
  }
  const startNodeId = ensureNode(input.start);
  const endNodeId = ensureNode(input.end);
  next.segments.push({
    id: segmentId,
    startNodeId,
    endNodeId,
    groupId: input.groupId ?? null,
    levelId: input.levelId ?? null,
    role: defaultRole(input.role),
    provenance: input.provenance,
  });
  return { graph: next, diagnostics: [] };
}

export function setSketchSegmentRole(
  graph: SmartRoofSketchGraph,
  segmentId: string,
  role: SmartRoofLineRoleInfo,
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const segment = segmentById(next, segmentId);
  replaceSegment(next, { ...segment, role });
  return { graph: next, diagnostics: [] };
}

export function setSketchNodeHeight(
  graph: SmartRoofSketchGraph,
  nodeId: string,
  height: SmartRoofHeight | null,
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const index = next.nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) throw new Error(`Smart roof node not found: ${nodeId}`);
  const node = next.nodes[index]!;
  next.nodes[index] = height ? { ...node, height } : (({ height: _height, ...rest }) => rest)(node);
  return { graph: next, diagnostics: [] };
}

export function setSketchSegmentHeight(
  graph: SmartRoofSketchGraph,
  segmentId: string,
  height: SmartRoofHeight | null,
  options: { readonly applyToEndpoints?: boolean; readonly heightToleranceM?: number; readonly overrideLockedEndpoints?: boolean } = {},
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const diagnostics: SmartRoofDiagnostic[] = [];
  const segment = segmentById(next, segmentId);
  const patchSegment = height ? { ...segment, height } : (({ height: _height, ...rest }) => rest)(segment);
  replaceSegment(next, patchSegment);

  if (height && options.applyToEndpoints !== false) {
    const tolerance = options.heightToleranceM ?? 1e-6;
    for (const nodeId of [segment.startNodeId, segment.endNodeId]) {
      const index = next.nodes.findIndex((node) => node.id === nodeId);
      if (index === -1) {
        diagnostics.push(diag("error", "SEGMENT_ENDPOINT_MISSING", "Segment endpoint is missing while applying a line height.", [segmentId, nodeId]));
        continue;
      }
      const existing = next.nodes[index]!;
      if (!options.overrideLockedEndpoints && existing.height?.locked && Math.abs(existing.height.valueM - height.valueM) > tolerance) {
        diagnostics.push(diag("warning", "LOCKED_ENDPOINT_HEIGHT_CONFLICT", "A locked endpoint height differs from the requested line height and was preserved.", [segmentId, nodeId]));
        continue;
      }
      next.nodes[index] = { ...existing, height };
    }
  }

  return { graph: next, diagnostics };
}

export function setAllSketchNodeHeights(
  graph: SmartRoofSketchGraph,
  height: SmartRoofHeight | null,
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  next.nodes = next.nodes.map((node) => (
    height ? { ...node, height } : (({ height: _height, ...rest }) => rest)(node)
  ));
  return { graph: next, diagnostics: [] };
}

export function setSketchNodeHeightsForGroup(
  graph: SmartRoofSketchGraph,
  groupId: string | null,
  height: SmartRoofHeight | null,
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const matchesGroup = (value: string | null | undefined): boolean => (value ?? null) === groupId;
  next.nodes = next.nodes.map((node) => {
    if (!matchesGroup(node.groupId)) return node;
    return height ? { ...node, height } : (({ height: _height, ...rest }) => rest)(node);
  });
  next.segments = next.segments.map((segment) => {
    if (!matchesGroup(segment.groupId)) return segment;
    return height ? { ...segment, height } : (({ height: _height, ...rest }) => rest)(segment);
  });
  return { graph: next, diagnostics: [] };
}

export function connectSegmentEndpointToNode(
  graph: SmartRoofSketchGraph,
  segmentId: string,
  endpoint: SmartRoofEndpoint,
  targetNodeId: string,
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  nodeById(next, targetNodeId);
  const segment = segmentById(next, segmentId);
  replaceSegment(next, {
    ...segment,
    [endpoint === "start" ? "startNodeId" : "endNodeId"]: targetNodeId,
  });
  removeOrphanNodes(next);
  return { graph: next, diagnostics: [] };
}

export function moveSketchNode(
  graph: SmartRoofSketchGraph,
  nodeId: string,
  point: { readonly x: number; readonly y: number },
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  const index = next.nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) throw new Error(`Smart roof node not found: ${nodeId}`);
  next.nodes[index] = { ...next.nodes[index]!, x: point.x, y: point.y };
  return { graph: next, diagnostics: [] };
}

export function removeSketchSegment(
  graph: SmartRoofSketchGraph,
  segmentId: string,
): SmartRoofOperationResult {
  const next = cloneGraph(graph);
  next.segments = next.segments.filter((segment) => segment.id !== segmentId);
  removeOrphanNodes(next);
  return { graph: next, diagnostics: [] };
}

export function splitSketchSegmentAtPoint(
  graph: SmartRoofSketchGraph,
  segmentId: string,
  point: { readonly x: number; readonly y: number; readonly nodeId?: string },
  options: { readonly modelTolerancePx?: number } = {},
): SmartRoofOperationResult {
  const tolerance = options.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  const next = cloneGraph(graph);
  const segment = segmentById(next, segmentId);
  const a = nodeById(next, segment.startNodeId);
  const b = nodeById(next, segment.endNodeId);
  const projection = projectPointOnSegment(point, a, b);
  const diagnostics: SmartRoofDiagnostic[] = [];
  if (projection.distance > tolerance || projection.t <= tolerance || projection.t >= 1 - tolerance) {
    diagnostics.push(diag("warning", "SPLIT_POINT_NOT_INTERNAL", "Split point is not an internal point on the segment.", [segmentId]));
    return { graph: next, diagnostics };
  }

  const nodeId = point.nodeId ?? nextId("node", next.nodes);
  if (!next.nodes.some((node) => node.id === nodeId)) {
    next.nodes.push({
      id: nodeId,
      x: projection.x,
      y: projection.y,
      groupId: segment.groupId ?? a.groupId ?? null,
      levelId: segment.levelId ?? a.levelId ?? null,
      provenance: {
        source: "split",
        parentSegmentIds: [segment.id, ...(segment.provenance?.parentSegmentIds ?? [])],
      },
    });
  }

  const firstId = makeChildSegmentId(next, segment.id, 1);
  const secondId = makeChildSegmentId(next, segment.id, 2);
  next.segments = next.segments.filter((item) => item.id !== segment.id);
  const childProvenance = {
    ...segment.provenance,
    parentSegmentIds: [segment.id, ...(segment.provenance?.parentSegmentIds ?? [])],
  };
  next.segments.push(
    { ...segment, id: firstId, endNodeId: nodeId, provenance: childProvenance },
    { ...segment, id: secondId, startNodeId: nodeId, provenance: childProvenance },
  );
  return {
    graph: next,
    diagnostics,
    mapping: { segments: { [segment.id]: [firstId, secondId] }, nodes: { [nodeId]: nodeId } },
  };
}

export function connectSegmentEndpointToSegment(
  graph: SmartRoofSketchGraph,
  segmentId: string,
  endpoint: SmartRoofEndpoint,
  targetSegmentId: string,
  options: { readonly modelTolerancePx?: number } = {},
): SmartRoofOperationResult {
  const tolerance = options.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  const sourceGraph = cloneGraph(graph);
  const sourceSegment = segmentById(sourceGraph, segmentId);
  const sourceNodeId = endpoint === "start" ? sourceSegment.startNodeId : sourceSegment.endNodeId;
  const sourceNode = nodeById(sourceGraph, sourceNodeId);
  const target = segmentById(sourceGraph, targetSegmentId);
  const targetA = nodeById(sourceGraph, target.startNodeId);
  const targetB = nodeById(sourceGraph, target.endNodeId);
  const projection = projectPointOnSegment(sourceNode, targetA, targetB);
  if (projection.distance > tolerance || projection.t <= tolerance || projection.t >= 1 - tolerance) {
    return {
      graph: sourceGraph,
      diagnostics: [diag("warning", "ENDPOINT_NOT_ON_TARGET_SEGMENT", "Endpoint is not close enough to the target segment.", [segmentId, targetSegmentId])],
    };
  }

  const split = splitSketchSegmentAtPoint(sourceGraph, targetSegmentId, {
    x: projection.x,
    y: projection.y,
    nodeId: `${targetSegmentId}:junction-${projection.t.toFixed(6)}`,
  }, options);
  const createdNodeId = Object.keys(split.mapping?.nodes ?? {})[0];
  const connected = connectSegmentEndpointToNode(split.graph, segmentId, endpoint, createdNodeId);
  return {
    graph: connected.graph,
    diagnostics: [...split.diagnostics, ...connected.diagnostics],
    mapping: split.mapping,
  };
}

export function normalizeSketchGraph(
  graph: SmartRoofSketchGraph,
  options: { readonly modelTolerancePx?: number; readonly connectCrossings?: boolean } = {},
): SmartRoofOperationResult {
  const tolerance = options.modelTolerancePx ?? graph.metadata?.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  let next = cloneGraph(graph);
  const diagnostics: SmartRoofDiagnostic[] = [];
  const nodeMapping: Record<string, string> = {};
  const segmentMapping: Record<string, readonly string[]> = {};

  const sortedNodes = [...next.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sortedNodes.length; i++) {
    const a = next.nodes.find((node) => node.id === sortedNodes[i]!.id);
    if (!a) continue;
    for (let j = i + 1; j < sortedNodes.length; j++) {
      const b = next.nodes.find((node) => node.id === sortedNodes[j]!.id);
      if (!b) continue;
      if (distance(a, b) > tolerance) continue;
      if (!sameConnectivityLevel(a, b)) continue;
      if (!compatibleHeights(a, b, tolerance)) {
        diagnostics.push(diag("warning", "NODE_HEIGHT_CONFLICT", "Coincident nodes carry conflicting explicit heights and were not merged.", [a.id, b.id]));
        continue;
      }
      const merged = mergeNodeTarget(a, b);
      next.nodes = next.nodes.map((node) => (node.id === a.id ? merged : node)).filter((node) => node.id !== b.id);
      rewriteNodeReferences(next, b.id, a.id);
      nodeMapping[b.id] = a.id;
    }
  }

  const preSplitSegments = [...next.segments].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < preSplitSegments.length; i++) {
    const aSeg = preSplitSegments[i]!;
    const a0 = nodeById(next, aSeg.startNodeId);
    const a1 = nodeById(next, aSeg.endNodeId);
    for (let j = i + 1; j < preSplitSegments.length; j++) {
      const bSeg = preSplitSegments[j]!;
      if ((aSeg.groupId ?? null) !== (bSeg.groupId ?? null) || (aSeg.levelId ?? null) !== (bSeg.levelId ?? null)) continue;
      const b0 = nodeById(next, bSeg.startNodeId);
      const b1 = nodeById(next, bSeg.endNodeId);
      const sameEndpoints =
        (aSeg.startNodeId === bSeg.startNodeId && aSeg.endNodeId === bSeg.endNodeId) ||
        (aSeg.startNodeId === bSeg.endNodeId && aSeg.endNodeId === bSeg.startNodeId);
      if (!sameEndpoints && areColinearOverlapping(a0, a1, b0, b1, tolerance)) {
        diagnostics.push(diag("warning", "COLINEAR_OVERLAP_REVIEW_REQUIRED", "Colinear overlapping segments were detected and preserved for manual review.", [aSeg.id, bSeg.id]));
      }
    }
  }

  const originalSegments = [...next.segments].sort((a, b) => a.id.localeCompare(b.id));
  for (const segment of originalSegments) {
    if (!next.segments.some((s) => s.id === segment.id)) continue;
    const current = segmentById(next, segment.id);
    const a = nodeById(next, current.startNodeId);
    const b = nodeById(next, current.endNodeId);
    const internalNodes = next.nodes
      .filter((node) => node.id !== a.id && node.id !== b.id)
      .filter((node) => sameConnectivityLevel(a, node))
      .map((node) => ({ node, projection: projectPointOnSegment(node, a, b) }))
      .filter(({ projection }) => projection.distance <= tolerance && projection.t > tolerance && projection.t < 1 - tolerance)
      .sort((left, right) => left.projection.t - right.projection.t);
    if (internalNodes.length === 0) continue;
    const nodeIds = [a.id, ...internalNodes.map(({ node }) => node.id), b.id];
    const children: SmartRoofSegment[] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      children.push({
        ...current,
        id: makeChildSegmentId(next, current.id, i + 1),
        startNodeId: nodeIds[i]!,
        endNodeId: nodeIds[i + 1]!,
        provenance: {
          ...current.provenance,
          parentSegmentIds: [current.id, ...(current.provenance?.parentSegmentIds ?? [])],
        },
      });
    }
    next.segments = next.segments.filter((s) => s.id !== current.id);
    next.segments.push(...children);
    segmentMapping[current.id] = children.map((child) => child.id);
  }

  for (let i = 0; i < next.segments.length; i++) {
    const aSeg = next.segments[i]!;
    const a0 = nodeById(next, aSeg.startNodeId);
    const a1 = nodeById(next, aSeg.endNodeId);
    for (let j = i + 1; j < next.segments.length; j++) {
      const bSeg = next.segments[j]!;
      if ((aSeg.groupId ?? null) !== (bSeg.groupId ?? null) || (aSeg.levelId ?? null) !== (bSeg.levelId ?? null)) continue;
      const b0 = nodeById(next, bSeg.startNodeId);
      const b1 = nodeById(next, bSeg.endNodeId);
      const intersection = lineIntersectionParameter(a0, a1, b0, b1, tolerance);
      if (intersection && intersection.t > tolerance && intersection.t < 1 - tolerance && intersection.u > tolerance && intersection.u < 1 - tolerance) {
        diagnostics.push(diag(options.connectCrossings ? "info" : "warning", "CROSSING_NOT_CONNECTED_UNSUPPORTED", "Projected crossing detected; it is preserved as ambiguous unless explicitly connected.", [aSeg.id, bSeg.id]));
      } else if (areColinearOverlapping(a0, a1, b0, b1, tolerance)) {
        const sameEndpoints =
          (aSeg.startNodeId === bSeg.startNodeId && aSeg.endNodeId === bSeg.endNodeId) ||
          (aSeg.startNodeId === bSeg.endNodeId && aSeg.endNodeId === bSeg.startNodeId);
        if (!sameEndpoints) {
          diagnostics.push(diag("warning", "COLINEAR_OVERLAP_REVIEW_REQUIRED", "Colinear overlapping segments were detected and preserved for manual review.", [aSeg.id, bSeg.id]));
        }
      }
    }
  }

  const seenConnectivity = new Map<string, SmartRoofSegment>();
  const keptSegments: SmartRoofSegment[] = [];
  for (const segment of next.segments.sort((a, b) => a.id.localeCompare(b.id))) {
    const key = [segment.startNodeId, segment.endNodeId].sort().join("::");
    const existing = seenConnectivity.get(key);
    if (!existing) {
      seenConnectivity.set(key, segment);
      keptSegments.push(segment);
      continue;
    }
    if (!compatibleRoles(existing.role, segment.role)) {
      diagnostics.push(diag("warning", "SEGMENT_ROLE_CONFLICT", "Duplicate segments carry conflicting explicit roles and were not merged.", [existing.id, segment.id]));
      keptSegments.push(segment);
      continue;
    }
    const merged: SmartRoofSegment = {
      ...existing,
      role: mergeRoles(existing.role, segment.role),
      provenance: {
        source: existing.provenance?.source ?? segment.provenance?.source,
        sourceIds: [...new Set([...(existing.provenance?.sourceIds ?? []), ...(segment.provenance?.sourceIds ?? [])])],
        parentSegmentIds: [...new Set([existing.id, segment.id, ...(existing.provenance?.parentSegmentIds ?? []), ...(segment.provenance?.parentSegmentIds ?? [])])],
        legacy: existing.provenance?.legacy ?? segment.provenance?.legacy,
      },
    };
    const index = keptSegments.findIndex((item) => item.id === existing.id);
    keptSegments[index] = merged;
    seenConnectivity.set(key, merged);
    segmentMapping[segment.id] = [existing.id];
  }
  next.segments = keptSegments;
  removeOrphanNodes(next);

  return {
    graph: next,
    diagnostics,
    mapping: {
      ...(Object.keys(nodeMapping).length ? { nodes: nodeMapping } : {}),
      ...(Object.keys(segmentMapping).length ? { segments: segmentMapping } : {}),
    },
  };
}

export function assertNoDeadSegmentReferences(graph: SmartRoofSketchGraph): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const segment of graph.segments) {
    if (!nodeIds.has(segment.startNodeId) || !nodeIds.has(segment.endNodeId)) {
      throw new Error(`Dead node reference in smart roof segment: ${segment.id}`);
    }
  }
}

export { pointOnSegment };
