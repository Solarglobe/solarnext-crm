import type { InstallerCostResult } from "../installers/installers.types";
import { computeLineAmounts, round2 } from "./quoteCalc";

export type MoneyTriplet = {
  ht: number;
  tva: number;
  ttc: number;
};

export type ProjectEconomicTotals = {
  solarglobe: MoneyTriplet;
  installer: MoneyTriplet;
  project: MoneyTriplet;
};

function centsToEuros(cents: unknown): number {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return round2(n / 100);
}

export function installerCostToMoneyTriplet(installerCost: InstallerCostResult | null | undefined): MoneyTriplet {
  if (!installerCost) return { ht: 0, tva: 0, ttc: 0 };
  const ht = centsToEuros(installerCost.final_total_ht_cents);
  const explicitVat = centsToEuros(installerCost.final_total_vat_cents);
  const explicitTtc = centsToEuros(installerCost.final_total_ttc_cents);
  if (explicitTtc > 0 || explicitVat > 0) {
    return { ht, tva: explicitVat, ttc: explicitTtc };
  }
  const vatRate = Number(installerCost.vat_rate_percent);
  if (Number.isFinite(vatRate) && vatRate >= 0) {
    const line = computeLineAmounts({
      quantity: 1,
      unit_price_ht: ht,
      line_discount_percent: 0,
      tva_percent: vatRate,
    });
    return { ht: line.net_ht, tva: line.total_tva, ttc: line.total_ttc };
  }
  return { ht, tva: 0, ttc: ht };
}

export function computeProjectEconomicTotals(
  solarglobe: MoneyTriplet,
  installerCost: InstallerCostResult | null | undefined
): ProjectEconomicTotals {
  const sg = {
    ht: round2(solarglobe.ht),
    tva: round2(solarglobe.tva),
    ttc: round2(solarglobe.ttc),
  };
  const installer = installerCostToMoneyTriplet(installerCost);
  return {
    solarglobe: sg,
    installer,
    project: {
      ht: round2(sg.ht + installer.ht),
      tva: round2(sg.tva + installer.tva),
      ttc: round2(sg.ttc + installer.ttc),
    },
  };
}
