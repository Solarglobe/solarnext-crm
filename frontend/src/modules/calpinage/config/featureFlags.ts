/**
 * @module config/featureFlags
 * @description Point d'entrée unique des feature flags du module calpinage.
 *
 * Politique :
 * - Tous les flags sont lus via des variables d'environnement VITE_ (accessibles côté client).
 * - `isEnabled(flag)` est la seule API à utiliser dans les composants et services.
 * - NE PAS lire `import.meta.env.VITE_*` directement dans les composants — passer par ce module.
 * - Le flag CANONICAL_3D a une logique étendue (preview / window override) dans
 *   `../canonical3d/featureFlags.ts` qui importe depuis ce fichier.
 *
 * @see config/README-FLAGS.md pour la liste complète et les instructions d'activation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Identifiants canoniques des feature flags du module calpinage.
 * Ajouter un flag ici ET dans CALPINAGE_FLAG_ENV_KEYS.
 */
export type CalpinageFeatureFlag =
  | "CANONICAL_3D"
  | "NEAR_SHADING_3D"
  | "FAR_SHADING"
  | "AUTO_SHADING_ROWS"
  | "BIFACIAL";

// ---------------------------------------------------------------------------
// Mapping flag → clé VITE_
// ---------------------------------------------------------------------------

/**
 * Source de vérité unique des noms de variables d'environnement.
 * canonical3d/featureFlags.ts importe depuis ici pour éviter la duplication.
 */
export const CALPINAGE_FLAG_ENV_KEYS: Readonly<Record<CalpinageFeatureFlag, string>> = {
  /** Viewer 3D canonique (produit + preview dev). Logique étendue dans canonical3d/featureFlags.ts. */
  CANONICAL_3D: "VITE_CALPINAGE_CANONICAL_3D",
  /** Near shading raycast 3D TS (expérimental, peut diverger du near backend). */
  NEAR_SHADING_3D: "VITE_CANONICAL_3D_NEAR_SHADING",
  /** Far shading (masques lointains / horizon). */
  FAR_SHADING: "VITE_CALPINAGE_FAR_SHADING",
  /** Calcul automatique des rangées d'ombrage (espacement inter-rangée). */
  AUTO_SHADING_ROWS: "VITE_CALPINAGE_AUTO_SHADING_ROWS",
  /** Gain bifacial (face arrière des panneaux bifaciaux). */
  BIFACIAL: "VITE_CALPINAGE_BIFACIAL",
} as const;

// ---------------------------------------------------------------------------
// Helper bas niveau (réutilisable par canonical3d/featureFlags.ts)
// ---------------------------------------------------------------------------

/**
 * Lit la valeur brute d'une clé VITE_ depuis import.meta.env.
 * Retourne `undefined` si absente ou vide.
 *
 * Réutilisé par `canonical3d/featureFlags.ts` pour ses lectures d'env.
 */
export function resolveEnvFlag(envKey: string): string | undefined {
  try {
    const val = import.meta.env?.[envKey];
    if (val == null) return undefined;
    const s = String(val).trim();
    return s !== "" ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalise une valeur brute en boolean.
 * OFF : absent / vide / `0` / `false` / `off` / `no`
 * ON  : `true` / `1` / `yes` / `on` (insensible à la casse)
 * Toute autre valeur → OFF (sécurité par défaut).
 */
export function normalizeFlagValue(raw: string | undefined): boolean {
  if (raw == null) return false;
  const s = raw.toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

// ---------------------------------------------------------------------------
// API principale
// ---------------------------------------------------------------------------

/**
 * Retourne `true` si le flag est activé (ON) selon la variable d'environnement VITE_.
 *
 * Pour le flag `CANONICAL_3D`, cette fonction ne gère que la lecture booléenne simple.
 * Utiliser `getCanonical3DFlagResolution()` depuis `canonical3d/featureFlags.ts` si
 * vous avez besoin du mode (off / preview_dev / product) ou de l'override window.
 *
 * @example
 * ```ts
 * import { isEnabled } from "../config/featureFlags";
 *
 * if (isEnabled("NEAR_SHADING_3D")) {
 *   // activer le pipeline near shading 3D TS
 * }
 * ```
 */
export function isEnabled(flag: CalpinageFeatureFlag): boolean {
  const key = CALPINAGE_FLAG_ENV_KEYS[flag];
  return normalizeFlagValue(resolveEnvFlag(key));
}
