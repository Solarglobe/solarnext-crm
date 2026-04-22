/**
 * Z monde le long d’une droite verticale (anchorX, anchorY, z libre) : intersection avec le rayon caméra.
 */

import * as THREE from "three";

/**
 * @returns Z monde (m) ou NaN si le rayon est quasi vertical dans le plan XY (vue de dessus).
 */
export function worldZFromPointerOnVerticalThroughXY(
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  rect: DOMRectReadOnly,
  anchorXM: number,
  anchorYM: number,
): number {
  const ndcX = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  const ndcY = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const o = raycaster.ray.origin;
  const d = raycaster.ray.direction;
  const denom = d.x * d.x + d.y * d.y;
  if (denom < 1e-14) {
    return Number.NaN;
  }
  const s = (d.x * (anchorXM - o.x) + d.y * (anchorYM - o.y)) / denom;
  if (!Number.isFinite(s)) return Number.NaN;
  return o.z + s * d.z;
}
