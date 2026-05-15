import { describe, expect, it } from "vitest";
import { readRuntimeRoofExtensionSources } from "../roofExtensionSource";

describe("roofExtensionSource — apex vs hips après jitter léger (P0)", () => {
  it("ne signale pas ROOF_EXTENSION_APEX_HIP_MISMATCH quand hips≈apex après quantification", () => {
    const state = {
      roofExtensions: [
        {
          id: "rx-align",
          kind: "dormer",
          contour: {
            closed: true,
            points: [
              { x: 0, y: 0, h: 0 },
              { x: 10, y: 0, h: 0 },
              { x: 10, y: 10, h: 0 },
              { x: 0, y: 10, h: 0 },
            ],
          },
          ridge: {
            a: { x: 5, y: 5, h: 1 },
            b: { x: 5, y: 10, h: 1 },
          },
          hips: {
            left: { a: { x: 0, y: 0 }, b: { x: 5.00002, y: 5.00002 } },
            right: { a: { x: 10, y: 0 }, b: { x: 4.99998, y: 4.99998 } },
          },
          apexVertex: { id: "rx-align:apex", x: 5, y: 5, h: 1 },
          ridgeHeightRelM: 1,
        },
      ],
    };
    const src = readRuntimeRoofExtensionSources(state)[0]!;
    expect(src.warnings.includes("ROOF_EXTENSION_APEX_HIP_MISMATCH")).toBe(false);
  });
});
