/**
 * Synchronise caméra (perspective ou orthographique plan) + OrbitControls sur un Box3.
 * Prompt 34 — même géométrie, autre projection selon `mode`.
 *
 * Lerp framerate-independent (useFrame priority 1, après OrbitControls priority -1) :
 *   facteur = 1 - Math.pow(0.001, delta)  → convergence ~300 ms indépendamment du FPS.
 * L'interaction utilisateur (OrbitControls "start") annule immédiatement le lerp.
 * Caméra orthographique : pas de lerp position (frustum set immédiatement).
 */

import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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
  VIEWER_FRAMING_MARGIN,
  VIEWER_ORBIT_DAMPING,
  VIEWER_ORBIT_DAMPING_FACTOR,
  VIEWER_ORBIT_MAX_POLAR_ANGLE,
  VIEWER_ORBIT_MIN_POLAR_ANGLE,
  VIEWER_PLAN_ORBIT_MAX_POLAR,
  VIEWER_PLAN_ORBIT_MIN_POLAR,
} from "./viewerConstants";
import { isCalpinage3DRuntimeDebugEnabled, logCalpinage3DDebug } from "../../core/calpinage3dRuntimeDebug";

/** Seuil de snap : quand la caméra est à < LERP_SNAP_THRESHOLD m de la cible, snap immédiat. */
const LERP_SNAP_THRESHOLD = 0.01;

export function CameraFramingRig({
  box,
  mode,
  framingMargin,
  /** Si false : orbite / zoom / pan désactivés (ex. drag sur curseur d’édition sommet). */
  orbitEnabled = true,
  /**
   * Référence vers l’instance `OrbitControls` (three-stdlib) — pour couper l’orbite **de façon synchrone**
   * au `pointerdown` (avant que React n’ait re-rendu), ex. drag Z sur sommet.
   */
  orbitControlsInstanceRef,
}: {
  readonly box: THREE.Box3;
  readonly mode: CameraViewMode;
  /** Marge premium (défaut `VIEWER_FRAMING_MARGIN`). */
  readonly framingMargin?: number;
  readonly orbitEnabled?: boolean;
  readonly orbitControlsInstanceRef?: MutableRefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // ── Lerp state ─────────────────────────────────────────────
  /** Position cible du lerp (perspective uniquement). */
  const lerpTargetPos = useRef(new THREE.Vector3());
  /** LookAt cible du lerp (ctrl.target final). */
  const lerpTargetLookAt = useRef(new THREE.Vector3());
  /** true = lerp en cours. Annulé par interaction utilisateur ou snap. */
  const lerpActive = useRef(false);

  const sig = useMemo(() => boundingBoxSignature(box), [box]);

  useLayoutEffect(() => {
    const run = () => {
      const aspect = size.width / Math.max(size.height, 1);
      const ctrl = controlsRef.current;
      const margin = framingMargin ?? VIEWER_FRAMING_MARGIN;

      if (mode === "PLAN_2D") {
        const f = computePlanOrthographicFraming(box, aspect, margin);

        if (camera instanceof THREE.OrthographicCamera) {
          // Ortho : frustum + position immédiats (position non pertinente pour lerp visuel).
          camera.left   = f.left;
          camera.right  = f.right;
          camera.top    = f.top;
          camera.bottom = f.bottom;
          camera.near   = f.near;
          camera.far    = f.far;
          camera.position.copy(f.position);
          camera.up.set(0, 0, 1);
          camera.lookAt(f.target);
          camera.zoom = 1;
          camera.updateProjectionMatrix();
          lerpActive.current = false;
        } else if (camera instanceof THREE.PerspectiveCamera) {
          // Caméra perspective quasi-zénithale — parallaxe négligeable pour les hauteurs
          // typiques d’un bâtiment : l’empreinte XY correspond à la position 2D dessinée.
          const halfH = (f.top - f.bottom) / 2;
          const dist  = Math.max(f.position.z - f.target.z, 1e-4);
          camera.fov  = THREE.MathUtils.radToDeg(2 * Math.atan2(halfH, dist));
          camera.near = f.near;
          camera.far  = f.far;
          camera.up.set(0, 0, 1);
          camera.updateProjectionMatrix();
          lerpTargetPos.current.copy(f.position);
          lerpTargetLookAt.current.copy(f.target);
          lerpActive.current = true;
        } else {
          return;
        }

        if (ctrl) {
          ctrl.target.copy(f.target);
          ctrl.minDistance   = f.minDistance;
          ctrl.maxDistance   = f.maxDistance;
          ctrl.minPolarAngle = VIEWER_PLAN_ORBIT_MIN_POLAR;
          ctrl.maxPolarAngle = VIEWER_PLAN_ORBIT_MAX_POLAR;
          ctrl.update();
        }

        if (isCalpinage3DRuntimeDebugEnabled()) {
          logCalpinage3DDebug("[CameraFramingRig] PLAN_2D framing", { mode, aspect, f });
        }
        invalidate();
        return;
      }

      // ── SCENE_3D — perspective orbitale ────────────────────────────────
      if (!(camera instanceof THREE.PerspectiveCamera)) return;
      camera.fov = VIEWER_CAMERA_FOV_DEG;
      camera.up.set(0, 0, 1);
      const f3 = computeViewerFraming(box, aspect, margin);
      camera.near = f3.near;
      camera.far  = f3.far;
      camera.updateProjectionMatrix();
      // Lerp depuis la position initiale 1000× distante (montage Canvas) vers la cible.
      lerpTargetPos.current.copy(f3.position);
      lerpTargetLookAt.current.copy(f3.target);
      lerpActive.current = true;

      if (ctrl) {
        ctrl.target.copy(f3.target);
        ctrl.minDistance     = f3.minDistance;
        ctrl.maxDistance     = f3.maxDistance;
        ctrl.minPolarAngle   = VIEWER_ORBIT_MIN_POLAR_ANGLE;
        ctrl.maxPolarAngle   = VIEWER_ORBIT_MAX_POLAR_ANGLE;
        /** Rotation 360° libre — pas de contrainte azimutale. */
        ctrl.minAzimuthAngle = -Infinity;
        ctrl.maxAzimuthAngle = +Infinity;
        ctrl.update();
      }

      if (isCalpinage3DRuntimeDebugEnabled()) {
        logCalpinage3DDebug("[CameraFramingRig] SCENE_3D framing", { mode, aspect, f3 });
      }
      invalidate();
    };

    run();
  }, [sig, mode, framingMargin, size.width, size.height, camera, invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Lerp framerate-independent — priority 1 (après OrbitControls priority -1).
   * Garantit que la position lerpée est la valeur finale avant le rendu de chaque frame.
   * L’utilisateur peut interrompre : l’event "start" d’OrbitControls met lerpActive à false.
   */
  useFrame((_, delta) => {
    if (!lerpActive.current) return;
    const factor = 1 - Math.pow(0.001, delta);
    camera.position.lerp(lerpTargetPos.current, factor);
    camera.lookAt(lerpTargetLookAt.current);
    if (camera.position.distanceTo(lerpTargetPos.current) < LERP_SNAP_THRESHOLD) {
      camera.position.copy(lerpTargetPos.current);
      camera.lookAt(lerpTargetLookAt.current);
      lerpActive.current = false;
    }
    invalidate();
  }, 1); // priority 1 — après OrbitControls (-1)

  const bindControlsRef = (node: OrbitControlsImpl | null) => {
    if (controlsRef.current) {
      controlsRef.current.removeEventListener("start", cancelLerp);
    }
    controlsRef.current = node;
    if (orbitControlsInstanceRef) {
      orbitControlsInstanceRef.current = node;
    }
    // Annuler le lerp dès que l’utilisateur interagit avec les contrôles.
    if (node) {
      node.addEventListener("start", cancelLerp);
    }
  };

  function cancelLerp() {
    lerpActive.current = false;
  }

  return (
    <OrbitControls
      ref={bindControlsRef}
      enableDamping={VIEWER_ORBIT_DAMPING}
      dampingFactor={VIEWER_ORBIT_DAMPING_FACTOR}
      enableRotate={orbitEnabled}
      enableZoom={orbitEnabled}
      enablePan={orbitEnabled}
      makeDefault
    />
  );
}
