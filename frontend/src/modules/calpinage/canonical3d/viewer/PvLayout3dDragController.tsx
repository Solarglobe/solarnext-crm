/**
 * Pass 5 — déplacement d’un bloc PV depuis le maillage 3D : pointermove global + raycast → px image
 * → `setManipulationTransform` (même logique delta que les poignées 2D).
 */

import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { worldPointToImage } from "../world/worldToImage";
import type { CanonicalWorldConfig } from "../world/worldConvention";
import { INSPECT_USERDATA_KEY } from "./inspection/sceneInspectionTypes";

/**
 * Filtre les maillages autorisés pour le raycast PV-layout en mode drag.
 * Seuls les maillages de tessellation toit (kind="PAN", meshRole="roof_tessellation")
 * participent : cela évite de picker les panneaux PV eux-mêmes lors du déplacement.
 */
function meshParticipatesInPvLayout3dRaycast(o: THREE.Object3D): boolean {
  const raw = (o.userData as Record<string, unknown> | undefined)?.[INSPECT_USERDATA_KEY];
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return r.kind === "PAN" && r.meshRole === "roof_tessellation";
}

export type PvLayout3dDragSession = {
  readonly blockId: string;
  readonly pointerId: number;
  readonly startImg: { readonly x: number; readonly y: number };
  readonly mode?: "move" | "rotate";
  readonly centerImg?: { readonly x: number; readonly y: number } | null;
};

type PvLayout3dPick = {
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  readonly plane: THREE.Plane;
  readonly object: THREE.Object3D;
};

type Props = {
  readonly session: PvLayout3dDragSession | null;
  readonly worldConfig: CanonicalWorldConfig | null;
  /** Delta px image cumulé depuis le pointerdown (aligné Phase 3). */
  readonly onLiveOffsetImg: (dxImg: number, dyImg: number, rotationDeg?: number) => void;
  readonly onSessionEnd: () => void;
};

export function PvLayout3dDragController({ session, worldConfig, onLiveOffsetImg, onSessionEnd }: Props) {
  const { gl, camera, scene, invalidate } = useThree();
  const sessionRef = useRef<PvLayout3dDragSession | null>(null);
  sessionRef.current = session;
  const liveRef = useRef(onLiveOffsetImg);
  liveRef.current = onLiveOffsetImg;
  const endRef = useRef(onSessionEnd);
  endRef.current = onSessionEnd;
  const raycasterRef = useRef(new THREE.Raycaster());
  const lockedRoofObjectRef = useRef<THREE.Object3D | null>(null);
  const lastRoofPlaneRef = useRef<THREE.Plane | null>(null);
  /** Passe 6 — au plus une mise à jour moteur / frame (perf). */
  const rafRef = useRef(0);
  const pendingOffsetRef = useRef<{ dx: number; dy: number; rotationDeg: number } | null>(null);
  /**
   * Recalage d'origine : premier hit 3D réel capturé au premier pointermove.
   * Élimine le saut initial dû au désalignement entre le startImg 2D (pointerdown)
   * et la position image dérivée du raycast 3D (premiers pointermove).
   */
  const firstHitImgRef = useRef<{ x: number; y: number } | null>(null);
  const prevSessionKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = gl.domElement;
    const raycaster = raycasterRef.current;

    const planeFromHit = (h: THREE.Intersection): THREE.Plane | null => {
      if (!h.face) return null;
      const normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      if (normal.lengthSq() <= 1e-12) return null;
      return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, h.point);
    };

    const pickWorldFromClient = (clientX: number, clientY: number): PvLayout3dPick | null => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const locked = lockedRoofObjectRef.current;
      const hits = locked ? raycaster.intersectObject(locked, true) : raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        let allowed = false;
        while (o) {
          if (meshParticipatesInPvLayout3dRaycast(o)) {
            allowed = true;
            break;
          }
          o = o.parent;
        }
        if (allowed && h.point) {
          const plane = planeFromHit(h);
          if (!plane) continue;
          lockedRoofObjectRef.current = h.object;
          lastRoofPlaneRef.current = plane;
          return { point: { x: h.point.x, y: h.point.y, z: h.point.z }, plane, object: h.object };
        }
      }
      const fallbackPlane = lastRoofPlaneRef.current;
      if (fallbackPlane && lockedRoofObjectRef.current) {
        const p = raycaster.ray.intersectPlane(fallbackPlane, new THREE.Vector3());
        if (p) {
          return {
            point: { x: p.x, y: p.y, z: p.z },
            plane: fallbackPlane,
            object: lockedRoofObjectRef.current,
          };
        }
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      const s = sessionRef.current;
      const wc = worldConfig;
      if (!s || ev.pointerId !== s.pointerId || !wc) return;
      if (!wc || wc.metersPerPixel <= 0) return;
      const sessionKey = `${s.blockId}:${s.pointerId}`;
      if (sessionKey !== prevSessionKeyRef.current) {
        prevSessionKeyRef.current = sessionKey;
        firstHitImgRef.current = null;
        lockedRoofObjectRef.current = null;
        lastRoofPlaneRef.current = null;
      }
      const picked = pickWorldFromClient(ev.clientX, ev.clientY);
      if (!picked) return;
      const img = worldPointToImage(picked.point, wc);

      // Recalage d'origine : si c'est le premier hit réel de cette session,
      // on l'utilise comme origine 3D canonique. Le delta au frame 1 sera (0,0)
      // — aucun saut — et tous les deltas suivants sont cohérents dans le même
      // système de coordonnées que le raycast (pas de désalignement 2D/3D).
      if (firstHitImgRef.current === null) {
        firstHitImgRef.current = { x: img.x, y: img.y };
      }
      const origin = firstHitImgRef.current;

      const dx = img.x - origin.x;
      const dy = img.y - origin.y;
      let rotationDeg = 0;
      if (s.mode === "rotate" && s.centerImg) {
        // Angle depuis le premier hit réel (pas depuis startImg 2D) pour éviter
        // un saut angulaire initial identique au saut de translation.
        const start = Math.atan2(origin.y - s.centerImg.y, origin.x - s.centerImg.x);
        const now = Math.atan2(img.y - s.centerImg.y, img.x - s.centerImg.x);
        rotationDeg = ((now - start) * 180) / Math.PI;
      }
      pendingOffsetRef.current = { dx, dy, rotationDeg };
      if (rafRef.current !== 0) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const p = pendingOffsetRef.current;
        pendingOffsetRef.current = null;
        if (p) {
          liveRef.current(p.dx, p.dy, p.rotationDeg);
          invalidate();
        }
      });
    };

    const onUp = (ev: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      const p = pendingOffsetRef.current;
      pendingOffsetRef.current = null;
      if (p) liveRef.current(p.dx, p.dy, p.rotationDeg);
      firstHitImgRef.current = null;
      prevSessionKeyRef.current = null;
      lockedRoofObjectRef.current = null;
      lastRoofPlaneRef.current = null;
      endRef.current();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      pendingOffsetRef.current = null;
      lockedRoofObjectRef.current = null;
      lastRoofPlaneRef.current = null;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [gl.domElement, camera, scene, worldConfig, invalidate]);

  return null;
}

