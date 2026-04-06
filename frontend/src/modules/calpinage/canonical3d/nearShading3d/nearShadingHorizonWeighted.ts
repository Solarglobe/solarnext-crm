/**
 * Agrégation near shading avec pondération dz et gate horizon (alignement backend calpinageShading.service).
 */

import type {
  NearShadingAnnualAggregate,
  NearShadingSceneContext,
  NearShadingSolarDirectionInput,
  NearShadingTimeStepResult,
} from "../types/near-shading-3d";
import type { GeometryDiagnostic } from "../types/quality";
import { isSunBlockedByHorizonForNear } from "../../integration/horizonSunGateForNear";
import { runNearShadingTimeStep } from "./nearShadingEngine";

function sunAzimuthElevationFromUnitTowardSun(dx: number, dy: number, dz: number): {
  azimuthDeg: number;
  elevationDeg: number;
} {
  const uz = Math.max(-1, Math.min(1, dz));
  const elRad = Math.asin(uz);
  const elevationDeg = (elRad * 180) / Math.PI;
  const cosEl = Math.cos(elRad);
  if (Math.abs(cosEl) < 1e-10) {
    return { azimuthDeg: 0, elevationDeg };
  }
  let azimuthDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  azimuthDeg = ((azimuthDeg % 360) + 360) % 360;
  return { azimuthDeg, elevationDeg };
}

export interface NearShadingHorizonWeightedResult {
  readonly annual: NearShadingAnnualAggregate;
  readonly perPanelMeanShadedFraction: ReadonlyMap<string, number>;
  readonly diagnostics: readonly string[];
}

/**
 * Pour chaque direction soleil : si sous horizon → ignoré ; sinon pondération w=max(0,uz) comme le backend.
 */
export function runNearShadingSeriesHorizonWeighted(
  scene: NearShadingSceneContext,
  sunVectors: readonly { dx: number; dy: number; dz: number }[],
  horizonMask: unknown | null | undefined
): NearShadingHorizonWeightedResult {
  const steps: NearShadingTimeStepResult[] = [];
  const panelIds = scene.panels.map((p) => String(p.id));
  const panelWeightedSum = new Map<string, number>();
  const panelWeightSum = new Map<string, number>();
  for (const id of panelIds) {
    panelWeightedSum.set(id, 0);
    panelWeightSum.set(id, 0);
  }

  let globalWeightedShaded = 0;
  let globalWeight = 0;

  for (const v of sunVectors) {
    const len = Math.hypot(v.dx, v.dy, v.dz);
    if (len < 1e-12) continue;
    const ux = v.dx / len;
    const uy = v.dy / len;
    const uz = v.dz / len;
    const w = Math.max(0, uz);
    if (w <= 0) continue;

    const { azimuthDeg, elevationDeg } = sunAzimuthElevationFromUnitTowardSun(ux, uy, uz);
    if (isSunBlockedByHorizonForNear(horizonMask ?? null, azimuthDeg, elevationDeg)) {
      continue;
    }

    const solar: NearShadingSolarDirectionInput = {
      directionTowardSunWorld: { x: ux, y: uy, z: uz },
    };
    const step = runNearShadingTimeStep(scene, solar);
    steps.push(step);

    globalWeightedShaded += w * step.globalShadedFraction;
    globalWeight += w;

    for (const pr of step.panelResults) {
      const pid = String(pr.panelId);
      panelWeightedSum.set(pid, (panelWeightedSum.get(pid) ?? 0) + w * pr.shadingRatio);
      panelWeightSum.set(pid, (panelWeightSum.get(pid) ?? 0) + w);
    }
  }

  const mean = globalWeight > 0 ? globalWeightedShaded / globalWeight : 0;
  const fractions = steps.map((s) => s.globalShadedFraction).filter((f) => Number.isFinite(f));
  const minF = fractions.length ? Math.min(...fractions) : 0;
  const maxF = fractions.length ? Math.max(...fractions) : 0;

  const perPanelMean = new Map<string, number>();
  for (const id of panelIds) {
    const ws = panelWeightSum.get(id) ?? 0;
    const num = panelWeightedSum.get(id) ?? 0;
    perPanelMean.set(id, ws > 0 ? num / ws : 0);
  }

  const diag: GeometryDiagnostic[] = [
    {
      code: "NS_HORIZON_WEIGHTED_AGGREGATE",
      severity: "info",
      message: `Near horizon-weighted : ${steps.length} pas soleil visibles / ${sunVectors.length} vecteurs, meanShaded=${mean.toFixed(4)}.`,
    },
  ];

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
      diagnostics: diag,
    },
  };

  return {
    annual,
    perPanelMeanShadedFraction: perPanelMean,
    diagnostics: [
      `horizonWeightedSteps=${steps.length}`,
      `sunVectorCount=${sunVectors.length}`,
    ],
  };
}
