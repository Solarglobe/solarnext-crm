import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PdfLegacyPort from "../index";

function vmForScenario(scenarioType: "BASE" | "BATTERY_VIRTUAL") {
  return {
    selected_scenario_snapshot: { scenario_type: scenarioType },
    fullReport: {
      p9: { _present: true },
      p7_virtual_battery:
        scenarioType === "BATTERY_VIRTUAL"
          ? {
              meta: { client: "Client Test", ref: "REF-1", date: "2026-04-28" },
              title: "Impact réel de votre batterie virtuelle",
              subtitle: "Comprendre précisément ce qu’elle change dans votre projet solaire",
              without_battery: { autonomie_ratio: 0.32, pv_used_kwh: 5000, grid_import_kwh: 10500 },
              with_virtual_battery: { autonomie_ratio: 0.59, pv_total_used_kwh: 9200, battery_discharged_kwh: 4200, grid_import_kwh: 6266 },
              max_theoretical: { production_kwh: 13457, consumption_kwh: 15500, autonomy_ratio: 0.86 },
              contribution: { recovered_kwh: 4200, grid_bought_less_kwh: 4234, autonomy_gain_ratio: 0.27 },
              limits: ["A", "B", "C"],
            }
          : null,
    },
    organization: {},
  };
}

describe("PdfLegacyPort — page batterie virtuelle", () => {
  it("BASE: page absente", () => {
    const { queryByText } = render(<PdfLegacyPort viewModel={vmForScenario("BASE")} />);
    expect(queryByText("Impact réel de votre batterie virtuelle")).not.toBeInTheDocument();
  });

  it("BATTERY_VIRTUAL: page présente", () => {
    const { getByText } = render(<PdfLegacyPort viewModel={vmForScenario("BATTERY_VIRTUAL")} />);
    expect(getByText("Impact réel de votre batterie virtuelle")).toBeInTheDocument();
  });
});
