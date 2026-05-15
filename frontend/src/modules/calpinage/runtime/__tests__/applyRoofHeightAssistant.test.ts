import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRoofHeightAssistant,
  buildRoofHeightAssistantTargets,
  summarizeRoofHeightAssistantRuntime,
} from "../applyRoofHeightAssistant";

const runtime = {
  contours: [
    { roofRole: "main", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    { roofRole: "chienAssis", points: [{ x: 1, y: 1 }] },
  ],
  ridges: [
    { roofRole: "main", a: { x: 5, y: 0 }, b: { x: 5, y: 10 } },
    { roofRole: "chienAssis", a: { x: 1, y: 1 }, b: { x: 2, y: 2 } },
  ],
  traits: [{ roofRole: "valley", a: { x: 0, y: 5 }, b: { x: 10, y: 5 } }],
};

describe("applyRoofHeightAssistant", () => {
  afterEach(() => {
    delete (window as unknown as { __calpinageApplyStructuralHeightSelection?: unknown }).__calpinageApplyStructuralHeightSelection;
  });

  it("résume les lignes structurelles sans compter les chiens assis", () => {
    expect(summarizeRoofHeightAssistantRuntime(runtime)).toEqual({
      contourPointCount: 3,
      ridgeEndpointCount: 2,
      traitEndpointCount: 2,
    });
  });

  it("prépare les cibles égout/faîtage/trait en batch", () => {
    const targets = buildRoofHeightAssistantTargets(runtime, {
      eaveHeightM: 4,
      ridgeHeightM: 7,
      traitHeightM: 5.5,
    });
    expect(targets).toHaveLength(7);
    expect(targets.filter((t) => t.source === "eave")).toHaveLength(3);
    expect(targets.filter((t) => t.source === "ridge")).toHaveLength(2);
    expect(targets.filter((t) => t.source === "trait")).toHaveLength(2);
  });

  it("applique les hauteurs via la chaîne structurelle legacy", () => {
    const fn = vi.fn().mockReturnValue({ ok: true });
    (window as unknown as { __calpinageApplyStructuralHeightSelection: typeof fn }).__calpinageApplyStructuralHeightSelection = fn;
    const result = applyRoofHeightAssistant(runtime, {
      eaveHeightM: 4,
      ridgeHeightM: 7,
      traitHeightM: null,
    });
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(5);
    expect(fn).toHaveBeenCalledTimes(5);
    expect(fn).toHaveBeenCalledWith({ type: "contour", index: 0, pointIndex: 0 }, 4);
    expect(fn).toHaveBeenCalledWith({ type: "ridge", index: 0, pointIndex: 1 }, 7);
  });
});
