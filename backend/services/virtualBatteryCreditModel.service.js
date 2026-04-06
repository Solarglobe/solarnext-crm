/**
 * Batterie virtuelle "crédit kWh" — modèle métier pro PV.
 * Pas de revente OA : surplus crédité, crédit compense les imports ultérieurs.
 * Import "facturé" = import physique − crédit utilisé.
 * Modèle mensuel (12 mois).
 */

/**
 * Applique le modèle batterie virtuelle crédit kWh sur une base mensuelle BASE.
 *
 * @param {{
 *   baseMonthly: Array<{ prod: number, conso: number, auto: number, surplus: number, import: number }>,
 *   config?: { credit_ratio?: number, credit_cap_kwh?: number, cost_basis?: 'credited'|'used' },
 *   economics?: { price_eur_kwh?: number }
 * }} input
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   billable_import_kwh: number,
 *   credited_kwh: number,
 *   used_credit_kwh: number,
 *   remaining_credit_kwh: number,
 *   billable_monthly: Array<{ billable_import: number, credited: number, used_credit: number, bank_end: number, lost_kwh?: number }>,
 *   annual_cost_breakdown?: object
 * }}
 */
export function applyVirtualBatteryCredit({ baseMonthly, config = {}, economics = {} }) {
  if (!Array.isArray(baseMonthly) || baseMonthly.length !== 12) {
    return { ok: false, reason: "INVALID_BASE_MONTHLY" };
  }

  const creditRatio = config.credit_ratio != null && Number.isFinite(Number(config.credit_ratio))
    ? Math.max(0, Math.min(1, Number(config.credit_ratio)))
    : 1.0;
  const creditCapKwh = config.credit_cap_kwh != null && Number.isFinite(Number(config.credit_cap_kwh))
    ? Math.max(0, Number(config.credit_cap_kwh))
    : null; // pas de plafond

  let creditBankKwh = 0;
  let totalCredited = 0;
  let totalUsedCredit = 0;
  let totalBillableImport = 0;
  let totalLost = 0;
  const billableMonthly = [];

  for (let m = 0; m < 12; m++) {
    const month = baseMonthly[m];
    const surplus = Number(month?.surplus ?? 0) || 0;
    const importM = Number(month?.import ?? 0) || 0;

    const creditedKwhM = surplus * creditRatio;
    creditBankKwh += creditedKwhM;
    totalCredited += creditedKwhM;

    // Plafond de crédit : excédent = perdu (pas vendu)
    let lostKwhM = 0;
    if (creditCapKwh != null && creditCapKwh > 0 && creditBankKwh > creditCapKwh) {
      lostKwhM = creditBankKwh - creditCapKwh;
      creditBankKwh = creditCapKwh;
      totalLost += lostKwhM;
    }

    const usedCreditKwhM = Math.min(creditBankKwh, importM);
    creditBankKwh -= usedCreditKwhM;
    totalUsedCredit += usedCreditKwhM;

    const billableImportM = Math.max(0, importM - usedCreditKwhM);
    totalBillableImport += billableImportM;

    billableMonthly.push({
      billable_import: Math.round(billableImportM * 100) / 100,
      credited: Math.round(creditedKwhM * 100) / 100,
      used_credit: Math.round(usedCreditKwhM * 100) / 100,
      bank_end: Math.round(creditBankKwh * 100) / 100,
      ...(lostKwhM > 0 ? { lost_kwh: Math.round(lostKwhM * 100) / 100 } : {}),
    });
  }

  const remainingCreditKwh = Math.round(creditBankKwh * 100) / 100;

  return {
    ok: true,
    billable_import_kwh: Math.round(totalBillableImport * 100) / 100,
    credited_kwh: Math.round(totalCredited * 100) / 100,
    used_credit_kwh: Math.round(totalUsedCredit * 100) / 100,
    remaining_credit_kwh: remainingCreditKwh,
    billable_monthly: billableMonthly,
    lost_kwh: totalLost > 0 ? Math.round(totalLost * 100) / 100 : 0,
  };
}

/**
 * Calcule le coût annuel batterie virtuelle (abonnement + frais + coût/kWh crédité ou utilisé).
 *
 * @param {{
 *   creditResult: { credited_kwh: number, used_credit_kwh: number },
 *   config: { annual_subscription_ttc?: number, fee_fixed?: number, cost_per_kwh_storage?: number, cost_basis?: 'credited'|'used' }
 * }} input
 */
export function computeVirtualBatteryAnnualCost({ creditResult, config }) {
  const sub = config?.annual_subscription_ttc != null && Number.isFinite(Number(config.annual_subscription_ttc))
    ? Number(config.annual_subscription_ttc)
    : 0;
  const feeFixed =
    config?.fee_fixed_ttc != null && Number.isFinite(Number(config.fee_fixed_ttc))
      ? Number(config.fee_fixed_ttc)
      : (config?.fee_fixed != null && Number.isFinite(Number(config.fee_fixed)) ? Number(config.fee_fixed) : 0);
  const costPerKwh =
    config?.cost_per_kwh_storage_ttc != null && Number.isFinite(Number(config.cost_per_kwh_storage_ttc))
      ? Number(config.cost_per_kwh_storage_ttc)
      : (config?.cost_per_kwh_storage != null && Number.isFinite(Number(config.cost_per_kwh_storage)) ? Number(config.cost_per_kwh_storage) : 0);
  const costBasis = config?.cost_basis === "used" ? "used" : "credited";
  const kwhForCost = costBasis === "used" ? creditResult.used_credit_kwh : creditResult.credited_kwh;
  const variableCost = kwhForCost * costPerKwh;
  const annualCostTtc = Math.round((sub + feeFixed + variableCost) * 100) / 100;
  const variableCostRounded = Math.round(variableCost * 100) / 100;
  return {
    annual_cost_ttc: annualCostTtc,
    fee_fixed_ttc: feeFixed,
    annual_subscription_ttc: sub,
    fee_fixed: feeFixed,
    cost_per_kwh_storage: costPerKwh,
    cost_basis: costBasis,
    kwh_billed: kwhForCost,
    variable_cost: variableCostRounded,
    breakdown: {
      annual_subscription_ttc: sub,
      fee_fixed_ttc: feeFixed,
      variable_cost: variableCostRounded,
      total_ttc: annualCostTtc,
    },
  };
}
