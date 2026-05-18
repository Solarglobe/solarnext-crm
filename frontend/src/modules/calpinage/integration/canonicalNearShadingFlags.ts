/**
 * Feature flag **expérimental / opt-in** — near shading 3D TS (raycast triangles).
 * Désactivé par défaut. Si activé : near UI peut diverger du near backend (`nearShadingCore.cjs`).
 * Voir `shading/shadingGovernance.ts` et avertissements runtime dans `nearShadingWrapper`.
 *
 * Activé via `VITE_CANONICAL_3D_NEAR_SHADING=true` dans `.env.local`.
 * @see ../config/featureFlags.ts — registre central, flag `NEAR_SHADING_3D`.
 * @see ../config/README-FLAGS.md — instructions d'activation.
 */
import { isEnabled } from "../config/featureFlags";

export const CANONICAL_3D_NEAR_SHADING_ENABLED: boolean = isEnabled("NEAR_SHADING_3D");
