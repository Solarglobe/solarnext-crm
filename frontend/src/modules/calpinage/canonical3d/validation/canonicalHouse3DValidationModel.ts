/**
 * Rapport officiel de validation Maison 3D (entrées canoniques uniquement).
 */

import type { CanonicalHouse3DValidationCode } from "./canonicalHouse3DValidationCodes";
import { CANONICAL_HOUSE_3D_VALIDATION_REPORT_SCHEMA_ID } from "./canonicalHouse3DValidationCodes";

export type CanonicalHouse3DQualityLevel = "clean" | "acceptable" | "partial" | "ambiguous" | "invalid";

export type CanonicalHouse3DValidationSeverity = "error" | "warning" | "info";

/** Une entrée de diagnostic exploitable machine + humain. */
export interface CanonicalHouse3DValidationDiagnostic {
  readonly code: CanonicalHouse3DValidationCode;
  readonly severity: CanonicalHouse3DValidationSeverity;
  readonly message: string;
  /** Identifiants métier (patch, arête, annexe, mur…). */
  readonly entityIds?: readonly string[];
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export type ValidationBlockStatus = "ok" | "warning" | "error" | "skipped";

export interface CanonicalHouse3DValidationBlockReport {
  readonly status: ValidationBlockStatus;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly diagnostics: readonly CanonicalHouse3DValidationDiagnostic[];
}

export interface CanonicalHouse3DValidationReport {
  readonly schemaId: typeof CANONICAL_HOUSE_3D_VALIDATION_REPORT_SCHEMA_ID;
  readonly validatedAtIso: string;
  readonly globalValidity: boolean;
  readonly globalQualityLevel: CanonicalHouse3DQualityLevel;
  /** Prévisualisation / debug : coque présente et pas d’erreur bloquante bâtiment. */
  readonly isBuildableForViewer: boolean;
  /** Premium 3D : toiture attachée, coutures non invalides, pas niveau invalid/ambiguous. */
  readonly isBuildableForPremium3D: boolean;
  /** Ombrage : plans résolus majoritairement, intersections exploitables. */
  readonly isBuildableForShading: boolean;
  /** Pose PV : même base que shading + annexes sans erreur bloquante. */
  readonly isBuildableForPV: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly buildingValidation: CanonicalHouse3DValidationBlockReport;
  readonly roofTopologyValidation: CanonicalHouse3DValidationBlockReport;
  readonly roofPlanesValidation: CanonicalHouse3DValidationBlockReport;
  readonly roofIntersectionsValidation: CanonicalHouse3DValidationBlockReport;
  readonly roofBuildingBindingValidation: CanonicalHouse3DValidationBlockReport;
  readonly roofAnnexesValidation: CanonicalHouse3DValidationBlockReport;
  readonly globalGeometryValidation: CanonicalHouse3DValidationBlockReport;
}

export interface ValidateCanonicalHouse3DGeometryOptions {
  /** Tolérance résidu plan (m) — alignée sur solveRoofPlanes par défaut. */
  readonly maxPlaneResidualM?: number;
  /** Si true, tout fallback plan est warning minimum (sinon info si résidu OK). */
  readonly strictPlaneProvenance?: boolean;
}
