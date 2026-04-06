/**
 * Blindage UX — activeTool Phase 3 : toujours « panels » | « select », jamais vide ni brut inattendu.
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePhase3Data } from "../usePhase3Data";

describe("usePhase3Data — activeTool", () => {
  const win = window as unknown as {
    getPhase3ActiveTool?: () => unknown;
  };

  afterEach(() => {
    delete win.getPhase3ActiveTool;
  });

  it("retourne panels si getPhase3ActiveTool absent ou valeur vide", () => {
    const { result } = renderHook(() => usePhase3Data());
    expect(result.current.activeTool).toBe("panels");

    win.getPhase3ActiveTool = () => undefined;
    const { result: r2 } = renderHook(() => usePhase3Data());
    expect(r2.current.activeTool).toBe("panels");
  });

  it("retourne select lorsque le legacy expose select", () => {
    win.getPhase3ActiveTool = () => "select";
    const { result } = renderHook(() => usePhase3Data());
    expect(result.current.activeTool).toBe("select");
  });

  it("retombe sur panels pour une valeur hors contrat (comme le legacy)", () => {
    win.getPhase3ActiveTool = () => "rotate";
    const { result } = renderHook(() => usePhase3Data());
    expect(result.current.activeTool).toBe("panels");
  });
});
