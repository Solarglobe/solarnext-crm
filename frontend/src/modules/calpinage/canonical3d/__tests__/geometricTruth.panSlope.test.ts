/**
 * Prompt 23 — B : pan incliné, Z cohérents, normale plausible, pas de plan « plat » contradictoire.
 */

import { describe, expect, it } from "vitest";
import { buildCanonicalPans3DFromRuntime } from "../adapters/buildCanonicalPans3DFromRuntime";
import type { HeightResolverContext } from "../../core/heightResolver";
import {
  expectFinitePoint3D,
  expectNormalPointsUpish,
  expectReasonableResidentialZ,
  expectUnitNormal3D,
} from "../test-utils/geometryAssertions";

function roofStateWithPan(points: { x: number; y: number; h: number }[]) {
  return {
    roof: {
      scale: { metersPerPixel: 0.01 },
      roof: { north: { angleDeg: 0 } },
      roofPans: [{ id: "slope-pan", points }],
    },
  };
}

describe("Géométrie B — pan avec vraie pente (h explicites)", () => {
  it("rectangle : bas 5 m, haut 8 m → pente > 0, normale vers le haut, résidu plan modéré", () => {
    const poly = [
      { x: 0, y: 0, h: 5 },
      { x: 100, y: 0, h: 5 },
      { x: 100, y: 100, h: 8 },
      { x: 0, y: 100, h: 8 },
    ];
    const ctx: HeightResolverContext = { state: {} };
    const res = buildCanonicalPans3DFromRuntime({
      state: roofStateWithPan(poly),
      heightResolverContext: ctx,
      options: { defaultHeightM: 0 },
    });
    expect(res.pans.length).toBe(1);
    const pan = res.pans[0]!;
    for (const v of pan.vertices3D) {
      expectReasonableResidentialZ(v.zWorldM, "vertex");
      expectFinitePoint3D(
        { x: v.xWorldM, y: v.yWorldM, z: v.zWorldM },
        `v ${v.vertexId}`,
      );
    }
    const zs = pan.vertices3D.map((v) => v.zWorldM);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(2.5);
    expect(pan.slopeDeg).not.toBeNull();
    expect(pan.slopeDeg!).toBeGreaterThan(2);
    expect(pan.diagnostics.usedFallbackForAllVertices).toBe(false);
    expectUnitNormal3D(pan.normal, "pan.normal");
    expectNormalPointsUpish(pan.normal);
    if (pan.diagnostics.planeResidualRmsM != null) {
      expect(pan.diagnostics.planeResidualRmsM).toBeLessThan(0.15);
    }
    expect(pan.boundaryEdgesWorld?.length).toBe(4);
    for (const e of pan.boundaryEdgesWorld ?? []) {
      expectFinitePoint3D(e.start, "edge.start");
      expectFinitePoint3D(e.end, "edge.end");
    }
  });

  it("pente nulle en h mais Z différents serait incohérent — ici on impose h égaux → plat géométrique", () => {
    const flat = [
      { x: 0, y: 0, h: 4 },
      { x: 50, y: 0, h: 4 },
      { x: 50, y: 50, h: 4 },
      { x: 0, y: 50, h: 4 },
    ];
    const res = buildCanonicalPans3DFromRuntime({
      state: roofStateWithPan(flat),
      heightResolverContext: { state: {} },
    });
    const pan = res.pans[0]!;
    expect(pan.diagnostics.allHeightsEqual).toBe(true);
    expect(pan.diagnostics.zRangeM).toBeLessThanOrEqual(1e-4);
    expect(pan.slopeDeg).not.toBeNull();
    expect(pan.slopeDeg!).toBeLessThanOrEqual(1.5);
  });
});
