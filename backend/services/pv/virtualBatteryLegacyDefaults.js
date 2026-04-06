/**
 * Fallbacks tarifaires batterie virtuelle (hors grille org exploitable).
 * Ne pas disperser ces valeurs : tout changement doit être reflété dans
 * frontend/src/constants/virtualBatteryLegacyDefaults.ts
 */

export const VB_LEGACY_MYSMART_CONTRIBUTION_FIXED_EUR_PER_YEAR_HT = 9.6;
export const VB_LEGACY_MYSMART_CONTRIBUTION_PER_KVA_EUR_PER_YEAR_HT = 2.38;

/** Contribution autoproducteur MySmart historique (€/an HT) si pas de contributionRule admin. */
export function vbLegacyMySmartAnnualContributionHt(meterKva) {
  const kv = Number(meterKva);
  const k = Number.isFinite(kv) ? kv : 0;
  return (
    VB_LEGACY_MYSMART_CONTRIBUTION_FIXED_EUR_PER_YEAR_HT +
    VB_LEGACY_MYSMART_CONTRIBUTION_PER_KVA_EUR_PER_YEAR_HT * k
  );
}

/** Urban / MyBattery legacy P2 : contribution €/an HT si ligne grille absente. */
export const VB_LEGACY_DEFAULT_AUTOPROD_CONTRIBUTION_EUR_PER_YEAR_HT = 9.6;
export const VB_LEGACY_MYBATTERY_ACTIVATION_FEE_HT = 232.5;

/** MyBattery BASE : déstockage €/kWh HT (legacy P2). */
export const VB_LEGACY_MYBATTERY_BASE_DISCHARGE_EUR_PER_KWH_HT = 0.07925;
/** MyBattery HPHC ventilé (legacy P2). */
export const VB_LEGACY_MYBATTERY_HPHC_HP_DISCHARGE_EUR_PER_KWH_HT = 0.08025;
export const VB_LEGACY_MYBATTERY_HPHC_HC_DISCHARGE_EUR_PER_KWH_HT = 0.06585;

/** Urban BASE : composante réseau €/kWh HT (legacy + virtualBatteryTariffs2026). */
export const VB_LEGACY_URBAN_BASE_GRID_FEE_EUR_PER_KWH_HT = 0.0484;

/** Urban HPHC : totaux énergie + réseau €/kWh HT (legacy P2). */
export const VB_LEGACY_URBAN_HPHC_HP_DISCHARGE_SUM_HT = 0.1412 + 0.0494;
export const VB_LEGACY_URBAN_HPHC_HC_DISCHARGE_SUM_HT = 0.1007 + 0.035;
