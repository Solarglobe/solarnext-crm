/**
 * DynamicCamera — swap caméra Three.js dans le store R3F selon le mode vue,
 * sans détruire le Canvas ni le contexte WebGL.
 *
 * Pourquoi : R3F crée la caméra une seule fois à l'initialisation du Canvas.
 * Changer le type de projection (perspective ↔ orthographique) nécessite
 * d'injecter une nouvelle instance via `useThree(s => s.set)({ camera })`.
 *
 * Ce composant DOIT être placé AVANT `CameraFramingRig` dans l'arbre du Canvas
 * afin que le bon type de caméra soit en place quand `CameraFramingRig` lit
 * `camera instanceof THREE.OrthographicCamera` dans son propre useLayoutEffect.
 *
 * `framingBox` est lu via une ref (pattern évite dépendance sur chaque bbox minor-change) :
 * seul un changement de `mode` déclenche la création d'une nouvelle caméra.
 * `CameraFramingRig` prend ensuite le relais pour le framing précis.
 */

import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CameraViewMode } from "./cameraViewMode";
import { VIEWER_CAMERA_FOV_DEG, VIEWER_DEFAULT_CAMERA_OFFSET } from "./viewerConstants";

export interface DynamicCameraProps {
  readonly mode: CameraViewMode;
  readonly framingBox: THREE.Box3;
}

/**
 * Injecte la caméra correcte dans le store R3F selon `mode`.
 * Retourne null — aucun rendu JSX.
 */
export function DynamicCamera({ mode, framingBox }: DynamicCameraProps): null {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);

  // Ref pattern : framingBox mis à jour à chaque render sans être une dépendance de l'effect.
  // Seul `mode` déclenche le swap caméra ; CameraFramingRig gère le re-framing sur bbox change.
  const framingBoxRef = useRef(framingBox);
  framingBoxRef.current = framingBox;

  useLayoutEffect(() => {
    const box = framingBoxRef.current;
    const center = box.getCenter(new THREE.Vector3());
    const aspect = size.width / Math.max(size.height, 1);

    if (mode === "PLAN_2D") {
      // Caméra orthographique pour la vue plan.
      // Frustum et position définitifs calculés par CameraFramingRig (computePlanOrthographicFraming).
      // H4-FIX — far aligné sur la prop Canvas (far=5000). Avant : 1e6 → ratio near/far=2e7,
      // soit 1000× plus mauvaise précision depth buffer que la configuration Canvas (5e4).
      // Les valeurs polygonOffset calibrées pour far=5000 étaient inefficaces avec far=1e6.
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 5000);
      cam.position.set(center.x, center.y, 50);
      cam.up.set(0, 0, 1);
      cam.lookAt(new THREE.Vector3(center.x, center.y, 0));
      set({ camera: cam });
    } else {
      // Caméra perspective pour la vue 3D orbitale.
      // Position identique à la prop `camera` du Canvas (loin dans la direction VIEWER_DEFAULT_CAMERA_OFFSET).
      // CameraFramingRig repositionne via computeViewerFraming + lerp.
      // H4-FIX — far=5000 aligné sur Canvas (ratio near/far=5e4, précision depth optimale).
      const cam = new THREE.PerspectiveCamera(VIEWER_CAMERA_FOV_DEG, aspect, 0.1, 5000);
      cam.position.set(
        VIEWER_DEFAULT_CAMERA_OFFSET.x * 1000,
        VIEWER_DEFAULT_CAMERA_OFFSET.y * 1000,
        VIEWER_DEFAULT_CAMERA_OFFSET.z * 1000,
      );
      cam.up.set(0, 0, 1);
      cam.lookAt(center);
      set({ camera: cam });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, set]);
  // size.width / size.height exclus intentionnellement : on ne veut pas recréer la caméra
  // sur chaque resize — CameraFramingRig met à jour le frustum/aspect dans son propre effect.

  return null;
}
