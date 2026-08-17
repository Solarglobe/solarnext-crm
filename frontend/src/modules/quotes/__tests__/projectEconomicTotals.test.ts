import { describe, expect, it } from "vitest";
import { computeProjectEconomicTotals } from "../projectEconomicTotals";
import type { InstallerCostResult } from "../../installers/installers.types";

const installerCost = {
  installer: { id: "installer-1", name: "OHELEC" },
  tariff_version: {
    id: "tariff-1",
    installer_id: "installer-1",
    version_label: "OHELEC HT V1",
    status: "ACTIVE",
  },
  requested_power_wc: 6300,
  matched_power_wc: 6500,
  installation_type: "ROOF_SUPERIMPOSED",
  electrical_type: "MONO",
  base_amount_ht_cents: 166667,
  electrical_adjustments: [],
  options: [],
  catalog_total_ht_cents: 166667,
  option_overrides: [],
  manual_override: null,
  vat_rate_percent: 20,
  vat_rate_bps: 2000,
  final_total_ht_cents: 166667,
  final_total_vat_cents: 33333,
  final_total_ttc_cents: 200000,
  warnings: [],
  calculated_at: "2026-08-17T10:00:00.000Z",
  calculation_version: "installer-pricing-v1",
} satisfies InstallerCostResult;

describe("computeProjectEconomicTotals", () => {
  it("additionne SolarGlobe et installateur en total projet", () => {
    const totals = computeProjectEconomicTotals({ ht: 8333.33, tva: 1666.67, ttc: 10000 }, installerCost);
    expect(totals.solarglobe.ttc).toBe(10000);
    expect(totals.installer.ttc).toBe(2000);
    expect(totals.project.ttc).toBe(12000);
  });

  it("préserve le total SolarGlobe si aucun installateur n'est sélectionné", () => {
    const totals = computeProjectEconomicTotals({ ht: 8333.33, tva: 1666.67, ttc: 10000 }, null);
    expect(totals.installer.ttc).toBe(0);
    expect(totals.project.ttc).toBe(10000);
  });
});
