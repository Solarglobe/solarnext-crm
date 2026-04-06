/**
 * Calcul coût annuel batterie virtuelle — moteur CALC uniquement.
 * Aucune dépendance DB, aucun pricingService, aucune valeur hardcodée.
 * Config = ctx.virtual_battery_input (injectée depuis le devis).
 */

/**
 * Calcule le coût annuel batterie virtuelle à partir de la config injectée (devis).
 *
 * @param {{
 *   annual_surplus_kwh: number,
 *   annual_import_kwh: number,
 *   config: { enabled?: boolean, annual_subscription_ttc?: number, cost_per_kwh_storage?: number, fee_fixed?: number, vat_rate?: number, estimated_savings_annual?: number }
 * }} input
 * @returns {{ ok: boolean, reason?: string, annual_cost_ttc?: number, annual_cost_ht?: number, net_gain_annual?: number, detail?: object }}
 */
export function computeVirtualBatteryQuote({ annual_surplus_kwh, annual_import_kwh, config }) {
  if (!config || config.enabled !== true) {
    return { ok: false, reason: "NO_VIRTUAL_BATTERY" };
  }

  const sub = config.annual_subscription_ttc;
  if (sub == null || !Number.isFinite(Number(sub)) || Number(sub) < 0) {
    return { ok: false, reason: "MISSING_SUBSCRIPTION" };
  }
  const annual_subscription_ttc = Number(sub);

  const surplus = annual_surplus_kwh != null && Number.isFinite(Number(annual_surplus_kwh)) ? Number(annual_surplus_kwh) : 0;
  if (surplus < 0) {
    return { ok: false, reason: "INVALID_SURPLUS" };
  }

  let cost_per_kwh_storage = 0;
  if (config.cost_per_kwh_storage != null) {
    const v = Number(config.cost_per_kwh_storage);
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, reason: "INVALID_COST_PER_KWH_STORAGE" };
    }
    cost_per_kwh_storage = v;
  }

  let fee_fixed = 0;
  if (config.fee_fixed != null) {
    const v = Number(config.fee_fixed);
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, reason: "INVALID_FEE_FIXED" };
    }
    fee_fixed = v;
  }

  const annualCostTtc = Math.round((annual_subscription_ttc + surplus * cost_per_kwh_storage + fee_fixed) * 100) / 100;

  let annualCostHt = null;
  if (config.vat_rate != null && Number.isFinite(Number(config.vat_rate))) {
    const vat = Number(config.vat_rate);
    if (vat >= 0 && vat <= 1) {
      annualCostHt = Math.round((annualCostTtc / (1 + vat)) * 100) / 100;
    }
  }

  let estimatedSavings = 0;
  if (config.estimated_savings_annual != null && Number.isFinite(Number(config.estimated_savings_annual))) {
    estimatedSavings = Number(config.estimated_savings_annual);
  }
  const net_gain_annual = Math.round((estimatedSavings - annualCostTtc) * 100) / 100;

  return {
    ok: true,
    annual_cost_ttc: annualCostTtc,
    annual_cost_ht: annualCostHt,
    net_gain_annual,
    detail: {
      annual_subscription_ttc,
      cost_per_kwh_storage,
      fee_fixed,
      surplus_kwh: surplus,
      estimated_savings_annual: estimatedSavings,
    },
  };
}
