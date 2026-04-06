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
export { imagePxToWorldHorizontalM } from "./worldMapping";
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
export { buildRoofModel3DFromLegacyGeometry, type BuildRoofModel3DResult } from "./buildRoofModel3DFromLegacyGeometry";
