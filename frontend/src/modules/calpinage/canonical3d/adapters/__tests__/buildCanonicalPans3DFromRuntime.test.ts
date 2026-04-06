/**
 * Tests adaptateur pans 2D → pans 3D canoniques (Prompt 3).
 */

import { describe, it, expect } from "vitest";
import {
  buildCanonicalPans3DFromRuntime,
  computeStablePan3DId,
  extractHeightStateContextFromCalpinageState,
} from "../buildCanonicalPans3DFromRuntime";
import type { HeightResolverContext } from "../../../core/heightResolver";

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

describe("CAS 1 — Pan simple avec Z explicites (P1 moteur Z)", () => {
  it("produit des vertices3D avec sources explicites et normale cohérente", () => {
    const poly = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ];
    const heightState = {
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 100, y: 100, h: 5 },
            { x: 200, y: 100, h: 5 },
            { x: 200, y: 200, h: 8 },
            { x: 100, y: 200, h: 8 },
          ],
        },
      ],
      ridges: [],
      traits: [],
    };
    const ctx: HeightResolverContext = { state: heightState };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "pan-A", polygon: poly }],
      },
    });

    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: ctx,
      options: { defaultHeightM: 0 },
    });

    expect(res.pans.length).toBe(1);
    const pan = res.pans[0]!;
    expect(pan.vertices3D.length).toBe(4);
    for (const v of pan.vertices3D) {
      expect(v.source).toMatch(/^explicit_vertex_/);
      expect(v.confidence).toBeGreaterThan(0.88);
    }
    expect(pan.normal.z).toBeGreaterThan(0.5);
    expect(pan.slopeDeg).not.toBeNull();
    expect(pan.slopeDeg!).toBeGreaterThan(1);
    expect(pan.diagnostics.isDegenerate).toBe(false);
    expect(pan.areaPlanM2).not.toBeNull();
    expect(pan.area3DM2).not.toBeNull();
  });
});

describe("CAS 2 — Pan résolu via pan-plane (P2)", () => {
  it("utilise pan_plane_fit et Z varient selon le plan", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const getHeightAtXY = (_pid: string, x: number, y: number) => 0.05 * x + 0.03 * y;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "pan-plane", points: poly }],
      },
    });

    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: ctx,
    });
    const pan = res.pans[0]!;
    expect(pan.vertices3D.every((v) => v.source === "pan_plane_fit")).toBe(true);
    const zs = pan.vertices3D.map((v) => v.zWorldM);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(1e-6);
    expect(pan.diagnostics.usedFallbackForAllVertices).toBe(false);
    expect(pan.diagnostics.isFlatLike).toBe(false);
  });
});

describe("CAS 3 — Pan réellement plat", () => {
  it("isFlatLike true, pas d’erreur fatale", () => {
    const poly = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
    ];
    const getHeightAtXY = () => 4.0;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "flat", polygon: poly }],
      },
    });

    const res = buildCanonicalPans3DFromRuntime({ state, heightResolverContext: ctx });
    const pan = res.pans[0]!;
    expect(pan.diagnostics.allHeightsEqual).toBe(true);
    expect(pan.diagnostics.isFlatLike).toBe(true);
    expect(pan.slopeDeg).not.toBeNull();
    expect(pan.slopeDeg!).toBeLessThanOrEqual(1);
  });
});

describe("CAS 4 — Pan dégénéré", () => {
  it("marque dégénéré, pas de crash", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const getHeightAtXY = () => 3;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "line", polygon: poly }],
      },
    });

    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: ctx,
      options: { includeDegeneratePans: true },
    });
    const pan = res.pans[0]!;
    expect(pan.diagnostics.isDegenerate).toBe(true);
    expect(pan.diagnostics.warnings).toContain("DEGENERATE_GEOMETRY");
  });
});

describe("CAS 5 — Hauteurs dégradées / fallback", () => {
  it("construit le pan avec confiance faible et diagnostic explicite", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    const ctx: HeightResolverContext = { state: {} };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.05 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "weak", polygon: poly }],
      },
    });

    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: ctx,
      options: { defaultHeightM: 2.5 },
    });
    const pan = res.pans[0]!;
    expect(pan.diagnostics.usedFallbackForAllVertices).toBe(true);
    expect(pan.diagnostics.confidenceAvg).toBeLessThan(0.3);
    expect(pan.vertices3D.every((v) => v.source === "fallback_default")).toBe(true);
  });
});

describe("CAS 6 — IDs stables", () => {
  it("même entrée → mêmes panId et stableId", () => {
    const poly = [
      { x: 1, y: 2 },
      { x: 10, y: 2 },
      { x: 5, y: 8 },
    ];
    const getHeightAtXY = () => 1;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "stable-pan", polygon: poly }],
      },
    });

    const a = buildCanonicalPans3DFromRuntime({ state, heightResolverContext: ctx });
    const b = buildCanonicalPans3DFromRuntime({ state, heightResolverContext: ctx });
    expect(a.pans[0]!.stableId).toBe(b.pans[0]!.stableId);
    expect(a.pans[0]!.panId).toBe("stable-pan");

    const id1 = computeStablePan3DId("stable-pan", poly);
    expect(a.pans[0]!.stableId).toBe(id1);
  });

  it("variation géométrique → stableId différent", () => {
    const idA = computeStablePan3DId("p", [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    const idB = computeStablePan3DId("p", [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ]);
    expect(idA).not.toBe(idB);
  });
});

describe("CAS 7 — Non-régression / pureté", () => {
  it("n’altère pas l’objet state en entrée", () => {
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "x", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 2 }] }],
      },
    });
    const snap = JSON.stringify(state);
    const getHeightAtXY = () => 1;
    buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: { state: {}, getHeightAtXY },
    });
    expect(JSON.stringify(state)).toBe(snap);
  });

  it("mpp manquant → ok false, pans vides", () => {
    const res = buildCanonicalPans3DFromRuntime({
      state: { roof: { roofPans: [{ id: "a", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] } },
    });
    expect(res.ok).toBe(false);
    expect(res.pans.length).toBe(0);
  });
});

describe("CAS 8 — explicit_pan_vertex_h sur points[] (Prompt 22)", () => {
  it("utilise h sur le sommet pan sans contour structurant", () => {
    const poly = [
      { x: 0, y: 0, h: 9.1 },
      { x: 100, y: 0, h: 9.2 },
      { x: 50, y: 80, h: 11.0 },
    ];
    const ctx: HeightResolverContext = { state: {} };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "pv-h", points: poly }],
      },
    });
    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: ctx,
      options: { defaultHeightM: 0 },
    });
    const pan = res.pans[0]!;
    expect(pan.vertices3D.every((v) => v.source === "explicit_pan_vertex_h")).toBe(true);
    expect(pan.vertices3D[0]!.zWorldM).toBeCloseTo(9.1);
    expect(pan.boundaryEdgesWorld?.length).toBe(3);
  });
});

describe("CAS 9 — Sommets partagés entre deux pans (unification Z)", () => {
  it("deux Z divergents au même coin → un seul Z après fusion", () => {
    const shared = { x: 50, y: 50 };
    const getHeightAtXY = (pid: string) => (pid === "pa" ? 6.0 : 8.0);
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = baseState({
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [
          {
            id: "pa",
            polygon: [shared, { x: 150, y: 50 }, { x: 150, y: 150 }],
          },
          {
            id: "pb",
            polygon: [shared, { x: 50, y: 150 }, { x: -50, y: 50 }],
          },
        ],
      },
    });
    const res = buildCanonicalPans3DFromRuntime({ state, heightResolverContext: ctx });
    expect(res.pans.length).toBe(2);
    const za = res.pans.find((p) => p.panId === "pa")!.vertices3D.find((v) => v.xPx === 50 && v.yPx === 50)!.zWorldM;
    const zb = res.pans.find((p) => p.panId === "pb")!.vertices3D.find((v) => v.xPx === 50 && v.yPx === 50)!.zWorldM;
    expect(za).toBeCloseTo(zb);
    expect(res.diagnostics.warnings.some((w) => w.startsWith("SHARED_VERTEX_Z_MISMATCH"))).toBe(true);
  });
});

describe("extractHeightStateContextFromCalpinageState", () => {
  it("lit contours / ridges / traits au niveau racine", () => {
    const h = extractHeightStateContextFromCalpinageState({
      contours: [{ points: [] }],
      ridges: [{ a: { x: 0, y: 0 } }],
      traits: [],
    });
    expect(h?.contours?.length).toBe(1);
    expect(h?.ridges?.length).toBe(1);
  });
});
