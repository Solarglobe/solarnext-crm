/**
 * Sortie officielle de l’assembleur premium — données de rendu + validation, sans recalcul géométrique.
 */

import type { PremiumHouse3DViewMode } from "./premiumHouse3DViewModes";
import type { CanonicalHouse3DQualityLevel } from "../../validation/canonicalHouse3DValidationModel";

export const PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID = "premium-house-3d-scene-assembly-v1" as const;

/** Paramètres Three meshStandard — couleurs en entier hex. */
export interface PremiumPbrMaterialToken {
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly flatShading?: boolean;
}

export interface PremiumLineMaterialToken {
  readonly color: number;
  readonly opacity: number;
}

export type PremiumGeometryTrustAccent = "none" | "neutral" | "acceptable" | "attention" | "critical";

export interface PremiumHouse3DValidationPresentation {
  /** `null` si aucun rapport Prompt 9 fourni — le viewer ne prétend pas à une qualité mesurée. */
  readonly qualityLevel: CanonicalHouse3DQualityLevel | null;
  readonly globalValidity: boolean | null;
  readonly source: "report" | "absent";
  /** Texte court pour badge / accessibilité. */
  readonly labelFr: string;
  readonly accent: PremiumGeometryTrustAccent;
  /** Codes diagnostics (erreurs puis avertissements) pour mode validation. */
  readonly diagnosticCodesExcerpt: readonly string[];
}

export interface PremiumHouse3DLightingToken {
  readonly ambientScale: number;
  readonly keyScale: number;
  readonly fillScale: number;
  readonly shadowMapSize: 1024 | 2048;
}

export interface PremiumHouse3DLayerFlags {
  readonly showRoof: boolean;
  readonly showRoofEdges: boolean;
  /** Polylignes faîtages / noues depuis `roofRidges` (données canoniques). */
  readonly showStructuralRidgeLines: boolean;
  readonly showObstacles: boolean;
  readonly showExtensions: boolean;
  readonly showPanels: boolean;
  readonly showPanelShading: boolean;
  readonly showSun: boolean;
}

export interface PremiumHouse3DPvPresentationBoost {
  readonly panelMetalness: number;
  readonly panelRoughness: number;
  readonly panelEmissiveIntensityBonus: number;
  readonly outlinePanelsWhenNotInspecting: boolean;
}

export interface PremiumHouse3DSceneAssembly {
  readonly schemaId: typeof PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID;
  readonly viewMode: PremiumHouse3DViewMode;
  readonly layers: PremiumHouse3DLayerFlags;
  readonly materials: {
    readonly roof: PremiumPbrMaterialToken;
    readonly obstacle: PremiumPbrMaterialToken;
    readonly extension: PremiumPbrMaterialToken;
    readonly roofEdgeLine: PremiumLineMaterialToken;
    readonly structuralRidgeLine: PremiumLineMaterialToken;
  };
  readonly lighting: PremiumHouse3DLightingToken;
  /** Marge de cadrage caméra (multiplicateur distance / ortho) — voir `viewerFraming`. */
  readonly framingMargin: number;
  readonly backgroundHex: string;
  readonly validation: PremiumHouse3DValidationPresentation;
  readonly pvBoost: PremiumHouse3DPvPresentationBoost;
}
