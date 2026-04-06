/**
 * Tests adaptateur scène 3D canonique globale (Prompt 6).
 */

import { describe, it, expect } from "vitest";
import { buildCanonicalScene3DInput, computeCanonicalScene3DId, type CanonicalPlacedPanel3D } from "../buildCanonicalScene3DInput";
import type { CanonicalPan3D } from "../buildCanonicalPans3DFromRuntime";
import type { CanonicalObstacle3D } from "../buildCanonicalObstacles3DFromRuntime";

function basePanDiagnostics(overrides: Partial<CanonicalPan3D["diagnostics"]> = {}): CanonicalPan3D["diagnostics"] {
  return {
    zSourceSummary: [],
    confidenceMin: 1,
    confidenceAvg: 1,
    isFlatLike: true,
    isDegenerate: false,
    warnings: [],
    zRangeM: 0,
    allHeightsEqual: true,
    usedFallbackForAllVertices: false,
    insufficientHeightSignal: false,
    heterogeneousZSources: false,
    planeResidualRmsM: null,
    ...overrides,
  };
}

function makePan(id: string, degenerate: boolean): CanonicalPan3D {
  const verts = [
    { vertexId: "v0", xPx: 0, yPx: 0, xWorldM: 0, yWorldM: 0, zWorldM: 5, heightM: 5, source: "pan_plane_fit", confidence: 0.85 },
    { vertexId: "v1", xPx: 10, yPx: 0, xWorldM: 1, yWorldM: 0, zWorldM: 5, heightM: 5, source: "pan_plane_fit", confidence: 0.85 },
    { vertexId: "v2", xPx: 10, yPx: 10, xWorldM: 1, yWorldM: 1, zWorldM: 5, heightM: 5, source: "pan_plane_fit", confidence: 0.85 },
  ];
  return {
    panId: id,
    stableId: `pan3d-stable-${id}`,
    points2D: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    vertices3D: verts,
    centroid2D: { x: 5, y: 5 },
    centroid3D: { xWorldM: 0.5, yWorldM: 0.5, zWorldM: 5 },
    normal: { x: 0, y: 0, z: 1 },
    slopeDeg: 0,
    azimuthDeg: 0,
    area2DPx: 50,
    areaPlanM2: 1,
    area3DM2: 1,
    diagnostics: basePanDiagnostics({
      isDegenerate: degenerate,
      warnings: degenerate ? ["DEGENERATE_TEST"] : [],
    }),
  };
}

function makeObstacle(id: string, relatedPanId: string | null, badZ: boolean): CanonicalObstacle3D {
  const base = 5;
  const top = badZ ? 4 : 7;
  const vx = (z: number) => ({
    vertexId: "v",
    xPx: 0,
    yPx: 0,
    xWorldM: 0,
    yWorldM: 0,
    zWorldM: z,
  });
  return {
    obstacleId: id,
    stableId: `obs3d-stable-${id}`,
    kind: "RECT_OBSTACLE",
    sourceKind: "test",
    semanticRole: "PHYSICAL_SHADING_BODY",
    polygon2D: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ],
    baseVertices3D: [vx(base), vx(base), vx(base)],
    topVertices3D: [vx(top), vx(top), vx(top)],
    centroid2D: { x: 0.5, y: 0.5 },
    centroid3D: { xWorldM: 0, yWorldM: 0, zWorldM: (base + top) / 2 },
    baseZWorldM: base,
    topZWorldM: top,
    heightM: top - base,
    footprintArea2DPx: 1,
    footprintAreaPlanM2: 1,
    envelopeArea3DM2: 1,
    relatedPanId,
    roofKind: null,
    diagnostics: {
      zBaseSource: [],
      zTopSource: [],
      heightSource: "test",
      confidenceMin: 1,
      confidenceAvg: 1,
      isDegenerate: false,
      isExtrudedFromRoof: true,
      isDormerLike: false,
      heightWasFallback: false,
      baseZUnreliable: false,
      warnings: [],
    },
  };
}

function makePanel(id: string, patchId: string): CanonicalPlacedPanel3D {
  return {
    id,
    roofPlanePatchId: patchId,
    center: { mode: "world", position: { x: 0.5, y: 0.5, z: 5 } },
    widthM: 1,
    heightM: 1.7,
    orientation: "portrait",
    rotationDegInPlane: 0,
  };
}

describe("buildCanonicalScene3DInput", () => {
  it("CAS 1 — scène complète valide → isValid true", () => {
    const pan = makePan("pan-a", false);
    const scene = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [makeObstacle("o1", "pan-a", false)],
      panels: [makePanel("pv1", "pan-a")],
    });
    expect(scene.diagnostics.isValid).toBe(true);
    expect(scene.diagnostics.is3DEligible).toBe(true);
    expect(scene.diagnostics.errors).toHaveLength(0);
    expect(scene.diagnostics.stats).toEqual({ panCount: 1, obstacleCount: 1, panelCount: 1 });
    expect(scene.world.coordinateSystem).toBe("ENU");
    expect(scene.world.zUp).toBe(true);
  });

  it("CAS 2 — sans obstacles → isValid true", () => {
    const pan = makePan("p1", false);
    const scene = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 12,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [],
      panels: [makePanel("x", "p1")],
    });
    expect(scene.obstacles.items).toHaveLength(0);
    expect(scene.diagnostics.isValid).toBe(true);
  });

  it("CAS 3 — panneau sans pan connu → warning", () => {
    const pan = makePan("only-pan", false);
    const scene = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [],
      panels: [makePanel("bad", "missing-patch")],
    });
    expect(scene.diagnostics.warnings.some((w) => w.includes("PANEL_PATCH_ID_NOT_IN_ROOF"))).toBe(true);
    expect(scene.diagnostics.isValid).toBe(true);
  });

  it("CAS 4 — pan dégénéré → warning", () => {
    const pan = makePan("deg", true);
    const scene = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [],
      panels: [makePanel("pv", "deg")],
    });
    expect(scene.diagnostics.warnings.some((w) => w.includes("PAN_DEGENERATE_DIAGNOSTIC"))).toBe(true);
  });

  it("CAS 5 — sceneId stable entre deux runs", () => {
    const pan = makePan("p", false);
    const obs = makeObstacle("o", "p", false);
    const panel = makePanel("pv", "p");
    const a = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [obs],
      panels: [panel],
    });
    const b = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [obs],
      panels: [panel],
    });
    expect(a.sceneId).toBe(b.sceneId);
    expect(a.sceneId).toMatch(/^scene3d-/);
  });

  it("CAS 6 — immutabilité : state inchangé (référence + contenu roofPans)", () => {
    const roofPans = [{ id: "pan-A", polygonPx: [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ] }];
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        canonical3DWorldContract: {
          schemaVersion: 1,
          metersPerPixel: 0.02,
          northAngleDeg: 0,
          referenceFrame: "LOCAL_IMAGE_ENU",
        },
        roofPans,
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
    const roofPansSnap = JSON.stringify(state.roof.roofPans);
    const contoursSnap = JSON.stringify(state.contours);
    buildCanonicalScene3DInput({
      state,
      getAllPanels: () => [],
    });
    expect(JSON.stringify(state.roof.roofPans)).toBe(roofPansSnap);
    expect(JSON.stringify(state.contours)).toBe(contoursSnap);
    expect(state.roof.roofPans).toBe(roofPans);
  });

  it("computeCanonicalScene3DId déterministe sur ordre des entrées", () => {
    const p1 = makePan("a", false);
    const p2 = makePan("b", false);
    const id1 = computeCanonicalScene3DId([p1, p2], [], []);
    const id2 = computeCanonicalScene3DId([p2, p1], [], []);
    expect(id1).toBe(id2);
  });

  it("failOnInvalid : présence de warnings → isValid false", () => {
    const pan = makePan("only", false);
    const scene = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [],
      panels: [makePanel("bad", "wrong-patch")],
      options: { failOnInvalid: true },
    });
    expect(scene.diagnostics.warnings.length).toBeGreaterThan(0);
    expect(scene.diagnostics.isValid).toBe(false);
    expect(scene.diagnostics.errors.some((e) => e.includes("FAIL_ON_INVALID"))).toBe(true);
  });

  it("stripInvalidItems retire panneau orphelin", () => {
    const pan = makePan("real", false);
    const scene = buildCanonicalScene3DInput({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
      pans: [pan],
      obstacles: [],
      panels: [makePanel("ok", "real"), makePanel("orphan", "nope")],
      options: { stripInvalidItems: true },
    });
    expect(scene.panels.items).toHaveLength(1);
    expect(scene.panels.items[0]!.id).toBe("ok");
    expect(scene.diagnostics.strippedCounts?.panels).toBe(1);
  });

  it("runtime sans canonical3DWorldContract → monde non résolu, is3DEligible false", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [],
      },
    };
    const scene = buildCanonicalScene3DInput({ state });
    expect(scene.diagnostics.is3DEligible).toBe(false);
    expect(scene.diagnostics.errors.some((e) => e.includes("WORLD_REFERENCE_FRAME_MISSING"))).toBe(true);
    expect(scene.world.referenceFrame).toBeUndefined();
  });

  it("runtime avec ridges sur state → diagnostics.structuralRoof peuplé (Prompt 2)", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        canonical3DWorldContract: {
          schemaVersion: 1,
          metersPerPixel: 0.02,
          northAngleDeg: 0,
          referenceFrame: "LOCAL_IMAGE_ENU",
        },
        roofPans: [
          {
            id: "pan-a",
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
      ridges: [
        { id: "r1", a: { x: 150, y: 100 }, b: { x: 150, y: 200 }, roofRole: "main" },
      ],
    };
    const scene = buildCanonicalScene3DInput({ state, getAllPanels: () => [] });
    expect(scene.diagnostics.structuralRoof?.source).toBe("runtime_state");
    expect(scene.diagnostics.structuralRoof?.ridgeKept).toBe(1);
    expect(scene.diagnostics.structuralRoof?.traitKept).toBe(0);
  });

  it("runtime sans north explicite → is3DEligible false (pas de nord 0 implicite)", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: {},
        canonical3DWorldContract: { referenceFrame: "LOCAL_IMAGE_ENU" },
        roofPans: [],
      },
    };
    const scene = buildCanonicalScene3DInput({ state });
    expect(scene.diagnostics.is3DEligible).toBe(false);
    expect(scene.diagnostics.errors.some((e) => e.includes("WORLD_NORTH_MISSING"))).toBe(true);
  });
});
