/**
 * Pipeline structural roof runtime → canonical (Prompt 2).
 */

import { describe, it, expect } from "vitest";
import {
  resolveCalpinageStructuralRoofForCanonicalChain,
  structuralRoofLineRawUsable,
} from "../calpinageStructuralRoofFromRuntime";
import { mapCalpinageRoofToLegacyRoofGeometryInput } from "../mapCalpinageToCanonicalNearShading";
import { buildRoofModel3DFromLegacyGeometry } from "../../canonical3d/builder/buildRoofModel3DFromLegacyGeometry";
import { buildSolarScene3DFromCalpinageRuntime } from "../../canonical3d/buildSolarScene3DFromCalpinageRuntime";

function roofBlock(mpp: number) {
  return {
    scale: { metersPerPixel: mpp },
    roof: { north: { angleDeg: 0 } },
    canonical3DWorldContract: {
      schemaVersion: 1,
      metersPerPixel: mpp,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU" as const,
    },
  };
}

describe("calpinageStructuralRoofFromRuntime", () => {
  it("Cas 2 — runtime sans ridges/traits → payload vide, pas de crash", () => {
    const res = resolveCalpinageStructuralRoofForCanonicalChain(
      { roof: { ...roofBlock(0.02), roofPans: [{ id: "a", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] } },
      undefined,
    );
    expect(res.payload.ridges).toHaveLength(0);
    expect(res.payload.traits).toHaveLength(0);
    expect(res.source).toBe("runtime_state");
  });

  it("Cas 3 — segment dégénéré (longueur ~0) → rejeté, compteur dropped", () => {
    const state = {
      ridges: [{ id: "bad", a: { x: 10, y: 10 }, b: { x: 10, y: 10 }, roofRole: "main" }],
      traits: [],
    };
    const res = resolveCalpinageStructuralRoofForCanonicalChain(state, undefined);
    expect(res.payload.ridges).toHaveLength(0);
    expect(res.stats.ridgeDropped).toBe(1);
    expect(res.warnings.some((w) => w.includes("STRUCTURAL_ROOF_DROPPED_RIDGES"))).toBe(true);
  });

  it("Cas 1 — ridges / traits valides → mapper + builder reçoivent les lignes", () => {
    const ridges = [
      { id: "r1", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, roofRole: "main" },
    ];
    const traits = [
      { id: "t1", a: { x: 0, y: 50 }, b: { x: 100, y: 50 }, roofRole: "main" },
    ];
    const res = resolveCalpinageStructuralRoofForCanonicalChain({ ridges, traits }, undefined);
    expect(res.payload.ridges).toHaveLength(1);
    expect(res.payload.traits).toHaveLength(1);

    const roof = {
      ...roofBlock(0.05),
      roofPans: [
        {
          id: "p1",
          polygonPx: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
        },
      ],
    };
    const legacy = mapCalpinageRoofToLegacyRoofGeometryInput(roof, res.payload);
    expect(legacy?.ridges).toHaveLength(1);
    expect(legacy?.traits).toHaveLength(1);
    const { model, stats } = buildRoofModel3DFromLegacyGeometry(legacy!);
    expect(stats.ridgeLineCount).toBeGreaterThanOrEqual(1);
    expect(model.roofRidges.length).toBeGreaterThanOrEqual(1);
  });

  it("explicit null → aucune ligne (override)", () => {
    const state = {
      ridges: [{ id: "x", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, roofRole: "main" }],
    };
    const res = resolveCalpinageStructuralRoofForCanonicalChain(state, null);
    expect(res.source).toBe("explicit_empty");
    expect(res.payload.ridges).toHaveLength(0);
  });

  it("structuralRoofLineRawUsable rejette chienAssis", () => {
    expect(
      structuralRoofLineRawUsable(
        { id: "c", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, roofRole: "chienAssis" },
        1e-3,
      ),
    ).toBe(false);
  });
});

describe("buildSolarScene3DFromCalpinageRuntime structural (Cas 4 & 5)", () => {
  const contoursP1 = [
    { x: 0, y: 0, h: 8 },
    { x: 100, y: 0, h: 8 },
    { x: 100, y: 100, h: 8 },
    { x: 0, y: 100, h: 8 },
  ];
  const contoursP2 = [
    { x: 100, y: 0, h: 8 },
    { x: 200, y: 0, h: 8 },
    { x: 200, y: 100, h: 8 },
    { x: 100, y: 100, h: 8 },
  ];

  it("Cas 4 — multi-pans + faîtage sur arête commune → ridge 3D présente", () => {
    const mpp = 0.05;
    const runtime = {
      pans: [
        {
          id: "p1",
          polygonPx: contoursP1.map((p) => ({ x: p.x, y: p.y, h: p.h })),
        },
        {
          id: "p2",
          polygonPx: contoursP2.map((p) => ({ x: p.x, y: p.y, h: p.h })),
        },
      ],
      roof: {
        ...roofBlock(mpp),
        roofPans: [
          {
            id: "p1",
            polygonPx: contoursP1.map((p) => ({ x: p.x, y: p.y, h: p.h })),
          },
          {
            id: "p2",
            polygonPx: contoursP2.map((p) => ({ x: p.x, y: p.y, h: p.h })),
          },
        ],
      },
      contours: [
        { roofRole: "contour", points: contoursP1 },
        { roofRole: "contour", points: contoursP2 },
      ],
      ridges: [
        {
          id: "r-shared",
          a: { x: 100, y: 0 },
          b: { x: 100, y: 100 },
          roofRole: "main",
        },
      ],
      traits: [],
    };

    const res = buildSolarScene3DFromCalpinageRuntime(runtime);
    expect(res.ok).toBe(true);
    expect(res.scene).not.toBeNull();
    const ridges3d = res.scene!.roofModel.roofRidges;
    expect(ridges3d.length).toBeGreaterThanOrEqual(1);
  });

  it("Cas 5 — multi-pans sans lignes structurantes → avertissement diagnostique", () => {
    const mpp = 0.05;
    const runtime = {
      pans: [
        { id: "p1", polygonPx: contoursP1.map((p) => ({ x: p.x, y: p.y, h: p.h })) },
        { id: "p2", polygonPx: contoursP2.map((p) => ({ x: p.x, y: p.y, h: p.h })) },
      ],
      roof: {
        ...roofBlock(mpp),
        roofPans: [
          { id: "p1", polygonPx: contoursP1.map((p) => ({ x: p.x, y: p.y, h: p.h })) },
          { id: "p2", polygonPx: contoursP2.map((p) => ({ x: p.x, y: p.y, h: p.h })) },
        ],
      },
      contours: [
        { roofRole: "contour", points: contoursP1 },
        { roofRole: "contour", points: contoursP2 },
      ],
    };
    const res = buildSolarScene3DFromCalpinageRuntime(runtime);
    expect(res.ok).toBe(true);
    expect(
      res.diagnostics.warnings.some((w) => w.message.includes("STRUCTURAL_ROOF_MULTI_PAN_NO_LINES")),
    ).toBe(true);
  });
});
