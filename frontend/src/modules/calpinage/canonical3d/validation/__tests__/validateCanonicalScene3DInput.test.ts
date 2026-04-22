/**
 * Tests validation / hardening CanonicalScene3DInput (Prompt 7).
 */

import { describe, it, expect } from "vitest";
import { computeCanonicalScene3DId } from "../../adapters/buildCanonicalScene3DInput";
import type { CanonicalScene3DInput } from "../../adapters/buildCanonicalScene3DInput";
import type { CanonicalPan3D } from "../../adapters/buildCanonicalPans3DFromRuntime";
import type { CanonicalObstacle3D } from "../../adapters/buildCanonicalObstacles3DFromRuntime";
import type { CanonicalPlacedPanel3D } from "../../adapters/buildCanonicalScene3DInput";
import {
  validateCanonicalScene3DInput,
  CANONICAL_SCENE_VALIDATION_CODES,
} from "../validateCanonicalScene3DInput";

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
    inclinedRoofGeometryTruthful: true,
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
      warnings: degenerate ? ["DEGENERATE"] : [],
    }),
  };
}

function makeObstacle(
  id: string,
  relatedPanId: string | null,
  opts: { badZ?: boolean; baseUnreliable?: boolean; heightFallback?: boolean } = {},
): CanonicalObstacle3D {
  const base = 5;
  const top = opts.badZ ? 4 : 7;
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
      heightWasFallback: opts.heightFallback === true,
      baseZUnreliable: opts.baseUnreliable === true,
      warnings: [],
    },
  };
}

function makePanel(id: string, patchId: string, geomBad = false): CanonicalPlacedPanel3D {
  return {
    id,
    roofPlanePatchId: patchId,
    center: { mode: "world", position: { x: 0.5, y: 0.5, z: 5 } },
    widthM: geomBad ? 0 : 1,
    heightM: 1.7,
    orientation: "portrait",
    rotationDegInPlane: 0,
  };
}

function wrapScene(
  pans: CanonicalPan3D[],
  obstacles: CanonicalObstacle3D[],
  panels: CanonicalPlacedPanel3D[],
  world?: Partial<{
    metersPerPixel: number;
    northAngleDeg: number;
    coordinateSystem: "ENU";
    zUp: true;
    referenceFrame: "LOCAL_IMAGE_ENU";
  }>,
): CanonicalScene3DInput {
  const mpp = world?.metersPerPixel ?? 0.02;
  const north = world?.northAngleDeg ?? 0;
  const referenceFrameExplicit =
    world != null && Object.prototype.hasOwnProperty.call(world, "referenceFrame");
  const referenceFrame = referenceFrameExplicit ? world!.referenceFrame : "LOCAL_IMAGE_ENU";
  return {
    sceneId: computeCanonicalScene3DId(pans, obstacles, panels),
    world: {
      coordinateSystem: "ENU",
      zUp: true,
      northAngleDeg: north,
      metersPerPixel: mpp,
      ...(referenceFrame === undefined ? {} : { referenceFrame }),
    },
    roof: { pans },
    obstacles: { items: obstacles },
    panels: { items: panels },
    diagnostics: {
      isValid: true,
      is3DEligible: true,
      warnings: [],
      errors: [],
      stats: { panCount: pans.length, obstacleCount: obstacles.length, panelCount: panels.length },
    },
  };
}

describe("validateCanonicalScene3DInput", () => {
  it("CAS 1 — scène valide → ok, scène retournée", () => {
    const pan = makePan("p1", false);
    const scene = wrapScene([pan], [makeObstacle("o1", "p1", {})], [makePanel("pv1", "p1")]);
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).toBe(scene);
    expect(res.diagnostics.errors).toHaveLength(0);
  });

  it("CAS 2 — pan dégénéré → erreur PAN_DEGENERATE", () => {
    const scene = wrapScene([makePan("bad", true)], [], []);
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(false);
    expect(res.scene).toBeNull();
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.PAN_DEGENERATE)).toBe(true);
  });

  it("CAS 3 — panneau sans pan → PANEL_ORPHAN", () => {
    const pan = makePan("only", false);
    const scene = wrapScene([pan], [], [makePanel("x", "ghost")]);
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(false);
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.PANEL_ORPHAN)).toBe(true);
  });

  it("CAS 4 — obstacle Z incohérent → erreur ; base peu fiable → warning", () => {
    const pan = makePan("p", false);
    const badZ = wrapScene([pan], [makeObstacle("o", "p", { badZ: true })], []);
    const r1 = validateCanonicalScene3DInput(badZ);
    expect(r1.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_INVALID_Z)).toBe(true);

    const warnOnly = wrapScene([pan], [makeObstacle("o2", "p", { baseUnreliable: true })], []);
    const r2 = validateCanonicalScene3DInput(warnOnly);
    expect(r2.ok).toBe(true);
    expect(r2.diagnostics.warnings.some((w) => w.code === CANONICAL_SCENE_VALIDATION_CODES.OBSTACLE_BASE_Z_UNRELIABLE)).toBe(true);
  });

  it("CAS 5 — ids dupliqués → DUPLICATE_ID", () => {
    const a = makePan("same", false);
    const b = makePan("same", false);
    const scene = wrapScene([a, b], [], []);
    const res = validateCanonicalScene3DInput(scene);
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.DUPLICATE_ID)).toBe(true);
  });

  it("CAS 6 — autoFilter retire entités invalides", () => {
    const good = makePan("good", false);
    const bad = makePan("bad", true);
    const scene = wrapScene(
      [good, bad],
      [makeObstacle("o", "good", { badZ: true })],
      [makePanel("pv", "good"), makePanel("orphan", "bad")],
    );
    const res = validateCanonicalScene3DInput(scene, { autoFilter: true });
    expect(res.ok).toBe(true);
    expect(res.scene!.roof.pans.map((p) => p.panId)).toEqual(["good"]);
    expect(res.scene!.obstacles.items).toHaveLength(0);
    expect(res.scene!.panels.items.map((p) => p.id)).toEqual(["pv"]);
    expect(
      res.diagnostics.warnings.some((w) => w.code === CANONICAL_SCENE_VALIDATION_CODES.AUTO_FILTER_REMOVED_PAN),
    ).toBe(true);
  });

  it("CAS 7 — strict : warnings deviennent erreurs", () => {
    const pan = makePan("p", false);
    const scene = wrapScene([pan], [makeObstacle("o", "p", { heightFallback: true })], []);
    const res = validateCanonicalScene3DInput(scene, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.STRICT_PROMOTED_WARNING)).toBe(
      true,
    );
    expect(res.diagnostics.warnings).toHaveLength(0);
  });

  it("WORLD_MPP_INVALID si mpp ≤ 0", () => {
    const pan = makePan("p", false);
    const scene = wrapScene([pan], [], [], { metersPerPixel: 0 });
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(false);
    expect(res.is3DEligible).toBe(false);
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.WORLD_MPP_INVALID)).toBe(true);
  });

  it("WORLD_NORTH_INVALID si northAngleDeg non fini", () => {
    const pan = makePan("p", false);
    const scene = wrapScene([pan], [], [], { northAngleDeg: Number.NaN });
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(false);
    expect(res.is3DEligible).toBe(false);
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.WORLD_NORTH_INVALID)).toBe(true);
  });

  it("WORLD_REFERENCE_FRAME_MISSING si referenceFrame absent", () => {
    const pan = makePan("p", false);
    const scene = wrapScene([pan], [], [], { referenceFrame: undefined });
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(false);
    expect(res.is3DEligible).toBe(false);
    expect(
      res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.WORLD_REFERENCE_FRAME_MISSING),
    ).toBe(true);
  });

  it("WORLD_Z_UP_INVALID si zUp !== true", () => {
    const pan = makePan("p", false);
    const base = wrapScene([pan], [], []);
    const scene: CanonicalScene3DInput = {
      ...base,
      world: { ...base.world, zUp: false as unknown as true },
    };
    const res = validateCanonicalScene3DInput(scene);
    expect(res.ok).toBe(false);
    expect(res.is3DEligible).toBe(false);
    expect(res.diagnostics.errors.some((e) => e.code === CANONICAL_SCENE_VALIDATION_CODES.WORLD_Z_UP_INVALID)).toBe(true);
  });
});
