/**
 * Définitions officielles KPI énergie (audit moteur) — fonctions pures testables.
 */

function clampPct(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Math.max(0, Math.min(100, Number(x)));
}

function round2(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Math.round(Number(x) * 100) / 100;
}

/**
 * @param {{ production_kwh: number, total_pv_used_on_site_kwh: number }} p
 * @returns {number | null} pourcentage 0–100
 */
export function computePvSelfConsumptionPct(p) {
  const prod = Number(p?.production_kwh);
  const used = Number(p?.total_pv_used_on_site_kwh);
  if (!Number.isFinite(prod) || prod <= 0 || !Number.isFinite(used) || used < 0) return null;
  return round2(clampPct((used / prod) * 100));
}

/**
 * Autonomie site : (conso − import réseau) / conso
 */
export function computeSiteAutonomyPct(p) {
  const conso = Number(p?.consumption_kwh);
  const imp = Number(p?.grid_import_kwh);
  if (!Number.isFinite(conso) || conso <= 0 || !Number.isFinite(imp) || imp < 0) return null;
  return round2(clampPct(((conso - imp) / conso) * 100));
}

/**
 * Couverture solaire : énergie solaire utile / consommation
 */
export function computeSolarCoveragePct(p) {
  const conso = Number(p?.consumption_kwh);
  const used = Number(p?.total_pv_used_on_site_kwh);
  if (!Number.isFinite(conso) || conso <= 0 || !Number.isFinite(used) || used < 0) return null;
  return round2(clampPct((used / conso) * 100));
}

/**
 * Taux d'injection : surplus / production
 */
export function computeExportPct(p) {
  const prod = Number(p?.production_kwh);
  const sur = Number(p?.surplus_kwh);
  if (!Number.isFinite(prod) || prod <= 0 || !Number.isFinite(sur) || sur < 0) return null;
  return round2(clampPct((sur / prod) * 100));
}
