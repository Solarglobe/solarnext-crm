/**
 * Modes de caméra du viewer canonique (Prompt 34) — **même `SolarScene3D`**, autre regard.
 * Ne change ni builder ni identité des objets ; uniquement projection / contrôles / aides visuelles.
 */

export const CAMERA_VIEW_MODES = ["PLAN_2D", "SCENE_3D"] as const;

export type CameraViewMode = (typeof CAMERA_VIEW_MODES)[number];

export const DEFAULT_CAMERA_VIEW_MODE: CameraViewMode = "SCENE_3D";

export function isCameraViewMode(v: string): v is CameraViewMode {
  return (CAMERA_VIEW_MODES as readonly string[]).includes(v);
}
