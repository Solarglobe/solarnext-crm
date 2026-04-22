/**
 * Résolution unique de la puissance unitaire d'un panneau (Wc) — variantes legacy snake_case / camelCase.
 * Retourne null si non résolvable (pas de valeur par défaut ici).
 *
 * Ordre de lecture : power_wc → powerWc → power_w → powerWp
 */

/** Message d'erreur moteur — panneau obligatoire pour le calcul kWc / production. */
export const ENGINE_ERROR_PANEL_REQUIRED =
  "[ENGINE ERROR] Panel is required to compute production";

/**
 * @param {unknown} panel
 * @returns {number|null} Wc crédible (> 50) ou null
 */
export function resolvePanelPowerWc(panel) {
  if (!panel || typeof panel !== "object") return null;
  const keys = ["power_wc", "powerWc", "power_w", "powerWp"];
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(panel, k)) continue;
    const raw = panel[k];
    if (raw == null || raw === "") continue;
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n <= 50) continue;
    return n;
  }
  return null;
}

/**
 * kWc installée arrondie comme resolveKwcMono / scenarios (2 décimales « centi-kWc »).
 * @param {number} panelCount
 * @param {number} panelWc
 * @returns {number|null}
 */
export function computeInstalledKwcRounded2(panelCount, panelWc) {
  const n = Number(panelCount);
  const w = Number(panelWc);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 50) return null;
  return Math.round((n * w) / 1000 * 100) / 100;
}

/**
 * kWc pour affichage quote-prep (3 décimales).
 * @param {number} panelCount
 * @param {number} panelWc
 * @returns {number|null}
 */
export function computeInstalledKwcRounded3(panelCount, panelWc) {
  const n = Number(panelCount);
  const w = Number(panelWc);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 50) return null;
  return Math.round((n * w) / 1000 * 1000) / 1000;
}

/**
 * @param {number} storedKwc
 * @param {number} expectedKwc
 * @returns {boolean} true si stored est manifestement incohérent
 */
export function isInstalledKwcDivergent(storedKwc, expectedKwc) {
  if (!Number.isFinite(storedKwc) || !Number.isFinite(expectedKwc)) return true;
  const diff = Math.abs(storedKwc - expectedKwc);
  const tol = Math.max(0.05, Math.abs(expectedKwc) * 0.02);
  return diff > tol;
}
