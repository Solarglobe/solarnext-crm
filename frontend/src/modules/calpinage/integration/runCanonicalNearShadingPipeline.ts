/**
 * Chaîne unique : toiture 3D (pré-construite) → volumes → panneaux 3D → near shading raycast (canonical3d).
 * V1 SAFE : mapping panneau→pan, gate horizon, pondération dz, per-panel physique.
 *
 * La toiture ne doit pas être reconstruite ici : passer `officialRoofModelResult` issu du pipeline
 * officiel ou du cache near (`officialRoofModelNearShadingCache`).
 */

import type { BuildRoofModel3DResult } from "../canonical3d/builder/buildRoofModel3DFromLegacyGeometry";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../canonical3d/nearShading3d/nearShadingParams";
import { runNearShadingSeriesHorizonWeighted } from "../canonical3d/nearShading3d/nearShadingHorizonWeighted";
import type { NearShadingAnnualAggregate } from "../canonical3d/types/near-shading-3d";
import { buildPvPanels3D } from "../canonical3d/pvPanels/buildPvPanels3D";
import { buildRoofVolumes3D } from "../canonical3d/volumes/buildRoofVolumes3D";
import type { ObstacleInput, PanelInput } from "../shading/shadingInputTypes";
import {
  CANONICAL_NEAR_MAX_PANELS,
  CANONICAL_NEAR_MAX_PANELS_TIMESTEPS,
} from "./canonicalNearShadingLimits";
import { mapNearObstaclesToVolumeInputs, mapPanelsToPvPlacementInputs } from "./mapCalpinageToCanonicalNearShading";

export interface CanonicalNearShadingPerPanelRow {
  readonly panelId: string;
  readonly meanShadedFraction: number;
  readonly lossPct: number;
}

export interface RunCanonicalNearShadingPipelineOptions {
  /** Sortie `buildRoofModel3DFromLegacyGeometry` — même instance que le pipeline 3D officiel lorsque possible. */
  readonly officialRoofModelResult: BuildRoofModel3DResult;
  readonly obstacles: readonly ObstacleInput[];
  readonly panels: readonly PanelInput[];
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly getHeightAtImagePoint?: (pt: { x: number; y: number }) => number;
  /** Vecteurs soleil annuels (même convention que nearShadingCore / getAnnualSunVectors). */
  readonly sunVectors: readonly { dx: number; dy: number; dz: number }[];
  /** Masque horizon (optionnel) — near uniquement si soleil au-dessus (aligné backend). */
  readonly horizonMask?: unknown | null;
  readonly samplingNx?: number;
  readonly samplingNy?: number;
}

export type CanonicalNearShadingPipelineResult =
  | {
      readonly ok: true;
      readonly nearLossPct: number;
      readonly annual: NearShadingAnnualAggregate;
      readonly perPanel: readonly CanonicalNearShadingPerPanelRow[];
      readonly diagnostics: readonly string[];
    }
  | { readonly ok: false; readonly reason: string; readonly diagnostics: readonly string[] };

export function runCanonicalNearShadingPipeline(
  opts: RunCanonicalNearShadingPipelineOptions
): CanonicalNearShadingPipelineResult {
  const diag: string[] = [];
  const roofRes = opts.officialRoofModelResult;
  const patches = roofRes.model.roofPlanePatches;
  if (!patches.length) {
    return {
      ok: false,
      reason: "NO_ROOF_PLANE_PATCHES",
      diagnostics: ["Reconstruction toiture : aucun pan planaire."],
    };
  }
  diag.push(`roofPatches=${patches.length}`);

  const workBudget = opts.panels.length * opts.sunVectors.length;
  if (workBudget > CANONICAL_NEAR_MAX_PANELS_TIMESTEPS) {
    return {
      ok: false,
      reason: "PERF_BUDGET_EXCEEDED",
      diagnostics: [
        ...diag,
        `Budget panels×timesteps=${workBudget} > ${CANONICAL_NEAR_MAX_PANELS_TIMESTEPS} — fallback legacy requis.`,
      ],
    };
  }

  const baseElevationM = 0;
  const volumeInput = mapNearObstaclesToVolumeInputs(
    opts.obstacles,
    opts.metersPerPixel,
    opts.northAngleDeg,
    baseElevationM
  );

  const { inputs: panelInputs, diagnostics: mapDiag } = mapPanelsToPvPlacementInputs(
    opts.panels,
    patches,
    opts.metersPerPixel,
    opts.northAngleDeg,
    opts.getHeightAtImagePoint,
    opts.samplingNx ?? 3,
    opts.samplingNy ?? 3
  );
  diag.push(...mapDiag);

  if (!panelInputs.length) {
    return {
      ok: false,
      reason: "NO_PANELS_MAPPED_TO_PATCHES",
      diagnostics: [
        ...diag,
        "Aucun panneau mappé vers un patch 3D (panId manquant ou inconnu).",
      ],
    };
  }

  if (panelInputs.length > CANONICAL_NEAR_MAX_PANELS) {
    return {
      ok: false,
      reason: "PERF_PANEL_COUNT_EXCEEDED",
      diagnostics: [
        ...diag,
        `Nombre de panneaux 3D ${panelInputs.length} > ${CANONICAL_NEAR_MAX_PANELS}.`,
      ],
    };
  }

  const volRes = buildRoofVolumes3D(volumeInput, { roofPlanePatches: patches });
  const pvRes = buildPvPanels3D({ panels: panelInputs }, { roofPlanePatches: patches });

  if (!pvRes.panels.length) {
    return {
      ok: false,
      reason: "NO_PV_PANELS_3D",
      diagnostics: [...diag, "Aucun panneau 3D généré (builder)."],
    };
  }

  const scene = {
    panels: pvRes.panels,
    obstacleVolumes: volRes.obstacleVolumes,
    extensionVolumes: volRes.extensionVolumes,
    params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
  };

  const weighted = runNearShadingSeriesHorizonWeighted(scene, opts.sunVectors, opts.horizonMask);

  const mean = weighted.annual.meanShadedFraction;
  const nearLossPct = Math.max(0, Math.min(100, mean * 100));

  const perPanel: CanonicalNearShadingPerPanelRow[] = [];
  for (const p of pvRes.panels) {
    const id = String(p.id);
    const fr = weighted.perPanelMeanShadedFraction.get(id) ?? 0;
    perPanel.push({
      panelId: id,
      meanShadedFraction: fr,
      lossPct: Math.max(0, Math.min(100, fr * 100)),
    });
  }

  diag.push(
    `timesteps=${opts.sunVectors.length}`,
    `horizonWeightedSteps=${weighted.annual.timestepResults.length}`,
    `meanShadedFraction=${mean.toFixed(4)}`,
    ...weighted.diagnostics
  );

  return {
    ok: true,
    nearLossPct,
    annual: weighted.annual,
    perPanel,
    diagnostics: diag,
  };
}
