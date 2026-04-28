import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import FullReport from "../FullReport";

function buildViewModel(withVirtualBatteryPage: boolean) {
  return {
    fullReport: {
      p1: {},
      p2: {},
      p3: {},
      p3b: {},
      p4: {},
      p5: {},
      p6: {},
      p7: {},
      p7_virtual_battery: withVirtualBatteryPage
        ? {
            meta: { client: "Client Test", ref: "REF-1", date: "2026-04-28" },
            title: "Impact réel de votre batterie virtuelle",
            subtitle: "Comprendre précisément ce qu’elle change dans votre projet solaire",
            without_battery: { autonomie_ratio: 0.32, pv_used_kwh: 5000, grid_import_kwh: 10500 },
            with_virtual_battery: { autonomie_ratio: 0.59, pv_total_used_kwh: 9200, battery_discharged_kwh: 4200, grid_import_kwh: 6266 },
            max_theoretical: { production_kwh: 13457, consumption_kwh: 15500, autonomy_ratio: 0.8681935484 },
            contribution: { recovered_kwh: 4200, grid_bought_less_kwh: 4234, autonomy_gain_ratio: 0.27 },
            limits: ["A", "B", "C"],
          }
        : null,
      p8: {},
      p9: {},
      p10: {},
      p11: {},
      p12: {},
    },
  };
}

describe("FullReport — page batterie virtuelle", () => {
  it("scenario BASE: page absente", () => {
    const { queryByText } = render(<FullReport viewModel={buildViewModel(false)} />);
    expect(queryByText("Impact réel de votre batterie virtuelle")).not.toBeInTheDocument();
  });

  it("scenario BATTERY_VIRTUAL: page presente", () => {
    const { getByText } = render(<FullReport viewModel={buildViewModel(true)} />);
    expect(getByText("Impact réel de votre batterie virtuelle")).toBeInTheDocument();
  });
});
