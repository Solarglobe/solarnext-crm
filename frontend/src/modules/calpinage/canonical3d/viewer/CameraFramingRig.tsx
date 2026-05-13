/**
 * Synchronise caméra perspective + OrbitControls sur un Box3.
 * PLAN_2D = vue quasi-zénithale (FOV dérivé du cadrage plan) ; SCENE_3D = orbite perspective.
 * Passage de mode : interpolation douce + conservation de l’azimut (convention OrbitControls / Y-up interne).
 */

import { useFrame, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  boundingBoxSignature,
  computePlanOrthographicFraming,
  computeViewerFraming,
} from "./viewerFraming";
import type { CameraViewMode } from "./cameraViewMode";
import {
  VIEWER_CAMERA_FOV_DEG,
  VIEWER_CAMERA_MODE_TRANSITION_MS,
  VIEWER_FRAMING_MARGIN,
  VIEWER_ORBIT_DAMPING,
  VIEWER_ORBIT_DAMPING_FACTOR,
  VIEWER_ORBIT_MAX_AZIMUTH,
  VIEWER_ORBIT_MAX_POLAR_ANGLE,
  VIEWER_ORBIT_MIN_AZIMUTH,
  VIEWER_ORBIT_MIN_POLAR_ANGLE,
  VIEWER_PLAN_ORBIT_MAX_POLAR,
  VIEWER_PLAN_ORBIT_MIN_POLAR,
} from "./viewerConstants";
import {
  buildCameraAuditPayload,
  cameraWorldRight,
  positionFromOrbitSpherical,
  readOrbitSpherical,
  smoothstep01,
} from "./cameraOrbitContinuity";
import {
  isCalpinage3DRuntimeDebugEnabled,
  isCalpinage3dCameraAuditEnabled,
  logCalpinage3DDebug,
  logCalpinage3dCameraAudit,
} from "../../core/calpinage3dRuntimeDebug";

const Z_UP = new THREE.Vector3(0, 0, 1);

type ModeTransition = {
  readonly t0: number;
  readonly durationMs: number;
  readonly fromPos: THREE.Vector3;
  readonly toPos: THREE.Vector3;
  readonly fromTarget: THREE.Vector3;
  readonly toTarget: THREE.Vector3;
  readonly fromFov: number;
  readonly toFov: number;
  readonly fromNear: number;
  readonly toNear: number;
  readonly fromFar: number;
  readonly toFar: number;
};

function applyPlanPerspectiveSnap(
  camera: THREE.PerspectiveCamera,
  ctrl: OrbitControlsImpl | null,
  box: THREE.Box3,
  aspect: number,
  margin: number,
): void {
  const f = computePlanOrthographicFraming(box, aspect, margin);
  const halfH = (f.top - f.bottom) / 2;
  const dist = Math.max(f.position.z - f.target.z, 1e-4);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan2(halfH, dist));
  camera.near = f.near;
  camera.far = f.far;
  camera.position.copy(f.position);
  camera.up.set(0, 0, 1);
  camera.lookAt(f.target);
  camera.updateProjectionMatrix();
  if (ctrl) {
    ctrl.target.copy(f.target);
    ctrl.minDistance = f.minDistance;
    ctrl.maxDistance = f.maxDistance;
    ctrl.minPolarAngle = VIEWER_PLAN_ORBIT_MIN_POLAR;
    ctrl.maxPolarAngle = VIEWER_PLAN_ORBIT_MAX_POLAR;
    ctrl.minAzimuthAngle = -Infinity;
    ctrl.maxAzimuthAngle = Infinity;
    ctrl.update();
  }
}

function applySceneOrbitLimitsOnly(
  camera: THREE.PerspectiveCamera,
  ctrl: OrbitControlsImpl | null,
  box: THREE.Box3,
  aspect: number,
  margin: number,
): void {
  const f3 = computeViewerFraming(box, aspect, margin);
  camera.fov = VIEWER_CAMERA_FOV_DEG;
  camera.up.set(0, 0, 1);
  camera.near = f3.near;
  camera.far = f3.far;
  camera.updateProjectionMatrix();
  if (ctrl) {
    ctrl.minDistance = f3.minDistance;
    ctrl.maxDistance = f3.maxDistance;
    ctrl.minPolarAngle = VIEWER_ORBIT_MIN_POLAR_ANGLE;
    ctrl.maxPolarAngle = VIEWER_ORBIT_MAX_POLAR_ANGLE;
    ctrl.minAzimuthAngle = VIEWER_ORBIT_MIN_AZIMUTH;
    ctrl.maxAzimuthAngle = VIEWER_ORBIT_MAX_AZIMUTH;
    ctrl.update();
  }
}

function applyScenePerspectiveSnap(
  camera: THREE.PerspectiveCamera,
  ctrl: OrbitControlsImpl | null,
  box: THREE.Box3,
  aspect: number,
  margin: number,
): void {
  const f3 = computeViewerFraming(box, aspect, margin);
  camera.fov = VIEWER_CAMERA_FOV_DEG;
  camera.up.set(0, 0, 1);
  camera.near = f3.near;
  camera.far = f3.far;
  camera.position.copy(f3.position);
  camera.lookAt(f3.target);
  camera.updateProjectionMatrix();
  if (ctrl) {
    ctrl.target.copy(f3.target);
    ctrl.minDistance = f3.minDistance;
    ctrl.maxDistance = f3.maxDistance;
    ctrl.minPolarAngle = VIEWER_ORBIT_MIN_POLAR_ANGLE;
    ctrl.maxPolarAngle = VIEWER_ORBIT_MAX_POLAR_ANGLE;
    ctrl.minAzimuthAngle = VIEWER_ORBIT_MIN_AZIMUTH;
    ctrl.maxAzimuthAngle = VIEWER_ORBIT_MAX_AZIMUTH;
    ctrl.update();
  }
}

function applySnapForMode(
  camera: THREE.PerspectiveCamera,
  ctrl: OrbitControlsImpl | null,
  mode: CameraViewMode,
  box: THREE.Box3,
  aspect: number,
  margin: number,
): void {
  if (mode === "PLAN_2D") {
    applyPlanPerspectiveSnap(camera, ctrl, box, aspect, margin);
  } else {
    applyScenePerspectiveSnap(camera, ctrl, box, aspect, margin);
  }
}

function buildPlanToSceneTransition(
  camera: THREE.PerspectiveCamera,
  ctrl: OrbitControlsImpl,
  box: THREE.Box3,
  aspect: number,
  margin: number,
): ModeTransition {
  const f3 = computeViewerFraming(box, aspect, margin);
  const thetaKeep = readOrbitSpherical(camera.position, ctrl.target, Z_UP).theta;
  const spDefault = readOrbitSpherical(f3.position, f3.target, Z_UP);
  const spEnd = new THREE.Spherical(spDefault.radius, spDefault.phi, thetaKeep);
  const toPos = positionFromOrbitSpherical(f3.target, spEnd, Z_UP);

  return {
    t0: performance.now(),
    durationMs: VIEWER_CAMERA_MODE_TRANSITION_MS,
    fromPos: camera.position.clone(),
    toPos,
    fromTarget: ctrl.target.clone(),
    toTarget: f3.target.clone(),
    fromFov: camera.fov,
    toFov: VIEWER_CAMERA_FOV_DEG,
    fromNear: camera.near,
    toNear: f3.near,
    fromFar: camera.far,
    toFar: f3.far,
  };
}

function buildSceneToPlanTransition(
  camera: THREE.PerspectiveCamera,
  ctrl: OrbitControlsImpl,
  box: THREE.Box3,
  aspect: number,
  margin: number,
): ModeTransition {
  const f = computePlanOrthographicFraming(box, aspect, margin);
  const halfH = (f.top - f.bottom) / 2;
  const dist = Math.max(f.position.z - f.target.z, 1e-4);
  const toFov = THREE.MathUtils.radToDeg(2 * Math.atan2(halfH, dist));

  return {
    t0: performance.now(),
    durationMs: VIEWER_CAMERA_MODE_TRANSITION_MS,
    fromPos: camera.position.clone(),
    toPos: f.position.clone(),
    fromTarget: ctrl.target.clone(),
    toTarget: f.target.clone(),
    fromFov: camera.fov,
    toFov,
    fromNear: camera.near,
    toNear: f.near,
    fromFar: camera.far,
    toFar: f.far,
  };
}

export function CameraFramingRig({
  box,
  mode,
  framingMargin,
  orbitEnabled = true,
  orbitControlsInstanceRef,
  worldEastUnit,
}: {
  readonly box: THREE.Box3;
  readonly mode: CameraViewMode;
  readonly framingMargin?: number;
  readonly orbitEnabled?: boolean;
  readonly orbitControlsInstanceRef?: MutableRefObject<OrbitControlsImpl | null>;
  /** Est monde (unitaire) — garde lecture carte ; optionnel si absent le garde Est/droite est désactivé. */
  readonly worldEastUnit?: THREE.Vector3;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const transitionRef = useRef<ModeTransition | null>(null);
  const prevModeRef = useRef<CameraViewMode | null>(null);
  const prevSigRef = useRef<string | null>(null);
  const [orbitSuspended, setOrbitSuspended] = useState(false);

  const sig = useMemo(() => boundingBoxSignature(box), [box]);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const ctrl = controlsRef.current;
    const aspect = size.width / Math.max(size.height, 1);
    const margin = framingMargin ?? VIEWER_FRAMING_MARGIN;

    const first = prevModeRef.current === null;
    const modeChanged = !first && prevModeRef.current !== mode;
    const sigChanged = prevSigRef.current !== sig;

    if (first) {
      applySnapForMode(camera, ctrl, mode, box, aspect, margin);
      prevModeRef.current = mode;
      prevSigRef.current = sig;
      if (isCalpinage3DRuntimeDebugEnabled()) {
        logCalpinage3DDebug("[CameraFramingRig] initial snap", { mode, aspect });
      }
      invalidate();
      return;
    }

    if (modeChanged) {
      const prev = prevModeRef.current!;
      if (ctrl && isCalpinage3dCameraAuditEnabled()) {
        const east = worldEastUnit?.clone().normalize() ?? new THREE.Vector3(1, 0, 0);
        logCalpinage3dCameraAudit(
          buildCameraAuditPayload(`mode-switch-start:${prev}->${mode}`, camera, ctrl, east),
        );
      }
      if (ctrl) {
        transitionRef.current =
          prev === "PLAN_2D" && mode === "SCENE_3D"
            ? buildPlanToSceneTransition(camera, ctrl, box, aspect, margin)
            : prev === "SCENE_3D" && mode === "PLAN_2D"
              ? buildSceneToPlanTransition(camera, ctrl, box, aspect, margin)
              : null;

        if (transitionRef.current) {
          setOrbitSuspended(true);
        } else {
          applySnapForMode(camera, ctrl, mode, box, aspect, margin);
        }
      } else {
        applySnapForMode(camera, null, mode, box, aspect, margin);
      }
      prevModeRef.current = mode;
      prevSigRef.current = sig;
      invalidate();
      return;
    }

    if (sigChanged) {
      if (transitionRef.current) {
        transitionRef.current = null;
        setOrbitSuspended(false);
      }
      applySnapForMode(camera, ctrl, mode, box, aspect, margin);
      prevSigRef.current = sig;
      invalidate();
      return;
    }

    prevSigRef.current = sig;
    prevModeRef.current = mode;
  }, [sig, mode, framingMargin, size.width, size.height, camera, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const ctrl = controlsRef.current;
    const tr = transitionRef.current;
    if (tr) {
      const u = smoothstep01((performance.now() - tr.t0) / tr.durationMs);
      camera.position.lerpVectors(tr.fromPos, tr.toPos, u);
      if (ctrl) {
        ctrl.target.lerpVectors(tr.fromTarget, tr.toTarget, u);
      }
      camera.fov = THREE.MathUtils.lerp(tr.fromFov, tr.toFov, u);
      camera.near = THREE.MathUtils.lerp(tr.fromNear, tr.toNear, u);
      camera.far = THREE.MathUtils.lerp(tr.fromFar, tr.toFar, u);
      camera.up.set(0, 0, 1);
      if (ctrl) {
        camera.lookAt(ctrl.target);
      }
      camera.updateProjectionMatrix();
      if (u >= 1 - 1e-4) {
        transitionRef.current = null;
        setOrbitSuspended(false);
        const aspect = size.width / Math.max(size.height, 1);
        const margin = framingMargin ?? VIEWER_FRAMING_MARGIN;
        if (mode === "SCENE_3D") {
          applySceneOrbitLimitsOnly(camera, ctrl, box, aspect, margin);
          if (ctrl) {
            camera.lookAt(ctrl.target);
          }
        } else {
          applySnapForMode(camera, ctrl, mode, box, aspect, margin);
        }
        if (ctrl && isCalpinage3dCameraAuditEnabled()) {
          const east = worldEastUnit?.clone().normalize() ?? new THREE.Vector3(1, 0, 0);
          logCalpinage3dCameraAudit(buildCameraAuditPayload("mode-transition-end", camera, ctrl, east));
          const right = cameraWorldRight(camera);
          if (right.dot(east) < -0.05) {
            logCalpinage3dCameraAudit(
              buildCameraAuditPayload("WARN-east-right-inversion-detected", camera, ctrl, east),
            );
          }
        }
      }
      invalidate();
      return;
    }
  });

  const bindControlsRef = (node: OrbitControlsImpl | null) => {
    controlsRef.current = node;
    if (orbitControlsInstanceRef) {
      orbitControlsInstanceRef.current = node;
    }
  };

  const controlsActive = orbitEnabled && !orbitSuspended;

  return (
    <OrbitControls
      ref={bindControlsRef}
      enableDamping={VIEWER_ORBIT_DAMPING && controlsActive}
      dampingFactor={VIEWER_ORBIT_DAMPING_FACTOR}
      enableRotate={controlsActive}
      enableZoom={controlsActive}
      enablePan={controlsActive}
      enabled={controlsActive}
      makeDefault
    />
  );
}
