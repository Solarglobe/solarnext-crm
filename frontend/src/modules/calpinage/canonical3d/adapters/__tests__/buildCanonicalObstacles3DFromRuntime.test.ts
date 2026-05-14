/**
 * Tests adaptateur obstacles / extensions / volumes → 3D canonique (Prompt 4).
 */

import { describe, it, expect } from "vitest";
import {
  buildCanonicalObstacles3DFromRuntime,
  computeStableObstacle3DId,
} from "../buildCanonicalObstacles3DFromRuntime";
import type { HeightResolverContext } from "../../../core/heightResolver";

function baseRoofState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roof: {
      scale: { metersPerPixel: 0.02 },
      roof: { north: { angleDeg: 0 } },
    },
    obstacles: [],
    shadowVolumes: [],
    roofExtensions: [],
    ...overrides,
  };
}

describe("CAS 1 — Rectangle avec hauteur explicite", () => {
  it("base/top cohérents, hauteur et diagnostics propres", () => {
    const getHeightAtXY = () => 5;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      obstacles: [
        {
          id: "o1",
          type: "rect",
          x: 100,
          y: 100,
          w: 50,
          h: 40,
          heightM: 2.2,
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    expect(res.obstacles.length).toBe(1);
    const o = res.obstacles[0]!;
    expect(o.heightM).toBe(2.2);
    expect(o.diagnostics.heightSource).toBe("explicit_runtime");
    expect(o.baseVertices3D.length).toBe(4);
    expect(o.topVertices3D[0].zWorldM - o.baseVertices3D[0].zWorldM).toBeCloseTo(2.2);
    expect(o.kind).toBe("RECT_OBSTACLE");
    expect(o.semanticRole).toBe("PHYSICAL_SHADING_BODY");
  });
});

describe("shapeMeta fidelity", () => {
  it("prioritizes rect shapeMeta over stale points so phase 3 matches the phase 2 drawing", () => {
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY: () => 3 };
    const state = baseRoofState({
      obstacles: [
        {
          id: "chimney-shapemeta",
          type: "polygon",
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
          shapeMeta: {
            originalType: "rect",
            centerX: 100,
            centerY: 200,
            width: 40,
            height: 20,
            angle: 0,
          },
          meta: { businessObstacleId: "chimney_square" },
          heightM: 1.8,
        },
      ],
    });

    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    const xs = o.polygon2D.map((p) => p.x);
    const ys = o.polygon2D.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(80);
    expect(Math.max(...xs)).toBeCloseTo(120);
    expect(Math.min(...ys)).toBeCloseTo(190);
    expect(Math.max(...ys)).toBeCloseTo(210);
    expect(o.centroid2D.x).toBeCloseTo(100);
    expect(o.centroid2D.y).toBeCloseTo(200);
  });
});

describe("CAS 2 — Obstacle sur toiture inclinée (Z par sommet)", () => {
  it("baseZ varie selon le plan simulé, top = base + h", () => {
    const getHeightAtXY = (_pid: string, x: number, y: number) => 4 + 0.01 * (x + y);
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      obstacles: [
        {
          id: "slope-obs",
          panId: "carrier-pan",
          type: "rect",
          x: 0,
          y: 0,
          w: 20,
          h: 20,
          heightM: 1,
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    const zb = o.baseVertices3D.map((v) => v.zWorldM);
    expect(Math.max(...zb) - Math.min(...zb)).toBeGreaterThan(0.05);
    const zt = o.topVertices3D.map((v) => v.zWorldM);
    for (let i = 0; i < zb.length; i++) {
      expect(zt[i] - zb[i]).toBeCloseTo(1);
    }
    expect(o.diagnostics.baseZUnreliable).toBe(false);
  });
});

describe("CAS 3 — Cercle", () => {
  it("polygone canonique (discrétisation), pas de crash, id stable", () => {
    const getHeightAtXY = () => 3;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      obstacles: [
        {
          id: "c1",
          type: "circle",
          x: 200,
          y: 200,
          r: 15,
          heightM: 0.5,
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    expect(o.baseVertices3D.length).toBeGreaterThanOrEqual(8);
    expect(o.kind).toBe("CIRCLE_OBSTACLE");
    const sid = computeStableObstacle3DId("c1", o.kind, o.semanticRole, o.polygon2D);
    expect(o.stableId).toBe(sid);
  });
});

describe("CAS 4 — Chien-assis / extension", () => {
  it("kind ROOF_EXTENSION, avertissement prism simplifié si lucarne complète", () => {
    const getHeightAtXY = () => 6;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      roofExtensions: [
        {
          id: "rx1",
          type: "roof_extension",
          kind: "dormer",
          stage: "COMPLETE",
          ridgeHeightRelM: 1.2,
          contour: {
            points: [
              { x: 50, y: 50 },
              { x: 80, y: 50 },
              { x: 65, y: 80 },
            ],
            closed: true,
          },
          ridge: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
          hips: { left: { a: {}, b: {} }, right: { a: {}, b: {} } },
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    expect(o.kind).toBe("ROOF_EXTENSION");
    expect(o.diagnostics.isDormerLike).toBe(true);
    expect(o.heightM).toBeCloseTo(1.2);
    expect(o.diagnostics.warnings).toContain("DORMER_SIMPLIFIED_TO_VERTICAL_PRISM_FROM_FOOTPRINT");
  });
});

describe("CAS 5 — Hauteur dégradée / fallback", () => {
  it("obstacle construit, warning et confiance plus faible", () => {
    const getHeightAtXY = () => 4;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      obstacles: [
        {
          id: "no-meta",
          type: "rect",
          x: 10,
          y: 10,
          w: 5,
          h: 5,
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    expect(o.heightM).toBe(1);
    expect(o.diagnostics.heightWasFallback).toBe(true);
    expect(o.diagnostics.warnings).toContain("HEIGHT_FALLBACK_OR_LEGACY_DEFAULT");
    expect(o.diagnostics.confidenceMin).toBeLessThan(0.5);
  });
});

describe("CAS 6 — Géométrie dégénérée", () => {
  it("footprint invalide → skip sans throw", () => {
    const getHeightAtXY = () => 1;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      obstacles: [
        { id: "bad", type: "rect", x: 0, y: 0, w: 0, h: 0 },
      ],
    });
    expect(() => buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx })).not.toThrow();
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    expect(res.obstacles.length).toBe(0);
    expect(res.diagnostics.invalidObstacles).toBeGreaterThan(0);
  });
});

describe("CAS 7 — IDs stables", () => {
  it("même entrée → mêmes ids", () => {
    const getHeightAtXY = () => 2;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      obstacles: [
        { id: "idstab", type: "rect", x: 1, y: 2, w: 3, h: 4, heightM: 1 },
      ],
    });
    const a = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const b = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    expect(a.obstacles[0]!.stableId).toBe(b.obstacles[0]!.stableId);
  });
});

describe("CAS 8 — Non-régression / immutabilité", () => {
  it("ne modifie pas le state d’entrée", () => {
    const state = baseRoofState({
      obstacles: [
        { id: "im", type: "rect", x: 0, y: 0, w: 10, h: 10, heightM: 1 },
      ],
    });
    const snap = JSON.stringify(state);
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY: () => 0 };
    buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    expect(JSON.stringify(state)).toBe(snap);
  });
});

describe("Volume ombrant abstrait", () => {
  it("semanticRole SHADOW_VOLUME_ABSTRACT et warning dédié", () => {
    const getHeightAtXY = () => 5;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseRoofState({
      shadowVolumes: [
        {
          id: "sv1",
          type: "shadow_volume",
          x: 100,
          y: 100,
          width: 0.6,
          depth: 0.6,
          shape: "cube",
          rotation: 0,
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    expect(o.semanticRole).toBe("SHADOW_VOLUME_ABSTRACT");
    expect(o.diagnostics.warnings).toContain("ABSTRACT_SHADOW_VOLUME_NOT_PHYSICAL_ROOF_BODY");
    expect(o.kind).toBe("SHADOW_VOLUME");
  });
});

describe("CAS — pan parent via hit-test (Prompt 22)", () => {
  it("sans panId, utilise hitTestPan sur le centroïde du footprint", () => {
    const getHeightAtXY = () => 4.5;
    const hitTestPan = (pt: { x: number; y: number }) => {
      if (Math.hypot(pt.x - 105, pt.y - 105) < 30) return { id: "inferred-pan" };
      return null;
    };
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY, hitTestPan };
    const state = baseRoofState({
      obstacles: [
        {
          id: "orphan",
          type: "rect",
          x: 100,
          y: 100,
          w: 10,
          h: 10,
          heightM: 1,
        },
      ],
    });
    const res = buildCanonicalObstacles3DFromRuntime({ state, heightResolverContext: ctx });
    const o = res.obstacles[0]!;
    expect(o.relatedPanId).toBe("inferred-pan");
    expect(o.diagnostics.warnings).toContain("OBSTACLE_PARENT_PAN_HITTEST_RESOLVED");
  });
});
