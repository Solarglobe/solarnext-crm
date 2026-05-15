/**
 * Blindage UX - activeTool Phase 3 : toujours "panels" | "select",
 * jamais vide ni brut inattendu.
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePhase3Data } from "../usePhase3Data";
import { bootstrapCalpinageStore } from "../../store/adapters/legacyCalpinageStateAdapter";

describe("usePhase3Data - activeTool", () => {
  const win = window as unknown as {
    getPhase3ActiveTool?: () => unknown;
    CALPINAGE_DP2_STATE?: { currentTool?: unknown };
  };

  afterEach(() => {
    delete win.getPhase3ActiveTool;
    delete win.CALPINAGE_DP2_STATE;
  });

  it("retourne panels si getPhase3ActiveTool absent ou valeur vide", () => {
    const teardown = bootstrapCalpinageStore();
    const { result, unmount } = renderHook(() => usePhase3Data());
    expect(result.current.activeTool).toBe("panels");
    unmount();
    teardown();

    win.getPhase3ActiveTool = () => undefined;
    const teardown2 = bootstrapCalpinageStore();
    const { result: r2, unmount: unmount2 } = renderHook(() => usePhase3Data());
    expect(r2.current.activeTool).toBe("panels");
    unmount2();
    teardown2();
  });

  it("retourne select lorsque le legacy expose select", () => {
    win.getPhase3ActiveTool = () => "select";
    const teardown = bootstrapCalpinageStore();
    const { result, unmount } = renderHook(() => usePhase3Data());
    expect(result.current.activeTool).toBe("select");
    unmount();
    teardown();
  });

  it("lit CALPINAGE_DP2_STATE quand le getter legacy est hors contrat", () => {
    win.getPhase3ActiveTool = () => "rotate";
    win.CALPINAGE_DP2_STATE = { currentTool: "select" };
    const teardown = bootstrapCalpinageStore();
    const { result, unmount } = renderHook(() => usePhase3Data());
    expect(result.current.activeTool).toBe("select");
    unmount();
    teardown();
  });
});
