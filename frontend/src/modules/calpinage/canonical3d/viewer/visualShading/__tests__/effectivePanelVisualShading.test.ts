import { describe, it, expect } from "vitest";
import { buildDemoSolarScene3D } from "../../demoSolarScene3d";
import { getEffectivePanelVisualShading } from "../effectivePanelVisualShading";

describe("getEffectivePanelVisualShading", () => {
  it("priorité runtime AVAILABLE sur near", () => {
    const base = buildDemoSolarScene3D();
    const scene = {
      ...base,
      panelVisualShadingByPanelId: {
        "pv-1": {
          panelId: "pv-1",
          lossPct: 5,
          qualityScore01: 0.95,
          state: "AVAILABLE" as const,
          provenance: "runtime_per_panel" as const,
        },
      },
    };
    const v = getEffectivePanelVisualShading("pv-1", scene);
    expect(v.lossPct).toBe(5);
    expect(v.provenance).toBe("runtime_per_panel");
  });

  it("runtime MISSING → secours near snapshot", () => {
    const base = buildDemoSolarScene3D();
    const scene = {
      ...base,
      panelVisualShadingByPanelId: {
        "pv-1": {
          panelId: "pv-1",
          lossPct: null,
          qualityScore01: null,
          state: "MISSING" as const,
          provenance: "runtime_per_panel" as const,
        },
      },
    };
    const v = getEffectivePanelVisualShading("pv-1", scene);
    expect(v.state).toBe("AVAILABLE");
    expect(v.provenance).toBe("near_snapshot_mean_fraction");
    expect(v.lossPct).not.toBeNull();
  });
});
