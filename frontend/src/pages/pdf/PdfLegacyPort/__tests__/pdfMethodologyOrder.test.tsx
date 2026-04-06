/**
 * Garde-fous : page méthodologie SolarGlobe — présence, ordre (avant P12), titres clés.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PdfLegacyPort from "../index";

const minimalVm = {
  fullReport: {
    p10: { meta: { client: "Client Test", ref: "REF-1", date: "2026-03-30" }, best: {}, hyp: {} },
  },
  organization: {},
};

describe("PdfLegacyPort — méthodologie SolarGlobe", () => {
  it("insère #p-methodology-solarglobe immédiatement avant #p12", () => {
    const { container } = render(<PdfLegacyPort viewModel={minimalVm} />);
    const sections = container.querySelectorAll("section[id]");
    const ids = Array.from(sections).map((s) => s.getAttribute("id"));
    const iM = ids.indexOf("p-methodology-solarglobe");
    const i12 = ids.indexOf("p12");
    expect(iM, "méthodologie absente").toBeGreaterThanOrEqual(0);
    expect(i12, "p12 absente").toBeGreaterThanOrEqual(0);
    expect(iM, "méthodologie doit précéder p12").toBe(i12 - 1);
    expect(ids[ids.length - 1], "p12 reste la dernière section").toBe("p12");
  });

  it("contient titres clés, scope, workflow, cartes enrichies et bloc dual", () => {
    const { container } = render(<PdfLegacyPort viewModel={minimalVm} />);
    const root = container.querySelector("#p-methodology-solarglobe");
    expect(root).toBeTruthy();
    const text = root?.textContent ?? "";
    expect(text).toContain("Méthodologie de calcul SolarGlobe");
    expect(text).toContain("Ce que notre étude prend en compte");
    expect(text).toContain("Logique générale de calcul");
    expect(text).toMatch(/Données d['’]entrée/);
    expect(text).toContain("Modélisation");
    expect(text).toContain("Résultats");
    expect(text).toMatch(/Implantation réelle du projet/i);
    expect(text).toMatch(/production solaire/i);
    expect(text).toMatch(/Environnement et ombrage/i);
    expect(text).toMatch(/Autoconsommation/i);
    expect(text).toMatch(/Simulation économique/i);
    expect(text).toMatch(/Hypothèses et limites/i);
    expect(text).toContain("Cette étude permet");
    expect(text).toContain("Cette étude ne prétend pas");
  });

  it("affiche les méta dossier depuis fullReport.p10", () => {
    const { container } = render(<PdfLegacyPort viewModel={minimalVm} />);
    const meth = container.querySelector("#p-methodology-solarglobe");
    expect(meth?.textContent).toContain("Client Test");
    expect(meth?.textContent).toContain("REF-1");
  });
});
