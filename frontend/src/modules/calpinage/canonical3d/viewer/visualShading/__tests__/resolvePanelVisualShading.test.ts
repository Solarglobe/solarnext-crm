import { describe, it, expect } from "vitest";
import {
  lossPctToQualityScore01,
  buildLossPctByPanelIdFromPerPanelRows,
  resolvePanelVisualShadingForPanels,
  buildPanelVisualShadingMapFromRuntime,
  extractRuntimeShadingSummary,
} from "../resolvePanelVisualShading";

describe("lossPctToQualityScore01", () => {
  it("0 percent -> 1", () => {
    expect(lossPctToQualityScore01(0)).toBe(1);
  });

  it("100 percent -> 0", () => {
    expect(lossPctToQualityScore01(100)).toBe(0);
  });

  it("5 percent -> 0.95", () => {
    expect(lossPctToQualityScore01(5)).toBeCloseTo(0.95, 6);
  });

  it("clamp > 100", () => {
    expect(lossPctToQualityScore01(120)).toBe(0);
  });

  it("clamp < 0", () => {
    expect(lossPctToQualityScore01(-10)).toBe(1);
  });
});

describe("buildLossPctByPanelIdFromPerPanelRows", () => {
  it("ignore pertes invalides", () => {
    const m = buildLossPctByPanelIdFromPerPanelRows([
      { panelId: "a", lossPct: NaN },
      { panelId: "b", lossPct: 150 },
      { id: "c", lossPct: -1 },
    ]);
    expect(m.get("a")).toBe("invalid");
    expect(m.get("b")).toBe("invalid");
    expect(m.get("c")).toBe("invalid");
  });

  it("accepte panelId ou id", () => {
    const m = buildLossPctByPanelIdFromPerPanelRows([{ id: "x", lossPct: 10 }]);
    expect(m.get("x")).toBe(10);
  });
});

describe("resolvePanelVisualShadingForPanels", () => {
  it("correspondance exacte -> AVAILABLE", () => {
    const map = new Map<string, number | "invalid">([["p1", 12]]);
    const out = resolvePanelVisualShadingForPanels(["p1"], map);
    expect(out.p1!.state).toBe("AVAILABLE");
    expect(out.p1!.lossPct).toBe(12);
    expect(out.p1!.qualityScore01).toBeCloseTo(0.88, 5);
  });

  it("sans correspondance -> MISSING", () => {
    const out = resolvePanelVisualShadingForPanels(["p9"], new Map());
    expect(out.p9!.state).toBe("MISSING");
    expect(out.p9!.lossPct).toBeNull();
  });

  it("perte invalide stockee -> INVALID", () => {
    const map = new Map<string, number | "invalid">([["p1", "invalid"]]);
    const out = resolvePanelVisualShadingForPanels(["p1"], map);
    expect(out.p1!.state).toBe("INVALID");
  });
});

describe("buildPanelVisualShadingMapFromRuntime", () => {
  it("extrait shading.perPanel du runtime", () => {
    const runtime = {
      shading: {
        perPanel: [
          { panelId: "a", lossPct: 0 },
          { panelId: "b", lossPct: 25 },
        ],
      },
    };
    const out = buildPanelVisualShadingMapFromRuntime(["a", "b", "c"], runtime);
    expect(out.a!.qualityScore01).toBe(1);
    expect(out.b!.lossPct).toBe(25);
    expect(out.c!.state).toBe("MISSING");
  });

  it("lit aussi shading.normalized.perPanel du runtime legacy", () => {
    const runtime = {
      shading: {
        normalized: {
          perPanel: [{ panelId: "legacy-pv", lossPct: 18 }],
        },
      },
    };
    const out = buildPanelVisualShadingMapFromRuntime(["legacy-pv"], runtime);
    expect(out["legacy-pv"]!.state).toBe("AVAILABLE");
    expect(out["legacy-pv"]!.lossPct).toBe(18);
  });

  it("runtime sans shading -> tous MISSING", () => {
    const out = buildPanelVisualShadingMapFromRuntime(["x"], {});
    expect(out.x!.state).toBe("MISSING");
  });
});

describe("extractRuntimeShadingSummary", () => {
  it("lit le resume normalise du runtime legacy", () => {
    const out = extractRuntimeShadingSummary({
      shading: {
        normalized: {
          totalLossPct: 12.4,
          near: { totalLossPct: 7.1 },
          far: { totalLossPct: 5.7 },
          panelCount: 8,
          computedAt: 123,
        },
      },
    });
    expect(out).toEqual({
      totalLossPct: 12.4,
      nearLossPct: 7.1,
      farLossPct: 5.7,
      panelCount: 8,
      computedAt: 123,
      blockingReason: null,
    });
  });

  it("remonte la raison GPS absent", () => {
    const out = extractRuntimeShadingSummary({
      shading: {
        normalized: {
          totalLossPct: null,
          near: { totalLossPct: null },
          far: { totalLossPct: null, source: "UNAVAILABLE_NO_GPS" },
          shadingQuality: { blockingReason: "missing_gps" },
          panelCount: 0,
        },
      },
    });
    expect(out?.blockingReason).toBe("missing_gps");
    expect(out?.totalLossPct).toBeNull();
  });
});
