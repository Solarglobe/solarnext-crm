/**
 * CFIX-1 — usePhase2Data expose hasExistingGeometry pour la sidebar Phase 2.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { setupPhase2SidebarNotify, usePhase2Data } from "../usePhase2Data";
import { useCalpinageStore } from "../../store/calpinageStore";
import { act, renderHook } from "@testing-library/react";

describe("usePhase2Data", () => {
  const initialState = useCalpinageStore.getState();

  afterEach(() => {
    act(() => {
      useCalpinageStore.setState(initialState, true);
    });
    delete (window as unknown as { notifyPhase2SidebarUpdate?: unknown }).notifyPhase2SidebarUpdate;
  });

  it("expose hasExistingGeometry depuis le store Phase2", () => {
    act(() => {
      useCalpinageStore.setState({
        phase2: {
          activeTool: "select",
          contourClosed: true,
          ridgeDefined: false,
          heightsDefined: false,
          obstaclesCount: 0,
          canValidate: false,
          validateHint: "",
          captured: true,
          hasExistingGeometry: true,
        },
      });
    });

    const { result } = renderHook(() => usePhase2Data());
    expect(result.current.hasExistingGeometry).toBe(true);
    expect(result.current.captured).toBe(true);
  });

  it("hasExistingGeometry false par défaut avant bootstrap adapter", () => {
    act(() => {
      useCalpinageStore.setState({
        phase2: {
          activeTool: "contour",
          contourClosed: false,
          ridgeDefined: false,
          heightsDefined: false,
          obstaclesCount: 0,
          canValidate: false,
          validateHint: "",
          captured: false,
          hasExistingGeometry: false,
        },
      });
    });

    const { result } = renderHook(() => usePhase2Data());
    expect(result.current.hasExistingGeometry).toBe(false);
  });

  it("setupPhase2SidebarNotify expose une notification d'update Phase2", () => {
    const listener = vi.fn();
    window.addEventListener("phase2:update", listener);
    try {
      const cleanup = setupPhase2SidebarNotify();
      (window as unknown as { notifyPhase2SidebarUpdate: () => void }).notifyPhase2SidebarUpdate();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(cleanup).toBe((window as unknown as { notifyPhase2SidebarUpdate: unknown }).notifyPhase2SidebarUpdate);
    } finally {
      window.removeEventListener("phase2:update", listener);
    }
  });
});
