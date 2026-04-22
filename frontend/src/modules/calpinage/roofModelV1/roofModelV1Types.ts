import type { RoofShadingPhase6V1 } from "./roofModelShadingV1Types";

/** Modèle toit bâtiment v1 (schéma aligné shims — sous-ensemble typé). */
export type RoofModelV1 = Readonly<{
  project: { siteAnchor: { lat: number; lng: number } };
  buildings: ReadonlyArray<{
    roofFaces?: ReadonlyArray<{
      pitchDeg?: number;
      slopeAzimuthDeg?: number;
    }>;
  }>;
  shadingPhase6?: RoofShadingPhase6V1;
}>;

/** Échappatoire typage (builds stricts / stups consommateurs) */
export type Any = any;
