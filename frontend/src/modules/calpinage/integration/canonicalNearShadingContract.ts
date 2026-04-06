/**
 * Contrat géométrique shading canonical (V1 SAFE) — couche intermédiaire.
 * Ne modifie pas les structures legacy calpinage ; documente les champs attendus
 * pour le pipeline 3D (buildRoofModel3D → volumes → buildPvPanels3D → raycast).
 */

import type { RoofPlanePatch3D } from "../canonical3d/types/roof-surface";

/** Entrée panneau enrichie pour le mapping vers PvPanelPlacementInput (lecture moteur / état). */
export interface CanonicalShadingPanelSource {
  readonly id?: string;
  /** Identifiant du pan toiture — doit correspondre à RoofPlanePatch3D.id (pan legacy). */
  readonly panId?: string | null;
  readonly polygonPx?: ReadonlyArray<{ x: number; y: number }>;
  readonly center?: { x: number; y: number } | null;
  /** Rotation bloc (deg), ex. pvPlacementEngine.getAllPanels().rotationDeg */
  readonly rotationDeg?: number;
  /** Rotation locale module (deg), lue sur block.panels[idx] si disponible. */
  readonly localRotationDeg?: number;
  readonly moduleWidthM?: number;
  readonly moduleHeightM?: number;
  readonly widthM?: number;
  readonly heightM?: number;
  readonly orientation?: "portrait" | "landscape" | string | null;
}

/** Référence pan : patch 3D issu de buildRoofModel3DFromLegacyGeometry. */
export type CanonicalShadingPanPatchRef = Pick<
  RoofPlanePatch3D,
  "id" | "normal" | "equation" | "centroid"
>;
