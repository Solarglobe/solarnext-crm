export const SMART_ROOF_SKETCH_SCHEMA_VERSION = 1 as const;

export type SmartRoofLineRole =
  | "unknown"
  | "outline"
  | "trait"
  | "ridge"
  | "hip"
  | "valley";

export type SmartRoofRoleSource =
  | "unset"
  | "inferred"
  | "manual"
  | "legacy"
  | "imported";

export type SmartRoofHeightSource =
  | "manual"
  | "measured"
  | "legacy"
  | "imported"
  | "deduced"
  | "estimated"
  | "default";

export type SmartRoofEndpoint = "start" | "end";

export interface SmartRoofHeight {
  readonly valueM: number;
  readonly source: SmartRoofHeightSource;
  readonly locked?: boolean;
}

export interface SmartRoofLineRoleInfo {
  readonly value: SmartRoofLineRole;
  readonly source: SmartRoofRoleSource;
  readonly locked?: boolean;
}

export interface SmartRoofProvenance {
  readonly source?: string;
  readonly sourceIds?: readonly string[];
  readonly parentNodeIds?: readonly string[];
  readonly parentSegmentIds?: readonly string[];
  readonly legacy?: {
    readonly kind: "contour" | "trait" | "ridge";
    readonly id: string;
    readonly pointIndex?: number;
    readonly segmentIndex?: number;
  };
}

export interface SmartRoofGroup {
  readonly id: string;
  readonly label?: string;
  readonly kind?: "building" | "roof" | "level" | "unknown";
  readonly parentGroupId?: string | null;
}

export interface SmartRoofNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly groupId?: string | null;
  readonly levelId?: string | null;
  readonly height?: SmartRoofHeight;
  readonly provenance?: SmartRoofProvenance;
}

export interface SmartRoofLegacyAttach {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface SmartRoofSegment {
  readonly id: string;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly groupId?: string | null;
  readonly levelId?: string | null;
  readonly role: SmartRoofLineRoleInfo;
  readonly startAttach?: SmartRoofLegacyAttach | null;
  readonly endAttach?: SmartRoofLegacyAttach | null;
  readonly height?: SmartRoofHeight;
  readonly slopeDeg?: number | null;
  readonly provenance?: SmartRoofProvenance;
}

export interface SmartRoofSketchGraph {
  readonly schemaVersion: typeof SMART_ROOF_SKETCH_SCHEMA_VERSION;
  readonly groups: readonly SmartRoofGroup[];
  readonly nodes: readonly SmartRoofNode[];
  readonly segments: readonly SmartRoofSegment[];
  readonly metadata?: {
    readonly createdFrom?: "empty" | "legacy" | "test" | "import";
    readonly modelTolerancePx?: number;
    readonly lastInterpretation?: {
      readonly status: "none" | "estimated_flat" | "estimated_pitched" | "explicit_or_mixed";
      readonly generatedAtIso?: string;
    };
  };
}

export type SmartRoofDiagnosticSeverity = "info" | "warning" | "error";

export interface SmartRoofDiagnostic {
  readonly severity: SmartRoofDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly entityIds?: readonly string[];
}

export interface SmartRoofIdMapping {
  readonly nodes?: Readonly<Record<string, string>>;
  readonly segments?: Readonly<Record<string, readonly string[]>>;
  readonly pans?: Readonly<Record<string, string>>;
}

export interface SmartRoofOperationResult<T = SmartRoofSketchGraph> {
  readonly graph: T;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
  readonly mapping?: SmartRoofIdMapping;
}

export interface SmartRoofToleranceConfig {
  readonly modelTolerancePx?: number;
  readonly screenSnapTolerancePx?: number;
}
