/**
 * Construction du payload de réponse final du moteur de calcul SmartPitch.
 *
 * Strangler Fig — Phase 1 extraction.
 * Fonction pure : aucun effet de bord, pas d'accès DB, pas d'appel HTTP.
 * Testable unitairement sans mock de l'environnement HTTP.
 *
 * @module calcResponseBuilder
 */

import { mapScenarioToV2 } from "../scenarioV2Mapper.service.js";
import { buildCalculationConfidenceFromCalc } from "../calculationConfidence.service.js";

// ---------------------------------------------------------------------------
// Types (JSDoc uniquement — pas de TypeScript dans ce module)
// ---------------------------------------------------------------------------
/**
 * @typedef {Object} BuildCalcResponseParams
 * @property {object}  ctx            - Contexte moteur (meta, site, house, pv, settings, productionMultiPan, …)
 * @property {object}  form           - Formulaire d'entrée original (pour erpnext_lead_id)
 * @property {object}  conso          - Résultat consommation (hourly, annual_kwh, …)
 * @property {number}  annualExact    - Consommation annuelle exacte = Σ(hourly), en kWh
 * @property {object}  pilotage       - Résultat pilotage (propriété .stats utilisée)
 * @property {object}  scenariosFinal - Map des scénarios finaux { BASE, BATTERY_PHYSICAL, … }
 * @property {object}  finance        - Résultat du moteur finance
 * @property {object}  impact         - Résultat impact CO₂
 * @returns  {object}                 ctxFinal — payload JSON prêt pour res.json()
 */

/**
 * Résout le bloc `production` à partir du contexte moteur.
 * Priorité : productionMultiPan > pv.monthly/pv.total_kwh > null.
 *
 * @param {object} ctx - Contexte moteur
 * @returns {{ byPan: Array, annualKwh: number, monthlyKwh: Array } | null}
 */
export function resolveProductionBlock(ctx) {
  if (ctx.productionMultiPan) {
    return {
      byPan: ctx.productionMultiPan.byPan,
      annualKwh: ctx.productionMultiPan.annualKwh,
      monthlyKwh: ctx.productionMultiPan.monthlyKwh,
    };
  }
  if (ctx.pv?.monthly && ctx.pv?.total_kwh != null) {
    return {
      byPan: [],
      annualKwh: ctx.pv.total_kwh,
      monthlyKwh: Array.isArray(ctx.pv.monthly) ? ctx.pv.monthly : [],
    };
  }
  return null;
}

/**
 * Construit le payload de réponse final à partir des résultats du moteur de calcul.
 *
 * NE PAS appeler `res.json()` ici — le controller reste responsable du transport HTTP.
 *
 * @param {BuildCalcResponseParams} params
 * @returns {object} ctxFinal
 */
export function buildCalcResponse({ ctx, form, conso, annualExact, pilotage, scenariosFinal, finance, impact }) {
  const production = resolveProductionBlock(ctx);
  const ctxWithProduction = { ...ctx, production };

  const scenariosV2 = Object.values(scenariosFinal)
    .filter((sc) => sc._v2 === true)
    .map((sc) => mapScenarioToV2(sc, ctxWithProduction));

  return {
    meta: ctx.meta,
    site: ctx.site,
    erpnext_lead_id: form?.erpnext_lead_id || null,
    house: {
      ...ctx.house,
      conso_annuelle_kwh: annualExact,
    },
    conso: {
      ...conso,
      annual_kwh: annualExact,
    },
    pv: ctx.pv,
    production,
    pilotage: pilotage.stats,
    scenarios: scenariosFinal,
    scenarios_v2: scenariosV2,
    finance,
    impact,
    settings: ctx.settings,
    calculation_confidence: buildCalculationConfidenceFromCalc(ctx, scenariosFinal),
  };
}
