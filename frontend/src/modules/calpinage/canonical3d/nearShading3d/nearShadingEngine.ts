/**
 * Moteur near shading 3D : rayons vers le soleil, intersections triangles, agrégations.
 */

import type { GeometryDiagnostic } from "../types/quality";
import type {
  NearShadingAnnualAggregate,
  NearShadingPanelResult,
  NearShadingSampleResult,
  NearShadingSceneContext,
  NearShadingSeriesResult,
  NearShadingSolarDirectionInput,
  NearShadingTimeStepResult,
} from "../types/near-shading-3d";
import type { ConfidenceTier } from "../types/quality";
import { add3, normalize3, scale3 } from "../utils/math3";
import { findClosestOccluderHit } from "./volumeRaycast";

const T_RAY_MIN = 1e-9;

function mergeQuality(confidences: ConfidenceTier[]): ConfidenceTier {
  if (confidences.includes("low")) return "low";
  if (confidences.includes("medium")) return "medium";
  return "high";
}

function emptyStep(
  solar: NearShadingSolarDirectionInput,
  diag: GeometryDiagnostic[]
): NearShadingTimeStepResult {
  return {
    solarDirection: solar,
    panelResults: [],
    totalSamples: 0,
    shadedSamples: 0,
    globalShadedFraction: 0,
    quality: { confidence: "low", diagnostics: diag },
  };
}

/**
 * Un pas temporel : une direction solaire, tous les panneaux et leurs échantillons grille.
 */
export function runNearShadingTimeStep(
  scene: NearShadingSceneContext,
  solar: NearShadingSolarDirectionInput
): NearShadingTimeStepResult {
  const globalDiag: GeometryDiagnostic[] = [];
  const dir = normalize3(solar.directionTowardSunWorld);
  if (!dir) {
    globalDiag.push({
      code: "NS_INVALID_SUN_DIRECTION",
      severity: "warning",
      message: "Direction solaire nulle ou non normalisable — pas de raycast.",
    });
    return emptyStep(solar, globalDiag);
  }

  if (!scene.panels.length) {
    globalDiag.push({
      code: "NS_SCENE_NO_PANELS",
      severity: "warning",
      message: "Aucun panneau dans la scène.",
    });
    return emptyStep(solar, globalDiag);
  }

  const { originEpsilonM, rayMaxLengthM, useAabbBroadPhase } = scene.params;
  const panelResults: NearShadingPanelResult[] = [];
  let totalSamples = 0;
  let shadedSamples = 0;
  const confidences: ConfidenceTier[] = [];

  for (const panel of scene.panels) {
    const samples = panel.samplingGrid.cellCentersWorld;
    const sampleResults: NearShadingSampleResult[] = [];
    let shadedCount = 0;
    const panelDiag: GeometryDiagnostic[] = [];

    if (!samples.length) {
      panelDiag.push({
        code: "NS_PANEL_NO_SAMPLES",
        severity: "warning",
        message: `Panneau ${panel.id} : grille d’échantillonnage vide.`,
        context: { panelId: panel.id },
      });
    }

    samples.forEach((origin, sampleIndex) => {
      const rayOrigin = add3(origin, scale3(dir, originEpsilonM));
      const hit = findClosestOccluderHit(
        rayOrigin,
        dir,
        T_RAY_MIN,
        rayMaxLengthM,
        scene.obstacleVolumes,
        scene.extensionVolumes,
        useAabbBroadPhase
      );
      const shaded = hit != null;
      if (shaded) shadedCount++;
      const sr: NearShadingSampleResult = {
        panelId: panel.id,
        sampleIndex,
        originWorld: { ...origin },
        shaded,
        hitDistanceM: hit ? hit.t + originEpsilonM : null,
        hitVolumeId: hit ? hit.volumeId : null,
        hitVolumeKind: hit ? hit.kind : null,
        hitFaceId: hit ? hit.faceId : null,
        diagnostics: [],
      };
      sampleResults.push(sr);
    });

    totalSamples += samples.length;
    shadedSamples += shadedCount;

    const ratio = samples.length > 0 ? shadedCount / samples.length : 0;
    const panelConf: ConfidenceTier = panelDiag.length ? "medium" : "high";
    confidences.push(panelConf);

    panelResults.push({
      panelId: panel.id,
      sampleResults,
      shadedSampleCount: shadedCount,
      totalSampleCount: samples.length,
      shadingRatio: ratio,
      quality: { confidence: panelConf, diagnostics: panelDiag },
    });
  }

  const globalShadedFraction = totalSamples > 0 ? shadedSamples / totalSamples : 0;

  globalDiag.push({
    code: "NS_TIMESTEP_COMPLETE",
    severity: "info",
    message: `Near shading 3D : ${shadedSamples}/${totalSamples} échantillons ombrés (raycast triangles).`,
  });

  return {
    solarDirection: { directionTowardSunWorld: { ...dir } },
    panelResults,
    totalSamples,
    shadedSamples,
    globalShadedFraction,
    quality: {
      confidence: mergeQuality(confidences),
      diagnostics: globalDiag,
    },
  };
}

/**
 * Plusieurs directions solaires + agrégat annuel simple (moyenne / min / max des fractions globales).
 */
export function runNearShadingSeries(
  scene: NearShadingSceneContext,
  solarDirections: readonly NearShadingSolarDirectionInput[]
): NearShadingSeriesResult {
  const globalDiagnostics: GeometryDiagnostic[] = [];
  const steps: NearShadingTimeStepResult[] = [];
  const fractions: number[] = [];

  for (const solar of solarDirections) {
    const step = runNearShadingTimeStep(scene, solar);
    steps.push(step);
    fractions.push(step.globalShadedFraction);
  }

  const valid = fractions.filter((f) => Number.isFinite(f));
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  const minF = valid.length ? Math.min(...valid) : 0;
  const maxF = valid.length ? Math.max(...valid) : 0;

  const annual: NearShadingAnnualAggregate = {
    timestepResults: steps,
    meanShadedFraction: mean,
    minShadedFraction: minF,
    maxShadedFraction: maxF,
    nearShadingLossProxy: 1 - mean,
    quality: {
      confidence: steps.some((s) => s.quality.confidence === "low")
        ? "low"
        : steps.some((s) => s.quality.confidence === "medium")
          ? "medium"
          : "high",
      diagnostics: [
        {
          code: "NS_ANNUAL_AGGREGATE",
          severity: "info",
          message: `Série near shading : ${solarDirections.length} pas, perte proxy locale ≈ ${(1 - mean).toFixed(4)}.`,
        },
      ],
    },
  };

  globalDiagnostics.push({
    code: "NS_SERIES_COMPLETE",
    severity: "info",
    message: `Near shading série : ${steps.length} time steps agrégés.`,
  });

  return { annual, globalDiagnostics };
}
