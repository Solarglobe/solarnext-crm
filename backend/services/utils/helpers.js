// services/utils/helpers.js
// ================================================================
// SMARTPITCH V3 — Fonctions utilitaires globales
// ================================================================

/**
 * Arrondit un nombre à n décimales
 * @param {number} value
 * @param {number} decimals
 */
export function round(value, decimals = 0) {
  if (isNaN(value)) return 0;
  const pow = Math.pow(10, decimals);
  return Math.round(value * pow) / pow;
}

/**
 * Formate un nombre avec des espaces (ex: 12 345)
 */
export function formatNumber(value, decimals = 0) {
  return round(value, decimals).toLocaleString("fr-FR");
}

/**
 * Calcule une moyenne à partir d'un tableau
 */
export function avg(array = []) {
  if (!array.length) return 0;
  return array.reduce((a, b) => a + b, 0) / array.length;
}

/**
 * Calcule une somme à partir d'un tableau
 */
export function sum(array = []) {
  if (!array.length) return 0;
  return array.reduce((a, b) => a + b, 0);
}

/**
 * Limite un nombre entre un min et un max
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
