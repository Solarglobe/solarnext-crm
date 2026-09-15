import type { OverviewLeadSnapshot } from "./overviewSave";
import { resolveCurrentElectricitySubscription } from "@shared/currentElectricitySubscription.js";

const numberOrNull = (raw: unknown): number | null => {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

const hierarchy = "Les prix saisis sont prioritaires, puis la moyenne de la facture. À défaut, les paramètres servent d’estimation.";

export function currentElectricityTariffType(lead: Partial<OverviewLeadSnapshot>): string | null {
  const tariff = String(lead.tariff_type ?? "").trim().toUpperCase().replace(/[\s/_-]/g, "");
  if (["HPHC", "HEURESPLEINESHEURESCREUSES"].includes(tariff)) return "HPHC";
  if (tariff) return tariff;
  // Older rows use false by default; only an affirmative HP/HC flag proves an option.
  return lead.hp_hc === true ? "HPHC" : null;
}

export function currentElectricityTariffPatch(tariff: string | undefined): Pick<OverviewLeadSnapshot, "tariff_type" | "hp_hc"> {
  return { tariff_type: tariff ?? "", hp_hc: tariff ? tariff === "hp_hc" : null };
}

/** Preview only: never write the derived average into the customer's exact prices. */
export function buildCurrentElectricityBillPreview(
  lead: Partial<OverviewLeadSnapshot>,
  months: { month: number; kwh: number }[] = [],
  importedAnnualKwh?: number | null,
) {
  const mode = String(lead.consumption_mode || "ANNUAL").toUpperCase();
  const ep = lead.energy_profile as { engine?: { annual_kwh?: number }; summary?: { annual_kwh?: number } } | null;
  const monthlyValues = Array.from({ length: 12 }, (_, i) => numberOrNull(months.find((m) => Number(m.month) === i + 1)?.kwh));
  const annualKwh = mode === "MONTHLY"
    ? monthlyValues.every((n) => n != null && n >= 0)
      ? monthlyValues.reduce<number>((sum, n) => sum + (n ?? 0), 0)
      : numberOrNull(lead.consumption_annual_calculated_kwh)
    : mode === "PDL" || mode === "HOURLY"
      ? numberOrNull(importedAnnualKwh ?? ep?.engine?.annual_kwh ?? ep?.summary?.annual_kwh)
        ?? numberOrNull(lead.consumption_annual_calculated_kwh)
        ?? numberOrNull(lead.consumption_annual_kwh)
      : numberOrNull(lead.consumption_annual_kwh);
  const bill = numberOrNull(lead.electricity_annual_bill_ttc);
  const subscription = resolveCurrentElectricitySubscription({
    monthly: lead.electricity_subscription_ttc_month,
    meterKva: lead.meter_power_kva,
    tariffType: lead.tariff_type,
    hpHc: lead.hp_hc === true ? true : undefined,
  });
  const subscriptionAnnual = subscription.annual;
  const tariffType = currentElectricityTariffType(lead);
  const validPrice = (raw: unknown) => { const n = numberOrNull(raw); return n != null && n >= 0; };
  const isHpHc = tariffType === "HPHC";
  const supported = !tariffType || tariffType === "BASE" || isHpHc;
  const exactPrices = supported && (isHpHc
    ? validPrice(lead.elec_price_hp_eur_kwh) && validPrice(lead.elec_price_hc_eur_kwh)
    : validPrice(lead.elec_price_base_eur_kwh));
  let error: string | null = null;
  if (bill != null && bill < 0) error = "La facture annuelle doit être positive ou nulle.";
  else if (subscription.invalid) error = "L’abonnement mensuel doit être un montant positif ou nul.";
  else if (bill != null && subscriptionAnnual != null && Math.round(bill * 100) < Math.round(subscriptionAnnual * 100)) {
    error = subscription.isEstimate
      ? "La facture annuelle est inférieure à l’abonnement estimé. Vérifiez la facture ou renseignez l’abonnement réel."
      : "La facture annuelle doit inclure les 12 mois d’abonnement. Vérifiez ces deux montants.";
  } else if (bill != null && annualKwh != null && annualKwh <= 0) {
    error = "Renseignez une consommation supérieure à 0 kWh pour les mêmes 12 mois que la facture.";
  }
  const averagePriceKwh = !error && !exactPrices && bill != null && subscriptionAnnual != null && annualKwh != null && annualKwh > 0
    ? Math.max(0, bill - subscriptionAnnual) / annualKwh : null;
  const currency = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const referenceDate = subscription.reference?.effective_date?.split("-").reverse().join("/");
  const missingSubscriptionInputs = [
    subscription.missing.includes("meter_kva_missing") && "la puissance du compteur (kVA)",
    subscription.missing.includes("tariff_type_missing") && "l’option tarifaire",
  ].filter(Boolean).join(" et ");
  const subscriptionMessage = subscription.isEstimate && subscription.monthly != null
    ? `Abonnement estimé : ${currency.format(subscription.monthly)} €/mois TTC${referenceDate ? ` (grille EDF du ${referenceDate})` : " (grille EDF)"}. Le montant réel, si vous le renseignez, est prioritaire.`
    : subscription.invalid ? "Corrigez le montant de l’abonnement."
      : subscription.source === "CURRENT_LEAD" ? "Montant réel utilisé pour le calcul."
        : missingSubscriptionInputs ? `Pour estimer l’abonnement, renseignez ${missingSubscriptionInputs}, ou saisissez le montant réel.`
          : "Cette puissance ou cette option n’est pas couverte par la grille EDF de référence. Renseignez l’abonnement réel.";
  const message = error ?? (averagePriceKwh != null
    ? `Prix moyen calculé hors abonnement : ${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 5 }).format(averagePriceKwh)} €/kWh TTC (estimation).`
    : hierarchy);
  return { annualKwh, averagePriceKwh, error, message, subscription, subscriptionMessage };
}
