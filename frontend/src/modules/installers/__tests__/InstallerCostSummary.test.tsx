import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstallerCostSummary } from "../InstallerQuotePrepPanel";
import type { InstallerCostResult } from "../installers.types";

function result(overrides: Partial<InstallerCostResult> = {}): InstallerCostResult {
  return {
    installer: { id: "installer-ohelec", name: "OHELEC" },
    tariff_version: {
      id: "version-1",
      installer_id: "installer-ohelec",
      version_label: "OHELEC HT V1",
      status: "ACTIVE",
      effective_from: "2026-08-17",
    },
    requested_power_wc: 5820,
    matched_power_wc: 6000,
    installation_type: "ROOF_SUPERIMPOSED",
    electrical_type: "MONO",
    pricing_grid: { id: "grid-roof", code: "OHELEC_ROOF_SUPERIMPOSED_GRID", label: "Toiture" },
    base_amount_ht_cents: 200000,
    electrical_adjustments: [],
    options: [],
    catalog_total_ht_cents: 200000,
    option_overrides: [],
    manual_override: null,
    final_total_ht_cents: 200000,
    warnings: [],
    calculated_at: "2026-08-17T12:00:00.000Z",
    calculation_version: "installer-pricing-v1",
    ...overrides,
  };
}

describe("InstallerCostSummary", () => {
  it("affiche la puissance projet, le palier backend et le total HT", () => {
    render(<InstallerCostSummary result={result()} />);

    expect(screen.getByText("5,82 kWc")).toBeInTheDocument();
    expect(screen.getByText("6 kWc")).toBeInTheDocument();
    expect(screen.getByText("2 000,00 € HT")).toBeInTheDocument();
  });

  it("affiche le palier 7 kWc retourné par le backend pour 6,3 kWc", () => {
    render(<InstallerCostSummary result={result({ requested_power_wc: 6300, matched_power_wc: 7000, base_amount_ht_cents: 220000, catalog_total_ht_cents: 220000, final_total_ht_cents: 220000 })} />);

    expect(screen.getByText("6,3 kWc")).toBeInTheDocument();
    expect(screen.getByText("7 kWc")).toBeInTheDocument();
    expect(screen.getByText("2 200,00 € HT")).toBeInTheDocument();
  });

  it("affiche les options, l'override manuel et le coût catalogue", () => {
    render(
      <InstallerCostSummary
        result={result({
          electrical_type: "TRI",
          electrical_adjustments: [{ code: "TRI", label: "Triphasé", rule_type: "FIXED_SURCHARGE", amount_ht_cents: 25000 }],
          options: [
            { code: "CABLE_AND_CONNECTION", label: "Câble / raccordement", category: "ELECTRICAL", catalog_amount_ht_cents: 15000, final_amount_ht_cents: 30000, override: { code: "CABLE_AND_CONNECTION", catalog_amount_ht_cents: 15000, override_amount_ht_cents: 30000 } },
          ],
          catalog_total_ht_cents: 240000,
          option_overrides: [{ code: "CABLE_AND_CONNECTION", catalog_amount_ht_cents: 15000, override_amount_ht_cents: 30000 }],
          manual_override: { amount_ht_cents: 250000, reason: "Accord direction" },
          final_total_ht_cents: 250000,
        })}
      />
    );

    expect(screen.getByText(/Triphasé : \+250,00 € HT/)).toBeInTheDocument();
    expect(screen.getByText(/catalogue 150,00 € HT/)).toBeInTheDocument();
    expect(screen.getByText(/Modification manuelle : Accord direction/)).toBeInTheDocument();
    expect(screen.getByText(/Coût calculé catalogue : 2 400,00 € HT/)).toBeInTheDocument();
  });

  it("signale un snapshot figé", () => {
    render(<InstallerCostSummary result={result()} frozen />);

    expect(screen.getByText("Tarif figé au moment du devis")).toBeInTheDocument();
  });
});
