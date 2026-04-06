import { describe, expect, it } from "vitest";
import {
  getProjectProgress,
  getNextStep,
  formatProjectStatus,
  getProjectTracking,
} from "../projectPvTracking";
import type { Lead } from "../../../services/leads.service";

describe("projectPvTracking (suivi PV)", () => {
  it("getProjectProgress — statuts métier PV", () => {
    expect(getProjectProgress("ETUDE")).toBe(10);
    expect(getProjectProgress("MAIRIE")).toBe(30);
    expect(getProjectProgress("ACCORD_MAIRIE")).toBe(50);
    expect(getProjectProgress("PLANIFICATION")).toBe(70);
    expect(getProjectProgress("INSTALLATION")).toBe(85);
    expect(getProjectProgress("RACCORDEMENT")).toBe(95);
    expect(getProjectProgress("TERMINE")).toBe(100);
  });

  it("getProjectProgress — statuts API existants (non 0)", () => {
    expect(getProjectProgress("SIGNE")).toBeGreaterThan(0);
    expect(getProjectProgress("CLOTURE")).toBe(100);
  });

  it("getProjectProgress — inconnu → 0", () => {
    expect(getProjectProgress(undefined)).toBe(0);
    expect(getProjectProgress("INCONNU")).toBe(0);
  });

  it("getNextStep — étapes métier PV", () => {
    expect(getNextStep("ETUDE")).toBe("Finaliser étude");
    expect(getNextStep("MAIRIE")).toBe("Attente mairie");
    expect(getNextStep("TERMINE")).toBe("Projet terminé");
  });

  it("getNextStep — statut inconnu → -", () => {
    expect(getNextStep("UNKNOWN_CODE")).toBe("-");
  });

  it("formatProjectStatus — libellé lisible", () => {
    expect(formatProjectStatus("SIGNE")).toBe("Signé");
    expect(formatProjectStatus("DP_DEPOSE")).toBe("DP déposé");
  });

  it("getProjectTracking — aligné sur progress / nextStep / libellé", () => {
    const lead = {
      project_status: "DP_A_DEPOSER",
    } as Lead;
    const t = getProjectTracking(lead);
    expect(t.progress).toBe(getProjectProgress("DP_A_DEPOSER"));
    expect(t.nextStep).toBe(getNextStep("DP_A_DEPOSER"));
    expect(t.statusLabel).toBe(formatProjectStatus("DP_A_DEPOSER"));
  });

  it("getProjectTracking — sans statut", () => {
    const lead = {} as Lead;
    const t = getProjectTracking(lead);
    expect(t.progress).toBe(0);
    expect(t.nextStep).toBe("—");
    expect(t.statusLabel).toBe("—");
  });
});
