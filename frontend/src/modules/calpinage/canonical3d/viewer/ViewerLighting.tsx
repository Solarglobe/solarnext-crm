import * as THREE from "three";
import {
  VIEWER_AMBIENT_INTENSITY,
  VIEWER_FILL_LIGHT_INTENSITY,
  VIEWER_KEY_LIGHT_INTENSITY,
  VIEWER_SHADOW_BIAS,
  VIEWER_SHADOW_NORMAL_BIAS,
} from "./viewerConstants";
import { SOLARNEXT_3D_PREMIUM_THEME } from "./viewerVisualTokens";
import type { ViewerQualityProfile } from "./viewerQualityProfile";

export function ViewerLighting({
  center,
  maxDim,
  ambientScale,
  keyScale,
  fillScale,
  qualityProfile,
}: {
  readonly center: THREE.Vector3;
  readonly maxDim: number;
  readonly ambientScale: number;
  readonly keyScale: number;
  readonly fillScale: number;
  readonly qualityProfile: ViewerQualityProfile;
}) {
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  const m = maxDim;

  return (
    <>
      <hemisphereLight
        args={[SOLARNEXT_3D_PREMIUM_THEME.lighting.skyColor, SOLARNEXT_3D_PREMIUM_THEME.lighting.groundColor]}
        intensity={SOLARNEXT_3D_PREMIUM_THEME.lighting.hemisphereIntensity * ambientScale}
      />
      <ambientLight intensity={VIEWER_AMBIENT_INTENSITY * ambientScale} />
      <directionalLight
        position={[cx + m * 1.8, cy + m * 1.2, cz + m * 2.45]}
        intensity={VIEWER_KEY_LIGHT_INTENSITY * keyScale}
        castShadow={qualityProfile.shadows}
        shadow-mapSize={[qualityProfile.shadowMapSize, qualityProfile.shadowMapSize]}
        shadow-bias={VIEWER_SHADOW_BIAS}
        shadow-normalBias={VIEWER_SHADOW_NORMAL_BIAS}
      />
      <directionalLight
        position={[cx - m * 1.4, cy - m * 1.05, cz + m * 0.72]}
        intensity={VIEWER_FILL_LIGHT_INTENSITY * fillScale}
      />
    </>
  );
}
