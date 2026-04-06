/**
 * Alignement contrat frontend / backend — perte globale = combined.totalLossPct.
 */
import { describe, it, expect } from "vitest";
import {
  getGlobalShadingLossPctForCalpinageShadingState,
  getOfficialGlobalShadingLossPct,
  getOfficialGlobalShadingLossPctOr,
} from "../officialGlobalShadingLoss.js";

describe("getOfficialGlobalShadingLossPct", () => {
  it("lit combined.totalLossPct en priorité", () => {
    expect(
      getOfficialGlobalShadingLossPct({
        combined: { totalLossPct: 8 },
        totalLossPct: 3,
        near: { totalLossPct: 1 },
      })
    ).toBe(8);
  });

  it("racine seulement si pas de clé totalLossPct sur combined", () => {
    expect(getOfficialGlobalShadingLossPct({ totalLossPct: 6.2 })).toBe(6.2);
  });

  it("combined null explicite → null (pas la racine)", () => {
    expect(
      getOfficialGlobalShadingLossPct({
        combined: { totalLossPct: null },
        totalLossPct: 9,
      })
    ).toBeNull();
  });

  it("missing_gps → null", () => {
    expect(
      getOfficialGlobalShadingLossPct({
        shadingQuality: { blockingReason: "missing_gps" },
        combined: { totalLossPct: 4 },
      })
    ).toBeNull();
  });
});

describe("getOfficialGlobalShadingLossPctOr", () => {
  it("null → défaut", () => {
    expect(getOfficialGlobalShadingLossPctOr(null, 0)).toBe(0);
  });
});

/** TEST affichage unique : near.official / near.totalLossPct ne remplacent pas combined */
describe("getGlobalShadingLossPctForCalpinageShadingState", () => {
  it("normalized → même règle que getOfficial (combined)", () => {
    expect(
      getGlobalShadingLossPctForCalpinageShadingState({
        normalized: {
          near: { totalLossPct: 20, official: { engine: "x" } },
          far: { totalLossPct: 3, source: "RELIEF_ONLY" },
          combined: { totalLossPct: 12 },
          totalLossPct: 12,
        },
      })
    ).toBe(12);
  });

  it("sans normalized : lastResult.annualLossPercent → lecture via forme { combined }", () => {
    expect(
      getGlobalShadingLossPctForCalpinageShadingState({
        normalized: null,
        lastResult: { annualLossPercent: 7.25, nearLossPct: 2, farLossPct: 5 },
      })
    ).toBe(7.25);
  });

  it("near.totalLossPct seul dans lastResult ne sert pas de global", () => {
    expect(
      getGlobalShadingLossPctForCalpinageShadingState({
        normalized: null,
        lastResult: { nearLossPct: 99 },
      })
    ).toBeNull();
  });
});
