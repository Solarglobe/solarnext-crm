/**
 * Correctif HeightStateContext → P1 actif dans l’adaptateur legacy (toiture non plate).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { calpinageStateToLegacyRoofInput } from "../calpinageStateToLegacyRoofInput";
import { buildRoofModel3DFromLegacyGeometry } from "../../canonical3d/builder/buildRoofModel3DFromLegacyGeometry";

function baseRoof() {
  return {
    scale: { metersPerPixel: 0.02 },
    roof: { north: { angleDeg: 0 } },
  };
}

describe("calpinageStateToLegacyRoofInput — HeightStateContext + h explicites ridges", () => {
  afterEach(() => {
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
    vi.restoreAllMocks();
  });

  it("CAS 1 — contour 4 m + faîtage 7 m : legacy pan (P1) + ridge (h explicite) ont des heightM distincts ; mesh non plat si sommets pan ont des cotes différentes", () => {
    (window as unknown as { getHeightAtXY: () => undefined }).getHeightAtXY = vi.fn().mockReturnValue(undefined);

    const roof = baseRoof();
    const runtime = {
      ...roof,
      pans: [
        {
          id: "pan-a",
          polygonPx: [
            { x: 0, y: 0, h: 4 },
            { x: 100, y: 0, h: 4 },
            { x: 100, y: 100, h: 7 },
            { x: 0, y: 100, h: 7 },
          ],
        },
      ],
      contours: [
        {
          roofRole: "main",
          points: [
            { x: 0, y: 0, h: 4 },
            { x: 100, y: 0, h: 4 },
            { x: 100, y: 100, h: 4 },
            { x: 0, y: 100, h: 4 },
          ],
        },
      ],
      ridges: [
        {
          id: "ridge-1",
          roofRole: "main",
          a: { x: 50, y: 0, h: 7 },
          b: { x: 50, y: 100, h: 7 },
        },
      ],
    };

    const input = calpinageStateToLegacyRoofInput(roof, { ridges: runtime.ridges }, { warnIfNoRuntime: false }, runtime);
    expect(input).not.toBeNull();
    const hs = input!.pans[0]!.polygonPx.map((p) => p.heightM);
    expect(new Set(hs).size).toBeGreaterThan(1);
    expect(input!.ridges?.[0]?.a.heightM).toBe(7);
    expect(input!.ridges?.[0]?.b.heightM).toBe(7);

    const { model } = buildRoofModel3DFromLegacyGeometry(input!);
    const patch = model.roofPlanePatches[0]!;
    const zs = patch.cornersWorld.map((c) => c.z);
    expect(Math.min(...zs)).toBeLessThan(Math.max(...zs));
  });

  it("CAS 2 — ridge a.h / b.h uniquement : transmis dans LegacyStructuralLine2D", () => {
    (window as unknown as { getHeightAtXY: () => undefined }).getHeightAtXY = vi.fn().mockReturnValue(undefined);

    const roof = baseRoof();
    const ridges = [
      {
        id: "r-x",
        roofRole: "main",
        a: { x: 10, y: 10, h: 6.2 },
        b: { x: 90, y: 90, h: 6.8 },
      },
    ];
    const runtime = {
      ...roof,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { x: 0, y: 0, h: 5 },
            { x: 100, y: 0, h: 5 },
            { x: 100, y: 100, h: 5 },
            { x: 0, y: 100, h: 5 },
          ],
        },
      ],
    };

    const input = calpinageStateToLegacyRoofInput(roof, { ridges }, { warnIfNoRuntime: false }, runtime);
    expect(input?.ridges?.[0]?.a.heightM).toBeCloseTo(6.2, 5);
    expect(input?.ridges?.[0]?.b.heightM).toBeCloseTo(6.8, 5);
  });

  it("CAS 3 — pan sans h ; contour coté ; getHeightAtXY inutile → P1 remplit heightM", () => {
    (window as unknown as { getHeightAtXY: () => undefined }).getHeightAtXY = vi.fn().mockReturnValue(undefined);

    const roof = baseRoof();
    const runtime = {
      ...roof,
      pans: [
        {
          id: "pan-only",
          polygonPx: [
            { x: 10, y: 10 },
            { x: 200, y: 10 },
            { x: 200, y: 200 },
            { x: 10, y: 200 },
          ],
        },
      ],
      contours: [
        {
          roofRole: "main",
          points: [
            { x: 10, y: 10, h: 4.2 },
            { x: 200, y: 10, h: 4.2 },
            { x: 200, y: 200, h: 4.2 },
            { x: 10, y: 200, h: 4.2 },
          ],
        },
      ],
    };

    const input = calpinageStateToLegacyRoofInput(roof, null, { warnIfNoRuntime: false }, runtime);
    expect(input).not.toBeNull();
    for (const pt of input!.pans[0]!.polygonPx) {
      expect(pt.heightM).toBeCloseTo(4.2, 5);
    }
    expect((window as unknown as { getHeightAtXY: ReturnType<typeof vi.fn> }).getHeightAtXY).not.toHaveBeenCalled();
  });

  it("CAS 4 — buildRoofModel3DFromLegacyGeometry : patch avec zRange > 0 et normale de pente (cotes sommets différentes)", () => {
    (window as unknown as { getHeightAtXY: () => undefined }).getHeightAtXY = vi.fn().mockReturnValue(undefined);

    const roof = baseRoof();
    const runtime = {
      ...roof,
      pans: [
        {
          id: "pa",
          polygonPx: [
            { x: 0, y: 0, h: 4 },
            { x: 120, y: 0, h: 4 },
            { x: 120, y: 80, h: 8 },
            { x: 0, y: 80, h: 8 },
          ],
        },
      ],
    };

    const input = calpinageStateToLegacyRoofInput(roof, null, { warnIfNoRuntime: false }, runtime);
    expect(input).not.toBeNull();
    const { model } = buildRoofModel3DFromLegacyGeometry(input!);
    const patch = model.roofPlanePatches[0]!;
    const zs = patch.cornersWorld.map((c) => c.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1e-3);
    expect(Math.hypot(patch.normal.x, patch.normal.y)).toBeGreaterThan(1e-4);
  });

  it("h = 0 explicite sur sommet pan est conservé", () => {
    (window as unknown as { getHeightAtXY: () => undefined }).getHeightAtXY = vi.fn().mockReturnValue(undefined);
    const roof = baseRoof();
    const runtime = {
      ...roof,
      pans: [
        {
          id: "pz",
          polygonPx: [
            { x: 0, y: 0, h: 0 },
            { x: 50, y: 0, h: 3 },
            { x: 50, y: 50, h: 3 },
            { x: 0, y: 50, h: 3 },
          ],
        },
      ],
    };
    const input = calpinageStateToLegacyRoofInput(roof, null, { warnIfNoRuntime: false }, runtime);
    expect(input!.pans[0]!.polygonPx[0]!.heightM).toBe(0);
  });
});
