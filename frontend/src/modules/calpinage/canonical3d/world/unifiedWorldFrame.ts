/**
 * Repère monde unique 2D ↔ 3D (SolarScene3D / viewer officiel).
 *
 * Règle : une seule convention pour le plan image → plan horizontal monde (ENU, Z up) → Three.js (identité).
 * Les formules sont dans `builder/worldMapping.ts` ; les helpers typés passent par `core/worldConvention.ts`.
 */

import type { CanonicalWorldConfig, CanonicalWorldReferenceFrame } from "./worldConvention";
import { isValidCanonicalWorldConfig } from "./worldConvention";

/** Origine image officielle du mapping px → monde : coin haut-gauche (0,0), +y pixel vers le bas. */
export const UNIFIED_WORLD_IMAGE_ORIGIN_PX = { x: 0, y: 0 } as const;

/**
 * Contrat figé demandé produit : même repère pour canvas 2D et scène 3D.
 * `imageOriginPx` est toujours (0,0) ; toute autre origine implicite est interdite dans le pipeline canonique.
 */
export type UnifiedWorldFrame = {
  readonly referenceFrame: CanonicalWorldReferenceFrame;
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly imageOriginPx: typeof UNIFIED_WORLD_IMAGE_ORIGIN_PX;
};

export function toUnifiedWorldFrame(config: CanonicalWorldConfig): UnifiedWorldFrame | null {
  if (!isValidCanonicalWorldConfig(config)) return null;
  return {
    referenceFrame: config.referenceFrame,
    metersPerPixel: config.metersPerPixel,
    northAngleDeg: config.northAngleDeg,
    imageOriginPx: UNIFIED_WORLD_IMAGE_ORIGIN_PX,
  };
}

/**
 * Monde canonique (m) → position Three.js pour `SolarScene3DViewer` : identité (ENU, Z up).
 * Ne pas utiliser pour le legacy `houseModelV2` / phase3Viewer.
 */
export function worldMetersToThreeJsPosition(
  xM: number,
  yM: number,
  zM: number
): { x: number; y: number; z: number } {
  return { x: xM, y: yM, z: zM };
}
