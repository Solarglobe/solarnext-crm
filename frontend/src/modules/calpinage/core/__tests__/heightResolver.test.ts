import { describe, expect, it } from "vitest";
import {
  DormerHeightContext,
  getExplicitHeightAtPoint,
  getHeightOnDormerSurface,
  resolveHeightAtXY,
} from "../heightResolver";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Flat horizontal dormer at pixel (100,100)-(200,200), ridge at y=130. */
function makeDormer(overrides: Partial<DormerHeightContext> = {}): DormerHeightContext {
  return {
    footprintPx: [
      { x: 100, y: 100 }, // frontLeft
      { x: 200, y: 100 }, // frontRight
      { x: 200, y: 200 }, // rearRight
      { x: 100, y: 200 }, // rearLeft
    ],
    ridgePx: {
      a: { x: 100, y: 130 },
      b: { x: 200, y: 130 },
    },
    frontMidPx: { x: 150, y: 100 },
    rearMidPx:  { x: 150, y: 200 },
    facadeHeightRelM: 0.45,
    ridgeHeightRelM:  1.15,
    supportPanId: "pan-A",
    ...overrides,
  };
}

/** Simulates getHeightAtXY returning a flat pan at Z=5m. */
function flatPan5m(_panId: string, _x: number, _y: number): number {
  return 5.0;
}

// ---------------------------------------------------------------------------
// P1.5 unit tests on getHeightOnDormerSurface
// ---------------------------------------------------------------------------

describe("getHeightOnDormerSurface", () => {
  it("retourne null si le point est hors empreinte", () => {
    const res = getHeightOnDormerSurface(50, 50, [makeDormer()], flatPan5m);
    expect(res).toBeNull();
  });

  it("P1.5 point sur la face avant (entre egout et faitage) retourne hauteur chien assis", () => {
    // Point at (150, 110) — inside footprint, front face (y=110 < ridge y=130)
    // t_front = dist(110, ridge=130) / dist(frontMid=100, ridge=130) = (130-110)/(130-100) = 20/30 ~ 0.667
    // hRel = 1.15 + 0.667 * (0.45 - 1.15) = 1.15 - 0.467 = 0.683
    const res = getHeightOnDormerSurface(150, 110, [makeDormer()], flatPan5m);
    expect(res).not.toBeNull();
    expect(res!.source).toBe("dormer_surface_interpolated");
    expect(res!.panId).toBe("pan-A");
    // absoluteZ = 5.0 + ~0.683
    expect(res!.heightM).toBeGreaterThan(5.45);  // above facade
    expect(res!.heightM).toBeLessThan(5.0 + 1.15);  // below ridge
  });

  it("P1.5 point au niveau du faitage retourne ridgeHeightRelM + baseZ", () => {
    // Point exactly on the ridge line (y=130)
    const res = getHeightOnDormerSurface(150, 130, [makeDormer()], flatPan5m);
    expect(res).not.toBeNull();
    expect(res!.heightM).toBeCloseTo(5.0 + 1.15, 2);
  });

  it("P1.5 point sur la face arriere retourne hauteur interpolee entre faitage et 0", () => {
    // Point at (150, 165) — rear face, midway between ridge(130) and rear(200)
    // t_rear = dist(165, ridge=130) / dist(rearMid=200, ridge=130) = 35/70 = 0.5
    // hRel = 1.15 * (1 - 0.5) = 0.575
    const res = getHeightOnDormerSurface(150, 165, [makeDormer()], flatPan5m);
    expect(res).not.toBeNull();
    expect(res!.heightM).toBeGreaterThan(5.0);
    expect(res!.heightM).toBeLessThan(5.0 + 1.15);
    expect(res!.heightM).toBeCloseTo(5.0 + 0.575, 1);
  });

  it("point hors chien assis utilise le pan principal (pas P1.5)", () => {
    // The resolver should NOT use dormer height for points outside footprint
    const res = getHeightOnDormerSurface(50, 50, [makeDormer()], flatPan5m);
    expect(res).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: resolveHeightAtXY with P1.5
// ---------------------------------------------------------------------------

describe("resolveHeightAtXY — P1.5 chien assis", () => {
  it("un point sur chien assis retourne dormer_surface_interpolated, pas pan_plane_fit", () => {
    // Without dormer context, getHeightAtXY on the main pan returns 5m.
    // With dormer context, P1.5 should intercept and return dormer surface height.
    const dormer = makeDormer();
    const context = {
      state: { dormers: [dormer] },
      getHeightAtXY: flatPan5m,
    };
    const res = resolveHeightAtXY(150, 110, context, { panId: "pan-A" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("dormer_surface_interpolated");
    // Must be higher than main pan (5m) + facade (0.45m) — because front face
    expect(res.heightM).toBeGreaterThan(5.45);
    expect(res.heightM).toBeLessThan(5.0 + 1.15);
    expect(res.panId).toBe("pan-A");
  });

  it("un point hors chien assis utilise P2 (pan_plane_fit) normalement", () => {
    const dormer = makeDormer();
    const context = {
      state: { dormers: [dormer] },
      getHeightAtXY: flatPan5m,
    };
    // Point outside the dormer footprint
    const res = resolveHeightAtXY(50, 50, context, { panId: "pan-A" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("pan_plane_fit");
    expect(res.heightM).toBeCloseTo(5.0, 6);
  });

  it("P1 (vertex explicite) prend priority sur P1.5 si dans epsilon", () => {
    // A point at (150, 110) — inside dormer AND within epsilon of an explicit ridge vertex
    const dormer = makeDormer();
    const context = {
      state: {
        dormers: [dormer],
        ridges: [
          { a: { x: 150, y: 110, h: 7.5 }, b: { x: 151, y: 110 } },
        ],
      },
      getHeightAtXY: flatPan5m,
    };
    const res = resolveHeightAtXY(150, 110, context, { epsilonPx: 20 });
    expect(res.source).toBe("explicit_vertex_ridge");
    expect(res.heightM).toBeCloseTo(7.5, 6);
  });

  it("confidence de dormer_surface_interpolated est superieure a pan_plane_fit_hittest", () => {
    const dormer = makeDormer();
    const context = {
      state: { dormers: [dormer] },
      getHeightAtXY: flatPan5m,
    };
    const res = resolveHeightAtXY(150, 110, context, { panId: "pan-A" });
    expect(res.confidence).toBeGreaterThan(0.78); // > pan_plane_fit_hittest
    expect(res.confidence).toBeCloseTo(0.82, 2);
  });

  it("getHeightAtXY indisponible : P1.5 est skippee, repli sur P4", () => {
    const dormer = makeDormer();
    const context = {
      state: { dormers: [dormer] },
      // No getHeightAtXY provided
    };
    const res = resolveHeightAtXY(150, 110, context, {});
    // P1.5 requires getHeightAtXY for the base Z — without it, falls to P4
    expect(res.source).toBe("insufficient_height_signal");
    expect(res.ok).toBe(false);
  });
});
