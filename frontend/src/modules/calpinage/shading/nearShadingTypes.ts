/**
 * Contrats near shading frontend — partagés entre wrapper et sélection officielle (évite imports circulaires).
 */

import type { NearShadingCanonical3dEnvelope, NearShadingOfficialNear } from "../integration/canonicalNearShadingTypes";
import type { ObstacleInput, PanelInput } from "./shadingInputTypes";

export type { NearShadingCanonical3dEnvelope, NearShadingOfficialNear, ObstacleInput, PanelInput };

export interface NearShadingConfig {
  year?: number;
  stepMinutes?: number;
  minSunElevationDeg?: number;
}

export interface ComputeNearShadingFrontendParams {
  panels: PanelInput[];
  obstacles: ObstacleInput[];
  latitude: number;
  longitude: number;
  config?: NearShadingConfig;
  getHeightAtImagePoint?: (point: { x: number; y: number }) => number;
  useZLocal?: boolean;
  metersPerPixel?: number;
  debug?: boolean;
  calpinageRoofState?: unknown;
  /**
   * `CALPINAGE_STATE` racine (optionnel) : priorise `state.pans` sur `roof.roofPans` pour le legacy 3D.
   */
  calpinageRuntimeRoot?: unknown;
  /**
   * Lignes structurantes résolues (XY image) — même lecture que Phase 2 / pans.
   * Optionnel : si absent, le pipeline 3D canonical n’a pas les ridges/traits pour Z.
   */
  calpinageStructural?: { ridges?: unknown[]; traits?: unknown[] };
  /**
   * Masque horizon (même formes que computeAnnualShadingLoss / horizonMaskSampler).
   * Si défini, le near canonical n’intègre que les directions soleil **au-dessus** de l’horizon (aligné backend).
   */
  horizonMask?: unknown | null;
}

export interface NearShadingPanelResult {
  panelId: string | undefined;
  shadedFractionAvg: number;
  lossPct: number;
  shadedSamplesCount?: number;
}

export interface ComputeNearShadingFrontendResult {
  totalLossPct: number;
  perPanel: NearShadingPanelResult[];
  debugInfo?: {
    totalWeight: number;
    totalWeightedFraction: number;
    obstacleCount: number;
    panelCount: number;
    sunVectorCount: number;
  };
  /** Traçabilité moteur 3D / fallback (sérialisable JSON). */
  canonicalNear?: NearShadingCanonical3dEnvelope;
  /**
   * Source unique documentée : quel moteur a produit `totalLossPct`.
   * Toujours présent après `computeNearShadingFrontend`.
   */
  officialNear: NearShadingOfficialNear;
}
