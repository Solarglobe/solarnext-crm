/**
 * Tests unitaires Phase3ChecklistValidation — P5-CHECKLIST-LOCKED
 * Vérifie la logique de validation CENTRAL vs MICRO et le bouton disabled.
 *
 * Exécuter : npm run test:phase3-checklist
 * ou : npx vitest run src/modules/calpinage/__tests__/Phase3ChecklistValidation.test.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Phase3ChecklistPanel, isPhase3ChecklistOk } from "../Phase3ChecklistPanel";

describe("Phase3ChecklistValidation — CENTRAL", () => {
  it("CENTRAL + ratio OK (0.8–1.4) → bouton actif (Prêt)", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={12}
        totalDcKw={5.4}
        selectedInverter={{ name: "Onduleur 5kW", acPowerKw: 5 }}
        inverterFamily="CENTRAL"
      />
    );
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    expect(
      isPhase3ChecklistOk({
        panelCount: 12,
        totalDcKw: 5.4,
        selectedInverter: { name: "Inv", acPowerKw: 5 },
        inverterFamily: "CENTRAL",
      })
    ).toBe(true);
  });

  it("CENTRAL + ratio < 0.8 → bouton bloqué (À compléter)", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={5}
        totalDcKw={2}
        selectedInverter={{ name: "Onduleur 5kW", acPowerKw: 5 }}
        inverterFamily="CENTRAL"
      />
    );
    expect(screen.getByText("À compléter")).toBeInTheDocument();
    expect(screen.getByText(/Onduleur sous-dimensionné/)).toBeInTheDocument();
    expect(
      isPhase3ChecklistOk({
        panelCount: 5,
        totalDcKw: 2,
        selectedInverter: { name: "Inv", acPowerKw: 5 },
        inverterFamily: "CENTRAL",
      })
    ).toBe(false);
  });
});

describe("Phase3ChecklistValidation — MICRO", () => {
  it("MICRO + panneaux + inverter → bouton actif (Prêt)", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={10}
        totalDcKw={4.5}
        selectedInverter={{ name: "Micro 0.5kW", acPowerKw: 0.5 }}
        inverterFamily="MICRO"
      />
    );
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    expect(screen.getByText("5.00 kW")).toBeInTheDocument();
    expect(
      isPhase3ChecklistOk({
        panelCount: 10,
        totalDcKw: 4.5,
        selectedInverter: { name: "Micro", acPowerKw: 0.5 },
        inverterFamily: "MICRO",
      })
    ).toBe(true);
  });

  it("MICRO + ratio > 1.4 → bouton actif (ratio indicatif, pas bloquant)", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={20}
        totalDcKw={12}
        selectedInverter={{ name: "Micro 0.4kW", acPowerKw: 0.4 }}
        inverterFamily="MICRO"
      />
    );
    expect(screen.getByText("Prêt")).toBeInTheDocument();
    expect(
      isPhase3ChecklistOk({
        panelCount: 20,
        totalDcKw: 12,
        selectedInverter: { name: "Micro", acPowerKw: 0.4 },
        inverterFamily: "MICRO",
      })
    ).toBe(true);
  });

  it("MICRO + 0 panneau → bloqué", () => {
    render(
      <Phase3ChecklistPanel
        panelCount={0}
        totalDcKw={0}
        selectedInverter={{ name: "Micro 0.5kW", acPowerKw: 0.5 }}
        inverterFamily="MICRO"
      />
    );
    expect(screen.getByText("À compléter")).toBeInTheDocument();
    expect(
      isPhase3ChecklistOk({
        panelCount: 0,
        totalDcKw: 0,
        selectedInverter: { name: "Micro", acPowerKw: 0.5 },
        inverterFamily: "MICRO",
      })
    ).toBe(false);
  });
});

describe("Phase3ChecklistValidation — cas communs", () => {
  it("Aucun inverter → bloqué", () => {
    expect(
      isPhase3ChecklistOk({
        panelCount: 10,
        totalDcKw: 4.5,
        selectedInverter: null,
        inverterFamily: "CENTRAL",
      })
    ).toBe(false);
    expect(
      isPhase3ChecklistOk({
        panelCount: 10,
        totalDcKw: 4.5,
        selectedInverter: null,
        inverterFamily: "MICRO",
      })
    ).toBe(false);
  });
});
