/**
 * Agrégation near shading avec pondération par panneau et gate horizon.
 *
 * Pondération :
 *   ANCIENNE (approx. toiture plate) : w = max(0, uz)  — cosinus zénithal de la direction solaire.
 *   NOUVELLE (correcte pour panneaux inclinés) : wp = max(0, dot(sunDir, panelNormal))
 *     — cosinus d'incidence sur la normale du panneau, calculé PER-PANEL.
 *
 * Pour un panneau horizontal (normal={0,0,1}) les deux pondérations sont identiques.
 * Pour un panneau incliné à 45° sud, le soleil perpendiculaire au panneau donne
 *   OLD: w = cos(45°) ≈ 0.707, NEW: wp = 1.0 → résultat pondéré correct.
 *
 * Alignement backend calpinageShading.service : le backend utilise max(0, uz) qui est une
 * approximation valide pour toitures faiblement inclinées. La pondération per-panneau est
 * plus exacte pour les cas à forte inclinaison.
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
 * Pour chaque direction soleil : si sous horizon → ignoré ; sinon pondération per-panneau
 * wp = max(0, dot(sunDir, panelNormal)) — correcte pour les panneaux inclinés.
 *
 * L'ancienne pondération max(0, uz) reste valide pour les panneaux horizontaux (cas identique)
 * mais sous-estime/surestime l'irradiance pour les panneaux inclinés.
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

  // Pré-calcul des normales par panneau pour pondération correcte (inclinaison quelconque).
  // Fallback {0,0,1} si la normale n'est pas disponible (panneau dégénéré ou non résolu).
  const panelNormalMap = new Map<string, { x: number; y: number; z: number }>();
  for (const p of scene.panels) {
    // TODO: vérifier que outwardNormal est normalisé (buildPvPanels3D le garantit)
    panelNormalMap.set(String(p.id), p.outwardNormal ?? { x: 0, y: 0, z: 1 });
  }

  let globalWeightedShaded = 0;
  let globalWeight = 0;

  for (const v of sunVectors) {
    const len = Math.hypot(v.dx, v.dy, v.dz);
    if (len < 1e-12) continue;
    const ux = v.dx / len;
    const uy = v.dy / len;
    const uz = v.dz / len;
    // Préfiltrage : soleil sous le plan horizontal → aucun panneau ne reçoit d'irradiance directe.
    if (uz <= 0) continue;

    const { azimuthDeg, elevationDeg } = sunAzimuthElevationFromUnitTowardSun(ux, uy, uz);
    if (isSunBlockedByHorizonForNear(horizonMask ?? null, azimuthDeg, elevationDeg)) {
      continue;
    }

    const solar: NearShadingSolarDirectionInput = {
      directionTowardSunWorld: { x: ux, y: uy, z: uz },
    };
    const step = runNearShadingTimeStep(scene, solar);
    steps.push(step);

    // Pondération per-panneau : cos d'incidence sur la normale du panneau.
    // Correcte pour panneaux inclinés (45°, etc.) contrairement à max(0, uz) qui
    // n'est exact que pour les panneaux horizontaux.
    for (const pr of step.panelResults) {
      const pid = String(pr.panelId);
      const n = panelNormalMap.get(pid) ?? { x: 0, y: 0, z: 1 }; // fallback plat
      const wp = Math.max(0, ux * n.x + uy * n.y + uz * n.z);
      panelWeightedSum.set(pid, (panelWeightedSum.get(pid) ?? 0) + wp * pr.shadingRatio);
      panelWeightSum.set(pid, (panelWeightSum.get(pid) ?? 0) + wp);
      globalWeightedShaded += wp * pr.shadingRatio;
      globalWeight += wp;
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
      message: `Near horizon-weighted (pondération per-panneau) : ${steps.length} pas soleil visibles / ${sunVectors.length} vecteurs, meanShaded=${mean.toFixed(4)}.`,
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
