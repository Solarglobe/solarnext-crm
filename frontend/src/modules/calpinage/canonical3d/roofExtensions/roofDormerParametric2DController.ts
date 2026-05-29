import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import {
  createRoofDormerParametricModelFromDraft,
  type RoofDormerParametric2DDraft,
  type RoofDormerParametricModel,
} from "./roofDormerParametricModel";
import {
  roofDormerParametricHasBlockingErrors,
  validateRoofDormerParametricModel,
} from "./roofDormerParametricValidation";

export interface NormalizeRoofDormerParametricDraftResult {
  readonly model: RoofDormerParametricModel | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

/**
 * Controlled 2D entry point for the parallel system.
 * The UI may still be rich, but it must produce this draft instead of mutating
 * free legacy fields such as point.h, dormerModel or canonicalDormerGeometry.
 */
export function normalizeRoofDormerParametric2DDraft(
  draft: RoofDormerParametric2DDraft,
  supportPatch?: RoofPlanePatch3D | null,
): NormalizeRoofDormerParametricDraftResult {
  let model: RoofDormerParametricModel;
  try {
    model = createRoofDormerParametricModelFromDraft(draft);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      model: null,
      diagnostics: [{ code: "DRAFT_CREATE_EXCEPTION", severity: "error", message, context: { entityId: draft.id } }],
    };
  }
  const diagnostics = validateRoofDormerParametricModel(model, supportPatch);
  if (roofDormerParametricHasBlockingErrors(diagnostics)) {
    return { model: null, diagnostics };
  }
  return { model, diagnostics };
}
