/**
 * Pass 5 — déplacement d’un bloc PV depuis le maillage 3D : pointermove global + raycast → px image
 * → `setManipulationTransform` (même logique delta que les poignées 2D).
 */

import { useLayoutEffect, useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { worldPointToImage } from "../world/worldToImage";
import type { CanonicalWorldConfig } from "../world/worldConvention";
import { INSPECT_USERDATA_KEY } from "./inspection/sceneInspectionTypes";

export type PvLayout3dDragSession = {
  readonly blockId: string;
  readonly pointerId: number;
  readonly startImg: { readonly x: number; readonly y: number };
};

type Props = {
  readonly session: PvLayout3dDragSession | null;
  readonly worldConfig: CanonicalWorldConfig | null;
  /** Delta px image cumulé depuis le pointerdown (aligné Phase 3). */
  readonly onLiveOffsetImg: (dxImg: number, dyImg: number) => void;
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
  /** Passe 6 — au plus une mise à jour moteur / frame (perf). */
  const rafRef = useRef(0);
  const pendingOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  /**
   * Positions monde initiales des meshes du bloc en cours de drag.
   * Renseignées au début de chaque session, vidées à la fin.
   * Permet de déplacer directement les meshes Three.js pendant le drag
   * sans attendre le rebuild React (rendu live immédiat).
   */
  const initialMeshPositions = useRef<Map<THREE.Mesh, THREE.Vector3>>(new Map());

  useEffect(() => {
    if (!session) {
      initialMeshPositions.current.clear();
      return;
    }
    const blockPrefix = session.blockId + "_";
    const map = new Map<THREE.Mesh, THREE.Vector3>();
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const u = (obj.userData?.[INSPECT_USERDATA_KEY] ?? {}) as { kind?: string; id?: string };
      if (u.kind === "PV_PANEL" && typeof u.id === "string") {
        const pid = u.id;
        if (pid === session.blockId || pid.startsWith(blockPrefix)) {
          map.set(obj, obj.position.clone());
        }
      }
    });
    initialMeshPositions.current = map;
  }, [session, scene]);

  useLayoutEffect(() => {
    const el = gl.domElement;
    const raycaster = raycasterRef.current;

    const pickWorldFromClient = (clientX: number, clientY: number): { x: number; y: number; z: number } | null => {
      const rect = el.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hits = raycaster.intersectObjects(scene.children, true);
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
        if (allowed && h.point) return { x: h.point.x, y: h.point.y, z: h.point.z };
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      const s = sessionRef.current;
      const wc = worldConfig;
      if (!s || ev.pointerId !== s.pointerId || !wc) return;
      const w = pickWorldFromClient(ev.clientX, ev.clientY);
      if (!w) return;
      const img = worldPointToImage(w, wc);
      const dx = img.x - s.startImg.x;
      const dy = img.y - s.startImg.y;
      pendingOffsetRef.current = { dx, dy };
      if (rafRef.current !== 0) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const p = pendingOffsetRef.current;
        pendingOffsetRef.current = null;
        if (p) {
          liveRef.current(p.dx, p.dy);
          /**
           * Mise à jour directe des mesh.position Three.js pour un rendu live immédiat,
           * sans attendre le rebuild React (qui n'arrive qu'au pointerup).
           * Delta image px → delta monde ENU : même loi que imagePxToWorldHorizontalM.
           */
          if (wc && initialMeshPositions.current.size > 0) {
            const mpp = wc.metersPerPixel;
            const rad = (wc.northAngleDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const dwx = mpp * (p.dx * cos + p.dy * sin);
            const dwy = mpp * (p.dx * sin - p.dy * cos);
            for (const [mesh, init] of initialMeshPositions.current) {
              mesh.position.set(init.x + dwx, init.y + dwy, init.z);
            }
          }
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
      if (p) liveRef.current(p.dx, p.dy);
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
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [gl.domElement, camera, scene, worldConfig, invalidate]);

  return null;
}

/** Filtre optionnel : prioriser les maillages pan / PV (évite le sol). */
export function meshParticipatesInPvLayout3dRaycast(obj: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    const u = o.userData?.[INSPECT_USERDATA_KEY] as { kind?: string; meshRole?: string } | undefined;
    if (u?.kind === "PAN" && u.meshRole === "roof_tessellation") return true;
    if (u?.kind === "PV_PANEL") return true;
    o = o.parent;
  }
  return false;
}
