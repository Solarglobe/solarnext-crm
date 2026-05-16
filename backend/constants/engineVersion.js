/**
 * ENGINE_VERSION — Constante versionnée du moteur de calcul Smartpitch/SolarNext.
 *
 * Format : "calc-vYYYY-MM" — mois de la dernière modification significative
 * du moteur (algorithme, formules financières, mapping scénarios).
 *
 * Règle : incrémenter cette constante à chaque modification du moteur qui
 * pourrait produire des résultats différents à partir des mêmes inputs.
 * Cela permet de détecter, dans financial_scenarios, les enregistrements
 * calculés avec une version antérieure du moteur.
 *
 * Utilisé par : financialScenarios.service.js → colonne engine_version.
 */
export const ENGINE_VERSION = "calc-v2026-05";
