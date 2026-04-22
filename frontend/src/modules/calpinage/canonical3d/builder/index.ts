/**
 * Builder 2D → 3D — isolé du runtime calpinage.
 */

export type {
  LegacyExtensionInput,
  LegacyImagePoint2D,
  LegacyPanInput,
  LegacyRoofGeometryInput,
  LegacyStructuralLine2D,
} from "./legacyInput";
export {
  imagePxToWorldHorizontalM,
  polygonHorizontalAreaM2FromImagePx,
  segmentHorizontalLengthMFromImagePx,
  worldHorizontalMToImagePx,
} from "./worldMapping";
export {
  resolveOfficialShellFootprintRingWorld,
  type OfficialShellFootprintRingWorld,
} from "./officialShellFootprintRing";
export type {
  InterPanContinuityGrade,
  InterPanRelationReport,
  SharedStructuralEdgeConstraint,
  SharedStructuralEdgeRole,
} from "./interPanTypes";
export {
  buildInterPanRelationReports,
  collectStructuralSharedEdgeConstraintsByPan,
  projectNormalOrthogonalToEdgeDirections,
} from "./interPanSharedEdges";
export {
  buildRoofModel3DFromLegacyGeometry,
  type BuildRoofModel3DFromLegacyGeometryOptions,
  type BuildRoofModel3DResult,
  type RoofGeometryFidelityMode,
} from "./buildRoofModel3DFromLegacyGeometry";
export {
  computeRoofReconstructionQualityDiagnostics,
  countWorldXYCornerZClusterViolations,
  emptyRoofReconstructionQualityDiagnostics,
  type RoofPatchTruthClass,
  type RoofReconstructionQualityDiagnostics,
  type RoofReconstructionQualityLevel,
} from "./roofReconstructionQuality";
