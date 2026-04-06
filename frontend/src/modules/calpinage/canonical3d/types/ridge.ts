/**
 * Ligne structurante 3D (faîtage, noue, rupture…) — **sémantique au-dessus** de `RoofEdge3D`.
 *
 * - Ce n’est **pas** un segment de dessin 2D : uniquement des références à des `roofEdges` déjà résolus en WORLD.
 * - Une polyligne : ordre dans `roofEdgeIds` suit la ligne (≥ 1 arête).
 * - L’incidence face ↔ arête reste portée par `RoofEdge3D.incidentPlanePatchIds`.
 */

import type { GeometryProvenance } from "./provenance";
import type { StableEntityId } from "./primitives";

export type RoofRidgeStructuralKind =
  | "main_ridge"
  | "secondary_ridge"
  | "hip_line"
  | "valley_line"
  | "break_line"
  | "dormer_ridge"
  | "other";

export interface RoofRidge3D {
  readonly id: StableEntityId;
  /** Ordre le long de la ligne structurante. */
  readonly roofEdgeIds: readonly StableEntityId[];
  readonly structuralKind: RoofRidgeStructuralKind;
  /** Contrainte géométrique future (pente cible, angle dièdre…) — clé/valeur typée. */
  readonly constraintHint?: Readonly<Record<string, number>>;
  readonly provenance: GeometryProvenance;
}
