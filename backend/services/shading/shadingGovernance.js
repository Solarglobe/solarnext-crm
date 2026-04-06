/**
 * Gouvernance technique — shading SolarNext (autorité, pipelines, anti-dérive).
 *
 * Règles produit (à ne pas court-circuiter) :
 * - Vérité globale exposée : `shading.combined.totalLossPct` (voir officialShadingTruth.js).
 * - Persistance étude / devis / recalcul serveur : backend = autorité au moment du build
 *   (`calpinageShading.service` + `normalizeCalpinageShading` + payload).
 * - Near côté serveur : uniquement `nearShadingCore.cjs` (Node) — pas le pipeline TS « canonical 3D » du front.
 * - Near côté UI : `nearShadingWrapper` → `mergeOfficialNearShading` ; le canonical 3D est opt-in
 *   (`VITE_CANONICAL_3D_NEAR_SHADING`) et peut diverger du near backend tant que ce flag est actif.
 *
 * Ce module ne modifie aucun calcul : constantes + diagnostic optionnel uniquement.
 */

export const OFFICIAL_GLOBAL_LOSS_CONTRACT = "shading.combined.totalLossPct";

/** Identifiant documentaire du moteur near serveur (aligné imports calpinageShading.service). */
export const BACKEND_NEAR_ENGINE_ID = "nearShadingCore.cjs";

/** Pipeline TS opt-in côté navigateur uniquement — ne pas confondre avec le near serveur. */
export const FRONTEND_EXPERIMENTAL_NEAR_CANONICAL_ID = "canonical_3d_ts_frontend";

/**
 * Point d’entrée unique documenté pour la sélection near « produit UI » (legacy vs canonical).
 * Toute autre voie ne doit pas remplacer totalLossPct near sans passer par ici.
 */
export const FRONTEND_NEAR_OFFICIAL_SELECTION_MODULE =
  "integration/nearShadingOfficialSelection.mergeOfficialNearShading";

/**
 * @param {number|null|undefined} backendOfficial
 * @param {number|null|undefined} frontendDisplayed
 * @param {number} [tolerance=0.5]
 * @param {string} [context=""]
 * @returns {{ ok: boolean, delta?: number, skipped?: boolean }}
 */
export function diagnoseGlobalLossMismatchBackend(
  backendOfficial,
  frontendDisplayed,
  tolerance = 0.5,
  context = ""
) {
  if (backendOfficial == null || frontendDisplayed == null) {
    return { ok: true, skipped: true };
  }
  const a = Number(backendOfficial);
  const b = Number(frontendDisplayed);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: true, skipped: true };
  const delta = Math.abs(a - b);
  if (delta <= tolerance) return { ok: true };
  if (process.env.NODE_ENV !== "production" && typeof console !== "undefined" && console.warn) {
    console.warn("[SHADING_GOVERNANCE] Écart perte globale officielle (back vs front)", {
      backendOfficial: a,
      frontendDisplayed: b,
      delta,
      context,
    });
  }
  return { ok: false, delta };
}
