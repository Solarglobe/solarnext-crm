import { describe, expect, it } from "vitest";
import { applyMeterRowToLeadSnapshot, buildMeterAutosavePayload, mergeEnergyProfileEngine, leadResponseWithoutMeterFields } from "../overviewSave";

const profile = {
  contract: { pdl: "11111111111111", tariff_type: "hp_hc", plage_hc: "HC (22H30-6H30)",
    off_peak_periods: [{ start: "22:30", end: "06:30" }], puissance_souscrite_kva: 18 },
  engine: { annual_kwh: 8760, hourly: Array(8760).fill(1), period_start: "2025-01-01", period_end: "2025-12-31",
    timezone: "Europe/Paris", provenance: { source: "C68_R65" }, monthly_kwh_ref: [744, 672], debug: { scale: 1.1 } },
  hourly: [{ timestamp: "2025-01-01T00:00:00+01:00", power_w: 1234 }],
  monthly_kwh_ref: [744, 672], import_debug: { imported_files: ["c68.json", "r65.json", "loadcurve.csv"] },
};

describe("energy profile preservation when editing a meter", () => {
  it("keeps C68, raw data and metadata through engine update, invoice save and API reload", () => {
    const before = structuredClone(profile);
    const engine = { annual_kwh: 9000, hourly: Array(8760).fill(9000 / 8760), debug: undefined };
    const updated = mergeEnergyProfileEngine(profile, engine) as typeof profile;
    const payload = buildMeterAutosavePayload({ consumption_mode: "PDL", energy_profile: updated,
      electricity_annual_bill_ttc: 2400, electricity_subscription_ttc_month: 20 }, "Maison", []);
    const reloaded = applyMeterRowToLeadSnapshot(JSON.parse(JSON.stringify(payload)));
    const saved = reloaded.energy_profile as typeof profile;
    expect(saved.contract).toEqual(profile.contract);
    expect(saved.hourly).toEqual(profile.hourly);
    expect(saved.import_debug).toEqual(profile.import_debug);
    expect(saved.monthly_kwh_ref).toEqual(profile.monthly_kwh_ref);
    expect(saved.engine).toEqual({ ...profile.engine, annual_kwh: 9000, hourly: engine.hourly });
    expect(payload.consumption_annual_kwh).toBe(9000);
    expect(reloaded.electricity_annual_bill_ttc).toBe(2400);
    expect(reloaded.electricity_subscription_ttc_month).toBe(20);
    expect(profile).toEqual(before);
  });

  it("retains the selected meter profile when a PATCH response omits unchanged data", () => {
    const current = { energy_profile: profile, electricity_annual_bill_ttc: 1000 };
    const response = applyMeterRowToLeadSnapshot({ electricity_annual_bill_ttc: 2400 }, { partial: true });
    const merged = { ...current, ...response };
    expect(merged.energy_profile).toBe(profile);
    expect(merged.electricity_annual_bill_ttc).toBe(2400);
    const saved = buildMeterAutosavePayload(merged, "Maison", []);
    expect(saved.energy_profile).toBe(profile);
    expect(applyMeterRowToLeadSnapshot({ energy_profile: null }, { partial: true }).energy_profile).toBeNull();
  });

  it("replaces the whole profile when switching meters, never borrowing the previous contract", () => {
    const otherProfile = { engine: { annual_kwh: 2000, hourly: Array(8760).fill(2000 / 8760) }, import_debug: { meter: "B" } };
    const switched = { energy_profile: profile, ...applyMeterRowToLeadSnapshot({ energy_profile: otherProfile }) };
    expect(switched.energy_profile).toBe(otherProfile);
    expect(mergeEnergyProfileEngine(switched.energy_profile, { annual_kwh: 2100 })).not.toHaveProperty("contract");
    const emptyMeter = { ...switched, ...applyMeterRowToLeadSnapshot({}) };
    expect(emptyMeter.energy_profile).toBeUndefined();
    expect(buildMeterAutosavePayload(emptyMeter, "Compteur C", [])).not.toHaveProperty("energy_profile");
  });

  it("keeps the selected meter data when the lead PATCH returns its default meter", () => {
    const selectedProfile = { contract: { pdl: "22222222222222", tariff_type: "base" } };
    const current = { full_name: "Ancien nom", energy_profile: selectedProfile, tariff_type: "base", meter_power_kva: 6,
      electricity_annual_bill_ttc: 1500 };
    const leadResponse = { full_name: "Nom corrigé", energy_profile: profile, tariff_type: "hp_hc", meter_power_kva: 18,
      electricity_annual_bill_ttc: 2400 };
    expect({ ...current, ...leadResponseWithoutMeterFields(leadResponse) }).toEqual({ ...current, full_name: "Nom corrigé" });
  });

  it("preserves profiles without an engine and keeps explicit deletion distinct from an unloaded field", () => {
    expect(mergeEnergyProfileEngine(profile)).toBe(profile);
    expect(mergeEnergyProfileEngine(profile, null)).toBeNull();
    expect(buildMeterAutosavePayload({ energy_profile: null }, "Maison", []).energy_profile).toBeNull();
    const raw = { summary: { annual_kwh: 10 }, hourly: [2, 3, 5], contract: profile.contract };
    expect(mergeEnergyProfileEngine(raw, { annual_kwh: 10, hourly: [2, 3, 5] })).toMatchObject(raw);
  });
});
