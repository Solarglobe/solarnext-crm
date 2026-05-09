/**
 * Phase A — Exports publics des interfaces de découplage.
 *
 * Point d'entrée unique pour les consommateurs (moteurs Phase 2 et 3,
 * adapters Phase 1, tests).
 *
 * Import recommandé :
 *   import type { HeightResolver, PlacementRules, PanContext, EngineCallbacks } from
 *     "../engine/interfaces";
 */

export type {
  HeightResolution,
  HeightResolver,
} from "./HeightResolver";

export type {
  WorldTransform,
} from "./WorldTransform";

export type {
  PanRoofType,
  PanPolygonVertex,
  RoofFace,
  Vec3,
  WorldCorner3D,
  RoofFaceDerived3D,
  PanContext,
} from "./PanContext";

export type {
  FlatRoofSupportTiltDeg,
  FlatRoofConfig,
  PlacementRules,
} from "./PlacementRules";

export type {
  StructuralChangeDomain,
  EngineCallbacks,
} from "./EngineCallbacks";

export { createNoOpEngineCallbacks } from "./EngineCallbacks";

export {
  DP2_BOUNDARY_GLOBALS,
  DP2_CONSUMED_CALPINAGE_FUNCTIONS,
  DP2_AUDIT_CHECKLIST,
} from "./Dp2Boundary";

export type { Dp2GlobalName } from "./Dp2Boundary";
