/**
 * Contrat monde runtime → canonical3d (hardening Prompt 1).
 */

import { describe, it, expect } from "vitest";
import {
  applyCanonical3DWorldContractToRoof,
  diagnoseCanonical3DWorldContract,
  getCanonical3DWorldContractDriftReport,
  readRoofAuthoritativeWorldMetrics,
} from "../canonical3DWorldContract";
import { peekCalpinageRuntimeWorldFrame } from "../../canonical3d/world/normalizeWorldConfig";
import { buildCanonicalScene3DInput } from "../../canonical3d/adapters/buildCanonicalScene3DInput";
import { buildSolarScene3DFromCalpinageRuntime } from "../../canonical3d/buildSolarScene3DFromCalpinageRuntime";

function roofComplete(overrides: Record<string, unknown> = {}) {
  return {
    scale: { metersPerPixel: 0.02 },
    roof: { north: { angleDeg: 12.5 } },
    ...overrides,
  };
}

describe("canonical3DWorldContract runtime", () => {
  it("Cas 1 — runtime complet → contrat + scène 3D éligible", () => {
    const state = {
      pans: [
        {
          id: "p1",
          polygonPx: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        },
      ],
      roof: {
        ...roofComplete(),
        roofPans: [
          {
            id: "p1",
            polygonPx: [
              { x: 100, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 200 },
              { x: 100, y: 200 },
            ],
          },
        ],
      },
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 100, y: 100, h: 5 },
            { x: 200, y: 100, h: 5 },
            { x: 200, y: 200, h: 5 },
            { x: 100, y: 200, h: 5 },
          ],
        },
      ],
    };
    applyCanonical3DWorldContractToRoof(state.roof);
    const peek = peekCalpinageRuntimeWorldFrame(state);
    expect(peek?.referenceFrame).toBe("LOCAL_IMAGE_ENU");
    expect(peek?.northAngleDeg).toBe(12.5);

    const sceneIn = buildCanonicalScene3DInput({ state, deferPlacedPanels: true });
    expect(sceneIn.diagnostics.is3DEligible).toBe(true);
    expect(sceneIn.world.referenceFrame).toBe("LOCAL_IMAGE_ENU");

    const res = buildSolarScene3DFromCalpinageRuntime(state);
    expect(res.ok).toBe(true);
    expect(res.is3DEligible).toBe(true);
  });

  it("Cas 2 — metersPerPixel absent ou invalide → diagnostic clair, pas de contrat", () => {
    const r1 = { scale: {}, roof: { north: { angleDeg: 0 } } };
    expect(["missing_meters_per_pixel", "invalid_meters_per_pixel"]).toContain(
      diagnoseCanonical3DWorldContract(r1).status,
    );
    const d1 = applyCanonical3DWorldContractToRoof(r1);
    expect(d1.contract).toBeNull();
    expect((r1 as Record<string, unknown>).canonical3DWorldContract).toBeUndefined();

    const r2 = { scale: { metersPerPixel: 0 }, roof: { north: { angleDeg: 0 } } };
    expect(applyCanonical3DWorldContractToRoof(r2).status).toBe("invalid_meters_per_pixel");

    const state = { roof: r2 };
    const peek = peekCalpinageRuntimeWorldFrame(state);
    expect(peek).toBeNull();
  });

  it("Cas 3 — northAngleDeg absent ou invalide → diagnostic clair", () => {
    const r1 = { scale: { metersPerPixel: 0.02 }, roof: {} };
    expect(applyCanonical3DWorldContractToRoof(r1).status).toBe("missing_north_angle");

    const r2 = { scale: { metersPerPixel: 0.02 }, roof: { north: { angleDeg: Number.NaN } } };
    expect(applyCanonical3DWorldContractToRoof(r2).status).toBe("invalid_north_angle");

    const state = { roof: r1 };
    const scene = buildCanonicalScene3DInput({ state });
    expect(scene.diagnostics.is3DEligible).toBe(false);
    expect(scene.diagnostics.errors.some((e) => e.includes("WORLD_NORTH_MISSING"))).toBe(true);
  });

  it("Cas 4 — referenceFrame absent (pas de bloc aligné) → canonical non éligible", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
      },
    };
    const peek = peekCalpinageRuntimeWorldFrame(state);
    expect(peek?.referenceFrame).toBeUndefined();
    const scene = buildCanonicalScene3DInput({ state });
    expect(scene.diagnostics.is3DEligible).toBe(false);
  });

  it("Cas 4b — referenceFrame faux ou bloc incohérent → pas de frame peek", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        canonical3DWorldContract: {
          metersPerPixel: 0.02,
          northAngleDeg: 0,
          referenceFrame: "OTHER",
        },
      },
    };
    expect(peekCalpinageRuntimeWorldFrame(state)?.referenceFrame).toBeUndefined();
  });

  it("Cas 5 — save / reload JSON : contrat stable après apply", () => {
    const roof = roofComplete({ roof: { north: { angleDeg: -7 } } });
    applyCanonical3DWorldContractToRoof(roof);
    const exported = {
      roofState: {
        scale: roof.scale,
        roof: roof.roof,
        canonical3DWorldContract: (roof as Record<string, unknown>).canonical3DWorldContract,
      },
    };
    const raw = JSON.stringify(exported);
    const parsed = JSON.parse(raw) as typeof exported;
    const restoredRoof = {
      scale: parsed.roofState.scale,
      roof: parsed.roofState.roof,
    } as Record<string, unknown>;
    applyCanonical3DWorldContractToRoof(restoredRoof);
    const c = (restoredRoof as { canonical3DWorldContract?: { northAngleDeg: number } }).canonical3DWorldContract;
    expect(c?.northAngleDeg).toBe(-7);
    expect(peekCalpinageRuntimeWorldFrame({ roof: restoredRoof })?.referenceFrame).toBe("LOCAL_IMAGE_ENU");
  });

  it("Cas 6 — ancien runtime sans clé contract : métriques OK, peek sans frame puis apply répare", () => {
    const roof = {
      scale: { metersPerPixel: 0.02 },
      roof: { north: { angleDeg: 0 } },
    };
    expect(diagnoseCanonical3DWorldContract(roof).status).toBe("complete");
    expect(peekCalpinageRuntimeWorldFrame({ roof })?.referenceFrame).toBeUndefined();
    applyCanonical3DWorldContractToRoof(roof);
    expect(
      (roof as { canonical3DWorldContract?: { referenceFrame: string } }).canonical3DWorldContract
        ?.referenceFrame,
    ).toBe("LOCAL_IMAGE_ENU");
    expect(peekCalpinageRuntimeWorldFrame({ roof })?.referenceFrame).toBe("LOCAL_IMAGE_ENU");
  });

  it("Cas 6b — legacy sans nord ni contrat", () => {
    const roof = { scale: { metersPerPixel: 0.02 }, roof: {} };
    const diag = diagnoseCanonical3DWorldContract(roof);
    expect(diag.status).toBe("missing_north_angle");
    expect(diag.codes[0]).toBe("CANONICAL_WORLD_CONTRACT_MISSING_NORTH");
    expect(() => buildCanonicalScene3DInput({ state: { roof } })).not.toThrow();
  });
});

describe("readRoofAuthoritativeWorldMetrics", () => {
  it("ne fabrique pas de nord implicite", () => {
    const m = readRoofAuthoritativeWorldMetrics({
      scale: { metersPerPixel: 0.1 },
      roof: { north: {} },
    });
    expect(m.metersPerPixel).toBe(0.1);
    expect(m.northAngleDeg).toBeNull();
  });
});

describe("getCanonical3DWorldContractDriftReport (Prompt 1-bis)", () => {
  it("Cas 1-bis A — mpp runtime changé sans resync → drift détecté", () => {
    const roof = roofComplete();
    applyCanonical3DWorldContractToRoof(roof);
    (roof as { scale: { metersPerPixel: number } }).scale.metersPerPixel = 0.99;
    const d = getCanonical3DWorldContractDriftReport(roof);
    expect(d.aligned).toBe(false);
    expect(d.codes).toContain("CANONICAL_WORLD_DRIFT_METERS_PER_PIXEL");
  });

  it("Cas 1-bis B — nord runtime changé sans resync → drift détecté", () => {
    const roof = roofComplete();
    applyCanonical3DWorldContractToRoof(roof);
    (roof as { roof: { north: { angleDeg: number } } }).roof.north.angleDeg = 99;
    const d = getCanonical3DWorldContractDriftReport(roof);
    expect(d.aligned).toBe(false);
    expect(d.codes).toContain("CANONICAL_WORLD_DRIFT_NORTH_ANGLE");
  });

  it("Cas 1-bis C — apply immédiatement après mutation → plus de drift", () => {
    const roof = roofComplete();
    applyCanonical3DWorldContractToRoof(roof);
    (roof as { scale: { metersPerPixel: number } }).scale.metersPerPixel = 0.05;
    expect(getCanonical3DWorldContractDriftReport(roof).aligned).toBe(false);
    applyCanonical3DWorldContractToRoof(roof);
    expect(getCanonical3DWorldContractDriftReport(roof).aligned).toBe(true);
  });

  it("Cas 1-bis D — autorités complètes mais miroir absent → drift", () => {
    const roof = roofComplete();
    const d0 = getCanonical3DWorldContractDriftReport(roof);
    expect(d0.aligned).toBe(false);
    expect(d0.codes).toContain("CANONICAL_WORLD_DRIFT_MISSING_MIRROR");
  });

  it("Cas 1-bis E — contrat orphelin (autorités incomplètes) → drift", () => {
    const roof = {
      scale: {},
      roof: { north: { angleDeg: 0 } },
      canonical3DWorldContract: {
        schemaVersion: 1,
        metersPerPixel: 0.02,
        northAngleDeg: 0,
        referenceFrame: "LOCAL_IMAGE_ENU",
      },
    };
    const d = getCanonical3DWorldContractDriftReport(roof);
    expect(d.aligned).toBe(false);
    expect(d.codes).toContain("CANONICAL_WORLD_DRIFT_ORPHAN_CONTRACT");
  });
});
