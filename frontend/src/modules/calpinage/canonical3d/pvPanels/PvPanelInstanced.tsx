/**
 * PvPanelInstanced — Rendu haute performance des panneaux PV via THREE.InstancedMesh.
 *
 * Objectif : réduire N draw calls (1 par panneau) à 1 draw call pour la surface de base.
 *
 * Architecture :
 * - Géométrie partagée : PlaneGeometry(1, 1) centrée à l'origine, normale +Z.
 *   La matrice d'instance applique scale(widthM, heightM) + rotation(localFrame) + translation(origin).
 * - Per-instance color : si panelColors fourni, instanceColor est utilisé (material.color = white).
 *   Sinon, material.color = baseColor uniforme.
 * - Panneaux masqués (pvLayout3DInteractionMode) : matrice scale(0,0,0).
 * - Sélection / inspection : onPanelClick reçoit (PvPanelSurface3D, ThreeEvent).
 *   Le caller (SolarScene3DViewer.tsx) est responsable de patcher e.object.userData pour
 *   la compatibilité avec le système d'inspection existant.
 * - Cleanup : dispose de la géométrie partagée au démontage.
 *
 * Garanties anti-régression :
 * 1. NE modifie PAS buildPvPanels3D.ts.
 * 2. Sélection par raycasting fonctionne via e.instanceId.
 * 3. Aucune logique de panneau unique — uniquement le rendu.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";

// ── Géométrie partagée ────────────────────────────────────────────────────────

/**
 * Plan unité 1×1, normal +Z, centré à l'origine.
 * La matrice d'instance scale par (widthM, heightM) et oriente selon localFrame.
 */
function buildSharedPanelGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

// ── Matrice d'instance ────────────────────────────────────────────────────────

/**
 * Matrice locale → monde à partir du LocalFrame3D du panneau.
 *
 * set(row-major) :
 *   col0 = xAxis * widthM   (direction largeur dans le monde, mise à l'échelle)
 *   col1 = yAxis * heightM  (direction hauteur dans le monde, mise à l'échelle)
 *   col2 = zAxis            (normale sortante, vecteur unitaire — pas de scale profondeur pour un plan)
 *   col3 = origin           (centre monde du panneau)
 *
 * Pour un PlaneGeometry(1,1), les vertices sont à (±0.5, ±0.5, 0) en local.
 * Après transformation : ±widthM/2 le long de xAxis, ±heightM/2 le long de yAxis. ✓
 */
function applyPanelInstanceMatrix(panel: PvPanelSurface3D, target: THREE.Matrix4): void {
  const { xAxis: x, yAxis: y, zAxis: z, origin: o } = panel.localFrame;
  const w = panel.widthM;
  const h = panel.heightM;
  // THREE.Matrix4.set prend les arguments en ordre row-major
  target.set(
    w * x.x,  h * y.x,  z.x,  o.x,
    w * x.y,  h * y.y,  z.y,  o.y,
    w * x.z,  h * y.z,  z.z,  o.z,
    0,        0,        0,    1,
  );
}

/** Matrice dégénérée : scale(0,0,0) pour masquer une instance sans la supprimer. */
const HIDDEN_INSTANCE_MATRIX: THREE.Matrix4 = (() => {
  const m = new THREE.Matrix4();
  m.makeScale(0, 0, 0);
  return Object.freeze(m) as THREE.Matrix4;
})();

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PvPanelInstancedProps {
  /** Surfaces 3D des panneaux — issues de buildPvPanels3D (non modifié). */
  readonly panels: readonly PvPanelSurface3D[];
  /**
   * Couleurs hex par instance (même ordre que panels).
   * Si fourni : material.color = 0xffffff (blanc), instanceColor appliqué par panneau.
   * Si absent  : material.color = baseColor uniforme.
   */
  readonly panelColors?: readonly number[];
  /** Couleur de base quand panelColors absent, ou valeur de fallback (0x111827 = bleu foncé premium). */
  readonly baseColor: number;
  /** Couleur emissive partagée (non per-instance — limitation InstancedMesh). */
  readonly emissiveColor: number;
  /** Intensité emissive partagée. */
  readonly emissiveIntensity: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly renderOrder?: number;
  readonly polygonOffsetFactor?: number;
  readonly polygonOffsetUnits?: number;
  /**
   * IDs des panneaux à masquer (matrice scale=0).
   * Utilisé en pvLayout3DInteractionMode pour les panneaux "live" rendus séparément.
   */
  readonly hiddenPanelIds?: ReadonlySet<string>;
  /**
   * Callback de clic sur un panneau individuel.
   * Reçoit la surface PV ET l'event — le caller est responsable du patch userData
   * pour la compatibilité avec le système d'inspection.
   */
  readonly onPanelClick?: (panel: PvPanelSurface3D, e: ThreeEvent<MouseEvent>) => void;
  /**
   * Callback pointerDown sur un panneau — utilisé en pvLayout3DInteractionMode.
   * Reçoit la surface PV ET l'event brut.
   */
  readonly onPanelPointerDown?: (panel: PvPanelSurface3D, e: ThreeEvent<PointerEvent>) => void;
  /** Callback hover panneau (identique à l'interface PanelHover du viewer). */
  readonly onPanelHover?: (
    payload: { panelId: string; clientX: number; clientY: number } | null,
  ) => void;
  /** Fonction de raycast custom (ex. roofModelingSkipOccluderRaycast pour le mode modélisation toiture). */
  readonly raycastFn?: (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PvPanelInstanced({
  panels,
  panelColors,
  baseColor,
  emissiveColor,
  emissiveIntensity,
  metalness,
  roughness,
  renderOrder = 0,
  polygonOffsetFactor = -1,
  polygonOffsetUnits = -1,
  hiddenPanelIds,
  onPanelClick,
  onPanelPointerDown,
  onPanelHover,
  raycastFn,
}: PvPanelInstancedProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = panels.length;

  // Géométrie partagée entre toutes les instances — dispose au démontage
  const sharedGeometry = useMemo(() => buildSharedPanelGeometry(), []);
  useEffect(() => {
    return () => {
      sharedGeometry.dispose();
    };
  }, [sharedGeometry]);

  // Met à jour les matrices et couleurs d'instance après chaque changement de panels/colors/hidden
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const hasPerInstanceColors = panelColors != null && panelColors.length === count;

    for (let i = 0; i < count; i++) {
      const panel = panels[i]!;
      const isHidden = hiddenPanelIds?.has(String(panel.id)) ?? false;

      if (isHidden) {
        mesh.setMatrixAt(i, HIDDEN_INSTANCE_MATRIX);
      } else {
        applyPanelInstanceMatrix(panel, m);
        mesh.setMatrixAt(i, m);
      }

      if (hasPerInstanceColors) {
        c.setHex(panelColors![i]!);
        mesh.setColorAt(i, c);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;

    if (hasPerInstanceColors && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    } else if (!hasPerInstanceColors && mesh.instanceColor) {
      // panelColors supprimé → réinitialise instanceColor pour revenir à la couleur uniforme
      mesh.instanceColor = null;
    }
  }, [panels, panelColors, count, hiddenPanelIds]);

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[sharedGeometry, undefined, count]}
      castShadow
      receiveShadow
      renderOrder={renderOrder}
      raycast={raycastFn}
      onClick={
        onPanelClick
          ? (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                onPanelClick(panels[e.instanceId]!, e);
              }
            }
          : undefined
      }
      onPointerDown={
        onPanelPointerDown
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                onPanelPointerDown(panels[e.instanceId]!, e);
              }
            }
          : undefined
      }
      onPointerOver={
        onPanelHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                const p = panels[e.instanceId]!;
                onPanelHover({ panelId: String(p.id), clientX: e.clientX, clientY: e.clientY });
              }
            }
          : undefined
      }
      onPointerOut={
        onPanelHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onPanelHover(null);
            }
          : undefined
      }
      onPointerMove={
        onPanelHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                const p = panels[e.instanceId]!;
                onPanelHover({ panelId: String(p.id), clientX: e.clientX, clientY: e.clientY });
              }
            }
          : undefined
      }
    >
      {/*
       * Quand panelColors est fourni, material.color = blanc pour que instanceColor
       * dicte la couleur finale sans teinte parasite (instanceColor × materialColor).
       * Sinon, material.color = baseColor uniforme.
       */}
      <meshStandardMaterial
        color={panelColors != null ? 0xffffff : baseColor}
        emissive={emissiveColor}
        emissiveIntensity={emissiveIntensity}
        metalness={metalness}
        roughness={roughness}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={polygonOffsetFactor}
        polygonOffsetUnits={polygonOffsetUnits}
      />
    </instancedMesh>
  );
}
