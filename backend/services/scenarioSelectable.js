/**
 * Phase 2 — Sélectionnabilité d'un scénario scenarios_v2 pour la sélection / l'export PDF.
 *
 * Source UNIQUE de vérité partagée par generatePdfFromScenario.controller.js et
 * selectScenario.controller.js (gardes harmonisées).
 *
 * Bloque UNIQUEMENT quand les données nécessaires sont réellement absentes / invalides :
 *   - scénario absent (null / undefined / non-objet)                     → SCENARIO_ABSENT
 *   - scénario ignoré au calcul (_skipped === true OU energy_basis="skipped") → SCENARIO_SKIPPED
 *   - finance non calculée : TOUS les indicateurs sont null/undefined/NaN/absents → SCENARIO_INCOMPLETE
 *
 * Ne bloque JAMAIS un scénario économiquement mauvais : une économie nulle (0),
 * négative, ou un ROI non rentable mais calculé restent des valeurs FINIES donc VALIDES.
 * BASE (« sans batterie ») reste sélectionnable dès qu'il est présent et non ignoré.
 *
 * Lecture seule — aucun calcul moteur ni financier ici.
 */

const FINANCE_INDICATOR_KEYS = [
  "economie_year_1",
  "economie_total",
  "total_savings_25y",
  "roi_years",
  "irr_pct",
  "tri",
];

/**
 * Vrai si la valeur est réellement absente ou invalide : null, undefined ou NaN.
 * 0 et les valeurs négatives sont des nombres FINIS → considérés comme présents (valides).
 * @param {*} v
 * @returns {boolean}
 */
function isMissingOrInvalid(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  return false;
}

export const SCENARIO_SELECTABLE_MESSAGES = {
  SCENARIO_ABSENT:
    "Ce scénario n'existe pas dans cette étude (actif non sélectionné).",
  SCENARIO_SKIPPED:
    "Ce scénario a été ignoré au calcul (actif choisi mais non simulé) — il ne peut pas être exporté.",
  SCENARIO_INCOMPLETE:
    "Ce scénario est incomplet (données de calcul manquantes) — il ne peut pas être exporté.",
};

/**
 * @param {object|null|undefined} scenario - objet scenarios_v2 (null/undefined si absent)
 * @param {string} scenarioId - "BASE" | "BATTERY_PHYSICAL" | "BATTERY_VIRTUAL" | "BATTERY_HYBRID"
 * @returns {{ selectable: boolean, reason?: "SCENARIO_ABSENT"|"SCENARIO_SKIPPED"|"SCENARIO_INCOMPLETE" }}
 */
export function evaluateScenarioSelectable(scenario, scenarioId) {
  if (scenario === null || scenario === undefined || typeof scenario !== "object") {
    return { selectable: false, reason: "SCENARIO_ABSENT" };
  }
  // Ignoré au calcul : signal fiable côté scenarios_v2 (energy_basis="skipped"),
  // + flag brut _skipped en secours.
  if (scenario._skipped === true || scenario.energy_basis === "skipped") {
    return { selectable: false, reason: "SCENARIO_SKIPPED" };
  }
  // BASE reste toujours sélectionnable s'il est présent et non ignoré.
  if (scenarioId === "BASE") {
    return { selectable: true };
  }
  const finance =
    scenario.finance && typeof scenario.finance === "object" ? scenario.finance : {};
  const anyFinanceComputed = FINANCE_INDICATOR_KEYS.some(
    (k) => !isMissingOrInvalid(finance[k])
  );
  if (!anyFinanceComputed) {
    return { selectable: false, reason: "SCENARIO_INCOMPLETE" };
  }
  return { selectable: true };
}
