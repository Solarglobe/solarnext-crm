import { Environment } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { Suspense, useLayoutEffect } from "react";
import { isCanonical3DEnabled } from "../featureFlags";
import type { ViewerQualityProfile } from "./viewerQualityProfile";

export function CanvasQualityApplier({
  profile,
  dpr,
}: {
  readonly profile: ViewerQualityProfile;
  readonly dpr: number;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    gl.setPixelRatio(dpr);
    gl.shadowMap.enabled = profile.shadows;
    gl.shadowMap.type = profile.shadowMapType;
    invalidate();
  }, [dpr, gl, invalidate, profile.shadowMapType, profile.shadows]);
  return null;
}

export function ViewerEnvironment({ profile }: { readonly profile: ViewerQualityProfile }) {
  if (!profile.environment) return null;
  return (
    <Suspense fallback={null}>
      <Environment
        files="/assets/hdri/overcast_sky_1k.hdr"
        background={false}
        environmentIntensity={profile.environmentIntensity}
      />
    </Suspense>
  );
}

export function ViewerPostProcessing({
  enabled,
  profile,
}: {
  readonly enabled: boolean;
  readonly profile: ViewerQualityProfile;
}) {
  if (!enabled || !profile.postprocessing) return null;
  const canonical = isCanonical3DEnabled();
  return (
    <EffectComposer multisampling={0}>
      {profile.smaa ? <SMAA /> : <></>}
      {canonical && profile.bloom ? (
        <Bloom
          intensity={0.35}
          luminanceThreshold={0.92}
          luminanceSmoothing={0.88}
          mipmapBlur
        />
      ) : <></>}
      {profile.vignette ? <Vignette offset={0.25} darkness={0.45} /> : <></>}
    </EffectComposer>
  );
}
