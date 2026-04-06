/**
 * Arrondi monétaire unique (euros, 2 décimales) — aligné sur le comportement historique
 * (Math.round(x * 100) / 100).
 */

/** Tolérance pour comparer des soldes après arrondi */
export const MONEY_EPSILON = 0.005;

/**
 * @param {unknown} n
 * @returns {number}
 */
export function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/**
 * Parse un nombre fini ; sinon 0.
 * @param {unknown} n
 * @returns {number}
 */
export function toFiniteNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Borne min / max.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 */
export function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Strictement positif (montants paiement, etc.).
 * @param {unknown} n
 * @returns {boolean}
 */
export function isStrictlyPositiveAmount(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}
