/**
 * engine/index.ts — Point d'entrée public du module engine (P2 extraction TS).
 *
 * Agrège les exports de tous les sous-modules :
 *   interfaces/    — contrats (types-only, zéro runtime)
 *   adapter/       — adaptateurs runtime → types moteur
 *   geometry/      — utilitaires géométriques purs
 *   roofGeometryEngine/ — moteur géométrie toiture (faceSolver, normalCalc, …)
 *   runtime/       — bridges window.* legacy (HeightResolver runtime, callbacks)
 *   validation/    — pipeline de validation panneaux
 *   PlacementEngineAdapter — façade typée pour window.pvPlacementEngine
 *
 * Règle d'import :
 *   - Préférer l'import depuis "engine/interfaces" pour les types-only.
 *   - Importer depuis "engine" uniquement si une valeur runtime est nécessaire
 *     (factory, classe, constante).
 *   - Ne JAMAIS importer "engine/index" depuis les fichiers sous engine/ eux-mêmes
 *     (risque de cycle).
 *
 * @module engine
 */

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces de découplage (types + quelques factories/constantes)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  // HeightResolver
  HeightResolution,
  HeightResolver,
  // WorldTransform
  WorldTransform,
  // PanContext
  PanRoofType,
  PanPolygonVertex,
  RoofFace,
  Vec3,
  WorldCorner3D,
  RoofFaceDerived3D,
  PanContext,
  // PlacementRules
  FlatRoofSupportTiltDeg,
  FlatRoofConfig,
  PlacementRules,
  // EngineCallbacks
  StructuralChangeDomain,
  EngineCallbacks,
  // Dp2Boundary
  Dp2GlobalName,
  // ActivePlacementBlockLike
  PanelProjection,
  PanelGridPosition,
  PanelLikeWithProjection,
  BlockLikeWithPanels,
  APBCreateBlockOpts,
  APBCreateBlockResult,
  APBResult,
  ActivePlacementBlockLike,
  // PlacementEngineAdapter
  PlacedPanel,
  PlacementPanelData,
  PlacementBlock,
  ManipulationTransform,
  GhostSlot,
  AutofillPreviewItem,
  AutofillGridPreviewResult,
  AutofillOpts,
  AddPanelResult,
  AddPanelsBatchResult,
  CreateBlockOpts,
  PlacementEngineAdapter,
} from "./interfaces";

export {
  createNoOpEngineCallbacks,
  DP2_BOUNDARY_GLOBALS,
  DP2_CONSUMED_CALPINAGE_FUNCTIONS,
  DP2_AUDIT_CHECKLIST,
  getActivePlacementBlock,
} from "./interfaces";

// ─────────────────────────────────────────────────────────────────────────────
// Moteur de géométrie toiture
// ─────────────────────────────────────────────────────────────────────────────

export {
  solveFace,
  computeRoofFaceNormal,
  computeTiltAzimuth,
  RuntimeHeightResolver,
  FallbackHeightResolver,
  buildConstraintHeightResolver,
  ConstraintHeightResolver,
} from "./roofGeometryEngine";

export type {
  TiltAzimuthResult,
  StructuralConstraintLine,
} from "./roofGeometryEngine";

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers purs
// ─────────────────────────────────────────────────────────────────────────────

export {
  pointInPolygon,
  polygonIntersectsPolygon,
  polygonBBox2D,
  bboxOverlap2D,
  distancePointToSegment,
  minDistancePointToPolygonEdges,
  minDistancePolygonToSegments,
  minDistanceBetweenPolygons,
  segmentIntersect,
} from "./geometry/polygonUtils";

export type {
  Point2D,
  BBox2D,
  Segment2D,
} from "./geometry/polygonUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Adapter runtime → types moteur
// ─────────────────────────────────────────────────────────────────────────────

export {
  buildPanContextFromRuntime,
  buildActivePanContextFromRuntime,
} from "./adapter/buildPanContextFromRuntime";

export {
  buildProjectionContext,
  buildProjectionContextFromPanContext,
  normalizePanelOrientation,
} from "./adapter/buildProjectionContext";

export type {
  Axis2D,
  RoofParams,
  PanelParams,
  PvRulesInput,
  BuildProjectionContextOpts,
  ProjectionContext,
  ExistingPanelProjection,
} from "./adapter/buildProjectionContext";

// ─────────────────────────────────────────────────────────────────────────────
// Runtime bridge — HeightResolver legacy
// ─────────────────────────────────────────────────────────────────────────────

export { createRuntimeHeightResolver } from "./runtime/RuntimeHeightResolver";

export {
  createLegacyEngineCallbacks,
} from "./runtime/LegacyEngineCallbacks";

// ─────────────────────────────────────────────────────────────────────────────
// Validation pipeline
// ─────────────────────────────────────────────────────────────────────────────

export {
  validatePanelPolygon,
  validatePanelPolygonIndexed,
  validatePanelPolygonSteps0And1,
  validatePanelPolygonStep3Ridge,
  validateAutofillCandidateDetailed,
  buildValidationCaches,
} from "./validation/panelValidator";

export type {
  RoofConstraints,
  AutofillValidationResult,
  PanelLike,
  BlockLike,
  ValidationCaches,
} from "./validation/panelValidator";
