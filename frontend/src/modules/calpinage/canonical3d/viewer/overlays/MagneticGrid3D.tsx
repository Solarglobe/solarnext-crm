/**
 * Magnetic snap points on the active roof pan.
 *
 * The business snap points are computed by SolarScene3DViewer. This component is
 * only a restrained visual affordance and must never look like a debug grid in
 * normal cinematic viewing.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export interface MagneticGridProps {
  /** Active roof pan. Used for external keying only. */
  readonly panId: string | null;
  /** Precomputed world-space snap points. */
  readonly snapPoints: THREE.Vector3[];
  /** false = no render. */
  readonly visible: boolean;
}

const SNAP_POINT_COLOR = "#dbeafe";
const SNAP_POINT_BASE_SIZE = 2.1;
const SNAP_POINT_OPACITY = 0.16;

export function MagneticGrid3D({ snapPoints, visible }: MagneticGridProps) {
  const materialRef = useRef<THREE.PointsMaterial>(null);

  useFrame(({ clock }) => {
    const mat = materialRef.current;
    if (!mat) return;
    const settle = Math.min(clock.getElapsedTime(), 0.18) / 0.18;
    mat.size = SNAP_POINT_BASE_SIZE + 0.35 * (1 - settle);
    mat.opacity = SNAP_POINT_OPACITY;
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (snapPoints.length === 0) return geo;
    const positions = new Float32Array(snapPoints.length * 3);
    for (let i = 0; i < snapPoints.length; i++) {
      positions[i * 3] = snapPoints[i]!.x;
      positions[i * 3 + 1] = snapPoints[i]!.y;
      positions[i * 3 + 2] = snapPoints[i]!.z;
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [snapPoints]);

  if (!visible || snapPoints.length === 0) return null;

  return (
    <points geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        color={SNAP_POINT_COLOR}
        size={SNAP_POINT_BASE_SIZE}
        sizeAttenuation={false}
        transparent
        opacity={SNAP_POINT_OPACITY}
        depthWrite={false}
        depthTest
      />
    </points>
  );
}
