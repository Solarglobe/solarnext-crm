/**
 * Entrée legacy toiture : priorité `calpinageStateToLegacyRoofInput`, repli mapper historique.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as calpinageRoofAdapter from "../../adapter/calpinageStateToLegacyRoofInput";
import type { LegacyRoofGeometryInput } from "../../canonical3d/builder/legacyInput";
import { mapCalpinageRoofToLegacyRoofGeometryInput } from "../mapCalpinageToCanonicalNearShading";

const baseRoof = {
  scale: { metersPerPixel: 0.02 },
  roof: { north: { angleDeg: 12 } },
  roofPans: [
    {
      id: "p1",
      polygonPx: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    },
  ],
};

describe("mapCalpinageRoofToLegacyRoofGeometryInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
  });

  it("Cas A — chemin riche null → fallback (defaultHeightM 5, comportement historique)", () => {
    vi.spyOn(calpinageRoofAdapter, "calpinageStateToLegacyRoofInput").mockReturnValue(null);

    const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(baseRoof, null);
    expect(legacy).not.toBeNull();
    expect(legacy!.defaultHeightM).toBe(5);
    expect(legacy!.pans).toHaveLength(1);
    expect(legacy!.pans[0]!.id).toBe("p1");
    expect(legacy!.pans[0]!.polygonPx).toHaveLength(3);
    expect(legacy!.pans[0]!.tiltDegHint).toBeUndefined();
    expect(legacy!.northAngleDeg).toBe(12);
  });

  it("Cas A bis — chemin riche non exploitable (mpp invalide) → fallback", () => {
    vi.spyOn(calpinageRoofAdapter, "calpinageStateToLegacyRoofInput").mockReturnValue({
      metersPerPixel: -1,
      northAngleDeg: 0,
      defaultHeightM: 5.5,
      pans: [{ id: "x", polygonPx: [{ xPx: 0, yPx: 0 }] }],
    } as unknown as LegacyRoofGeometryInput);

    const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(baseRoof, null);
    expect(legacy?.defaultHeightM).toBe(5);
    expect(legacy?.pans[0]!.polygonPx.length).toBeGreaterThanOrEqual(3);
  });

  it("Cas B — chemin riche exploitable → retourné tel quel", () => {
    const rich = {
      metersPerPixel: 0.02,
      northAngleDeg: 12,
      defaultHeightM: 5.5,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 4.2 },
            { xPx: 100, yPx: 0, heightM: 4.2 },
            { xPx: 100, yPx: 100, heightM: 4.2 },
          ],
          sourceIndex: 0,
        },
      ],
    };
    vi.spyOn(calpinageRoofAdapter, "calpinageStateToLegacyRoofInput").mockReturnValue(rich);

    const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(baseRoof, null);
    expect(legacy).toBe(rich);
    expect(legacy!.defaultHeightM).toBe(5.5);
    expect(legacy!.pans[0]!.polygonPx[0]!.heightM).toBe(4.2);
  });

  it("Cas C — hints physical transmis via chemin riche", () => {
    const rich = {
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      defaultHeightM: 5.5,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0 },
            { xPx: 10, yPx: 0 },
            { xPx: 10, yPx: 10 },
          ],
          tiltDegHint: 32,
          azimuthDegHint: 178,
        },
      ],
    };
    vi.spyOn(calpinageRoofAdapter, "calpinageStateToLegacyRoofInput").mockReturnValue(rich);

    const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(baseRoof, null);
    expect(legacy!.pans[0]!.tiltDegHint).toBe(32);
    expect(legacy!.pans[0]!.azimuthDegHint).toBe(178);
  });
});
