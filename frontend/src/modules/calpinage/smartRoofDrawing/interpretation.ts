import {
  DEFAULT_MODEL_TOLERANCE_PX,
  distance,
  pointOnSegment,
  signedPolygonArea,
} from "./geometry";
import type {
  LegacyCalpinageContour,
  SmartRoofLegacyState,
} from "./legacyBridge";
import type {
  SmartRoofDiagnostic,
  SmartRoofHeight,
  SmartRoofLineRole,
  SmartRoofLineRoleInfo,
  SmartRoofNode,
  SmartRoofSegment,
  SmartRoofSketchGraph,
} from "./types";

export interface SmartRoofReliefWorkingDefaults {
  readonly eaveHeightM: number;
  readonly flatHeightM: number;
  readonly ridgeRiseM: number;
}

export interface SmartRoofStructureInterpretationResult {
  readonly graph: SmartRoofSketchGraph;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly roleBySegmentId: Readonly<Record<string, SmartRoofLineRole>>;
  readonly heightByNodeId: Readonly<Record<string, SmartRoofHeight>>;
  readonly outlineSegmentIds: readonly string[];
  readonly structuralSegmentIds: readonly string[];
  readonly status: "none" | "estimated_flat" | "estimated_pitched" | "explicit_or_mixed";
}

export const DEFAULT_SMART_ROOF_RELIEF_WORKING_DEFAULTS: SmartRoofReliefWorkingDefaults = {
  eaveHeightM: 3,
  flatHeightM: 3,
  ridgeRiseM: 2,
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

function nodeMap(graph: SmartRoofSketchGraph): ReadonlyMap<string, SmartRoofNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function nodeById(nodes: ReadonlyMap<string, SmartRoofNode>, id: string): SmartRoofNode | null {
  return nodes.get(id) ?? null;
}

function roleCanBeInferred(role: SmartRoofLineRoleInfo): boolean {
  if (role.locked) return false;
  if (role.source === "manual" || role.source === "legacy" || role.source === "imported") return role.value === "unknown";
  return true;
}

function isHardHeight(height: SmartRoofHeight | undefined): boolean {
  if (!height) return false;
  if (height.locked) return true;
  return height.source === "manual" || height.source === "measured" || height.source === "legacy" || height.source === "imported";
}

function average(values: readonly number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function heightScopeKey(node: Pick<SmartRoofNode, "groupId" | "levelId">): string {
  return `${node.groupId ?? "__default_group"}::${node.levelId ?? "__default_level"}`;
}

function pushMapValue(map: Map<string, number[]>, key: string, value: number): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function contourSourceSegmentIds(legacyState: SmartRoofLegacyState): Set<string> {
  const ids = new Set<string>();
  for (const contour of legacyState.contours ?? []) {
    const raw = (contour as { smartSourceSegmentIds?: readonly unknown[] }).smartSourceSegmentIds;
    if (!Array.isArray(raw)) continue;
    for (const id of raw) if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

function panSourceUseCounts(legacyState: SmartRoofLegacyState): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const pan of legacyState.pans ?? []) {
    const ids = new Set<string>();
    for (const rawId of pan.smartSourceSegmentIds ?? []) {
      if (rawId) ids.add(String(rawId));
    }
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function graphDegrees(graph: SmartRoofSketchGraph, segmentIds?: ReadonlySet<string>): ReadonlyMap<string, number> {
  const degrees = new Map<string, number>();
  for (const segment of graph.segments) {
    if (segmentIds && !segmentIds.has(segment.id)) continue;
    degrees.set(segment.startNodeId, (degrees.get(segment.startNodeId) ?? 0) + 1);
    degrees.set(segment.endNodeId, (degrees.get(segment.endNodeId) ?? 0) + 1);
  }
  return degrees;
}

function endpointIds(segment: SmartRoofSegment): readonly string[] {
  return [segment.startNodeId, segment.endNodeId];
}

function isNearlyAxisAligned(segment: SmartRoofSegment, nodes: ReadonlyMap<string, SmartRoofNode>, tolerance: number): boolean {
  const a = nodeById(nodes, segment.startNodeId);
  const b = nodeById(nodes, segment.endNodeId);
  if (!a || !b) return false;
  const len = distance(a, b);
  if (len <= tolerance) return false;
  const eps = Math.max(tolerance, len * 1e-6);
  return Math.abs(a.x - b.x) <= eps || Math.abs(a.y - b.y) <= eps;
}

function findGraphNodeAtPoint(
  graph: SmartRoofSketchGraph,
  point: { readonly x: number; readonly y: number },
  tolerance: number,
): SmartRoofNode | null {
  let best: { readonly node: SmartRoofNode; readonly d: number } | null = null;
  for (const node of graph.nodes) {
    const d = distance(point, node);
    if (d > tolerance) continue;
    if (!best || d < best.d || (Math.abs(d - best.d) <= 1e-9 && node.id < best.node.id)) {
      best = { node, d };
    }
  }
  return best?.node ?? null;
}

function contourNodeIds(
  graph: SmartRoofSketchGraph,
  legacyState: SmartRoofLegacyState,
  tolerance: number,
): Set<string> {
  const ids = new Set<string>();
  for (const segmentId of contourSourceSegmentIds(legacyState)) {
    const segment = graph.segments.find((item) => item.id === segmentId);
    if (!segment) continue;
    ids.add(segment.startNodeId);
    ids.add(segment.endNodeId);
  }
  for (const contour of legacyState.contours ?? []) {
    for (const point of contour.points ?? []) {
      const node = findGraphNodeAtPoint(graph, point, tolerance);
      if (node) ids.add(node.id);
    }
  }
  for (const node of graph.nodes) {
    for (const contour of legacyState.contours ?? []) {
      const points = contour.points ?? [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        if (pointOnSegment(node, a, b, tolerance)) ids.add(node.id);
      }
    }
  }
  return ids;
}

function concaveContourNodeIds(
  graph: SmartRoofSketchGraph,
  contours: readonly LegacyCalpinageContour[],
  tolerance: number,
): Set<string> {
  const ids = new Set<string>();
  for (const contour of contours) {
    const points = contour.points ?? [];
    if (points.length < 4) continue;
    const area = signedPolygonArea(points);
    if (Math.abs(area) <= tolerance) continue;
    const orientation = area >= 0 ? 1 : -1;
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i + points.length - 1) % points.length]!;
      const current = points[i]!;
      const next = points[(i + 1) % points.length]!;
      const cross = (current.x - prev.x) * (next.y - current.y) - (current.y - prev.y) * (next.x - current.x);
      if (Math.abs(cross) <= tolerance) continue;
      if (Math.sign(cross) === -orientation) {
        const node = findGraphNodeAtPoint(graph, current, tolerance);
        if (node) ids.add(node.id);
      }
    }
  }
  return ids;
}

function inferStructuralRoles(input: {
  readonly graph: SmartRoofSketchGraph;
  readonly legacyState: SmartRoofLegacyState;
  readonly tolerance: number;
}): {
  readonly roleBySegmentId: Readonly<Record<string, SmartRoofLineRole>>;
  readonly outlineIds: readonly string[];
  readonly structuralIds: readonly string[];
  readonly highNodeIds: ReadonlySet<string>;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
} {
  const graph = input.graph;
  const tolerance = input.tolerance;
  const nodes = nodeMap(graph);
  const diagnostics: SmartRoofDiagnostic[] = [];
  const outlineIds = contourSourceSegmentIds(input.legacyState);
  const panUse = panSourceUseCounts(input.legacyState);
  const structuralSegments = graph.segments
    .filter((segment) => !outlineIds.has(segment.id) && segment.role.value !== "outline")
    .sort((a, b) => a.id.localeCompare(b.id));
  const structuralIdSet = new Set(structuralSegments.map((segment) => segment.id));
  const structuralDegree = graphDegrees(graph, structuralIdSet);
  const contourNodes = contourNodeIds(graph, input.legacyState, tolerance);
  const concaveNodes = concaveContourNodeIds(graph, input.legacyState.contours, tolerance);
  const roleBySegmentId: Record<string, SmartRoofLineRole> = {};
  const highNodeIds = new Set<string>();

  for (const segment of graph.segments) {
    if (outlineIds.has(segment.id) && roleCanBeInferred(segment.role)) {
      roleBySegmentId[segment.id] = "outline";
    }
  }

  for (const segment of structuralSegments) {
    const adjacentPanCount = panUse.get(segment.id) ?? 0;
    const canInfer = roleCanBeInferred(segment.role);
    let effectiveRole: SmartRoofLineRole = segment.role.value;
    if (canInfer) {
      const axisAligned = isNearlyAxisAligned(segment, nodes, tolerance);
      const endpoints = endpointIds(segment);
      const endpointOnContourCount = endpoints.filter((id) => contourNodes.has(id)).length;
      const maxStructuralDegree = Math.max(...endpoints.map((id) => structuralDegree.get(id) ?? 0));
      const minStructuralDegree = Math.min(...endpoints.map((id) => structuralDegree.get(id) ?? 0));
      const hasConcaveEndpoint = endpoints.some((id) => concaveNodes.has(id));
      if (adjacentPanCount >= 2 && axisAligned) {
        effectiveRole = "ridge";
      } else if (adjacentPanCount >= 2 && !axisAligned && (hasConcaveEndpoint || maxStructuralDegree >= 4)) {
        effectiveRole = "valley";
      } else if (adjacentPanCount >= 2 && !axisAligned) {
        effectiveRole = "hip";
      } else if (structuralSegments.length === 1 && endpointOnContourCount === 2) {
        effectiveRole = "ridge";
      } else if (axisAligned && endpointOnContourCount >= 1 && maxStructuralDegree >= 3 && minStructuralDegree >= 1) {
        effectiveRole = "ridge";
      }
      if (effectiveRole !== "unknown") {
        roleBySegmentId[segment.id] = effectiveRole;
      }
    }
    if (effectiveRole === "ridge" || segment.role.value === "ridge") {
      highNodeIds.add(segment.startNodeId);
      highNodeIds.add(segment.endNodeId);
    }
  }

  const inferredStructural = Object.entries(roleBySegmentId)
    .filter(([segmentId, role]) => !outlineIds.has(segmentId) && role !== "unknown")
    .map(([segmentId]) => segmentId);
  if (inferredStructural.length > 0) {
    diagnostics.push(diagnostic(
      "info",
      "SMART_ROOF_STRUCTURE_INFERRED",
      "Les lignes du dessin unique ont ete interpretees pour proposer les pans et le relief; les corrections manuelles restent prioritaires.",
      inferredStructural,
    ));
  }
  if (outlineIds.size > 0) {
    const inferredOutline = [...outlineIds].filter((segmentId) => roleBySegmentId[segmentId] === "outline");
    if (inferredOutline.length > 0) {
      diagnostics.push(diagnostic(
        "info",
        "SMART_ROOF_OUTLINE_INFERRED",
        "Le contour ferme dessine avec un seul outil a ete reconnu comme emprise de toiture.",
        inferredOutline,
      ));
    }
  }

  return {
    roleBySegmentId,
    outlineIds: [...outlineIds].sort(),
    structuralIds: structuralSegments.map((segment) => segment.id),
    highNodeIds,
    diagnostics,
  };
}

function resolveHeights(input: {
  readonly graph: SmartRoofSketchGraph;
  readonly legacyState: SmartRoofLegacyState;
  readonly highNodeIds: ReadonlySet<string>;
  readonly tolerance: number;
  readonly defaults: SmartRoofReliefWorkingDefaults;
}): {
  readonly heightByNodeId: Readonly<Record<string, SmartRoofHeight>>;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly status: SmartRoofStructureInterpretationResult["status"];
} {
  const graph = input.graph;
  const diagnostics: SmartRoofDiagnostic[] = [];
  const contourNodes = contourNodeIds(graph, input.legacyState, input.tolerance);
  const hardLowValuesByScope = new Map<string, number[]>();
  const hardHighValuesByScope = new Map<string, number[]>();
  const highNodeScopes = new Set<string>();

  for (const node of graph.nodes) {
    if (input.highNodeIds.has(node.id)) highNodeScopes.add(heightScopeKey(node));
    if (!node.height || !isHardHeight(node.height)) continue;
    const scope = heightScopeKey(node);
    if (input.highNodeIds.has(node.id)) pushMapValue(hardHighValuesByScope, scope, node.height.valueM);
    else if (contourNodes.has(node.id)) pushMapValue(hardLowValuesByScope, scope, node.height.valueM);
  }

  const heightByNodeId: Record<string, SmartRoofHeight> = {};
  let estimatedCount = 0;
  let deducedCount = 0;
  let flatEstimatedCount = 0;
  let pitchedEstimatedCount = 0;

  for (const node of graph.nodes) {
    if (node.height && isHardHeight(node.height)) {
      heightByNodeId[node.id] = node.height;
      continue;
    }
    const scope = heightScopeKey(node);
    const hasStructuralHighInScope = highNodeScopes.has(scope);
    const hardLowValues = hardLowValuesByScope.get(scope) ?? [];
    const hardHighValues = hardHighValuesByScope.get(scope) ?? [];
    const eaveHeightM = average(hardLowValues, hasStructuralHighInScope ? input.defaults.eaveHeightM : input.defaults.flatHeightM);
    const ridgeHeightM = average(hardHighValues, eaveHeightM + input.defaults.ridgeRiseM);
    if (!hasStructuralHighInScope) {
      heightByNodeId[node.id] = {
        valueM: eaveHeightM,
        source: "default",
        locked: false,
      };
      estimatedCount += 1;
      flatEstimatedCount += 1;
      continue;
    }
    if (input.highNodeIds.has(node.id)) {
      heightByNodeId[node.id] = {
        valueM: ridgeHeightM,
        source: hardHighValues.length > 0 ? "deduced" : "estimated",
        locked: false,
      };
      if (hardHighValues.length > 0) deducedCount += 1;
      else estimatedCount += 1;
      pitchedEstimatedCount += 1;
    } else {
      heightByNodeId[node.id] = {
        valueM: eaveHeightM,
        source: hardLowValues.length > 0 ? "deduced" : "default",
        locked: false,
      };
      if (hardLowValues.length > 0) deducedCount += 1;
      else estimatedCount += 1;
      pitchedEstimatedCount += 1;
    }
  }

  if (flatEstimatedCount > 0 && pitchedEstimatedCount === 0 && graph.segments.length > 0) {
    diagnostics.push(diagnostic(
      "info",
      "SMART_ROOF_RELIEF_ESTIMATED_FLAT",
      "Contour reconnu : toiture plate provisoire estimee. Ajoutez une ligne structurante ou corrigez une hauteur pour proposer une pente.",
      graph.nodes.map((node) => node.id),
    ));
  } else if (pitchedEstimatedCount > 0 || deducedCount > 0) {
    diagnostics.push(diagnostic(
      "info",
      "SMART_ROOF_RELIEF_ESTIMATED_PITCHED",
      "Relief estime a partir des lignes structurantes. Les valeurs restent modifiables et ne sont pas des mesures.",
      [...input.highNodeIds],
    ));
  }

  return {
    heightByNodeId,
    diagnostics,
    status: estimatedCount > 0
      ? (pitchedEstimatedCount > 0 ? "estimated_pitched" : "estimated_flat")
      : "explicit_or_mixed",
  };
}

function applyInterpretationToGraph(input: {
  readonly graph: SmartRoofSketchGraph;
  readonly roleBySegmentId: Readonly<Record<string, SmartRoofLineRole>>;
  readonly heightByNodeId: Readonly<Record<string, SmartRoofHeight>>;
  readonly status: SmartRoofStructureInterpretationResult["status"];
}): SmartRoofSketchGraph {
  const graph = clone(input.graph);
  const nodes = graph.nodes.map((node) => {
    const nextHeight = input.heightByNodeId[node.id];
    if (!nextHeight) return node;
    if (node.height && isHardHeight(node.height)) return node;
    return {
      ...node,
      height: nextHeight,
      provenance: {
        ...node.provenance,
        source: node.provenance?.source ?? nextHeight.source,
        sourceIds: [...new Set([...(node.provenance?.sourceIds ?? []), `height:${nextHeight.source}`])],
      },
    };
  });
  const nodeHeights = new Map(nodes.map((node) => [node.id, node.height]));
  const segments = graph.segments.map((segment) => {
    const inferredRole = input.roleBySegmentId[segment.id];
    const role = inferredRole && roleCanBeInferred(segment.role)
      ? { value: inferredRole, source: "inferred" as const, locked: false }
      : segment.role;
    const aHeight = nodeHeights.get(segment.startNodeId);
    const bHeight = nodeHeights.get(segment.endNodeId);
    const sameHeight = aHeight && bHeight && Math.abs(aHeight.valueM - bHeight.valueM) <= 1e-6;
    const shouldCarryLineHeight = sameHeight && (role.value === "ridge" || role.value === "outline" || role.value === "valley" || role.value === "hip");
    return {
      ...segment,
      role,
      ...(shouldCarryLineHeight && !isHardHeight(segment.height) ? { height: aHeight } : {}),
      provenance: {
        ...segment.provenance,
        source: segment.provenance?.source ?? (role.source === "inferred" ? "smart-roof-interpretation" : undefined),
        sourceIds: [...new Set([...(segment.provenance?.sourceIds ?? []), ...(role.source === "inferred" ? [`role:${role.value}`] : [])])],
      },
    };
  });
  return {
    ...graph,
    nodes,
    segments,
    metadata: {
      ...graph.metadata,
      lastInterpretation: {
        status: input.status,
        generatedAtIso: new Date().toISOString(),
      },
    },
  };
}

export function interpretSmartRoofStructure(input: {
  readonly graph: SmartRoofSketchGraph;
  readonly legacyState: SmartRoofLegacyState;
  readonly modelTolerancePx?: number;
  readonly defaults?: Partial<SmartRoofReliefWorkingDefaults>;
}): SmartRoofStructureInterpretationResult {
  const tolerance = input.modelTolerancePx ?? input.graph.metadata?.modelTolerancePx ?? DEFAULT_MODEL_TOLERANCE_PX;
  const defaults: SmartRoofReliefWorkingDefaults = {
    ...DEFAULT_SMART_ROOF_RELIEF_WORKING_DEFAULTS,
    ...(input.defaults ?? {}),
  };
  if (input.graph.segments.length === 0) {
    return {
      graph: clone(input.graph),
      diagnostics: [],
      roleBySegmentId: {},
      heightByNodeId: {},
      outlineSegmentIds: [],
      structuralSegmentIds: [],
      status: "none",
    };
  }
  const roles = inferStructuralRoles({
    graph: input.graph,
    legacyState: input.legacyState,
    tolerance,
  });
  const heights = resolveHeights({
    graph: input.graph,
    legacyState: input.legacyState,
    highNodeIds: roles.highNodeIds,
    tolerance,
    defaults,
  });
  return {
    graph: applyInterpretationToGraph({
      graph: input.graph,
      roleBySegmentId: roles.roleBySegmentId,
      heightByNodeId: heights.heightByNodeId,
      status: heights.status,
    }),
    diagnostics: [...roles.diagnostics, ...heights.diagnostics],
    roleBySegmentId: roles.roleBySegmentId,
    heightByNodeId: heights.heightByNodeId,
    outlineSegmentIds: roles.outlineIds,
    structuralSegmentIds: roles.structuralIds,
    status: heights.status,
  };
}
