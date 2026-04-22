/**
 * Phase B produit — preuve technique (métriques patch, signal hauteur, lignes support).
 * Complète la Phase A (actions utilisateur) sans recalculer la toiture.
 */

import { centroid3, planeFitResidualRms } from "../builder/planePolygon3d";
import type { RoofReconstructionQualityDiagnostics } from "../builder/roofReconstructionQuality";
import type { RoofHeightSignalDiagnostics } from "../builder/roofHeightSignalDiagnostics";
import type { RoofModel3D } from "../types/model";
import type {
  SolarSceneRoofQualityPhaseB,
  SolarSceneRoofQualityPhaseBPanTechnical,
} from "../types/solarScene3d";

function roundMm1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundMm2(n: number): number {
  return Math.round(n * 100) / 100;
}

function incoherentPanCount(d: RoofReconstructionQualityDiagnostics): number {
  const n =
    d.panCount - d.solvedPanCount - d.partiallySolvedPanCount - d.fallbackPanCount;
  return n > 0 ? n : 0;
}

function buildPanTechnical(args: {
  readonly model: RoofModel3D;
  readonly roofQuality: RoofReconstructionQualityDiagnostics;
}): SolarSceneRoofQualityPhaseBPanTechnical[] {
  const truthByPan = new Map(args.roofQuality.perPanTruth.map((t) => [t.panId, t.truthClass]));
  return args.model.roofPlanePatches.map((p) => {
    const panId = String(p.id);
    const c = centroid3(p.cornersWorld);
    const rmsM = planeFitResidualRms(p.cornersWorld, p.normal, c);
    const zs = p.cornersWorld.map((v) => v.z);
    const zLo = Math.min(...zs);
    const zHi = Math.max(...zs);
    const codes = [...new Set(p.quality.diagnostics.map((d) => d.code))].sort();
    return {
      panId,
      truthClass: truthByPan.get(panId) ?? "FALLBACK",
      diagnosticCodes: codes,
      planeResidualRmsMm: roundMm2(rmsM * 1000),
      cornerZSpanMm: roundMm1((zHi - zLo) * 1000),
      tiltDeg: p.tiltDeg ?? null,
      azimuthDeg: p.azimuthDeg ?? null,
    };
  });
}

function buildSupportLinesFr(args: {
  readonly roofQuality: RoofReconstructionQualityDiagnostics;
  readonly roofHeightSignal: RoofHeightSignalDiagnostics;
  readonly panTechnical: readonly SolarSceneRoofQualityPhaseBPanTechnical[];
}): string[] {
  const { roofQuality, roofHeightSignal, panTechnical } = args;
  const inc = incoherentPanCount(roofQuality);
  const lines: string[] = [];
  lines.push(
    `[SolarNext 3D] Qualité toiture : ${roofQuality.roofReconstructionQuality} ; signal hauteur : ${roofHeightSignal.heightSignalStatus}.`,
  );
  lines.push(
    `Pans : ${roofQuality.panCount} (fiables ${roofQuality.solvedPanCount}, partiels ${roofQuality.partiallySolvedPanCount}, repli ${roofQuality.fallbackPanCount}, incohérents ${inc}).`,
  );
  lines.push(
    `Hauteurs sommets : explicites ${roofHeightSignal.explicitVertexHeightCount}, interpolées ${roofHeightSignal.interpolatedVertexHeightCount}, repli ${roofHeightSignal.fallbackVertexHeightCount}.`,
  );
  if (roofHeightSignal.usedSyntheticZeroHeight) {
    lines.push("Attention : hauteur Z=0 synthétique (repli) sur au moins un sommet.");
  }
  for (const w of roofQuality.roofTopologyWarnings) {
    lines.push(`Topologie : ${w}`);
  }
  for (const hw of roofHeightSignal.heightWarnings) {
    lines.push(`Signal hauteur : ${hw}`);
  }
  for (const p of panTechnical) {
    const codes = p.diagnosticCodes.length > 0 ? p.diagnosticCodes.join(", ") : "—";
    lines.push(
      `Pan ${p.panId} : classe ${p.truthClass} ; RMS plan ${p.planeResidualRmsMm} mm ; ΔZ coins ${p.cornerZSpanMm} mm ; codes ${codes}.`,
    );
  }
  return lines;
}

/**
 * Construit l’objet métadonnée Phase B à partir du modèle toit déjà résolu et des diagnostics agrégés.
 */
export function buildRoofQualityPhaseBTechnicalProof(args: {
  readonly model: RoofModel3D;
  readonly roofQuality: RoofReconstructionQualityDiagnostics;
  readonly roofHeightSignal: RoofHeightSignalDiagnostics;
}): SolarSceneRoofQualityPhaseB {
  const { roofQuality, roofHeightSignal, model } = args;
  const panTechnical = buildPanTechnical({ model, roofQuality });
  const aggregateCounts = {
    panCount: roofQuality.panCount,
    solvedPanCount: roofQuality.solvedPanCount,
    partiallySolvedPanCount: roofQuality.partiallySolvedPanCount,
    fallbackPanCount: roofQuality.fallbackPanCount,
    incoherentPanCount: incoherentPanCount(roofQuality),
    sharedEdgeResolvedCount: roofQuality.sharedEdgeResolvedCount,
    sharedEdgeConflictCount: roofQuality.sharedEdgeConflictCount,
    structuralConstraintCount: roofQuality.structuralConstraintCount,
  };
  return {
    heightSignal: {
      status: roofHeightSignal.heightSignalStatus,
      explicitVertexHeightCount: roofHeightSignal.explicitVertexHeightCount,
      interpolatedVertexHeightCount: roofHeightSignal.interpolatedVertexHeightCount,
      fallbackVertexHeightCount: roofHeightSignal.fallbackVertexHeightCount,
      usedSyntheticZeroHeight: roofHeightSignal.usedSyntheticZeroHeight,
      inclinedRoofGeometryTruthful: roofHeightSignal.inclinedRoofGeometryTruthful,
      heightWarnings: [...roofHeightSignal.heightWarnings],
    },
    aggregateCounts,
    panTechnical,
    supportLinesFr: buildSupportLinesFr({ roofQuality, roofHeightSignal, panTechnical }),
  };
}
