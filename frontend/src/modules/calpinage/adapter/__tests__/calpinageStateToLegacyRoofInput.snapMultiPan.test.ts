/**
 * Niveau 2 — snap inter-pans sur l’adaptateur (px, tolérance liée au mpp).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { legacySharedCornerClusterTolPx } from "../../canonical3d/builder/legacyRoofPixelTolerances";
import { calpinageStateToLegacyRoofInput } from "../calpinageStateToLegacyRoofInput";

describe("calpinageStateToLegacyRoofInput — snap multi-pans", () => {
  afterEach(() => {
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
    vi.restoreAllMocks();
  });

  it("rapproche les sommets de bord commun entre deux pans dans la tolérance px", () => {
    (window as unknown as { getHeightAtXY: () => undefined }).getHeightAtXY = vi.fn().mockReturnValue(undefined);

    const mpp = 0.02;
    const tol = legacySharedCornerClusterTolPx(mpp);
    expect(tol).toBeGreaterThanOrEqual(6);
    const gap = tol;

    const roof = {
      scale: { metersPerPixel: mpp },
      roof: { north: { angleDeg: 0 } },
    };

    const runtime = {
      pans: [
        {
          id: "pa",
          polygonPx: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        },
        {
          id: "pb",
          polygonPx: [
            { x: 200 + gap, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 200 },
            { x: 200 + gap, y: 200 },
          ],
        },
      ],
    };

    const input = calpinageStateToLegacyRoofInput(roof, {}, { warnIfNoRuntime: false }, runtime);
    expect(input).not.toBeNull();
    const pa = input!.pans.find((p) => p.id === "pa")!;
    const pb = input!.pans.find((p) => p.id === "pb")!;
    const xShared = 200 + gap / 2;
    expect(pa.polygonPx[1]!.xPx).toBeCloseTo(xShared, 5);
    expect(pb.polygonPx[0]!.xPx).toBeCloseTo(xShared, 5);
    expect(pa.polygonPx[2]!.xPx).toBeCloseTo(xShared, 5);
    expect(pb.polygonPx[3]!.xPx).toBeCloseTo(xShared, 5);
  });
});
