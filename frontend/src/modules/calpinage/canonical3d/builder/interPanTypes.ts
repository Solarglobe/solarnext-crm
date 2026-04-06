/**
 * Types pour contraintes et rapports inter-pans (reconstruction roof-aware).
 * Pas de logique ici — uniquement des structures explicites pour audit et tests.
 *
 * Évolutions prévues (non implémentées) : rattacher des sous-toitures / lucarnes via
 * `topologyRole` des faces et des relations `SharedStructuralEdgeConstraint` enrichies
 * (second membre = volume dérivé, pas seulement un voisin pan).
 */

import type { GeometryDiagnostic } from "../types/quality";
import type { Vector3 } from "../types/primitives";

/** Rôle structurant de l’arête commune entre deux pans (côté solver). */
export type SharedStructuralEdgeRole =
  /** Faîtage / arêtier fort (sémantique ridge sur l’arête). */
  | "ridge_line"
  /** Cassure / ligne interne (trait). */
  | "break_line"
  /** Arête commune sans ligne structurante reconnue — seulement topologie. */
  | "topology_only";

/**
 * Qualité de continuité géométrique attendue / observée entre deux pans le long d’une arête.
 * `ambiguous` = données insuffisantes ou cas non classifiable proprement.
 */
export type InterPanContinuityGrade = "strong" | "medium" | "weak" | "ambiguous";

/**
 * Rapport auditable pour une paire de pans reliés par une arête commune.
 */
export interface InterPanRelationReport {
  readonly edgeId: string;
  readonly planePatchIdA: string;
  readonly planePatchIdB: string;
  readonly structuralRole: SharedStructuralEdgeRole;
  /** Angle entre normales extérieures (deg). */
  readonly angleBetweenNormalsDeg: number;
  /** Angle « d’ouverture » entre les deux pans dans une coupe perpendiculaire à l’arête : |180° − angle entre normales|. */
  readonly dihedralProfileDeg: number;
  readonly continuityGrade: InterPanContinuityGrade;
  /** Écart |Za−Zb| sur la ligne structurante 2D si disponible (m), sinon absent. */
  readonly structuralHeightDeltaM?: number;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

/**
 * Contrainte locale : arête partagée + directions d’arête unitaires à respecter (⊥ normale plan).
 */
export interface SharedStructuralEdgeConstraint {
  readonly edgeId: string;
  readonly otherPlanePatchId: string;
  /** Direction monde unitaire le long de l’arête (sommet A → B, cohérente avec l’arête). */
  readonly unitEdgeDirectionWorld: Vector3;
  readonly role: SharedStructuralEdgeRole;
}
