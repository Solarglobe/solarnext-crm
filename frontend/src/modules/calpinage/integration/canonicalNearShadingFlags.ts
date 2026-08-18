/**
 * Feature flag **expérimental / opt-in** — near shading 3D TS (raycast triangles).
 * Désactivé par défaut. Si activé : near UI peut diverger du near backend (`nearShadingCore.cjs`).
 * Voir `shading/shadingGovernance.ts` et avertissements runtime dans `nearShadingWrapper`.
 *
 * Activé via `VITE_CANONICAL_3D_NEAR_SHADING=true` dans `.env.local`.
 * @see ../config/featureFlags.ts — registre central, flag `NEAR_SHADING_3D`.
 * @see ../config/README-FLAGS.md — instructions d'activation.
 */
import {
  CALPINAGE_FLAG_ENV_KEYS,
  resolveStrictBooleanEnvFlag,
  type StrictBooleanFeatureFlagResolution,
} from "../config/featureFlags";

let warnedMisconfigured = false;

export function getCanonicalNearShadingFlagResolution(): StrictBooleanFeatureFlagResolution {
  const resolution = resolveStrictBooleanEnvFlag(CALPINAGE_FLAG_ENV_KEYS.NEAR_SHADING_3D);
  if (
    resolution.state === "MISCONFIGURED" &&
    !warnedMisconfigured &&
    typeof console !== "undefined" &&
    console.warn
  ) {
    warnedMisconfigured = true;
    console.warn("[CALPINAGE_NEAR_SHADING_FLAG]", {
      state: resolution.state,
      envKey: resolution.envKey,
      raw: resolution.raw,
      diagnosticCode: resolution.diagnosticCode,
      message: resolution.message,
    });
  }
  return resolution;
}

export const CANONICAL_3D_NEAR_SHADING_ENABLED: boolean =
  getCanonicalNearShadingFlagResolution().state === "ENABLED";

/** Tests : réinitialise le warning once. @internal */
export function __resetCanonicalNearShadingFlagWarningForTests(): void {
  warnedMisconfigured = false;
}
