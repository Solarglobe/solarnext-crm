/**
 * Arêtes 3D entre sommets — existence topologique et sémantique métier.
 *
 * Distinction :
 * - `RoofEdge3D` : segment géométrique entre deux sommets 3D (longueur, direction).
 * - Une « ridge » dessinée en 2D n’est pas une RoofEdge3D tant qu’elle n’est pas instanciée
 *   dans le repère monde avec sommets résolus (cf. RoofRidge3D).
 */

import type { GeometryProvenance } from "./provenance";
import type { StableEntityId, Vector3 } from "./primitives";

/** Classification topologique (manifold / bord). */
export type RoofEdgeTopologyKind = "boundary" | "interior" | "non_manifold";

/**
 * Sémantique métier de l’arête (égout, faîtage, etc.).
 * `unspecified` si l’arête existe géométriquement mais le rôle n’est pas encore classé.
 */
export type RoofEdgeSemanticKind =
  | "unspecified"
  | "eave" /** égout / rive basse */
  | "ridge" /** faîtage / arêtier supérieur */
  | "hip"
  | "valley"
  | "rake" /** rive rampante */
  | "flash" /** cassure / noue / ligne de rupture */
  | "internal_split"; /** découpes internes de face */

export interface RoofEdgeSemantic {
  readonly kind: RoofEdgeSemanticKind;
  readonly label?: string;
}

/**
 * Distingue une arête du **maillage** d’une simple polyligne de contrainte (sans statut manifold).
 * Les segments « dessin 2D » du legacy ne sont **pas** des RoofEdge3D tant qu’ils ne sont pas résolus ici.
 */
export type RoofEdgePurpose = "mesh_topology" | "constraint_polyline" | "both";

export interface RoofEdge3D {
  readonly id: StableEntityId;
  readonly vertexAId: StableEntityId;
  readonly vertexBId: StableEntityId;
  readonly topologyKind: RoofEdgeTopologyKind;
  readonly semantic: RoofEdgeSemantic | null;
  /** Rôle dans le maillage vs contrainte pure (défaut attendu : mesh_topology). */
  readonly purpose: RoofEdgePurpose;
  /**
   * Si l’arête appartient à une ligne structurante : ID de `RoofRidge3D`.
   * Optionnel : une arête peut être hors ridge (rive, découpe interne).
   */
  readonly ridgeLineId?: StableEntityId;
  /** IDs des faces (pans) incidents ; vide si arête orpheline ou non encore liée. */
  readonly incidentPlanePatchIds: readonly StableEntityId[];
  readonly lengthM: number;
  /** Direction vertexA → vertexB en WORLD ; **unitaire** si `purpose` implique géométrie métrique. */
  readonly directionWorld: Vector3;
  readonly provenance: GeometryProvenance;
}
