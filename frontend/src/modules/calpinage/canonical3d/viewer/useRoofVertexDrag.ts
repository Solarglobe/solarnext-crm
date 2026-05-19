/**
 * useRoofVertexDrag — état de drag d'un sommet toiture en mode édition Z.
 *
 * Architecture ref-only :
 *   Toute la session est stockée dans UN SEUL useRef. Les handlers qui mutent cet état
 *   (pointerDown/Move/Up) s'exécutent hors cycle React et n'ont jamais besoin de setState.
 *   Seul le callback `onDragEnd` (propagé depuis le viewer via RoofVertexZDragController)
 *   déclenche la mise à jour du state React/Zustand en fin de geste.
 *
 * Rôle dans le viewer :
 *   Remplace le double-pattern `zDragSessionRef` + async useEffect dans SolarScene3DViewer :
 *     // ❌ ANCIEN pattern (dead-code : zDragSessionRef n'était jamais LU dans les handlers)
 *     const zDragSessionRef = useRef<RoofZDragSession | null>(null);
 *     useEffect(() => { zDragSessionRef.current = roofZDragSession; }, [roofZDragSession]);
 *
 *   Le ref qui compte pour le geste immédiat est `zDragSessionImmediateRef` (alias de
 *   RoofVertexZDragController.gestureSessionRef), alimenté synchronement au pointerdown.
 *   `dragState` ici expose l'état de haut niveau (isDragging, vertexId, startWorldPos)
 *   utile pour les composants UI qui n'ont pas accès au RoofZDragSession interne.
 *
 * Note : RoofVertexZDragController.tsx est préservé — il gère l'intégralité du pipeline
 * pointermove/up via son propre useLayoutEffect. Ce hook est son complément léger côté viewer.
 */

import { useRef } from "react";
import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";

export interface RoofVertexDragState {
  /** Geste actif (pointerdown reçu, pointerup non encore traité). */
  isDragging: boolean;
  /** ID du sommet en cours de drag (format `"${panId}_${vertexIndex}"`). */
  vertexId: string | null;
  /** Position monde au début du drag — ancre pour les calculs de delta Z. */
  startWorldPos: THREE.Vector3 | null;
}

const INITIAL_STATE: RoofVertexDragState = {
  isDragging: false,
  vertexId: null,
  startWorldPos: null,
};

export interface UseRoofVertexDragReturn {
  /** Ref synchrone — état complet du geste, toujours à jour pour les handlers DOM. */
  readonly dragState: React.MutableRefObject<RoofVertexDragState>;
  /** Appelé au pointerdown sur un marqueur sommet. */
  readonly onPointerDown: (vertexId: string, startWorldPos: THREE.Vector3) => void;
  /** Appelé au pointermove — disponible pour extensions futures (pas de logique Z ici). */
  readonly onPointerMove: () => void;
  /** Appelé au pointerup — remet l'état à l'initial. */
  readonly onPointerUp: () => void;
}

/**
 * @param _scene — réservé aux extensions futures (filtrage par toiture, contraintes géo).
 */
export function useRoofVertexDrag(_scene: SolarScene3D | null): UseRoofVertexDragReturn {
  const dragState = useRef<RoofVertexDragState>({ ...INITIAL_STATE });

  const onPointerDown = (vertexId: string, startWorldPos: THREE.Vector3): void => {
    dragState.current = { isDragging: true, vertexId, startWorldPos };
  };

  const onPointerMove = (): void => {
    // La logique de mouvement Z est dans RoofVertexZDragController.
    // Ce hook n'a pas besoin de la dupliquer.
  };

  const onPointerUp = (): void => {
    dragState.current = { ...INITIAL_STATE };
  };

  return { dragState, onPointerDown, onPointerMove, onPointerUp };
}
