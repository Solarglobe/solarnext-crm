/**
 * Formules KPI dashboard — fonctions pures (sans I/O), testables.
 * Alignées sur dashboardOverview.service.js
 */

export function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Taux en % : part / total × 100, arrondi à 2 décimales.
 * Garde-fou division par zéro et valeurs non finies.
 */
export function ratePercent(part, total) {
  const p = num(part);
  const t = num(total);
  if (t <= 0) return 0;
  const r = (p / t) * 100;
  if (!Number.isFinite(r)) return 0;
  return Math.round(r * 100) / 100;
}

/** Badge couverture marge fiable (seuils métier) */
export function reliabilityCoverageTier(coveragePct) {
  const p = num(coveragePct);
  if (p >= 90) return "high";
  if (p >= 60) return "medium";
  return "low";
}

/** Montant TTC/HT moyen ou null si dénominateur nul */
export function avgMoneyOrNull(totalAmount, count) {
  const t = num(totalAmount);
  const c = num(count);
  if (c <= 0) return null;
  const a = t / c;
  if (!Number.isFinite(a)) return null;
  return Math.round(a * 100) / 100;
}

/** Arrondi monétaire 2 décimales, jamais NaN/Infinity */
export function roundMoney2(x) {
  const v = num(x);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Part d’un sous-ensemble dans un total (ex. marge % / CA HT).
 * Retour 0 si total ≤ 0 ou résultat non fini.
 */
export function ratioPercent(part, total) {
  const p = num(part);
  const t = num(total);
  if (t <= 0) return 0;
  const r = (p / t) * 100;
  if (!Number.isFinite(r)) return 0;
  return Math.round(r * 100) / 100;
}
