import type { BuildRoofModel3DResult } from "../builder/buildRoofModel3DFromLegacyGeometry";
import type { LegacyPanInput, LegacyRoofGeometryInput } from "../builder/legacyInput";
import type { RoofReconstructionQualityLevel } from "../builder/roofReconstructionQuality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { GeometryDiagnostic, GeometryTruthStatus } from "../types/quality";

export const ROOF_COMMERCIAL_GEOMETRY_TOLERANCES = {
  /** Règle métier : sous ce seuil, une toiture déclarée inclinée n'a pas une pente 3D assez fiable pour l'officiel. */
  flatDrainageMaxTiltDeg: 5,
  /** Règle métier de qualification inclinée, pas une vérité physique universelle. */
  inclinedMinTiltDeg: 0.75,
  /** Tolérance numérique anti-bruit sur les hauteurs, jamais une porte d'acceptation indépendante. */
  zNoiseFloorM: 0.001,
  /** Portée horizontale minimale pour interpréter atan(dZ / portée) sans instabilité. */
  minHorizontalRunM: 0.05,
  minSurfaceAreaM2: 0.01,
  /** Écart maximal toléré entre pente reconstruite et pente saisie avant diagnostic de contradiction. */
  tiltHintMaxDeltaDeg: 2,
} as const;

export type RoofKindProvenance =
  | "EXPLICIT"
  | "MIGRATED_DETERMINISTIC"
  | "INFERRED_HIGH_CONFIDENCE"
  | "UNRESOLVED";

export type ResolvedCommercialRoofKind = "FLAT" | "PITCHED" | "UNKNOWN";

export type RoofCommercialGeometryPanResult = {
  readonly panId: string;
  readonly declaredKind: ResolvedCommercialRoofKind;
  readonly roofKindProvenance: RoofKindProvenance;
  readonly status: GeometryTruthStatus;
  readonly commercialUsable: boolean;
  readonly tiltDeg: number | null;
  readonly physicalSlopeDeg: number | null;
  readonly zSpanM: number | null;
  readonly horizontalSpanM: number | null;
  readonly areaM2: number | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
};

export type RoofCommercialGeometryValidationResult = {
  readonly status: GeometryTruthStatus;
  readonly commercialUsable: boolean;
  readonly officialPvPlacementAllowed: boolean;
  readonly officialNearShadingAllowed: boolean;
  readonly diagnostics: readonly GeometryDiagnostic[];
  readonly panResults: readonly RoofCommercialGeometryPanResult[];
};

function diag(
  code: string,
  severity: GeometryDiagnostic["severity"],
  message: string,
  context?: Readonly<Record<string, string | number | boolean>>,
): GeometryDiagnostic {
  return context ? { code, severity, message, context } : { code, severity, message };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function declaredKind(pan: LegacyPanInput | undefined): ResolvedCommercialRoofKind {
  const kind = String(pan?.roofKind ?? "").trim().toUpperCase();
  if (kind === "FLAT") return "FLAT";
  if (kind === "PITCHED" || kind === "SLOPED" || kind === "MONOPENTE" || kind === "GABLE" || kind === "HIP") {
    return "PITCHED";
  }
  return "UNKNOWN";
}

function roofKindProvenance(pan: LegacyPanInput | undefined): RoofKindProvenance {
  const p = pan?.roofKindProvenance;
  if (
    p === "EXPLICIT" ||
    p === "MIGRATED_DETERMINISTIC" ||
    p === "INFERRED_HIGH_CONFIDENCE" ||
    p === "UNRESOLVED"
  ) {
    return p;
  }
  return pan?.roofKind == null ? "UNRESOLVED" : "EXPLICIT";
}

function roofKindProvenanceIsCommercial(p: RoofKindProvenance): boolean {
  return p === "EXPLICIT" || p === "MIGRATED_DETERMINISTIC" || p === "INFERRED_HIGH_CONFIDENCE";
}

function zSpanM(patch: RoofPlanePatch3D): number | null {
  const zs = patch.cornersWorld.map((p) => p.z);
  if (zs.length === 0 || zs.some((z) => !Number.isFinite(z))) return null;
  return Math.max(...zs) - Math.min(...zs);
}

function horizontalSpanM(patch: RoofPlanePatch3D): number | null {
  const pts = patch.cornersWorld;
  if (pts.length < 2) return null;
  let max = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      max = Math.max(max, Math.hypot(dx, dy));
    }
  }
  return max;
}

function physicalSlopeDegFromNormal(patch: RoofPlanePatch3D): number | null {
  const n = patch.normal;
  if (![n.x, n.y, n.z].every(Number.isFinite)) return null;
  const horizontal = Math.hypot(n.x, n.y);
  const vertical = Math.abs(n.z);
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || vertical <= 0) return null;
  return Math.atan(horizontal / vertical) * 180 / Math.PI;
}

function hasPatchDiagnostic(patch: RoofPlanePatch3D, code: string): boolean {
  return patch.quality.diagnostics.some((d) => d.code === code);
}

function qualityIsPhysicallyBlocking(quality: RoofReconstructionQualityLevel): boolean {
  return quality === "FALLBACK" || quality === "INCOHERENT";
}

function isDeclaredInclined(kind: RoofCommercialGeometryPanResult["declaredKind"]): boolean {
  return kind === "PITCHED";
}

function validatePan(args: {
  readonly pan: LegacyPanInput | undefined;
  readonly patch: RoofPlanePatch3D;
  readonly globalQuality: RoofReconstructionQualityLevel;
}): RoofCommercialGeometryPanResult {
  const patch = args.patch;
  const kind = declaredKind(args.pan);
  const provenance = roofKindProvenance(args.pan);
  const tiltDeg = finiteOrNull(patch.tiltDeg);
  const physicalSlopeDeg = physicalSlopeDegFromNormal(patch);
  const areaM2 = finiteOrNull(patch.surface.areaM2);
  const span = zSpanM(patch);
  const horizontalSpan = horizontalSpanM(patch);
  const diagnostics: GeometryDiagnostic[] = [];

  if (areaM2 == null || areaM2 <= ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.minSurfaceAreaM2) {
    diagnostics.push(diag("COMMERCIAL_ROOF_SURFACE_DEGENERATE", "error", "Surface de pan nulle ou quasi nulle.", {
      panId: String(patch.id),
      areaM2: areaM2 ?? -1,
    }));
  }
  if (tiltDeg == null || physicalSlopeDeg == null || span == null || horizontalSpan == null) {
    diagnostics.push(diag("COMMERCIAL_ROOF_NON_FINITE_GEOMETRY", "error", "Pente ou hauteurs de pan non finies.", {
      panId: String(patch.id),
    }));
  }
  if (horizontalSpan != null && horizontalSpan <= ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.minHorizontalRunM) {
    diagnostics.push(diag("COMMERCIAL_ROOF_HORIZONTAL_RUN_DEGENERATE", "error", "Portée horizontale de pan insuffisante pour qualifier la pente.", {
      panId: String(patch.id),
      horizontalSpanM: horizontalSpan,
    }));
  }

  if (kind === "UNKNOWN" || !roofKindProvenanceIsCommercial(provenance)) {
    diagnostics.push(diag("COMMERCIAL_ROOF_KIND_UNRESOLVED", "error", "Confirmez le type de toiture avant d'utiliser le placement photovoltaïque et l'ombrage 3D officiels.", {
      panId: String(patch.id),
      roofKind: kind,
      roofKindProvenance: provenance,
    }));
  }

  const usesDefaultFallback = hasPatchDiagnostic(patch, "HEIGHT_FALLBACK_DEFAULT_ON_CORNERS");
  const usesDangerousHeightFallback = usesDefaultFallback || args.globalQuality === "FALLBACK";
  const isPhysicallyInclined =
    physicalSlopeDeg != null &&
    span != null &&
    horizontalSpan != null &&
    horizontalSpan > ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.minHorizontalRunM &&
    span > ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.zNoiseFloorM &&
    physicalSlopeDeg > ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.inclinedMinTiltDeg;
  const tiltHint = finiteOrNull(args.pan?.tiltDegHint);
  const slopeMismatch =
    tiltHint != null &&
    physicalSlopeDeg != null &&
    Math.abs(tiltHint - physicalSlopeDeg) > ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.tiltHintMaxDeltaDeg;

  if (slopeMismatch) {
    diagnostics.push(diag("COMMERCIAL_ROOF_SLOPE_INCONSISTENT_WITH_NORMAL", "error", "Pente reconstruite incohérente avec la normale du pan.", {
      panId: String(patch.id),
      tiltDegHint: tiltHint,
      physicalSlopeDeg,
    }));
  }

  if (kind === "FLAT") {
    if (physicalSlopeDeg != null && physicalSlopeDeg > ROOF_COMMERCIAL_GEOMETRY_TOLERANCES.flatDrainageMaxTiltDeg) {
      diagnostics.push(diag("COMMERCIAL_FLAT_ROOF_EXCESSIVE_TILT", "error", "Toiture plate avec pente forte : vérifier la typologie ou la géométrie saisie.", {
        panId: String(patch.id),
        physicalSlopeDeg,
      }));
    }
    if (usesDefaultFallback) {
      diagnostics.push(diag("COMMERCIAL_FLAT_ROOF_HEIGHT_FALLBACK", "error", "Toiture plate explicite reconstruite avec hauteur de référence par défaut : compléter la hauteur réelle.", {
        panId: String(patch.id),
      }));
    }
  } else if (isDeclaredInclined(kind)) {
    if (!isPhysicallyInclined) {
      diagnostics.push(diag("COMMERCIAL_PITCHED_ROOF_RECONSTRUCTED_FLAT", "error", "Toiture inclinée reconstruite à plat : compléter les hauteurs/faîtages.", {
        panId: String(patch.id),
        physicalSlopeDeg: physicalSlopeDeg ?? -1,
        zSpanM: span ?? -1,
        horizontalSpanM: horizontalSpan ?? -1,
      }));
    }
    if (usesDangerousHeightFallback) {
      diagnostics.push(diag("COMMERCIAL_PITCHED_ROOF_HEIGHT_FALLBACK", "error", "Toiture inclinée reconstruite avec une hauteur fallback/default : non exploitable officiellement.", {
        panId: String(patch.id),
      }));
    }
  }

  if (qualityIsPhysicallyBlocking(args.globalQuality) && isDeclaredInclined(kind)) {
    diagnostics.push(diag("COMMERCIAL_ROOF_GLOBAL_QUALITY_BLOCKING", "error", "Qualité globale toiture incompatible avec une exploitation officielle.", {
      panId: String(patch.id),
      roofReconstructionQuality: args.globalQuality,
    }));
  }

  const hasError = diagnostics.some((d) => d.severity === "error");
  const hasWarning = diagnostics.some((d) => d.severity === "warning");
  return {
    panId: String(patch.id),
    declaredKind: kind,
    roofKindProvenance: provenance,
    status: hasError ? "INVALID" : hasWarning ? "DEGRADED" : "VALID",
    commercialUsable: !hasError,
    tiltDeg,
    physicalSlopeDeg,
    zSpanM: span,
    horizontalSpanM: horizontalSpan,
    areaM2,
    diagnostics,
  };
}

export function validateRoofCommercialGeometry(args: {
  readonly legacyInput: LegacyRoofGeometryInput;
  readonly roofResult: Pick<BuildRoofModel3DResult, "model" | "roofHeightSignal" | "roofReconstructionQuality">;
}): RoofCommercialGeometryValidationResult {
  const panById = new Map(args.legacyInput.pans.map((p) => [String(p.id), p] as const));
  const globalDiagnostics: GeometryDiagnostic[] = [];
  const globalQuality = args.roofResult.roofReconstructionQuality.roofReconstructionQuality;
  const hasDeclaredInclinedPan = args.legacyInput.pans.some((pan) => isDeclaredInclined(declaredKind(pan)));
  const hasUnresolvedPan = args.legacyInput.pans.some((pan) => declaredKind(pan) === "UNKNOWN" || !roofKindProvenanceIsCommercial(roofKindProvenance(pan)));

  if (args.roofResult.roofHeightSignal.heightSignalStatus === "MISSING" && hasDeclaredInclinedPan) {
    globalDiagnostics.push(diag("COMMERCIAL_ROOF_HEIGHT_SIGNAL_MISSING", "error", "Aucune hauteur exploitable pour reconstruire la forme physique de toiture."));
  } else if (args.roofResult.roofHeightSignal.heightSignalStatus === "PARTIAL") {
    globalDiagnostics.push(diag("COMMERCIAL_ROOF_HEIGHT_SIGNAL_PARTIAL", "warning", "Signal hauteur partiel : exploitation autorisée seulement si les pans restent physiquement cohérents."));
  }

  if (globalQuality === "PARTIAL") {
    globalDiagnostics.push(diag("COMMERCIAL_ROOF_RECONSTRUCTION_PARTIAL", "warning", "Reconstruction partielle : vérifier les diagnostics par pan."));
  } else if ((globalQuality === "FALLBACK" && (hasDeclaredInclinedPan || hasUnresolvedPan)) || globalQuality === "INCOHERENT") {
    globalDiagnostics.push(diag("COMMERCIAL_ROOF_RECONSTRUCTION_BLOCKING", "error", "Reconstruction toiture non exploitable officiellement.", {
      roofReconstructionQuality: globalQuality,
    }));
  }

  const panResults = args.roofResult.model.roofPlanePatches.map((patch) =>
    validatePan({
      pan: panById.get(String(patch.id)),
      patch,
      globalQuality,
    }),
  );
  const diagnostics = [...globalDiagnostics, ...panResults.flatMap((p) => p.diagnostics)];
  const hasError = diagnostics.some((d) => d.severity === "error") || panResults.some((p) => p.status === "INVALID");
  const hasWarning = diagnostics.some((d) => d.severity === "warning") || panResults.some((p) => p.status === "DEGRADED");
  const status: GeometryTruthStatus = hasError ? "INVALID" : hasWarning ? "DEGRADED" : "VALID";

  return {
    status,
    commercialUsable: status !== "INVALID",
    officialPvPlacementAllowed: status !== "INVALID",
    officialNearShadingAllowed: status !== "INVALID",
    diagnostics,
    panResults,
  };
}
