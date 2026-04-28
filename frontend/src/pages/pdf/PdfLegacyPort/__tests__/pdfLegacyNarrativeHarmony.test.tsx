/**
 * Garde-fous ciblés : ordre des sections PDF client, lexique P2 / P8 / P10 / P11, méthodologie.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PdfLegacyPort from "../index";

const viewModelWithP8 = {
  fullReport: {
    p9: { _present: true },
    p10: {
      meta: { client: "ACME", ref: "R-1", date: "2026-01-01" },
      best: {
        kwc: 6,
        savings_year1_eur: 1200,
        roi_years: 10,
        autonomy_pct: 50,
        tri_pct: 8,
        lcoe_eur_kwh: 0.12,
        gains_25_eur: 25000,
        nb_panels: 12,
        annual_production_kwh: 8000,
        autoprod_pct: 60,
      },
    },
  },
  organization: {},
};

describe("PdfLegacyPort — harmonisation narrative / lexique", () => {
  it("conserve l'ordre p1 → p2 → … → p8 → p10 → p11 → méthodo → p12", () => {
    const { container } = render(<PdfLegacyPort viewModel={viewModelWithP8} />);
    const ids = Array.from(container.querySelectorAll("section[id]")).map((s) => s.getAttribute("id") ?? "");
    const chain = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p10", "p11", "p-methodology-solarglobe", "p12"];
    for (let i = 1; i < chain.length; i++) {
      expect(ids.indexOf(chain[i]), `${chain[i]} doit suivre ${chain[i - 1]}`).toBeGreaterThan(ids.indexOf(chain[i - 1]));
    }
  });

  it("P10 n'emploie plus « Indépendance énergétique » (autonomie unifiée avec P6 / P7)", () => {
    const { container } = render(<PdfLegacyPort viewModel={viewModelWithP8} />);
    const p10 = container.querySelector("#p10");
    expect(p10?.textContent).not.toMatch(/Indépendance énergétique/);
    expect(p10?.textContent).toMatch(/Autonomie site/);
  });

  it("P8 : badge et libellés gains nets / projection patrimoniale", () => {
    const { container } = render(<PdfLegacyPort viewModel={viewModelWithP8} />);
    const p8 = container.querySelector("#p8");
    expect(p8?.textContent).toMatch(/Gains nets sur 25 ans/);
    expect(p8?.textContent).toMatch(/Gain net à 15 ans/);
  });

  it("P2 : titre structurant et hero gain net", () => {
    const { container } = render(<PdfLegacyPort viewModel={viewModelWithP8} />);
    const p2 = container.querySelector("#p2");
    expect(p2?.textContent).toMatch(/Comparatif financier et indicateurs/);
    expect(p2?.textContent).toMatch(/gain net après investissement/i);
  });

  it("P11 : projection, économies en synthèse, retour estimé", () => {
    const { container } = render(<PdfLegacyPort viewModel={viewModelWithP8} />);
    const p11 = container.querySelector("#p11");
    expect(p11?.textContent).toMatch(/Projection 25 ans — économies et financement/);
    expect(p11?.textContent).toMatch(/Économie/);
    expect(p11?.textContent).toMatch(/Retour estimé/);
  });

  it("méthodologie : calepinage explicite et bilan de production annuel", () => {
    const { container } = render(<PdfLegacyPort viewModel={viewModelWithP8} />);
    const m = container.querySelector("#p-methodology-solarglobe");
    expect(m?.textContent).toMatch(/Plan de pose \(calepinage\)/);
    expect(m?.textContent).toMatch(/Bilan de production annuel/);
  });
});
