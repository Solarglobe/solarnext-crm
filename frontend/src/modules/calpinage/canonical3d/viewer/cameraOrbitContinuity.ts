/**
 * Continuité orbitale PLAN_2D ↔ SCENE_3D — même convention que three-stdlib OrbitControls
 * (offset tourné en « Y-up » interne avant Spherical).
 */

import * as THREE from "three";

const Y_UP = new THREE.Vector3(0, 1, 0);
/** Identique à OrbitControls : aligne l’axe « up » caméra sur Y+ pour Spherical. */
export function quatCameraUpToYUp(cameraUp: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(cameraUp, Y_UP);
}

export function readOrbitSpherical(
  cameraPosition: THREE.Vector3,
  orbitTarget: THREE.Vector3,
  cameraUp: THREE.Vector3,
): THREE.Spherical {
  const quat = quatCameraUpToYUp(cameraUp);
  const offset = new THREE.Vector3().copy(cameraPosition).sub(orbitTarget).applyQuaternion(quat);
  return new THREE.Spherical().setFromVector3(offset);
}

export function positionFromOrbitSpherical(
  orbitTarget: THREE.Vector3,
  spherical: THREE.Spherical,
  cameraUp: THREE.Vector3,
  out?: THREE.Vector3,
): THREE.Vector3 {
  const quat = quatCameraUpToYUp(cameraUp);
  const quatInv = quat.clone().invert();
  const offset = new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(spherical.radius, spherical.phi, spherical.theta),
  );
  offset.applyQuaternion(quatInv);
  const res = out ?? new THREE.Vector3();
  return res.copy(orbitTarget).add(offset);
}

export function smoothstep01(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Direction « Est » monde (plan XY), unitaire, pour cohérence lecture carte (northAngleDeg). */
export function worldEastUnitFromNorthDeg(northAngleDeg: number, out?: THREE.Vector3): THREE.Vector3 {
  const rad = THREE.MathUtils.degToRad(Number.isFinite(northAngleDeg) ? northAngleDeg : 0);
  const v = out ?? new THREE.Vector3();
  v.set(Math.cos(rad), Math.sin(rad), 0);
  return v.normalize();
}

/**
 * Axe X droit de la caméra en monde (sans translation) — `transformDirection` sur la rotation monde.
 */
export function cameraWorldRight(camera: THREE.PerspectiveCamera, out?: THREE.Vector3): THREE.Vector3 {
  const v = out ?? new THREE.Vector3(1, 0, 0);
  return v.set(1, 0, 0).transformDirection(camera.matrixWorld);
}

export type CameraAuditPayload = {
  readonly tag: string;
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly azimuthRad: number;
  readonly polarRad: number;
  readonly distance: number;
  readonly worldDirection: [number, number, number];
  readonly cameraRight: [number, number, number];
  readonly eastDotRight: number;
};

export function buildCameraAuditPayload(
  tag: string,
  camera: THREE.PerspectiveCamera,
  controls: {
    readonly target: THREE.Vector3;
    getAzimuthalAngle(): number;
    getPolarAngle(): number;
    getDistance(): number;
  },
  worldEastUnit: THREE.Vector3,
): CameraAuditPayload {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const right = cameraWorldRight(camera);
  return {
    tag,
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
    azimuthRad: controls.getAzimuthalAngle(),
    polarRad: controls.getPolarAngle(),
    distance: controls.getDistance(),
    worldDirection: [dir.x, dir.y, dir.z],
    cameraRight: [right.x, right.y, right.z],
    eastDotRight: right.dot(worldEastUnit),
  };
}
