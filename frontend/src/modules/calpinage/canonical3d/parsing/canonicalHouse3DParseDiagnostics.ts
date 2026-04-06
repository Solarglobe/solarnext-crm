/**
 * Diagnostics et provenance — parseur CALPINAGE_STATE → CanonicalHouseDocument.
 * Aucun effet de bord, aucune lecture window/DOM.
 */

import type { CanonicalHouseDocument } from "../model/canonicalHouse3DModel";

/** Document canonique — alias officiel demandé (prompt 2B). */
export type CanonicalHouse3DDocument = CanonicalHouseDocument;

export type ParseSourceKind = "primary" | "mirror" | "ignored" | "fallback_legacy" | "cache_forbidden" | "external";

export interface FieldProvenance {
  readonly sourcePath: string;
  readonly sourceKind: ParseSourceKind;
  /** 1 = plus haute priorité (voir canonical-house3d-source-priority.md). */
  readonly sourcePriority: number;
  readonly isFallback: boolean;
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly missingReason?: string;
  readonly notes?: string;
}

export type ParseSeverity = "blocking" | "warning" | "info";

export interface ParseDiagnostic {
  readonly code: string;
  readonly severity: ParseSeverity;
  readonly message: string;
  readonly path?: string;
}

export interface ParseEligibility {
  readonly house3dBuildable: boolean;
  readonly roof3dBuildable: boolean;
  readonly obstacles3dBuildable: boolean;
  readonly pv3dBuildable: boolean;
  readonly reasons: readonly string[];
}

export interface CanonicalHouse3DParseResult {
  readonly document: CanonicalHouse3DDocument;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly provenance: {
    readonly building: readonly FieldProvenance[];
    readonly roofTopology: readonly FieldProvenance[];
    readonly roofGeometry: readonly FieldProvenance[];
    readonly heights: readonly FieldProvenance[];
    readonly annexes: readonly FieldProvenance[];
    readonly pv: readonly FieldProvenance[];
    readonly worldPlacement: readonly FieldProvenance[];
  };
  readonly eligibility: ParseEligibility;
  readonly sourcesUsed: readonly string[];
  readonly sourcesIgnored: readonly string[];
  /** 0..1 indicateur grossier (présence mpp, footprint, pans, hauteurs clés). */
  readonly completenessScore: number;
  /** true si meta.canonical3DWorldContract ou équivalent lu sur state.roof. */
  readonly canonical3DWorldContractPresent: boolean;
}

function pushReason(out: string[], cond: boolean, msg: string): void {
  if (cond) out.push(msg);
}

export function computeEligibility(input: {
  readonly hasMpp: boolean;
  readonly hasBuildingFootprint: boolean;
  readonly hasRoofPatches: boolean;
  readonly patchGeometryComplete: boolean;
  readonly blockingCount: number;
  readonly obstacleAmbiguousCount: number;
  readonly pvPanelsParsed: number;
}): ParseEligibility {
  const reasons: string[] = [];
  const { hasMpp, hasBuildingFootprint, hasRoofPatches, patchGeometryComplete, blockingCount, obstacleAmbiguousCount, pvPanelsParsed } = input;

  pushReason(reasons, !hasMpp, "MISSING_METERS_PER_PIXEL");
  pushReason(reasons, !hasBuildingFootprint, "MISSING_BUILDING_FOOTPRINT");
  pushReason(reasons, !hasRoofPatches, "MISSING_ROOF_PATCHES");
  pushReason(reasons, hasRoofPatches && !patchGeometryComplete, "INCOMPLETE_PATCH_HEIGHTS");
  pushReason(reasons, blockingCount > 0, "BLOCKING_DIAGNOSTICS_PRESENT");
  pushReason(reasons, obstacleAmbiguousCount > 0, "AMBIGUOUS_OBSTACLE_FAMILIES");

  const house3dBuildable = hasMpp && hasBuildingFootprint && blockingCount === 0;
  const roof3dBuildable = house3dBuildable && hasRoofPatches && patchGeometryComplete;
  const obstacles3dBuildable = house3dBuildable && obstacleAmbiguousCount === 0;
  const pv3dBuildable = pvPanelsParsed > 0;

  return {
    house3dBuildable,
    roof3dBuildable,
    obstacles3dBuildable,
    pv3dBuildable,
    reasons,
  };
}
