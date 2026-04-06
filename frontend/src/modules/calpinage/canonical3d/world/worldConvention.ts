/**
 * Contrat monde officiel Calpinage / SolarNext (ENU, Z-up, image → monde local).
 * Les formules numériques sont dans `builder/worldMapping.ts` ; ce fichier fige le contrat et la validation.
 *
 * Contrat produit unifié 2D/3D (origine image, identité Three) : `unifiedWorldFrame.ts`.
 */

export const CANONICAL_WORLD_FRAME = {
  axis: "ENU",
  zUp: true,
} as const;

/** Seul repère d’image supporté : origine coin haut-gauche, conversion via `worldMapping.imagePxToWorldHorizontalM`. */
export type CanonicalWorldReferenceFrame = "LOCAL_IMAGE_ENU";

export type CanonicalWorldConfig = {
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly referenceFrame: CanonicalWorldReferenceFrame;
};

export function isValidCanonicalWorldConfig(config: CanonicalWorldConfig): boolean {
  if (!config || typeof config !== "object") return false;
  if (config.referenceFrame !== "LOCAL_IMAGE_ENU") return false;
  if (typeof config.metersPerPixel !== "number" || !Number.isFinite(config.metersPerPixel) || config.metersPerPixel <= 0) {
    return false;
  }
  if (typeof config.northAngleDeg !== "number" || !Number.isFinite(config.northAngleDeg)) return false;
  return true;
}

/** Construit le bloc `world` exposé dans `CanonicalScene3DInput` à partir de la config officielle. */
export function canonicalSceneWorldFromConfig(config: CanonicalWorldConfig): {
  readonly coordinateSystem: "ENU";
  readonly zUp: true;
  readonly northAngleDeg: number;
  readonly metersPerPixel: number;
  readonly referenceFrame: CanonicalWorldReferenceFrame;
} {
  return {
    coordinateSystem: CANONICAL_WORLD_FRAME.axis,
    zUp: true,
    northAngleDeg: config.northAngleDeg,
    metersPerPixel: config.metersPerPixel,
    referenceFrame: config.referenceFrame,
  };
}

export function canonicalWorldConfigFromSceneWorld(w: {
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
  readonly referenceFrame: CanonicalWorldReferenceFrame;
}): CanonicalWorldConfig {
  return {
    metersPerPixel: w.metersPerPixel,
    northAngleDeg: w.northAngleDeg,
    referenceFrame: w.referenceFrame,
  };
}
