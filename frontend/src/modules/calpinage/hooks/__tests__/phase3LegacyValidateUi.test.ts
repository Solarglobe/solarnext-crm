import { describe, expect, it, vi, afterEach } from "vitest";
import {
  computeLegacyPhase3CanValidate,
  getPhase3ValidateBlockedHint,
  hasPhase3CatalogModuleSelected,
} from "../phase3LegacyValidateUi";

function mockWin(partial: Record<string, unknown>) {
  vi.stubGlobal("window", { ...window, ...partial } as Window & typeof globalThis);
}

describe("phase3LegacyValidateUi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hasPhase3CatalogModuleSelected — PV_SELECTED_PANEL.id", () => {
    mockWin({ PV_SELECTED_PANEL: { id: "p1" }, CALPINAGE_SELECTED_PANEL_ID: undefined });
    expect(hasPhase3CatalogModuleSelected()).toBe(true);
  });

  it("hasPhase3CatalogModuleSelected — CALPINAGE_SELECTED_PANEL_ID seul", () => {
    mockWin({ PV_SELECTED_PANEL: undefined, CALPINAGE_SELECTED_PANEL_ID: "x" });
    expect(hasPhase3CatalogModuleSelected()).toBe(true);
  });

  it("computeLegacyPhase3CanValidate — refus si 0 panneau posé", () => {
    mockWin({
      PV_SELECTED_PANEL: { id: "p1" },
      CALPINAGE_SELECTED_INVERTER_ID: "inv1",
      PV_SELECTED_INVERTER: { id: "inv1" },
      pvPlacementEngine: { getAllPanels: () => [] },
      getPhase3ChecklistOk: () => true,
    });
    expect(computeLegacyPhase3CanValidate()).toBe(false);
    expect(getPhase3ValidateBlockedHint()).toMatch(/Posez au moins un module/);
  });

  it("computeLegacyPhase3CanValidate — ok si toutes les conditions legacy", () => {
    mockWin({
      PV_SELECTED_PANEL: { id: "p1" },
      PV_SELECTED_INVERTER: { id: "inv1" },
      pvPlacementEngine: { getAllPanels: () => [{}, {}] },
      getPhase3ChecklistOk: () => true,
    });
    expect(computeLegacyPhase3CanValidate()).toBe(true);
    expect(getPhase3ValidateBlockedHint()).toBeNull();
  });
});
