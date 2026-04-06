// ======================================================================
// SMARTPITCH V10 — IMPACT ENVIRONNEMENTAL (VERSION SOLARGLOBE PRO 2025)
// ======================================================================
// Corrige :
// - lecture des données auto_kwh / surplus_kwh depuis buildScenario()
// - compatibilité totale avec scenarioService.js V-LIGHT
// - impact CO₂ réaliste sur 25 ans
// - équivalents pédagogiques (arbres, km voiture, smartphone, foyers…)
// ======================================================================

import { round } from "./utils/helpers.js";
import {
  mergeOrgEconomicsPartial,
  overlayFormEconomics,
  DEFAULT_ECONOMICS_FALLBACK,
} from "./economicsResolve.service.js";

// ======================================================================
// FACTEURS ENVIRONNEMENTAUX (ADEME 2025)
// ======================================================================
const FACTOR_CO2_AUTO = 0.081;      // kg CO₂/kWh autoconsommé
const FACTOR_CO2_SURPLUS = 0.048;   // kg CO₂/kWh injecté
const TREE_CO2 = 25;                // kg/an/arbre
const CAR_CO2_PER_KM = 0.192;       // kg CO₂/km
const SMARTPHONE_KWH = 0.0035;      // kWh par charge
const FOYER_CO2_YEAR = 950;         // kg CO₂/an foyer FR

// ======================================================================
// IMPACT ENVIRONNEMENTAL
// ======================================================================
export function computeImpact(ctx, scenarios) {

  const econMerged = overlayFormEconomics(
    mergeOrgEconomicsPartial(ctx.settings?.economics),
    ctx.form?.economics
  );
  const horizon = Number(
    ctx.finance?.horizon_years ??
      econMerged.horizon_years ??
      DEFAULT_ECONOMICS_FALLBACK.horizon_years
  );

  const par_scenario = {};

  // ====================================================================
  // 1. IMPACT PAR SCÉNARIO
  // ====================================================================
  for (const [id, sc] of Object.entries(scenarios)) {

    // 🔥 VERSION CORRIGÉE
    // scenarioService fournit : sc.auto_kwh + sc.surplus_kwh
    const auto = Number(sc.auto_kwh ?? sc.annual?.auto_kwh ?? 0) || 0;
    const surplus = Number(sc.surplus_kwh ?? sc.annual?.surplus_kwh ?? 0) || 0;

    // CO₂ évité sur toute la durée
    const co2_auto = auto * FACTOR_CO2_AUTO * horizon;
    const co2_surplus = surplus * FACTOR_CO2_SURPLUS * horizon;
    const co2_total = co2_auto + co2_surplus;

    // Équivalences pédagogiques
    const arbres_eq = Math.round(co2_total / TREE_CO2);
    const km_eq = Math.round(co2_total / CAR_CO2_PER_KM);
    const foyers_eq = round(co2_total / FOYER_CO2_YEAR, 2);
    const smartphone_charges = Math.round((auto + surplus) * horizon / SMARTPHONE_KWH);
    const trajets_paris_marseille = Math.round(km_eq / 775);

    par_scenario[id] = {
      co2_kg_25a: round(co2_total, 0),
      arbres_eq,
      km_voiture_eq: km_eq,
      foyers_eq,
      smartphone_charges,
      trajets_paris_marseille,
      details: {
        auto_kwh: auto,
        surplus_kwh: surplus,
        co2_auto: round(co2_auto, 0),
        co2_surplus: round(co2_surplus, 0),
        facteur_auto: FACTOR_CO2_AUTO,
        facteur_surplus: FACTOR_CO2_SURPLUS
      }
    };
  }

  // ====================================================================
  // 2. SYNTHÈSE GLOBALE (MOYENNE DES SCÉNARIOS)
  // ====================================================================
  const values = Object.values(par_scenario);

  const global =
    values.length > 0
      ? {
          co2_kg_25a: round(avg(values.map(v => v.co2_kg_25a)), 0),
          arbres_eq: round(avg(values.map(v => v.arbres_eq)), 0),
          km_voiture_eq: round(avg(values.map(v => v.km_voiture_eq)), 0),
          foyers_eq: round(avg(values.map(v => v.foyers_eq)), 2)
        }
      : null;

  // ====================================================================
  return {
    horizon,
    global,
    par_scenario
  };
}

// ======================================================================
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
