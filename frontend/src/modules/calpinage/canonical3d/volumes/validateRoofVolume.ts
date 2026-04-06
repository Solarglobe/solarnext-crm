/**
 * Validation légère d’un volume prismatique produit par le builder (tests / debug).
 */

import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";

export interface VolumeValidationIssue {
  readonly code: string;
  readonly message: string;
}

function validateVolumeBounds(
  v: { readonly vertices: readonly { position: { x: number; y: number; z: number } }[]; readonly bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } }
): VolumeValidationIssue[] {
  const issues: VolumeValidationIssue[] = [];
  const { min, max } = v.bounds;
  for (const p of v.vertices) {
    const q = p.position;
    if (q.x < min.x - 1e-6 || q.x > max.x + 1e-6 || q.y < min.y - 1e-6 || q.y > max.y + 1e-6 || q.z < min.z - 1e-6 || q.z > max.z + 1e-6) {
      issues.push({ code: "BOUNDS_VERTEX_OUTSIDE", message: "Sommet hors AABB déclarée" });
      break;
    }
  }
  return issues;
}

export function validateRoofObstacleVolume3D(v: RoofObstacleVolume3D): VolumeValidationIssue[] {
  const issues: VolumeValidationIssue[] = [];
  if (v.vertices.length < 6) issues.push({ code: "VERTEX_COUNT", message: "Prisme attend au moins 6 sommets (n≥3)" });
  if (v.volumeM3 <= 0) issues.push({ code: "VOLUME_NON_POSITIVE", message: "volumeM3 doit être > 0" });
  issues.push(...validateVolumeBounds(v));
  return issues;
}

export function validateRoofExtensionVolume3D(v: RoofExtensionVolume3D): VolumeValidationIssue[] {
  const issues: VolumeValidationIssue[] = [];
  if (v.vertices.length < 6) issues.push({ code: "VERTEX_COUNT", message: "Prisme attend au moins 6 sommets (n≥3)" });
  if (v.volumeM3 <= 0) issues.push({ code: "VOLUME_NON_POSITIVE", message: "volumeM3 doit être > 0" });
  issues.push(...validateVolumeBounds(v));
  return issues;
}
