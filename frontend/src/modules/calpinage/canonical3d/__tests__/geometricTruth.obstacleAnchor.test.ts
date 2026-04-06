/**
 * Prompt 23 — D : obstacle ancré au toit local (baseZ suit le plan, pas z=0 global silencieux).
 */

import { describe, expect, it } from "vitest";
import { buildCanonicalObstacles3DFromRuntime } from "../adapters/buildCanonicalObstacles3DFromRuntime";
import type { HeightResolverContext } from "../../core/heightResolver";
import {
  expectObstacleBaseNotFlatZeroWhenRoofElevated,
  expectObstacleVerticalExtrusion,
  expectReasonableResidentialZ,
} from "../test-utils/geometryAssertions";

describe("Géométrie D — obstacle sur pan incliné", () => {
  it("panId connu + getHeightAtXY en pente : baseZ ≈ toit local, top = base + heightM", () => {
    const mpp = 0.01;
    const getHeightAtXY = (_pid: string, _x: number, y: number) => 6 + y * 0.01;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = {
      roof: {
        scale: { metersPerPixel: mpp },
        roof: { north: { angleDeg: 0 } },
        roofPans: [
          {
            id: "slope-pan",
            points: [
              { x: 0, y: 0, h: 6 },
              { x: 200, y: 0, h: 6 },
              { x: 200, y: 200, h: 8 },
              { x: 0, y: 200, h: 8 },
            ],
          },
        ],
      },
      obstacles: [
        {
          id: "ch1",
          type: "rect",
          x: 80,
          y: 80,
          w: 40,
          h: 40,
          panId: "slope-pan",
          heightM: 1.2,
          businessObstacleId: "chimney_square",
        },
      ],
    };
    const res = buildCanonicalObstacles3DFromRuntime({
      state,
      heightResolverContext: ctx,
      options: { defaultBaseHeightM: 0, defaultObstacleHeightM: 1, includeDiagnostics: true },
    });
    expect(res.ok).toBe(true);
    expect(res.obstacles.length).toBe(1);
    const o = res.obstacles[0]!;
    expect(o.relatedPanId).toBe("slope-pan");
    expectObstacleVerticalExtrusion({
      baseVertices: o.baseVertices3D,
      topVertices: o.topVertices3D,
      heightM: 1.2,
    });
    const baseZs = o.baseVertices3D.map((v) => v.zWorldM);
    expectObstacleBaseNotFlatZeroWhenRoofElevated({
      baseZValues: baseZs,
      minExpectedMeanZ: 6.5,
    });
    for (const v of o.baseVertices3D) {
      expectReasonableResidentialZ(v.zWorldM, "base");
    }
    expect(Math.max(...baseZs) - Math.min(...baseZs)).toBeGreaterThan(0.05);
  });
});
