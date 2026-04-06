/**
 * Pan / face de toiture comme patch planaire 3D explicite (solver-ready).
 *
 * CONTRAT CYCLE :
 * - `boundaryVertexIds` : cycle fermé ordonné ; sens documenté par `boundaryCycleWinding`
 *   (vu depuis l’**extérieur** du volume sous toiture, côté « ciel »).
 * - `boundaryEdgeIds` : arêtes du maillage parcourant le bord dans le **même ordre** que les sommets.
 * - `cornersWorld` : copie des positions WORLD alignée sur `boundaryVertexIds` (même longueur).
 *
 * REDONDANCE CONTRÔLÉE : `normal`, `equation`, `localFrame.zAxis` doivent être cohérents (validation).
 *
 * Repères : voir `types/coordinates.ts` (WORLD vs UV pan).
 */

import type { PlaneFrameUv2D, WorldPosition3D } from "./coordinates";
import type { LocalFrame3D } from "./frame";
import type { PlaneEquation } from "./plane";
import type { GeometryProvenance } from "./provenance";
import type { QualityBlock } from "./quality";
import type { StableEntityId, SurfaceMeasures, Vector3 } from "./primitives";

/** Point 2D dans le repère tangent du pan (axes u,v du patch), en mètres — pas des coordonnées WORLD. */
export type Point2DInPlane = PlaneFrameUv2D;

/**
 * Rôle topologique / métier de la face (évite de mélanger coque principale et extension).
 */
export type RoofFaceTopologyRole =
  | "primary_shell"
  | "derived_split"
  | "extension_volume"
  | "internal_partition"
  | "unknown";

/**
 * Sens du cycle `boundaryVertexIds` **vu depuis l’extérieur** (normale sortante / « ciel »).
 * `unspecified` : autorisé tant que le builder n’a pas fixé la convention.
 */
export type FaceBoundaryCycleWinding = "counter_clockwise" | "clockwise" | "unspecified";

/**
 * Alias de nommage produit / spec (« roofPlanes3D ») — identique à RoofPlanePatch3D.
 * Une face de toiture est un patch planaire explicite en WORLD, pas une simple 2D+h.
 */
export type RoofPlane3D = RoofPlanePatch3D;

export interface RoofPlanePatch3D {
  readonly id: StableEntityId;
  /** Rôle de la face dans le modèle global (coque, extension, dérivé…). */
  readonly topologyRole: RoofFaceTopologyRole;
  /** Cycle de sommets le long du bord (IDs WORLD) — longueur ≥ 3 pour une face valide. */
  readonly boundaryVertexIds: readonly StableEntityId[];
  /** Arêtes du bord, même ordre cyclique que les sommets. */
  readonly boundaryEdgeIds: readonly StableEntityId[];
  /** Positions WORLD des coins, alignées sur `boundaryVertexIds`. */
  readonly cornersWorld: readonly WorldPosition3D[];
  readonly localFrame: LocalFrame3D;
  /** Normale unitaire **extérieure** (vers le « ciel »), WORLD. */
  readonly normal: Vector3;
  /** Plan en WORLD : `normal·p + d = 0` pour tout point `p` du pan. */
  readonly equation: PlaneEquation;
  /** Polygone bord en coordonnées (u,v) du repère tangent ; si présent, même cardinal que le bord. */
  readonly polygon2DInPlane?: readonly Point2DInPlane[];
  /** Sens du cycle bord, vu depuis l’extérieur. */
  readonly boundaryCycleWinding: FaceBoundaryCycleWinding;
  /** Azimut métier (0=Nord, 90=Est), degrés ; repère horizontal WORLD, pas UV pan. */
  readonly azimuthDeg?: number;
  /** Pente du plan vs horizontal WORLD, degrés. */
  readonly tiltDeg?: number;
  /** Centroïde du patch en WORLD (souvent dans le plan du pan). */
  readonly centroid: WorldPosition3D;
  readonly surface: SurfaceMeasures;
  /** IDs des faces adjacentes (arête commune). Symétrie recommandée (validation warning si asymétrique). */
  readonly adjacentPlanePatchIds: readonly StableEntityId[];
  readonly provenance: GeometryProvenance;
  readonly quality: QualityBlock;
}
