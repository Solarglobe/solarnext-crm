import { computeFinancialLineDbFields } from "./finance/financialLine.js";
import { roundMoney2 } from "./finance/moneyRounding.js";

function centsToEuros(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return roundMoney2(n / 100);
}

function percentToBps(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(100, n) * 100);
}

export function computeInstallerVatSnapshot(installerCost, vatRatePercent) {
  const rate = Math.max(0, Math.min(100, Number(vatRatePercent) || 0));
  const ht = centsToEuros(installerCost?.final_total_ht_cents);
  const line = computeFinancialLineDbFields({
    quantity: 1,
    unit_price_ht: ht,
    discount_ht: 0,
    vat_rate: rate,
  });
  return {
    vat_rate_percent: rate,
    vat_rate_bps: percentToBps(rate),
    final_total_ht_cents: Math.round(line.total_line_ht * 100),
    final_total_vat_cents: Math.round(line.total_line_vat * 100),
    final_total_ttc_cents: Math.round(line.total_line_ttc * 100),
  };
}

export function enrichInstallerCostWithVat(installerCost, vatRatePercent) {
  if (!installerCost || typeof installerCost !== "object") return installerCost;
  const vat = computeInstallerVatSnapshot(installerCost, vatRatePercent);
  return {
    ...installerCost,
    vat_rate_percent: vat.vat_rate_percent,
    vat_rate_bps: vat.vat_rate_bps,
    final_total_ht_cents: vat.final_total_ht_cents,
    final_total_vat_cents: vat.final_total_vat_cents,
    final_total_ttc_cents: vat.final_total_ttc_cents,
  };
}

export function computeProjectEconomicTotalsFromConfig(config = {}) {
  const totals = config?.totals && typeof config.totals === "object" ? config.totals : {};
  const solarglobe = {
    ht: roundMoney2(totals.ht),
    vat: roundMoney2(totals.tva ?? totals.vat),
    ttc: roundMoney2(totals.ttc),
  };

  const installerCost = config?.installer_cost && typeof config.installer_cost === "object" ? config.installer_cost : null;
  const installer = {
    ht: centsToEuros(installerCost?.final_total_ht_cents),
    vat: centsToEuros(installerCost?.final_total_vat_cents),
    ttc: centsToEuros(installerCost?.final_total_ttc_cents),
  };

  const project = {
    ht: roundMoney2(solarglobe.ht + installer.ht),
    vat: roundMoney2(solarglobe.vat + installer.vat),
    ttc: roundMoney2(solarglobe.ttc + installer.ttc),
  };

  return { solarglobe, installer, project };
}
