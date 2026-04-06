/**
 * Fallbacks BV alignés backend/services/pv/virtualBatteryLegacyDefaults.js
 * (même sémantique, pas d’import croisé TS/JS).
 */

export const VB_LEGACY_MYSMART_CONTRIBUTION_FIXED_EUR_PER_YEAR_HT = 9.6;
export const VB_LEGACY_MYSMART_CONTRIBUTION_PER_KVA_EUR_PER_YEAR_HT = 2.38;

export function vbLegacyMySmartAnnualContributionHt(meterKva: number): number {
  const kv = Number(meterKva);
  const k = Number.isFinite(kv) ? kv : 0;
  return (
    VB_LEGACY_MYSMART_CONTRIBUTION_FIXED_EUR_PER_YEAR_HT +
    VB_LEGACY_MYSMART_CONTRIBUTION_PER_KVA_EUR_PER_YEAR_HT * k
  );
}
