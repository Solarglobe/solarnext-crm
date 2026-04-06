/**
 * Gouvernance technique — shading SolarNext (alignée sur `backend/services/shading/shadingGovernance.js`).
 *
 * Hiérarchie :
 * - Officiel persisté / étude / PDF généré depuis serveur : backend (nearShadingCore + far + normalize).
 * - Officiel affichage / preview UI : même contrat `combined.totalLossPct` ; near UI via
 *   `computeNearShadingFrontend` uniquement.
 * - Expérimental : near canonical 3D TS si `VITE_CANONICAL_3D_NEAR_SHADING === "true"` — diagnostic
 *   et comparaison uniquement ; peut diverger du near backend tant que le flag est actif.
 *
 * Legacy : lecture `totalLossPct` racine autorisée seulement en secours (voir officialGlobalShadingLoss).
 */

export const OFFICIAL_GLOBAL_LOSS_CONTRACT = "shading.combined.totalLossPct" as const;

export const BACKEND_NEAR_ENGINE_ID = "nearShadingCore.cjs" as const;

export const FRONTEND_NEAR_LEGACY_ENGINE = "legacy_polygon" as const;

export const FRONTEND_EXPERIMENTAL_NEAR_CANONICAL_ID = "canonical_3d_ts_frontend" as const;

export const FRONTEND_NEAR_OFFICIAL_SELECTION_MODULE =
  "integration/nearShadingOfficialSelection.mergeOfficialNearShading" as const;

let _canonicalParityWarned = false;
let _experimentalNearInfoLogged = false;

function isDevBuild(): boolean {
  return typeof import.meta !== "undefined" && !import.meta.env?.PROD;
}

/**
 * Avertit une seule fois si le near canonical TS est activé : l’UI peut diverger du near backend.
 */
export function warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend(
  isCanonicalFlagEnabled: boolean
): void {
  if (!isCanonicalFlagEnabled || _canonicalParityWarned) return;
  if (!isDevBuild()) return;
  _canonicalParityWarned = true;
  if (typeof console !== "undefined" && console.warn) {
    console.warn(
      "[SHADING_GOVERNANCE] VITE_CANONICAL_3D_NEAR_SHADING actif : le near affiché peut diverger du near " +
        "backend (" +
        BACKEND_NEAR_ENGINE_ID +
        "). La perte globale persistée étude suit le recalcul serveur + combined.totalLossPct."
    );
  }
}

/**
 * Diagnostic sans réseau : à appeler quand on dispose déjà des deux valeurs (ex. après réponse API).
 */
export function diagnoseGlobalLossMismatch(
  backendOfficial: number | null | undefined,
  frontendDisplayed: number | null | undefined,
  tolerance = 0.5,
  context = ""
): { ok: boolean; delta?: number; skipped?: boolean } {
  if (backendOfficial == null || frontendDisplayed == null) {
    return { ok: true, skipped: true };
  }
  const a = Number(backendOfficial);
  const b = Number(frontendDisplayed);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: true, skipped: true };
  const delta = Math.abs(a - b);
  if (delta <= tolerance) return { ok: true };
  if (isDevBuild() && typeof console !== "undefined" && console.warn) {
    console.warn("[SHADING_GOVERNANCE] Écart perte globale (back vs front)", {
      backendOfficial: a,
      frontendDisplayed: b,
      delta,
      context,
    });
  }
  return { ok: false, delta };
}

/**
 * Trace unique en dev quand le near officiel UI est le pipeline expérimental (pas une erreur).
 */
export function logOnceIfUiNearUsedExperimentalCanonical(engine: string | undefined): void {
  if (engine !== "canonical_3d" || _experimentalNearInfoLogged) return;
  if (!isDevBuild()) return;
  _experimentalNearInfoLogged = true;
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "[SHADING_GOVERNANCE] Near UI = " +
        FRONTEND_EXPERIMENTAL_NEAR_CANONICAL_ID +
        " ; near étude serveur reste " +
        BACKEND_NEAR_ENGINE_ID +
        "."
    );
  }
}
