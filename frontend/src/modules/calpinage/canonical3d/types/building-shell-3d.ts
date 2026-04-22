/**
 * Enveloppe bâtiment (base horizontale + couronne haute suivant les plans toit) — distincte de la toiture `RoofModel3D`.
 * Repère identique aux autres entités `SolarScene3D` (Z-up, mêmes unités m).
 */

import type { WorldPosition3D } from "./coordinates";
import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "./volumetric-mesh";

export type BuildingShellContourSource =
  | "CALPINAGE_STATE.contours"
  | "roof.contoursBati"
  /**
   * @deprecated Anciennes scènes uniquement — le shell ne dérive plus des pans (option A : contour requis).
   */
  | "roof_plane_patches:largest_pan_footprint"
  /**
   * @deprecated Anciennes scènes uniquement — le shell ne dérive plus des pans (option A : contour requis).
   */
  | "roof_plane_patches:xy_footprint_union";

export interface BuildingShell3D {
  readonly id: "calpinage-building-shell";
  /** Origine du polygone d’emprise (traçabilité produit). */
  readonly contourSource: BuildingShellContourSource;
  readonly vertices: readonly VolumeVertex3D[];
  readonly edges: readonly VolumeEdge3D[];
  readonly faces: readonly VolumeFace3D[];
  readonly bounds: AxisAlignedBounds3D;
  readonly baseElevationM: number;
  /** Max Z de la couronne haute (sommets sous-toit), pas un plateau horizontal unique. */
  readonly topElevationM: number;
  /** max(top Z) − baseZ — indication d’envergure verticale pour audit. */
  readonly wallHeightM: number;
  /** Stratégie retenue pour la hauteur de mur (audit). */
  readonly wallHeightStrategy: string;
}

export type BuildingShellFootprintWorld = readonly WorldPosition3D[];
