/**
 * CFIX-1 — getPhase2Data expose hasExistingGeometry pour la sidebar Phase 2.
 */
import { describe, it, expect, afterEach } from "vitest";
import { usePhase2Data } from "../usePhase2Data";
import { renderHook } from "@testing-library/react";

describe("usePhase2Data", () => {
  const prevGetPhase2Data = (window as unknown as { getPhase2Data?: () => unknown }).getPhase2Data;

  afterEach(() => {
    if (prevGetPhase2Data) {
      (window as unknown as { getPhase2Data?: () => unknown }).getPhase2Data = prevGetPhase2Data;
    } else {
      delete (window as unknown as { getPhase2Data?: () => unknown }).getPhase2Data;
    }
    delete (window as unknown as { getPhase2ActiveTool?: () => string }).getPhase2ActiveTool;
  });

  it("expose hasExistingGeometry depuis getPhase2Data", () => {
    (window as unknown as { getPhase2Data: () => Record<string, unknown> }).getPhase2Data = () => ({
      contourClosed: true,
      ridgeDefined: false,
      heightsDefined: false,
      obstaclesCount: 0,
      canValidate: false,
      validateHint: "",
      captured: true,
      hasExistingGeometry: true,
    });
    (window as unknown as { getPhase2ActiveTool: () => string }).getPhase2ActiveTool = () => "select";

    const { result } = renderHook(() => usePhase2Data());
    expect(result.current.hasExistingGeometry).toBe(true);
    expect(result.current.captured).toBe(true);
  });

  it("hasExistingGeometry false si absent du legacy", () => {
    (window as unknown as { getPhase2Data: () => Record<string, unknown> }).getPhase2Data = () => ({
      contourClosed: false,
      ridgeDefined: false,
      heightsDefined: false,
      obstaclesCount: 0,
      canValidate: false,
      validateHint: "",
      captured: false,
    });
    (window as unknown as { getPhase2ActiveTool: () => string }).getPhase2ActiveTool = () => "contour";

    const { result } = renderHook(() => usePhase2Data());
    expect(result.current.hasExistingGeometry).toBe(false);
  });
});
