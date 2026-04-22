/**
 * Prompt 7 — debounce / consolidation des events structurels officiels.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE } from "../../canonical3d/scene/sceneRuntimeStructuralSignature";
import {
  emitOfficialRuntimeStructuralChange,
  flushOfficialRuntimeStructuralChangeNowForTests,
  resetOfficialRuntimeStructuralChangeDebouncerForTests,
} from "../emitOfficialRuntimeStructuralChange";

describe("emitOfficialRuntimeStructuralChange (Prompt 7)", () => {
  afterEach(() => {
    resetOfficialRuntimeStructuralChangeDebouncerForTests();
  });

  it("fusionne raisons et domaines en un seul événement après flush", () => {
    const spy = vi.fn();
    window.addEventListener(CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE, spy);
    emitOfficialRuntimeStructuralChange({ reason: "PAN_UPDATED", changedDomains: ["pans"] });
    emitOfficialRuntimeStructuralChange({ reason: "PV_PLACEMENT_SYNC", changedDomains: ["pv"] });
    flushOfficialRuntimeStructuralChangeNowForTests();
    expect(spy).toHaveBeenCalledTimes(1);
    const ev = spy.mock.calls[0]![0] as CustomEvent<{ reason: string; changedDomains: string[] }>;
    expect(ev.detail.reason).toBe("PAN_UPDATED+PV_PLACEMENT_SYNC");
    expect(ev.detail.changedDomains).toEqual(["pans", "pv"]);
    window.removeEventListener(CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE, spy);
  });
});
