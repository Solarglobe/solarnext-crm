/**
 * PvPanelInstanced — Rendu haute performance des panneaux PV via THREE.InstancedMesh.
 *
 * Objectif : réduire N draw calls (1 par panneau) à 1 draw call pour la surface de base.
 *
 * Architecture :
 * - Géométrie partagée : PlaneGeometry(1, 1) centrée à l'origine, normale +Z.
 *   La matrice d'instance est construite depuis corners3D + center3D + outwardNormal
 *   (même source de vérité que panelQuadGeometry — indépendant de localFrame).
 * - Per-instance color : si panelColors fourni, instanceColor est utilisé (material.color = white).
 *   Sinon, material.color = baseColor uniforme.
 * - Panneaux masqués (pvLayout3DInteractionMode) : matrice scale(0,0,0).
 * - Mise à jour matrices : via useFrame (RAF) + flag dirty — garantit l'application
 *   dans la même RAF que le rendu, sans dépendance au cycle React.
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

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";

// ── Géométrie partagée ────────────────────────────────────────────────────────

/**
 * Plan unité 1×1, normal +Z, centré à l'origine.
 * La matrice d'instance positionne et dimensionne chaque panneau en world space.
 */
function buildSharedPanelGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

// ── Matrice d'instance ────────────────────────────────────────────────────────

/**
 * Matrice locale → monde construite depuis corners3D + center3D + outwardNormal.
 *
 * N'utilise PAS localFrame pour éviter tout décalage entre le pipeline de placement
 * 3D et le pipeline canonique 2D→3D (buildPvPanels3D). Même source de vérité que
 * panelQuadGeometry (corners3D), ce qui garantit que la surface InstancedMesh
 * coïncide exactement avec la géométrie des cell lines.
 *
 * Pour PlaneGeometry(1,1) avec vertices à (±0.5, ±0.5, 0) :
 *   col0 = c1 - c0  (vecteur largeur pleine, scale implicite)
 *   col1 = c3 - c0  (vecteur hauteur pleine, scale implicite)
 *   col2 = outwardNormal
 *   col3 = center3D
 *
 * Preuve coins (center = (c1+c3)/2 pour un rectangle) :
 *   M*(−.5,−.5,0) = c0  ✓   M*( .5,−.5,0) = c1  ✓
 *   M*( .5, .5,0) = c2  ✓   M*(−.5, .5,0) = c3  ✓
 */
function applyPanelInstanceMatrix(panel: PvPanelSurface3D, target: THREE.Matrix4): void {
  const c0 = panel.corners3D[0]!;
  const c1 = panel.corners3D[1]!;
  const c3 = panel.corners3D[3]!;
  const ctr = panel.center3D;
  const n = panel.outwardNormal;
  const wx = c1.x - c0.x, wy = c1.y - c0.y, wz = c1.z - c0.z;
  const hx = c3.x - c0.x, hy = c3.y - c0.y, hz = c3.z - c0.z;
  // THREE.Matrix4.set prend les arguments en ordre row-major
  target.set(
    wx,  hx,  n.x,  ctr.x,
    wy,  hy,  n.y,  ctr.y,
    wz,  hz,  n.z,  ctr.z,
    0,   0,   0,    1,
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

  /**
   * Flag dirty : signale que les matrices/couleurs doivent être recalculées.
   * Mis à true à chaque changement de panels / colors / count / hidden.
   * Remis à false dans useFrame après application.
   *
   * On stocke également les props courantes en refs pour y accéder depuis useFrame
   * sans déclencher de re-render ni risquer une closure périmée.
   */
  const dirtyRef = useRef(true);
  const panelsRef = useRef(panels);
  const panelColorsRef = useRef(panelColors);
  const hiddenPanelIdsRef = useRef(hiddenPanelIds);

  useEffect(() => {
    panelsRef.current = panels;
    panelColorsRef.current = panelColors;
    hiddenPanelIdsRef.current = hiddenPanelIds;
    dirtyRef.current = true;
  }, [panels, panelColors, count, hiddenPanelIds]);

  /**
   * Application des matrices et couleurs dans la RAF (useFrame).
   *
   * Pourquoi useFrame plutôt que useLayoutEffect/useEffect :
   * - useFrame s'exécute DANS la RAF de R3F, juste avant le rendu THREE.js.
   * - Les matrices sont donc TOUJOURS à jour pour le frame courant, sans aucune
   *   dépendance au cycle React (résout les problèmes de premier montage,
   *   de count changeant, et de mode frameloop="demand").
   * - Le flag dirtyRef évite tout travail inutile sur les frames sans changement.
   */
  useFrame(() => {
    if (!dirtyRef.current) return;
    const mesh = meshRef.current;
    if (!mesh) return;

    dirtyRef.current = false;

    const currentPanels = panelsRef.current;
    const currentColors = panelColorsRef.current;
    const currentHidden = hiddenPanelIdsRef.current;
    const n = currentPanels.length;
    if (n === 0) return;

    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const hasPerInstanceColors = currentColors != null && currentColors.length === n;

    for (let i = 0; i < n; i++) {
      const panel = currentPanels[i]!;
      const isHidden = currentHidden?.has(String(panel.id)) ?? false;

      if (isHidden) {
        mesh.setMatrixAt(i, HIDDEN_INSTANCE_MATRIX);
      } else {
        applyPanelInstanceMatrix(panel, m);
        mesh.setMatrixAt(i, m);
      }

      if (hasPerInstanceColors) {
        c.setHex(currentColors![i]!);
        mesh.setColorAt(i, c);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;

    if (hasPerInstanceColors && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    } else if (!hasPerInstanceColors && mesh.instanceColor) {
      mesh.instanceColor = null;
    }
  });

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
