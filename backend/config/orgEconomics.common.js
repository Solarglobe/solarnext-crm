/**
 * Unification progressive — `settings_json.economics`
 * ------------------------------------------------------------
 * Liste unique des clés numériques reconnues par le backend (admin + org).
 * La validation / le pick partagés évitent la dérive entre routes ; les valeurs
 * par défaut « moteur » (finance / resolve) sont exportées séparément des
 * défauts d’UI admin (`admin.org.settings.controller.js`).
 *
 * RÉFÉRENCES TARIFAIRES (à vérifier à chaque arrêté CRE) :
 *   price_eur_kwh      : TRV EDF option base — référence 2023-S1 (0,1952 €/kWh HT estimé).
 *                        Mettre à jour depuis https://www.cre.fr chaque T1.
 *   oa_rate_lt_9       : Arrêté S24 — autoconsommation individuelle avec vente du surplus,
 *                        tranche 3-9 kWc, T4 2024. Source : arrêté du 11 juillet 2024.
 *   oa_rate_gte_9      : Arrêté S24 — tranche 9-36 kWc, T4 2024.
 *   elec_growth_pct    : Fallback moteur = 5 %/an. Défaut UI admin = 4 %/an (admin.org.settings.controller.js).
 *                        Écart volontaire (choix produit). Configurable par organisation.
 */

/** @type {readonly string[]} */
export const ORG_ECONOMICS_NUMERIC_KEYS = Object.freeze([
  "price_eur_kwh",
  "elec_growth_pct",
  "pv_degradation_pct",
  "horizon_years",
  "oa_rate_lt_9",
  "oa_rate_gte_9",
  "prime_lt9",
  "prime_gte9",
  "maintenance_pct",
  "onduleur_year",
  "onduleur_cost_pct",
  "battery_degradation_pct",
]);

export const ORG_ECONOMICS_NUMERIC_KEY_SET = new Set(ORG_ECONOMICS_NUMERIC_KEYS);

/**
 * Défauts alignés sur `economicsResolve.service.js` (hypothèses moteur / finance).
 * Toute nouvelle clé « moteur » doit exister ici et dans ORG_ECONOMICS_NUMERIC_KEYS.
 *
 * MISE À JOUR OA S24 (arrêté du 11 juillet 2024, applicable T4 2024 / S25) :
 *   oa_rate_lt_9  : 0.0762 €/kWh (tranche 3-9 kWc)  — était 0.04 (S16, périmé)
 *   oa_rate_gte_9 : 0.0606 €/kWh (tranche 9-36 kWc) — était 0.0617 (S21)
 * Note : pour les installations < 3 kWc le taux S24 est ~0.1305 €/kWh.
 *   À affiner si un bracket oa_rate_lt_3 est ajouté ultérieurement.
 */
export const ORG_ECONOMICS_ENGINE_DEFAULTS = Object.freeze({
  price_eur_kwh: 0.1952,        // TRV EDF option base 2023-S1 — à mettre à jour T1 chaque année
  elec_growth_pct: 5,           // Fallback moteur — configurable org (défaut UI admin = 4)
  pv_degradation_pct: 0.5,
  oa_rate_lt_9: 0.0762,         // S24 — 3-9 kWc (mis à jour depuis 0.04 S16)
  oa_rate_gte_9: 0.0606,        // S24 — 9-36 kWc (mis à jour depuis 0.0617 S21)
  prime_lt9: 80,
  prime_gte9: 180,
  horizon_years: 25,
  maintenance_pct: 0,
  onduleur_year: 15,
  onduleur_cost_pct: 12,
  battery_degradation_pct: 2,
});

/**
 * Extrait un patch economics { clé: number } depuis un objet client.
 * Clés inconnues : ignorées ; callback optionnel (ex. log deprecated).
 * @param {unknown} econPatch
 * @param {{ onUnknownKey?: (key: string) => void }} [opts]
 * @returns {Record<string, number> | null}
 */
export function pickOrgEconomicsNumericPatch(econPatch, opts = {}) {
  const { onUnknownKey } = opts;
  if (!econPatch || typeof econPatch !== "object" || Array.isArray(econPatch)) return null;
  const out = {};
  for (const key of Object.keys(econPatch)) {
    if (!ORG_ECONOMICS_NUMERIC_KEY_SET.has(key)) {
      onUnknownKey?.(key);
      continue;
    }
    const val = econPatch[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      out[key] = val;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validation stricte pour merge economics (ex. PUT /api/organizations/settings) :
 * uniquement des clés autorisées, toutes numériques et >= 0.
 * @param {unknown} economicsPatch
 * @returns {{ skip: true } | { valid: false, error: string } | { valid: true, economics: Record<string, number> }}
 */
export function validateOrgEconomicsPatchStrict(economicsPatch) {
  if (economicsPatch === undefined) return { skip: true };
  if (economicsPatch == null || typeof economicsPatch !== "object" || Array.isArray(economicsPatch)) {
    return { valid: false, error: "economics doit être un objet" };
  }
  const e = economicsPatch;
  const out = {};
  for (const key of Object.keys(e)) {
    if (!ORG_ECONOMICS_NUMERIC_KEY_SET.has(key)) {
      return { valid: false, error: `Champ inconnu: ${key}` };
    }
    const val = e[key];
    if (typeof val !== "number") {
      return { valid: false, error: `Champ ${key} doit être numérique` };
    }
    if (val < 0) {
      return { valid: false, error: `Champ ${key} doit être >= 0` };
    }
    out[key] = val;
  }
  return { valid: true, economics: out };
}
