import { describe, expect, it } from "vitest";
import { applyMeterRowToLeadSnapshot, buildMeterAutosavePayload } from "../overviewSave";

describe("current electricity subscription in meter forms", () => {
  it.each([null, 0, 17.42])("reloads and saves a selected meter amount of %s", (amount) => {
    const lead = applyMeterRowToLeadSnapshot({
      consumption_mode: "ANNUAL",
      electricity_subscription_ttc_month: amount,
      elec_price_hp_eur_kwh: 0.3,
      elec_price_hc_eur_kwh: 0.13,
    });
    const payload = buildMeterAutosavePayload(lead, "Maison", []);
    expect(payload.electricity_subscription_ttc_month).toBe(amount);
    expect(payload.elec_price_hp_eur_kwh).toBe(0.3);
    expect(payload.elec_price_hc_eur_kwh).toBe(0.13);
  });

  it("omits an unloaded subscription rather than clearing a saved value", () => {
    const payload = buildMeterAutosavePayload({ consumption_mode: "ANNUAL" }, "Maison", []);
    expect(payload).not.toHaveProperty("electricity_subscription_ttc_month");
  });
});
