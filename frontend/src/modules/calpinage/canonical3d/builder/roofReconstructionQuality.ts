/**
 * Prompt 4 — qualité de reconstruction toiture 3D (vérité géométrique vs fallback).
 *
 * ## Audit chaîne actuelle (synthèse)
 *
 * | Fichier | Fonction | Rôle | Limite actuelle | Politique |
 * |---------|----------|------|-----------------|-----------|
 * | `heightConstraints.ts` | `resolveZForPanCorner` | Z par coin (explicite → structurant → moyenne → default) | default global si signal faible | Garder + diagnostiquer |
 * | `unifyLegacyPanSharedCornersZ.ts` | `unifyLegacyPanCornerZAcrossPans` | Z unique clusters multi-pans (poids ridge) | moyenne peut lisser contradictions faibles | Garder |
 * | `imposeLegacySharedEdgePlanes.ts` | impose arête commune | plan contenant arête 3D partagée | ne corrige pas incohérences fortes | Garder |
 * | `buildRoofModel3DFromLegacyGeometry` | assemble | Newell, arêtes, ridges 3D | accepte plans à résiduel modéré | Diagnostiquer via qualité |
 * | `interPanSharedEdges.ts` | `buildInterPanRelationReports` | angles, grades, asymétries Z structurantes | `ambiguous` non bloquant | Conflicts → qualité globale |
 *
 * ## Règle produit — « vraie toiture 3D »
 *
 * **A.** Chaque pan : plan stable, normale cohérente avec les coins (RMS plan sous seuil), pente/azimut dérivables.
 * **B.** Voisins : une arête 2D commune → même segment 3D (sommets WORLD dédoublonnés par XY ; Z unifié).
 * **C.** Ridge / trait / contour : lorsque présents en entrée, ils pèsent sur Z (`heightConstraints`) et sur les rapports inter-pans ; ne sont pas décoratifs si alignés sur bord.
 *
 * Une reconstruction **TRUTHFUL** exige signal hauteur **SUFFICIENT**, aucune violation cluster XY-Z, aucun conflit d’arête structurante majeur, et tous les pans classés **TRUTHFUL** au plan local.
 */

import type { RoofModel3D } from "../types/model";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { LegacyRoofGeometryInput } from "./legacyInput";
import type { InterPanRelationReport } from "./interPanTypes";
import type { RoofHeightSignalDiagnostics } from "./roofHeightSignalDiagnostics";
import { centroid3, planeFitResidualRms } from "./planePolygon3d";

const RESIDUAL_OK = 0.005;
const RESIDUAL_HIGH = 0.05;
/** Aligné sur `buildRoofModel3DFromLegacyGeometry` (dédoublonnage sommets par XY monde). */
const POS_KEY_PRECISION = 1e5;
const Z_CLUSTER_TOL_M = 2e-3;

export type RoofReconstructionQualityLevel = "TRUTHFUL" | "PARTIAL" | "FALLBACK" | "INCOHERENT";

/** Vérité locale d’un pan — ne pas « promouvoir » visuellement sans cohérence minimale. */
export type RoofPatchTruthClass = "TRUTHFUL" | "PARTIAL" | "FALLBACK" | "INCOHERENT";

export type RoofReconstructionQualityDiagnostics = {
  readonly roofReconstructionQuality: RoofReconstructionQualityLevel;
  readonly panCount: number;
  readonly solvedPanCount: number;
  readonly partiallySolvedPanCount: number;
  readonly fallbackPanCount: number;
  readonly sharedEdgeResolvedCount: number;
  readonly sharedEdgeConflictCount: number;
  readonly structuralConstraintCount: number;
  readonly roofTopologyWarnings: readonly string[];
  /** Vérité locale par pan — ne pas promouvoir un pan en « toiture résolue » sans classe TRUTHFUL. */
  readonly perPanTruth: readonly { readonly panId: string; readonly truthClass: RoofPatchTruthClass }[];
};

export function emptyRoofReconstructionQualityDiagnostics(): RoofReconstructionQualityDiagnostics {
  return {
    roofReconstructionQuality: "FALLBACK",
    panCount: 0,
    solvedPanCount: 0,
    partiallySolvedPanCount: 0,
    fallbackPanCount: 0,
    sharedEdgeResolvedCount: 0,
    sharedEdgeConflictCount: 0,
    structuralConstraintCount: 0,
    roofTopologyWarnings: [],
    perPanTruth: [],
  };
}

function roundKeyWorldXY(n: number): number {
  return Math.round(n * POS_KEY_PRECISION) / POS_KEY_PRECISION;
}

function xyKeyWorld(p: { x: number; y: number }): string {
  return `${roundKeyWorldXY(p.x)},${roundKeyWorldXY(p.y)}`;
}

/**
 * Détecte des coins WORLD au même XY (à tolérance grille) mais Z différents — brisure de l’unicité topologique.
 */
export function countWorldXYCornerZClusterViolations(patches: readonly RoofPlanePatch3D[]): number {
  const byKey = new Map<string, number[]>();
  for (const p of patches) {
    for (const c of p.cornersWorld) {
      const k = xyKeyWorld(c);
      const arr = byKey.get(k) ?? [];
      arr.push(c.z);
      byKey.set(k, arr);
    }
  }
  let bad = 0;
  for (const zs of byKey.values()) {
    if (zs.length < 2) continue;
    const lo = Math.min(...zs);
    const hi = Math.max(...zs);
    if (hi - lo > Z_CLUSTER_TOL_M) bad++;
  }
  return bad;
}

function patchCodes(p: RoofPlanePatch3D): Set<string> {
  return new Set(p.quality.diagnostics.map((d) => d.code));
}

function classifyPatchTruth(p: RoofPlanePatch3D): RoofPatchTruthClass {
  const codes = patchCodes(p);
  const c = centroid3(p.cornersWorld);
  const rms = planeFitResidualRms(p.cornersWorld, p.normal, c);
  if (codes.has("PLANE_HIGH_RESIDUAL") || rms > RESIDUAL_HIGH) return "INCOHERENT";
  if (codes.has("HEIGHT_FALLBACK_DEFAULT_ON_CORNERS")) return "FALLBACK";
  if (rms > RESIDUAL_OK || codes.has("PLANE_MODERATE_RESIDUAL")) return "PARTIAL";
  return "TRUTHFUL";
}

function interPanStructuralConflictCount(reports: readonly InterPanRelationReport[]): number {
  let n = 0;
  for (const r of reports) {
    for (const d of r.diagnostics) {
      if (d.code === "INTERPAN_NON_MANIFOLD_EDGE") {
        n++;
        continue;
      }
      if (
        d.severity === "warning" &&
        (d.code === "INTERPAN_RIDGE_ALMOST_COPLANAR_OR_FLAT" ||
          d.code === "INTERPAN_BREAK_LINE_NEARLY_COPLANAR")
      ) {
        n++;
        continue;
      }
      if (d.code === "INTERPAN_HEIGHT_ASYMMETRY_ALONG_STRUCTURAL_LINE") {
        const ctx = d.context as { deltaM?: number } | undefined;
        const deltaM = ctx && typeof ctx.deltaM === "number" ? ctx.deltaM : 0;
        if (deltaM > 0.02) n++;
      }
    }
  }
  return n;
}

/**
 * Agrège la qualité globale après `buildRoofModel3DFromLegacyGeometry`.
 */
export function computeRoofReconstructionQualityDiagnostics(args: {
  readonly legacyInput: LegacyRoofGeometryInput;
  readonly model: RoofModel3D;
  readonly roofHeightSignal: RoofHeightSignalDiagnostics;
  readonly interPanReports: readonly InterPanRelationReport[];
}): RoofReconstructionQualityDiagnostics {
  const patches = args.model.roofPlanePatches;
  const panCount = patches.length;
  const roofTopologyWarnings: string[] = [];

  if (panCount === 0) {
    return emptyRoofReconstructionQualityDiagnostics();
  }

  const perPanTruth = patches.map((p) => ({
    panId: String(p.id),
    truthClass: classifyPatchTruth(p),
  }));

  let solvedPanCount = 0;
  let partiallySolvedPanCount = 0;
  let fallbackPanCount = 0;
  let incoherentPanCount = 0;
  for (const { truthClass } of perPanTruth) {
    if (truthClass === "TRUTHFUL") solvedPanCount++;
    else if (truthClass === "PARTIAL") partiallySolvedPanCount++;
    else if (truthClass === "FALLBACK") fallbackPanCount++;
    else incoherentPanCount++;
  }
  if (incoherentPanCount > 0) {
    roofTopologyWarnings.push(`INCOHERENT_PANS:${incoherentPanCount}`);
  }

  const sharedEdgeResolvedCount = args.model.roofEdges.filter(
    (e) => e.incidentPlanePatchIds.length === 2,
  ).length;
  const nonManifold = args.model.roofEdges.filter((e) => e.incidentPlanePatchIds.length > 2).length;
  const interConflicts = interPanStructuralConflictCount(args.interPanReports);
  const xyViolations = countWorldXYCornerZClusterViolations(patches);
  if (xyViolations > 0) {
    roofTopologyWarnings.push(`WORLD_XY_CORNER_Z_MISMATCH_CLUSTERS:${xyViolations}`);
  }
  if (nonManifold > 0) {
    roofTopologyWarnings.push(`NON_MANIFOLD_SHARED_EDGES:${nonManifold}`);
  }
  if (interConflicts > 0) {
    roofTopologyWarnings.push(`STRUCTURAL_INTERPAN_WARNINGS:${interConflicts}`);
  }

  const sharedEdgeConflictCount = nonManifold + interConflicts + xyViolations;

  const structuralConstraintCount =
    (args.legacyInput.ridges?.length ?? 0) + (args.legacyInput.traits?.length ?? 0);

  let roofReconstructionQuality: RoofReconstructionQualityLevel;

  if (xyViolations > 0 || nonManifold > 0 || incoherentPanCount > 0) {
    roofReconstructionQuality = "INCOHERENT";
  } else if (args.roofHeightSignal.heightSignalStatus === "MISSING" || fallbackPanCount === panCount) {
    roofReconstructionQuality = "FALLBACK";
  } else if (
    args.roofHeightSignal.heightSignalStatus === "SUFFICIENT" &&
    solvedPanCount === panCount &&
    sharedEdgeConflictCount === 0
  ) {
    roofReconstructionQuality = "TRUTHFUL";
  } else {
    roofReconstructionQuality = "PARTIAL";
  }

  if (args.roofHeightSignal.heightSignalStatus === "PARTIAL" && roofReconstructionQuality === "TRUTHFUL") {
    roofReconstructionQuality = "PARTIAL";
    roofTopologyWarnings.push("HEIGHT_SIGNAL_PARTIAL:global_truth_downgrade");
  }

  return {
    roofReconstructionQuality,
    panCount,
    solvedPanCount,
    partiallySolvedPanCount,
    fallbackPanCount,
    sharedEdgeResolvedCount,
    sharedEdgeConflictCount,
    structuralConstraintCount,
    roofTopologyWarnings,
    perPanTruth,
  };
}
