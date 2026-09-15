import { describe, expect, it } from "vitest";
import { buildCurrentElectricityBillPreview, currentElectricityTariffType, currentElectricityTariffPatch } from "../currentElectricityBill";
import { applyMeterRowToLeadSnapshot, buildMeterAutosavePayload } from "../overviewSave";

const input = { consumption_annual_kwh: 10000, electricity_annual_bill_ttc: 2400, electricity_subscription_ttc_month: 20 };

describe("annual electricity bill entry", () => {
  it.each([null, 0, 2400.12])("reloads and saves selected meter total %s including an explicit clear", (amount) => {
    const snapshot = applyMeterRowToLeadSnapshot({ ...input, electricity_annual_bill_ttc: amount });
    expect(buildMeterAutosavePayload(snapshot, "Maison", []).electricity_annual_bill_ttc).toBe(amount);
    expect(snapshot.electricity_subscription_ttc_month).toBe(20);
  });

  it("keeps an unloaded amount out of save requests", () => {
    expect(buildMeterAutosavePayload({}, "Maison", [])).not.toHaveProperty("electricity_annual_bill_ttc");
  });

  it("deducts 12 subscriptions before showing the average, without mutating exact prices", () => {
    const lead = { ...input, hp_hc: true, elec_price_hp_eur_kwh: 0.3 };
    const before = { ...lead };
    expect(buildCurrentElectricityBillPreview(lead).averagePriceKwh).toBe(0.216);
    expect(lead).toEqual(before);
    expect(buildCurrentElectricityBillPreview({ ...lead, elec_price_hc_eur_kwh: 0.13 }).averagePriceKwh).toBeNull();
    expect(buildCurrentElectricityBillPreview({ ...input, elec_price_base_eur_kwh: 0.17 }).averagePriceKwh).toBeNull();
  });

  it("does not assume a missing subscription is free", () => {
    expect(buildCurrentElectricityBillPreview({ ...input, electricity_subscription_ttc_month: null }).averagePriceKwh).toBeNull();
    expect(buildCurrentElectricityBillPreview({ ...input, electricity_subscription_ttc_month: 0 }).averagePriceKwh).toBe(0.24);
    expect(buildCurrentElectricityBillPreview({ ...input, electricity_annual_bill_ttc: 0, electricity_subscription_ttc_month: 0 }).averagePriceKwh).toBe(0);
  });

  it("estimates a missing subscription from the actual meter and deducts it from the bill", () => {
    const lead = { ...input, electricity_subscription_ttc_month: null, meter_power_kva: 9, tariff_type: "hp_hc" };
    const before = { ...lead };
    const preview = buildCurrentElectricityBillPreview(lead);
    expect(preview.subscription.monthly).toBe(19.88);
    expect(preview.subscription.annual).toBe(238.56);
    expect(preview.averagePriceKwh).toBeCloseTo(0.216144, 8);
    expect(preview.subscriptionMessage).toContain("Abonnement estimé : 19,88 €/mois TTC");
    expect(preview.subscriptionMessage).toContain("01/08/2026");
    expect(preview.subscription.reference?.source_url).toContain("Grille_prix_Tarif_Bleu.pdf");
    expect(lead).toEqual(before);
    expect(buildMeterAutosavePayload(lead, "Maison", []).electricity_subscription_ttc_month).toBeNull();
  });

  it("keeps a supplied subscription and exact energy prices ahead of reference prices", () => {
    const lead = { ...input, meter_power_kva: 9, tariff_type: "base", elec_price_base_eur_kwh: 0.13 };
    const actual = buildCurrentElectricityBillPreview(lead);
    expect(actual.subscription.monthly).toBe(20);
    expect(actual.subscription.isEstimate).toBe(false);
    expect(actual.averagePriceKwh).toBeNull();
    const estimated = buildCurrentElectricityBillPreview({ ...lead, electricity_subscription_ttc_month: null });
    expect(estimated.subscription.isEstimate).toBe(true);
    expect(estimated.averagePriceKwh).toBeNull();
    expect(estimated.subscriptionMessage).toContain("Abonnement estimé");
    expect(buildCurrentElectricityBillPreview({ ...lead, electricity_subscription_ttc_month: 0 }).subscription.monthly).toBe(0);
  });

  it("asks for missing meter data without defaulting to a power or tariff", () => {
    const noSubscription = { ...input, electricity_subscription_ttc_month: null };
    const neither = buildCurrentElectricityBillPreview(noSubscription);
    expect(neither.subscription.monthly).toBeNull();
    expect(neither.subscriptionMessage).toContain("la puissance du compteur (kVA) et l’option tarifaire");
    expect(buildCurrentElectricityBillPreview({ ...noSubscription, tariff_type: "base" }).subscriptionMessage).toContain("la puissance du compteur (kVA), ou");
    expect(buildCurrentElectricityBillPreview({ ...noSubscription, meter_power_kva: 9 }).subscriptionMessage).toContain("l’option tarifaire, ou");
    expect(buildCurrentElectricityBillPreview({ ...noSubscription, meter_power_kva: 9, hp_hc: false }).subscription.monthly).toBeNull();
    const unsupported = buildCurrentElectricityBillPreview({ ...noSubscription, meter_power_kva: 10, tariff_type: "base" });
    expect(unsupported.averagePriceKwh).toBeNull();
    expect(unsupported.subscriptionMessage).toContain("n’est pas couverte");
    expect(unsupported.subscriptionMessage).toContain("Renseignez l’abonnement réel");
  });

  it("keeps option selectors synchronized and treats a legacy false flag as unknown", () => {
    expect(currentElectricityTariffType({ hp_hc: false })).toBeNull();
    expect(currentElectricityTariffType({ hp_hc: true })).toBe("HPHC");
    expect(currentElectricityTariffType({ tariff_type: "BASE", hp_hc: true })).toBe("BASE");
    expect(currentElectricityTariffPatch("base")).toEqual({ tariff_type: "base", hp_hc: false });
    expect(currentElectricityTariffPatch("hp_hc")).toEqual({ tariff_type: "hp_hc", hp_hc: true });
    const cleared = currentElectricityTariffPatch(undefined);
    expect(cleared).toEqual({ tariff_type: "", hp_hc: null });
    const saved = buildMeterAutosavePayload(cleared, "Maison", []);
    expect(saved.tariff_type).toBe("");
    expect(saved.hp_hc).toBeNull();
    // The legacy database may still return false after a clear; the explicit option stays empty.
    expect(currentElectricityTariffType({ ...cleared, hp_hc: false })).toBeNull();
  });

  it("reports an impossible estimated annual bill and never replaces an invalid manual subscription", () => {
    const lead = { ...input, electricity_subscription_ttc_month: null, meter_power_kva: 9, tariff_type: "base" };
    expect(buildCurrentElectricityBillPreview({ ...lead, electricity_annual_bill_ttc: 100 }).error).toContain("inférieure à l’abonnement estimé");
    const invalid = buildCurrentElectricityBillPreview({ ...lead, electricity_subscription_ttc_month: -1 });
    expect(invalid.subscription.isEstimate).toBe(false);
    expect(invalid.averagePriceKwh).toBeNull();
    expect(invalid.error).toContain("positif ou nul");
    expect(invalid.subscriptionMessage).not.toContain("Montant réel utilisé");
  });

  it("keeps explicit zero prices and the selected Base contract ahead of stale HP/HC flags", () => {
    expect(buildCurrentElectricityBillPreview({ ...input, elec_price_base_eur_kwh: 0 }).averagePriceKwh).toBeNull();
    expect(buildCurrentElectricityBillPreview({ ...input, tariff_type: "base", hp_hc: true, elec_price_base_eur_kwh: 0.15 }).averagePriceKwh).toBeNull();
    expect(buildCurrentElectricityBillPreview({ ...input, tariff_type: "tempo", elec_price_base_eur_kwh: 0.15 }).averagePriceKwh).toBe(0.216);
  });

  it("explains impossible bill and consumption entries", () => {
    expect(buildCurrentElectricityBillPreview({ ...input, electricity_annual_bill_ttc: 239 }).error).toMatch(/12 mois d’abonnement/);
    expect(buildCurrentElectricityBillPreview({ ...input, consumption_annual_kwh: 0 }).error).toMatch(/supérieure à 0/);
    expect(buildCurrentElectricityBillPreview({ ...input, consumption_annual_kwh: undefined }).averagePriceKwh).toBeNull();
  });

  it("uses current monthly entries instead of stale annual input when changing modes", () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, kwh: 1000 }));
    const preview = buildCurrentElectricityBillPreview({ ...input, consumption_mode: "MONTHLY", consumption_annual_kwh: 99999 }, monthly);
    expect(preview.annualKwh).toBe(12000);
    expect(preview.averagePriceKwh).toBe(0.18);
  });

  it("uses the imported annual total, including a reconstructed partial curve", () => {
    const preview = buildCurrentElectricityBillPreview({
      ...input, consumption_mode: "PDL", consumption_annual_kwh: 99999,
      energy_profile: { engine: { annual_kwh: 10000, engine_consumption_source: "CSV_HOURLY_PARTIAL_REBUILT" } },
    });
    expect(preview.annualKwh).toBe(10000);
    expect(preview.averagePriceKwh).toBe(0.216);
  });
});
