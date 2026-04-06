/**
 * Prompt 23 — diagnostics : cas invalides = codes explicites (pas de silence).
 */

import { describe, expect, it } from "vitest";
import {
  buildCanonicalPans3DFromRuntime,
} from "../adapters/buildCanonicalPans3DFromRuntime";
import { buildCanonicalObstacles3DFromRuntime } from "../adapters/buildCanonicalObstacles3DFromRuntime";
import { expectDiagnosticsIncludeOneOf } from "../test-utils/geometryAssertions";

function baseState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roof: {
      scale: { metersPerPixel: 0.02 },
      roof: { north: { angleDeg: 0 } },
      roofPans: [],
    },
    ...overrides,
  };
}

describe("Diagnostics pans / unification / structure", () => {
  it("PAN_VERTEX_Z_FALLBACK_USED quand aucune h explicite ni getHeightAtXY", () => {
    const res = buildCanonicalPans3DFromRuntime({
      state: baseState({
        roof: {
          scale: { metersPerPixel: 0.01 },
          roof: { north: { angleDeg: 0 } },
          roofPans: [
            {
              id: "fb",
              polygon: [
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 25, y: 40 },
              ],
            },
          ],
        },
      }),
      heightResolverContext: { state: {} },
      options: { defaultHeightM: 4.2 },
    });
    expect(res.pans.length).toBe(1);
    expect(
      res.pans[0]!.diagnostics.warnings.some((w) => w.includes("PAN_VERTEX_Z_FALLBACK_USED")),
    ).toBe(true);
  });

  it("deux pans Z divergents au même pixel → SHARED_VERTEX_Z_MISMATCH et PAN_SHARED_VERTEX_Z_UNIFIED", () => {
    const shared = { x: 50, y: 50 };
    const ctx = {
      state: {},
      getHeightAtXY: (pid: string) => (pid === "pa" ? 6.0 : 8.0),
    };
    const res = buildCanonicalPans3DFromRuntime({
      state: baseState({
        roof: {
          scale: { metersPerPixel: 0.01 },
          roof: { north: { angleDeg: 0 } },
          roofPans: [
            { id: "pa", polygon: [shared, { x: 150, y: 50 }, { x: 150, y: 150 }] },
            { id: "pb", polygon: [shared, { x: 50, y: 150 }, { x: -50, y: 50 }] },
          ],
        },
      }),
      heightResolverContext: ctx,
    });
    expectDiagnosticsIncludeOneOf(res.diagnostics.warnings, ["SHARED_VERTEX_Z_MISMATCH"]);
    expectDiagnosticsIncludeOneOf(res.diagnostics.warnings, ["PAN_SHARED_VERTEX_Z_UNIFIED"]);
  });

  it("h explicites non coplanaires → HIGH_PLANE_RESIDUAL (géométrie « tordue » signalée)", () => {
    const res = buildCanonicalPans3DFromRuntime({
      state: baseState({
        roof: {
          scale: { metersPerPixel: 0.01 },
          roof: { north: { angleDeg: 0 } },
          roofPans: [
            {
              id: "twist",
              points: [
                { x: 0, y: 0, h: 5 },
                { x: 100, y: 0, h: 5 },
                { x: 100, y: 100, h: 5 },
                { x: 0, y: 100, h: 12 },
              ],
            },
          ],
        },
      }),
      heightResolverContext: { state: {} },
    });
    expect(res.pans.length).toBe(1);
    const w = res.pans[0]!.diagnostics.warnings;
    expect(w.some((x) => x.includes("HIGH_PLANE_RESIDUAL"))).toBe(true);
  });
});

describe("Diagnostics obstacles / extensions", () => {
  it("OBSTACLE_PARENT_PAN_UNRESOLVED sans panId ni hit-test", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "p1", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] }],
      },
      obstacles: [
        {
          id: "orphan",
          type: "rect",
          x: 40,
          y: 40,
          w: 20,
          h: 20,
          heightM: 1,
          businessObstacleId: "chimney_square",
        },
      ],
    };
    const res = buildCanonicalObstacles3DFromRuntime({
      state,
      heightResolverContext: { state: {} },
      options: { defaultBaseHeightM: 0 },
    });
    expect(res.obstacles.length).toBe(1);
    expectDiagnosticsIncludeOneOf(res.obstacles[0]!.diagnostics.warnings, ["OBSTACLE_PARENT_PAN_UNRESOLVED"]);
  });

  it("ROOF_EXTENSION_HEIGHT_FALLBACK + ROOF_EXTENSION_PARENT_SUPPORT_UNRESOLVED", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "p1", polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 90 }] }],
      },
      roofExtensions: [
        {
          id: "ext-noh",
          type: "roof_extension",
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
          ],
        },
      ],
    };
    const res = buildCanonicalObstacles3DFromRuntime({
      state,
      heightResolverContext: { state: {} },
      options: { defaultObstacleHeightM: 2, defaultBaseHeightM: 0 },
    });
    expect(res.obstacles.length).toBe(1);
    const w = res.obstacles[0]!.diagnostics.warnings;
    expectDiagnosticsIncludeOneOf(w, ["ROOF_EXTENSION_HEIGHT_FALLBACK"]);
    expectDiagnosticsIncludeOneOf(w, ["ROOF_EXTENSION_PARENT_SUPPORT_UNRESOLVED"]);
  });
});
