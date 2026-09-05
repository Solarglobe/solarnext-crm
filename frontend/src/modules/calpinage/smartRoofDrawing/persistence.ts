import type {
  SmartRoofDiagnostic,
  SmartRoofLineRole,
  SmartRoofRoleSource,
  SmartRoofSketchGraph,
} from "./types";
import { SMART_ROOF_SKETCH_SCHEMA_VERSION } from "./types";

export const SMART_ROOF_DRAWING_PERSISTENCE_VERSION = 1 as const;

export interface SmartRoofPersistedDrawing {
  readonly kind: "smartRoofDrawing";
  readonly persistenceVersion: typeof SMART_ROOF_DRAWING_PERSISTENCE_VERSION;
  readonly graph: SmartRoofSketchGraph;
  readonly appliedAtIso?: string;
  readonly sourceRevision?: string;
  readonly draftRevision?: string;
  readonly panIdMapping?: Readonly<Record<string, string>>;
  readonly diagnostics?: readonly SmartRoofDiagnostic[];
}

export interface SmartRoofPersistedDrawingReadResult {
  readonly persisted: SmartRoofPersistedDrawing | null;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly raw?: unknown;
}

const VALID_ROLES: readonly SmartRoofLineRole[] = ["unknown", "outline", "trait", "ridge", "hip", "valley"];
const VALID_ROLE_SOURCES: readonly SmartRoofRoleSource[] = ["unset", "inferred", "manual", "legacy", "imported"];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateGraph(value: unknown): { readonly graph: SmartRoofSketchGraph | null; readonly diagnostics: readonly SmartRoofDiagnostic[] } {
  const diagnostics: SmartRoofDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      graph: null,
      diagnostics: [diagnostic("error", "SMART_ROOF_GRAPH_INVALID", "Persisted smart roof drawing graph is not an object.")],
    };
  }
  if (value.schemaVersion !== SMART_ROOF_SKETCH_SCHEMA_VERSION) {
    return {
      graph: null,
      diagnostics: [diagnostic("error", "SMART_ROOF_GRAPH_VERSION_UNSUPPORTED", "Persisted smart roof drawing graph uses an unsupported schema version.")],
    };
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.segments) || !Array.isArray(value.groups)) {
    return {
      graph: null,
      diagnostics: [diagnostic("error", "SMART_ROOF_GRAPH_SHAPE_INVALID", "Persisted smart roof drawing graph is missing nodes, segments or groups.")],
    };
  }

  const nodeIds = new Set<string>();
  for (const item of value.nodes) {
    if (!isRecord(item) || typeof item.id !== "string" || !finiteNumber(item.x) || !finiteNumber(item.y)) {
      diagnostics.push(diagnostic("error", "SMART_ROOF_NODE_INVALID", "Persisted smart roof drawing contains an invalid node."));
      continue;
    }
    if (nodeIds.has(item.id)) diagnostics.push(diagnostic("error", "SMART_ROOF_NODE_DUPLICATE", "Persisted smart roof drawing contains duplicate node ids.", [item.id]));
    nodeIds.add(item.id);
  }

  const segmentIds = new Set<string>();
  for (const item of value.segments) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.startNodeId !== "string" ||
      typeof item.endNodeId !== "string" ||
      !isRecord(item.role) ||
      !VALID_ROLES.includes(item.role.value as SmartRoofLineRole) ||
      !VALID_ROLE_SOURCES.includes(item.role.source as SmartRoofRoleSource)
    ) {
      diagnostics.push(diagnostic("error", "SMART_ROOF_SEGMENT_INVALID", "Persisted smart roof drawing contains an invalid segment."));
      continue;
    }
    if (segmentIds.has(item.id)) diagnostics.push(diagnostic("error", "SMART_ROOF_SEGMENT_DUPLICATE", "Persisted smart roof drawing contains duplicate segment ids.", [item.id]));
    segmentIds.add(item.id);
    if (!nodeIds.has(item.startNodeId) || !nodeIds.has(item.endNodeId)) {
      diagnostics.push(diagnostic("error", "SMART_ROOF_SEGMENT_DEAD_REFERENCE", "Persisted smart roof drawing contains a segment with missing endpoint references.", [item.id]));
    }
  }

  const errors = diagnostics.filter((item) => item.severity === "error");
  return {
    graph: errors.length ? null : clone(value as unknown as SmartRoofSketchGraph),
    diagnostics,
  };
}

export function buildSmartRoofPersistedDrawing(input: {
  readonly graph: SmartRoofSketchGraph;
  readonly sourceRevision?: string;
  readonly draftRevision?: string;
  readonly panIdMapping?: Readonly<Record<string, string>>;
  readonly diagnostics?: readonly SmartRoofDiagnostic[];
  readonly appliedAtIso?: string;
}): SmartRoofPersistedDrawing {
  return {
    kind: "smartRoofDrawing",
    persistenceVersion: SMART_ROOF_DRAWING_PERSISTENCE_VERSION,
    graph: clone(input.graph),
    ...(input.appliedAtIso ? { appliedAtIso: input.appliedAtIso } : {}),
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    ...(input.draftRevision ? { draftRevision: input.draftRevision } : {}),
    ...(input.panIdMapping ? { panIdMapping: clone(input.panIdMapping) } : {}),
    ...(input.diagnostics ? { diagnostics: clone(input.diagnostics) } : {}),
  };
}

export function readSmartRoofPersistedDrawing(value: unknown): SmartRoofPersistedDrawingReadResult {
  if (value == null) return { persisted: null, diagnostics: [] };
  if (!isRecord(value)) {
    return {
      persisted: null,
      raw: value,
      diagnostics: [diagnostic("error", "SMART_ROOF_PERSISTED_INVALID", "Persisted smart roof drawing payload is not an object.")],
    };
  }
  if (value.kind !== "smartRoofDrawing" || value.persistenceVersion !== SMART_ROOF_DRAWING_PERSISTENCE_VERSION) {
    return {
      persisted: null,
      raw: clone(value),
      diagnostics: [diagnostic("error", "SMART_ROOF_PERSISTED_VERSION_UNSUPPORTED", "Persisted smart roof drawing payload uses an unsupported version.")],
    };
  }
  const graphResult = validateGraph(value.graph);
  if (!graphResult.graph) {
    return {
      persisted: null,
      raw: clone(value),
      diagnostics: graphResult.diagnostics,
    };
  }
  return {
    persisted: {
      kind: "smartRoofDrawing",
      persistenceVersion: SMART_ROOF_DRAWING_PERSISTENCE_VERSION,
      graph: graphResult.graph,
      ...(typeof value.appliedAtIso === "string" ? { appliedAtIso: value.appliedAtIso } : {}),
      ...(typeof value.sourceRevision === "string" ? { sourceRevision: value.sourceRevision } : {}),
      ...(typeof value.draftRevision === "string" ? { draftRevision: value.draftRevision } : {}),
      ...(isRecord(value.panIdMapping) ? { panIdMapping: clone(value.panIdMapping) as Readonly<Record<string, string>> } : {}),
      ...(Array.isArray(value.diagnostics) ? { diagnostics: clone(value.diagnostics) as readonly SmartRoofDiagnostic[] } : {}),
    },
    diagnostics: graphResult.diagnostics,
  };
}
