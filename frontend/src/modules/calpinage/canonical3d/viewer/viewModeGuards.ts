/**
 * Garde-fous toggle vue (Prompt 34) — détection de divergences de scène lors d’un simple changement de mode.
 */

import type { SolarScene3D } from "../types/solarScene3d";
import type { CameraViewMode } from "./cameraViewMode";
import { isCameraViewMode } from "./cameraViewMode";

export type ViewModeDiagnosticCode = "VIEW_MODE_SCENE_MISMATCH" | "VIEW_MODE_CAMERA_INVALID";

export type ViewModeDiagnostic = {
  readonly code: ViewModeDiagnosticCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

/**
 * À appeler après un switch de mode : si seul le mode devait changer, la référence `scene` doit être identique.
 */
export function diagnoseViewModeSwitch(params: {
  readonly sceneBefore: SolarScene3D | null;
  readonly sceneAfter: SolarScene3D | null;
  readonly modeBefore: CameraViewMode;
  readonly modeAfter: CameraViewMode;
  /** true si l’app garantit qu’aucun autre prop (hors mode) n’a changé. */
  readonly onlyViewModeChanged: boolean;
}): readonly ViewModeDiagnostic[] {
  const out: ViewModeDiagnostic[] = [];
  if (!isCameraViewMode(params.modeAfter) || !isCameraViewMode(params.modeBefore)) {
    out.push({
      code: "VIEW_MODE_CAMERA_INVALID",
      message: "Mode de vue inconnu (attendu PLAN_2D | SCENE_3D).",
      details: { modeBefore: params.modeBefore, modeAfter: params.modeAfter },
    });
  }
  if (
    params.onlyViewModeChanged &&
    params.sceneBefore != null &&
    params.sceneAfter != null &&
    params.sceneBefore !== params.sceneAfter
  ) {
    out.push({
      code: "VIEW_MODE_SCENE_MISMATCH",
      message:
        "Référence SolarScene3D différente alors que seul le mode de vue devait changer — risque de double vérité géométrique.",
      details: {
        sceneIdentityChanged: true,
      },
    });
  }
  return out;
}
