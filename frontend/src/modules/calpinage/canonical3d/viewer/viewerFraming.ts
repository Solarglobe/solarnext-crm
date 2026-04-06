/**
 * Cadrage caméra perspective à partir d’un Box3 — logique pure, testable, sans React.
 */

import * as THREE from "three";
import {
  VIEWER_CAMERA_FOV_DEG,
  VIEWER_DEFAULT_CAMERA_OFFSET,
  VIEWER_FAR_DISTANCE_FACTOR,
  VIEWER_FAR_RADIUS_FACTOR,
  VIEWER_FRAMING_MARGIN,
  VIEWER_MAX_DISTANCE_RADIUS_RATIO,
  VIEWER_MIN_DISTANCE_RADIUS_RATIO,
  VIEWER_NEAR_DISTANCE_RATIO,
  VIEWER_NEAR_MIN_M,
} from "./viewerConstants";

export type ViewerFraming = {
  readonly target: THREE.Vector3;
  readonly position: THREE.Vector3;
  readonly near: number;
  readonly far: number;
  readonly minDistance: number;
  readonly maxDistance: number;
};

/** Paramètres caméra / frustum pour le mode plan (orthographique ou FOV zénithal dérivé). */
export type PlanOrthographicFraming = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly minDistance: number;
  readonly maxDistance: number;
};

const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _dir = new THREE.Vector3();

/**
 * @param aspect largeur / hauteur du viewport (> 0)
 */
export function computeViewerFraming(box: THREE.Box3, aspect: number): ViewerFraming {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  box.getCenter(_center);
  box.getSize(_size);
  box.getBoundingSphere(_sphere);
  const radius = Math.max(_sphere.radius, 1e-4);

  const vFovRad = THREE.MathUtils.degToRad(VIEWER_CAMERA_FOV_DEG);
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * a);

  const distVert = radius / Math.sin(vFovRad / 2);
  const halfHoriz = Math.hypot(_size.x, _size.y) / 2;
  const distHoriz = halfHoriz > 1e-6 ? halfHoriz / Math.tan(hFovRad / 2) : distVert;
  const distance = VIEWER_FRAMING_MARGIN * Math.max(distVert, distHoriz, radius * 1.05);

  _dir.set(VIEWER_DEFAULT_CAMERA_OFFSET.x, VIEWER_DEFAULT_CAMERA_OFFSET.y, VIEWER_DEFAULT_CAMERA_OFFSET.z).normalize();
  const position = _center.clone().add(_dir.multiplyScalar(distance));

  const near = Math.max(VIEWER_NEAR_MIN_M, distance * VIEWER_NEAR_DISTANCE_RATIO);
  const far = Math.max(near * 8, distance * VIEWER_FAR_DISTANCE_FACTOR + radius * VIEWER_FAR_RADIUS_FACTOR);

  const minDistance = Math.max(VIEWER_NEAR_MIN_M * 2, radius * VIEWER_MIN_DISTANCE_RADIUS_RATIO);
  const maxDistance = Math.max(minDistance * 1.5, radius * VIEWER_MAX_DISTANCE_RADIUS_RATIO);

  return {
    target: _center.clone(),
    position,
    near,
    far,
    minDistance,
    maxDistance,
  };
}

/**
 * Vue plan (Z-up) : frustum orthographique centré sur le centre de la bbox, emprise XY = AABB × marge,
 * avec ratio (right−left)/(top−bottom) = aspect du viewport.
 * Légère translation XY sur la position pour éviter la dégénérescence lookAt lorsque up=(0,0,1) et la vue suit ~−Z.
 */
export function computePlanOrthographicFraming(
  box: THREE.Box3,
  aspect: number,
): PlanOrthographicFraming {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  box.getCenter(_center);
  box.getSize(_size);
  box.getBoundingSphere(_sphere);
  const radius = Math.max(_sphere.radius, 1e-4);

  let halfW = (_size.x / 2) * VIEWER_FRAMING_MARGIN;
  let halfH = (_size.y / 2) * VIEWER_FRAMING_MARGIN;
  const ar = halfW / Math.max(halfH, 1e-9);
  if (ar > a) {
    halfH = halfW / a;
  } else {
    halfW = halfH * a;
  }

  const target = new THREE.Vector3(_center.x, _center.y, _center.z);
  const dist = VIEWER_FRAMING_MARGIN * Math.max(radius * 1.05, Math.hypot(halfW, halfH));
  const jitter = Math.max(1e-5, radius * 1e-6);
  const position = new THREE.Vector3(_center.x + jitter, _center.y + jitter, _center.z + dist);

  const near = Math.max(VIEWER_NEAR_MIN_M, dist * VIEWER_NEAR_DISTANCE_RATIO);
  const far = Math.max(
    near * 8,
    dist * VIEWER_FAR_DISTANCE_FACTOR + radius * VIEWER_FAR_RADIUS_FACTOR,
  );

  const minDistance = Math.max(VIEWER_NEAR_MIN_M * 2, radius * VIEWER_MIN_DISTANCE_RADIUS_RATIO);
  const maxDistance = Math.max(minDistance * 1.5, radius * VIEWER_MAX_DISTANCE_RADIUS_RATIO);

  return {
    left: -halfW,
    right: halfW,
    top: halfH,
    bottom: -halfH,
    near,
    far,
    position,
    target,
    minDistance,
    maxDistance,
  };
}

/** Empreinte stable pour déclencher un reframing (évite dépendre de l’identité du Box3). */
export function boundingBoxSignature(box: THREE.Box3): string {
  return [
    box.min.x,
    box.min.y,
    box.min.z,
    box.max.x,
    box.max.y,
    box.max.z,
  ].map((n) => (Number.isFinite(n) ? n.toFixed(6) : "nan")).join("|");
}
