import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OFFICIAL_GLOBAL_LOSS_CONTRACT,
  diagnoseGlobalLossMismatch,
  warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend,
} from "../shadingGovernance";
import { getOfficialGlobalShadingLossPct } from "../officialGlobalShadingLoss";

describe("shadingGovernance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("contrat global aligné avec le backend (chaîne stable)", () => {
    expect(OFFICIAL_GLOBAL_LOSS_CONTRACT).toBe("shading.combined.totalLossPct");
  });

  it("diagnoseGlobalLossMismatch : ok sous tolérance", () => {
    expect(diagnoseGlobalLossMismatch(10, 10.3, 0.5, "t")).toEqual({ ok: true });
  });

  it("diagnoseGlobalLossMismatch : skip si null", () => {
    expect(diagnoseGlobalLossMismatch(null, 5)).toMatchObject({ ok: true, skipped: true });
  });

  it("diagnoseGlobalLossMismatch : ko + warn en dev si écart large", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = diagnoseGlobalLossMismatch(10, 20, 0.5, "test-mismatch");
    expect(r.ok).toBe(false);
    expect(r.delta).toBe(10);
    if (!import.meta.env.PROD) {
      expect(warn).toHaveBeenCalled();
    }
  });

  it("lecture officielle globale ignore near isolé (pas de promotion accidentelle)", () => {
    expect(
      getOfficialGlobalShadingLossPct({
        near: { totalLossPct: 80 },
        combined: { totalLossPct: 5 },
      })
    ).toBe(5);
  });

  it("warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend ne spam pas", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend(true);
    warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend(true);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
