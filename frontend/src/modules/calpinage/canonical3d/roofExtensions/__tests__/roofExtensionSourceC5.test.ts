import { describe, expect, it } from "vitest";
import { readRuntimeRoofExtensionSources } from "../roofExtensionSource";

function makeState(totalHeightM: number, ridgeHeightRelM?: number) {
  return {
    roofExtensions: [
      {
        id: "ext-1",
        canonicalV1: {
          version: "roof_extension_v1",
          footprintPx: [
            { x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 10, y: 40 },
          ],
          dimensions: { totalHeightM, wallHeightM: 0.4 },
        },
        ...(ridgeHeightRelM != null ? { ridgeHeightRelM } : {}),
      },
    ],
  };
}

describe("C5 -- totalHeightM guard dans roofExtensionSource", () => {
  it("totalHeightM dans la plage realiste (<= 4m) est utilise comme ridgeHeightRelM", () => {
    const sources = readRuntimeRoofExtensionSources(makeState(1.15));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.ridgeHeightRelM).toBeCloseTo(1.15, 6);
    expect(sources[0]!.warnings.some((w) => w.startsWith("ROOF_EXTENSION_TOTAL_HEIGHT_SUSPICIOUS"))).toBe(false);
  });

  it("totalHeightM > 4m emet ROOF_EXTENSION_TOTAL_HEIGHT_SUSPICIOUS et ignore la valeur", () => {
    const sources = readRuntimeRoofExtensionSources(makeState(6.5, 1.2));
    expect(sources).toHaveLength(1);
    // ridgeHeightRelM falls back to raw.ridgeHeightRelM (1.2), not 6.5
    expect(sources[0]!.ridgeHeightRelM).toBeCloseTo(1.2, 6);
    expect(sources[0]!.warnings.some((w) => w.startsWith("ROOF_EXTENSION_TOTAL_HEIGHT_SUSPICIOUS"))).toBe(true);
  });

  it("totalHeightM > 4m sans fallback ridgeHeightRelM => ridgeHeightRelM = null", () => {
    const sources = readRuntimeRoofExtensionSources(makeState(10.0));
    expect(sources[0]!.ridgeHeightRelM).toBeNull();
    expect(sources[0]!.warnings.some((w) => w.startsWith("ROOF_EXTENSION_TOTAL_HEIGHT_SUSPICIOUS"))).toBe(true);
  });

  it("totalHeightM exactement a 4m est accepte sans warning", () => {
    const sources = readRuntimeRoofExtensionSources(makeState(4.0));
    expect(sources[0]!.ridgeHeightRelM).toBeCloseTo(4.0, 6);
    expect(sources[0]!.warnings.some((w) => w.startsWith("ROOF_EXTENSION_TOTAL_HEIGHT_SUSPICIOUS"))).toBe(false);
  });
});
