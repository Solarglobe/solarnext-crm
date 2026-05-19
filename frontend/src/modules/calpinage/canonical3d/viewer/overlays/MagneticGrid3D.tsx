/**
 * Grille de points magnétiques sur le pan actif en mode placement PV.
 *
 * Les `snapPoints` (THREE.Vector3[]) sont précalculés dans SolarScene3DViewer via useMemo
 * sur la géométrie du pan ciblé — ce composant ne contient aucune logique de calcul métier.
 *
 * Animation : `useFrame` anime la taille des points (scale pulse) et leur opacité pour
 * indiquer visuellement les positions de snap disponibles.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// ── Types publics ─────────────────────────────────────────────────────────────

export interface MagneticGridProps {
  /** Pan de toit actif (null = aucun pan ciblé). Utilisé pour keying externe uniquement. */
  readonly panId: string | null;
  /** Points snap précalculés en world space — vides hors mode placement actif. */
  readonly snapPoints: THREE.Vector3[];
  /** false = rendu supprimé (useFrame continue mais ne dessine rien). */
  readonly visible: boolean;
}

// ── Constantes visuelles ──────────────────────────────────────────────────────

/** Couleur des points snap — jaune doux cohérent avec SOLARNEXT_3D_PREMIUM_THEME.selection.pan */
const SNAP_POINT_COLOR = "#f5d991";
/** Taille de base des points (px écran, sizeAttenuation=false = taille constante quelle que soit la distance). */
const SNAP_POINT_BASE_SIZE = 3.5;
/** Amplitude du pulse (±px). */
const SNAP_PULSE_AMPLITUDE = 1.8;
/** Fréquence du pulse en Hz. */
const SNAP_PULSE_FREQ_HZ = 1.2;

// ── Composant ─────────────────────────────────────────────────────────────────

export function MagneticGrid3D({ snapPoints, visible }: MagneticGridProps) {
  const materialRef = useRef<THREE.PointsMaterial>(null);

  // Animation pulse taille + opacité via useFrame
  useFrame(({ clock }) => {
    const mat = materialRef.current;
    if (!mat) return;
    const t = clock.getElapsedTime();
    const phase = Math.sin(t * Math.PI * 2 * SNAP_PULSE_FREQ_HZ);
    mat.size    = SNAP_POINT_BASE_SIZE + SNAP_PULSE_AMPLITUDE * phase;
    mat.opacity = 0.42 + 0.28 * phase;
  });

  // Géométrie reconstruite uniquement quand snapPoints change (référence stable)
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (snapPoints.length === 0) return geo;
    const positions = new Float32Array(snapPoints.length * 3);
    for (let i = 0; i < snapPoints.length; i++) {
      positions[i * 3]     = snapPoints[i].x;
      positions[i * 3 + 1] = snapPoints[i].y;
      positions[i * 3 + 2] = snapPoints[i].z;
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [snapPoints]);

  // Pas de rendu si invisible ou aucun point — useFrame continue (réinitialisation propre)
  if (!visible || snapPoints.length === 0) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        color={SNAP_POINT_COLOR}
        size={SNAP_POINT_BASE_SIZE}
        sizeAttenuation={false}
        transparent
        opacity={0.55}
        depthWrite={false}
        depthTest={true}
      />
    </points>
  );
}
