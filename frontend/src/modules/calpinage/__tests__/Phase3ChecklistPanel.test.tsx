/**
 * Tests unitaires Phase3ChecklistPanel.
 * Exécuter : npm run test:phase3-checklist (après npm install vitest @testing-library/react jsdom)
 * ou : npx vitest run src/modules/calpinage/__tests__/Phase3ChecklistPanel.test.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Phase3ChecklistPanel, isPhase3ChecklistOk } from "../Phase3ChecklistPanel";

describe("Phase3ChecklistPanel", () => {
  it("0 panneau → erreur affichée", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={0}
        totalDcKw={0}
        selectedInverter={null}
      />
    );
    expect(screen.getByText("Aucun")).toBeInTheDocument();
    expect(screen.getByText("Panneaux")).toBeInTheDocument();
  });

  it("panneau + pas onduleur → warning", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={10}
        totalDcKw={4.5}
        selectedInverter={null}
      />
    );
    expect(screen.getByText("Non sélectionné")).toBeInTheDocument();
    expect(screen.getByText("10 modules")).toBeInTheDocument();
  });

  it("panneau + onduleur ratio OK → OK", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={12}
        totalDcKw={5.4}
        selectedInverter={{ name: "Onduleur 5kW", acPowerKw: 5 }}
      />
    );
    expect(screen.getByText("12 modules")).toBeInTheDocument();
    expect(screen.getByText("Onduleur 5kW")).toBeInTheDocument();
    expect(screen.getByText("1.08")).toBeInTheDocument();
    expect(screen.getByText("Prêt")).toBeInTheDocument();
  });

  it("ratio < 0.8 → warning", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={5}
        totalDcKw={2}
        selectedInverter={{ name: "Onduleur 5kW", acPowerKw: 5 }}
      />
    );
    expect(screen.getByText(/0\.40/)).toBeInTheDocument();
    expect(screen.getByText(/Onduleur sous-dimensionné/)).toBeInTheDocument();
    expect(screen.getByText("À compléter")).toBeInTheDocument();
  });

  it("ratio > 1.4 → AC/DC warning (validation reste Prêt car ratio >= 0.8)", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={20}
        totalDcKw={10}
        selectedInverter={{ name: "Onduleur 5kW", acPowerKw: 5 }}
      />
    );
    expect(screen.getByText(/2\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Onduleur surdimensionné/)).toBeInTheDocument();
    expect(screen.getByText("Prêt")).toBeInTheDocument();
  });
});

describe("isPhase3ChecklistOk", () => {
  it("0 panneau → false", () => {
    expect(
      isPhase3ChecklistOk({ panelCount: 0, totalDcKw: 0, selectedInverter: null })
    ).toBe(false);
  });

  it("panneau + pas onduleur → false", () => {
    expect(
      isPhase3ChecklistOk({
        panelCount: 10,
        totalDcKw: 4.5,
        selectedInverter: null,
      })
    ).toBe(false);
  });

  it("panneau + onduleur ratio OK → true", () => {
    expect(
      isPhase3ChecklistOk({
        panelCount: 12,
        totalDcKw: 5.4,
        selectedInverter: { name: "Inv", acPowerKw: 5 },
      })
    ).toBe(true);
  });

  it("ratio < 0.8 → false", () => {
    expect(
      isPhase3ChecklistOk({
        panelCount: 5,
        totalDcKw: 2,
        selectedInverter: { name: "Inv", acPowerKw: 5 },
      })
    ).toBe(false);
  });

  it("ratio >= 0.8 (ex: 2.0) → true", () => {
    expect(
      isPhase3ChecklistOk({
        panelCount: 20,
        totalDcKw: 10,
        selectedInverter: { name: "Inv", acPowerKw: 5 },
      })
    ).toBe(true);
  });
});
