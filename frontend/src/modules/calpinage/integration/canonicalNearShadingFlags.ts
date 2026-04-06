/**
 * Feature flag **expérimental / opt-in** — near shading 3D TS (raycast triangles).
 * Désactivé par défaut. Si activé : near UI peut diverger du near backend (`nearShadingCore.cjs`).
 * Voir `shading/shadingGovernance.ts` et avertissements runtime dans `nearShadingWrapper`.
 */
export const CANONICAL_3D_NEAR_SHADING_ENABLED: boolean =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_CANONICAL_3D_NEAR_SHADING === "true";
