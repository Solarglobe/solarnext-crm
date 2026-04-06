/**
 * Couche canonique 3D toiture — API publique du module.
 *
 * CONTRAT : aucune dépendance au legacy calpinage, UI, ou runtime CRM.
 * Le builder 2D→3D et le solver brancheront ce module plus tard.
 *
 * Repères : lire `types/coordinates.ts` avant d’utiliser les positions (WORLD vs UV pan).
 * Convergence 3D produit (legacy preview → SolarScene3DViewer) : docs/architecture/3d-convergence-plan.md
 * Contrat pipeline canonical (entrées / sorties / geometry vs shading vs viewer) : docs/architecture/canonical-pipeline.md
 */

// ——— Repères explicites ———
export type { PlaneFrameUv2D, WorldDirection3D, WorldPosition3D } from "./types/coordinates";

// ——— Types primitifs & unités ———
export type { StableEntityId, SurfaceMeasures, Vector3 } from "./types/primitives";
export {
  CANONICAL_ANGLE_UNIT,
  CANONICAL_LENGTH_UNIT,
  CANONICAL_ROOF_MODEL_SCHEMA_VERSION,
  type CanonicalAngleUnit,
  type CanonicalLengthUnit,
} from "./types/units";

// ——— Repères & plan ———
export type { HalfSpaceSide } from "./types/plane";
export type { PlaneEquation } from "./types/plane";
export type { LocalFrame3D, LocalFrameRole } from "./types/frame";

// ——— Provenance & qualité ———
export type { GeometryProvenance } from "./types/provenance";
export type {
  ConfidenceTier,
  GeometryDiagnostic,
  GeometryDiagnosticSeverity,
  QualityBlock,
} from "./types/quality";

// ——— Entités ———
export type { RoofVertex3D, RoofVertexRole } from "./types/vertex";
export type {
  RoofEdge3D,
  RoofEdgePurpose,
  RoofEdgeSemantic,
  RoofEdgeSemanticKind,
  RoofEdgeTopologyKind,
} from "./types/edge";
export type { RoofRidge3D, RoofRidgeStructuralKind } from "./types/ridge";
export type {
  FaceBoundaryCycleWinding,
  Point2DInPlane,
  RoofFaceTopologyRole,
  RoofPlane3D,
  RoofPlanePatch3D,
} from "./types/roof-surface";
export type { RoofObstacle3D, RoofObstacleKind } from "./types/obstacle";
export type { RoofExtension3D, RoofExtensionIntegration, RoofExtensionKind } from "./types/extension";
export type { RoofModel3D, RoofModelMetadata, WorldReferenceFrame } from "./types/model";

// ——— Math & guards ———
export {
  add3,
  cross3,
  distance3,
  dot3,
  isApproxUnitDirection3,
  isFiniteVec3,
  isRightHandedOrthonormalFrame,
  length3,
  nearlyEqual3,
  normalize3,
  scale3,
  signedDistanceToPlane,
  sub3,
  vec3,
} from "./utils/math3";
export { isNonEmptyStableId, isUnitNormalPlane, isUnknownFiniteVec3 } from "./utils/guards";

// ——— Fabriques, validation, sérialisation, debug ———
export { createDefaultQualityBlock, createEmptyRoofModel3D } from "./utils/factories";
export type { RoofModelValidationResult } from "./utils/validation";
export { validateRoofModel3D } from "./utils/validation";
export {
  parseRoofModelJson,
  parseRoofModelJsonResult,
  serializeJsonStableSorted,
  serializeRoofModel3D,
  serializeRoofModel3DStableSorted,
  sortKeysDeep,
  type RoofModelParseError,
} from "./utils/serialization";
export type { RoofModel3DSummary } from "./utils/debug";
export { summarizeRoofModel3D } from "./utils/debug";

// ——— Builder 2D → 3D (non branché runtime) ———
export type {
  LegacyExtensionInput,
  LegacyImagePoint2D,
  LegacyPanInput,
  LegacyRoofGeometryInput,
  LegacyStructuralLine2D,
} from "./builder/legacyInput";
export { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "./builder/worldMapping";

// ——— Contrat monde verrouillé (ENU / Z-up / LOCAL_IMAGE_ENU) ———
export * from "./world/worldConvention";
export * from "./world/unifiedWorldFrame";
export * from "./world/normalizeWorldConfig";
export * from "./world/imageToWorld";
export * from "./world/worldToImage";

// ——— Convention monde 3D (helpers + doc : docs/architecture/3d-world-convention.md) ———
export {
  WORLD_CONVENTION,
  getWorldUnitScale,
  imagePointToWorldHorizontal,
  normalizeWorldVector,
  worldHorizontalToImagePoint,
  worldPointToViewer,
} from "./core/worldConvention";
export type { ImagePointPx, WorldHorizontalM, WorldPoint3DM } from "./core/worldConvention";
export type {
  InterPanContinuityGrade,
  InterPanRelationReport,
  SharedStructuralEdgeConstraint,
  SharedStructuralEdgeRole,
} from "./builder/interPanTypes";
export {
  buildInterPanRelationReports,
  collectStructuralSharedEdgeConstraintsByPan,
  projectNormalOrthogonalToEdgeDirections,
} from "./builder/interPanSharedEdges";
export { buildRoofModel3DFromLegacyGeometry, type BuildRoofModel3DResult } from "./builder/buildRoofModel3DFromLegacyGeometry";

// ——— Volumes 3D obstacles / extensions (non branché runtime) ———
export type { RoofVolumeStructuralRole } from "./types/roof-volume-common";
export type {
  AxisAlignedBounds3D,
  VolumeEdge3D,
  VolumeEdgeKind,
  VolumeFace3D,
  VolumeFaceKind,
  VolumeVertex3D,
} from "./types/volumetric-mesh";
export type {
  ObstacleVolumeExtrusionSpec,
  ObstacleVolumeExtrusionMode,
  RoofObstacleVolume3D,
} from "./types/roof-obstacle-volume";
export type { RoofExtensionVolume3D } from "./types/roof-extension-volume";
export type {
  BuildRoofVolumes3DContext,
  BuildRoofVolumes3DInput,
  LegacyExtensionVolumeInput,
  LegacyObstacleVolumeInput,
  LegacyVolumeFootprintSource,
  VolumeExtrusionPreference,
  VolumeImagePoint2D,
} from "./volumes/volumeInput";
export type {
  VolumeExtrusionChoice,
  VolumeRoofAnchorKind,
  VolumeRoofAttachment,
  VolumeRoofRelationHint,
} from "./types/volume-roof-attachment";
export { buildRoofVolumes3D, type BuildRoofVolumes3DResult } from "./volumes/buildRoofVolumes3D";
export { extrudeVerticalPrismWorld } from "./volumes/extrudeVerticalPrism";
export { extrudePrismAlongUnitDirection } from "./volumes/extrudePrismAlongAxis";
export { resolveFootprintHorizontalWorld } from "./volumes/footprintWorld";
export {
  projectFootprintOntoPlane,
  projectPointOntoPlane,
  resolvePlanePatchByRelatedIds,
} from "./volumes/planeAnchor";
export {
  validateRoofExtensionVolume3D,
  validateRoofObstacleVolume3D,
  type VolumeValidationIssue,
} from "./volumes/validateRoofVolume";

// ——— Panneaux PV surfaces 3D canoniques (non branché runtime placement) ———
export type {
  PvPanelAttachment3D,
  PvPanelAttachmentKind,
  PvPanelBuildResult,
  PvPanelGrid3D,
  PvPanelOrientation2D,
  PvPanelPoseMetadata,
  PvPanelRelationHint,
  PvPanelSamplingParams,
  PvPanelSurface3D,
} from "./types/pv-panel-3d";
export type {
  PvPanelEdgeClearanceClass,
  PvPanelGeometricAnchorQuality,
  PvPanelPatchBoundaryContext3D,
  PvPanelSpatialContext3D,
  PvPanelSpatialContextQuality,
  PvPanelStructuralProximity3D,
  PvPanelStructuralSemantic,
  PvPanelVolumeOverlapLikelihood,
  PvPanelVolumeProximityContext3D,
} from "./types/pv-panel-context-3d";
export type {
  BuildPvPanels3DContext,
  BuildPvPanels3DInput,
  PvPanelCenterInput,
  PvPanelPlacementInput,
  StructuralLineSegment3D,
} from "./pvPanels/pvPanelInput";
export { buildPvPanels3D } from "./pvPanels/buildPvPanels3D";
export { computePvPanelSpatialContext, type PanelContextBuildOptions } from "./pvPanels/panelContextComputer";
export {
  moduleDimsAlongPatchUv,
  orthonormalPatchBasis,
  panelRectangleFromCenter,
  panelSurfaceAreaM2,
} from "./pvPanels/panelOnPlaneGeometry";

// ——— Near shading 3D canonique (raycast triangles, non branché prod) ———
export type {
  NearShadingAnnualAggregate,
  NearShadingBuildResult,
  NearShadingPanelResult,
  NearShadingRayInput,
  NearShadingOccluderKind,
  NearShadingRaycastParams,
  NearShadingSampleResult,
  NearShadingSceneContext,
  NearShadingSeriesResult,
  NearShadingSolarDirectionInput,
  NearShadingTimeStepResult,
} from "./types/near-shading-3d";
export { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "./nearShading3d/nearShadingParams";
export { runNearShadingSeries, runNearShadingTimeStep } from "./nearShading3d/nearShadingEngine";
export { rayTriangleIntersectMollerTrumbore } from "./nearShading3d/rayTriangle";
export { rayAabbIntersects } from "./nearShading3d/rayAabb";
export { findClosestOccluderHit } from "./nearShading3d/volumeRaycast";

// ——— Scène 3D unifiée (calcul + futur rendu + export) ———
export type {
  PanelVisualShading,
  PanelVisualShadingProvenance,
  PanelVisualShadingState,
} from "./types/panelVisualShading";
export type {
  SolarScene3D,
  SolarScene3DMetadata,
  SolarSceneGenerator,
  SolarScenePanelShadingSummary,
  SolarSceneShadingSnapshot3D,
  SolarSceneSolarContext3D,
} from "./types/solarScene3d";
export { SOLAR_SCENE_3D_SCHEMA_VERSION, SOLAR_SCENE_RENDER_CONVENTIONS } from "./types/solarScene3d";
export { buildSolarScene3D, exportCanonicalScene3D, type BuildSolarScene3DInput } from "./scene/buildSolarScene3D";
export {
  deriveUnifiedRoofSceneReadModel,
  type UnifiedRoofSceneReadModel,
} from "./scene/unifiedRoofSceneContract";
export {
  parseSolarScene3DJson,
  serializeSolarScene3D,
  serializeSolarScene3DStableSorted,
} from "./scene/exportSolarScene3d";

// ——— Adaptateur runtime → pans 3D géométriques (Prompt 3 — pas de rendu) ———
export {
  buildCanonicalPans3DFromRuntime,
  computeStablePan3DId,
  extractHeightStateContextFromCalpinageState,
  type BuildCanonicalPans3DFromRuntimeInput,
  type BuildCanonicalPans3DFromRuntimeOptions,
  type CanonicalPan3D,
  type CanonicalPan3DDiagnostics,
  type CanonicalPanVertex3D,
  type CanonicalPans3DResult,
} from "./adapters/buildCanonicalPans3DFromRuntime";

// ——— Adaptateur runtime → obstacles / extensions / volumes 3D (Prompt 4 — pas de rendu) ———
export {
  buildCanonicalObstacles3DFromRuntime,
  computeStableObstacle3DId,
  type BuildCanonicalObstacles3DFromRuntimeInput,
  type BuildCanonicalObstacles3DFromRuntimeOptions,
  type CanonicalObstacle3D,
  type CanonicalObstacle3DDiagnostics,
  type CanonicalObstacle3DResult,
  type CanonicalObstacleKind,
  type CanonicalObstacleSemanticRole,
  type CanonicalObstacleVertex3D,
} from "./adapters/buildCanonicalObstacles3DFromRuntime";

// ——— Adaptateur panneaux posés → PvPanelPlacementInput (Prompt 5 — pas de rendu) ———
export {
  buildCanonicalPlacedPanelsFromRuntime,
  inferModuleDimsFromProjectionQuadPx,
  mapPvEnginePanelsToPanelInputs,
  type BuildCanonicalPlacedPanelsFromRuntimeInput,
  type BuildCanonicalPlacedPanelsFromRuntimeOptions,
  type CanonicalPlacedPanelRow,
  type CanonicalPlacedPanelsResult,
} from "./adapters/buildCanonicalPlacedPanelsFromRuntime";

// ——— Adaptateur global scène 3D (Prompt 6 — pas de rendu) ———
export {
  buildCanonicalScene3DInput,
  computeCanonicalScene3DId,
  type BuildCanonicalScene3DInput,
  type BuildCanonicalScene3DInputOptions,
  type CanonicalPlacedPanel3D,
  type CanonicalScene3DDiagnostics,
  type CanonicalScene3DInput,
  type CanonicalScene3DWorld,
} from "./adapters/buildCanonicalScene3DInput";

// ——— Validation / hardening scène 3D (Prompt 7 — pas de rendu) ———
export {
  CANONICAL_SCENE_VALIDATION_CODES,
  validateCanonicalScene3DInput,
  type CanonicalSceneValidationCode,
  type CanonicalSceneValidationIssue,
  type CanonicalSceneValidationResult,
  type CanonicalSceneValidationStats,
  type ValidateCanonicalScene3DInputOptions,
} from "./validation/validateCanonicalScene3DInput";

// ——— Cohérence 2D → 3D sur scène finale (Prompt 10) ———
export {
  COHERENCE_MAX_PANEL_OFF_PLANE_M,
  COHERENCE_MIN_NORMAL_LENGTH,
  COHERENCE_MIN_PANEL_DIM_M,
  COHERENCE_MIN_PATCH_AREA_M2,
  COHERENCE_MIN_VOLUME_HEIGHT_M,
} from "./validation/coherenceConstants";
export {
  FIDELITY_PANEL_LAYOUT_AREA_RATIO_WARN_ABOVE,
  FIDELITY_PATCH_JACCARD_ERROR_BELOW,
  FIDELITY_PATCH_JACCARD_WARN_BELOW,
  FIDELITY_ROOF_AREA_RATIO_MAX,
  FIDELITY_ROOF_AREA_RATIO_MIN,
  FIDELITY_SOURCE_COVERAGE_WARN_BELOW,
} from "./validation/fidelityConstants";
export { validate2DTo3DCoherence } from "./validation/validate2DTo3DCoherence";
export { appendUnifiedBusinessSceneIssues } from "./validation/validateUnifiedBusinessScene";
export { appendUnifiedWorldAlignmentIssues, dotImageAxesWorld } from "./validation/validateUnifiedWorldAlignment";
export { buildScene2DSourceTraceFromCalpinage } from "./sourceTrace/buildScene2DSourceTrace";
export type {
  CoherenceConfidence,
  CoherenceIssue,
  CoherenceScope,
  CoherenceSeverity,
  CoherenceSummary,
  Scene2DSourceTrace,
  SceneQualityGrade,
  Validate2DTo3DCoherenceResult,
  Validate2DTo3DCoherenceStats,
} from "./types/scene2d3dCoherence";
export {
  GRADE_A_MAX_WARNINGS,
  GRADE_B_MAX_WARNINGS,
  GRADE_C_MAX_WARNINGS,
} from "./validation/coherenceGradeConstants";
export { buildCoherenceSummary, computeSceneQualityGrade } from "./validation/coherenceDerive";

// ——— Runtime calpinage → SolarScene3D (Prompt 8 — assemblage + validation) ———
export * from "./buildSolarScene3DFromCalpinageRuntime";

// ——— Feature flag 3D canonical (Prompt 17 — interrupteur produit) ———
export {
  VITE_CALPINAGE_CANONICAL_3D_ENV_KEY,
  type Canonical3DActivationMode,
  type Canonical3DFlagResolution,
  type Canonical3DFlagSource,
  getCanonical3DFlagResolution,
  isCanonical3DDevSandboxRouteAllowed,
  isCanonical3DEnabled,
  isCanonical3DProductMountAllowed,
  logCanonical3DFlagResolutionOnce,
  resolveCanonical3DPreviewEnabled,
} from "./featureFlags";
export {
  tryBuildSolarScene3DForProduct,
  type BuildSolarScene3DForProductResult,
} from "./product/tryBuildSolarScene3DForProduct";

// ——— Viewer 3D métier (React + Three.js — lecture SolarScene3D) ———
// Note : le viewer séparé est supprimé. SolarScene3DViewer sera réutilisé
// pour le rendu 3D inline dans #zone-c (même surface que le plan 2D).
export { SolarScene3DViewer, type SolarScene3DViewerProps } from "./viewer/SolarScene3DViewer";
export {
  CAMERA_VIEW_MODES,
  DEFAULT_CAMERA_VIEW_MODE,
  isCameraViewMode,
  type CameraViewMode,
} from "./viewer/cameraViewMode";
export { diagnoseViewModeSwitch, type ViewModeDiagnostic } from "./viewer/viewModeGuards";
export { computePlanOrthographicFraming, type PlanOrthographicFraming } from "./viewer/viewerFraming";
export type {
  SceneInspectableKind,
  SceneInspectionSelection,
  SceneInspectUserData,
} from "./viewer/inspection/sceneInspectionTypes";
export { buildDemoSolarScene3D } from "./viewer/demoSolarScene3d";
