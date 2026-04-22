import { describe, expect, it, afterEach, vi } from "vitest";
import { tryCommitPvPlacementFrom3dRoofHit } from "../pvPlacementFrom3dWorldHit";

const wc = {
  metersPerPixel: 0.05,
  northAngleDeg: 0,
  referenceFrame: "LOCAL_IMAGE_ENU" as const,
};

describe("tryCommitPvPlacementFrom3dRoofHit", () => {
  afterEach(() => {
    const w = window as unknown as { __calpinageCommitPvPlacementFrom3DImagePoint?: unknown };
    delete w.__calpinageCommitPvPlacementFrom3DImagePoint;
  });

  it("refuse si la passerelle legacy n’est pas montée", () => {
    const r = tryCommitPvPlacementFrom3dRoofHit({
      panId: "p1",
      worldPointM: { x: 1, y: 2, z: 0 },
      worldConfig: wc,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEGACY_UNAVAILABLE");
  });

  it("convertit monde → image puis délègue au legacy", () => {
    const fn = vi.fn().mockReturnValue({ ok: true, blockId: "blk-1" });
    (window as unknown as { __calpinageCommitPvPlacementFrom3DImagePoint: typeof fn }).__calpinageCommitPvPlacementFrom3DImagePoint =
      fn;
    const r = tryCommitPvPlacementFrom3dRoofHit({
      panId: "pan-nord",
      worldPointM: { x: 10, y: 20, z: 0 },
      worldConfig: wc,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.panId).toBe("pan-nord");
      expect(r.blockId).toBe("blk-1");
      expect(r.imagePx.x).toBeGreaterThan(-1e9);
      expect(r.imagePx.y).toBeGreaterThan(-1e9);
    }
    expect(fn).toHaveBeenCalledTimes(1);
    const argCenter = fn.mock.calls[0][1] as { x: number; y: number };
    expect(typeof argCenter.x).toBe("number");
    expect(typeof argCenter.y).toBe("number");
  });
});
