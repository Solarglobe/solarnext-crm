import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../../canonical3d/buildSolarScene3DFromCalpinageRuntime";
import { initCalpinage } from "../../legacy/calpinage.module";
import {
  addSketchSegment,
  createSmartRoofSketchGraph,
  prepareSmartRoofDrawingApplication,
  smartRoofDraftGraphRevision,
  smartRoofLegacyDrawingRevision,
  type ComputePansFromGeometryCore,
  type LegacyCalpinageStateLike,
} from "../index";

declare global {
  interface Window {
    __calpinagePhase2GeometryEngineForTests?: {
      computePansFromGeometryCore: ComputePansFromGeometryCore;
    };
    CalpinageCanvas?: unknown;
    CalpinageMap?: unknown;
    CalpinagePans?: unknown;
  }
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function prepareWindowStubs(): void {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify([]), { status: 200 }));
  window.CalpinageCanvas = {};
  window.CalpinageMap = {};
  window.CalpinagePans = {
    panState: { pans: [], activePanId: null, activePoint: null },
    ensurePanPhysicalProps: () => undefined,
    recomputeAllPanPhysicalProps: () => undefined,
  };
}

function legacyEngine(): ComputePansFromGeometryCore {
  const container = document.createElement("div");
  document.body.appendChild(container);
  prepareWindowStubs();
  cleanup = initCalpinage(container, {
    studyId: "smart-roof-application-test",
    versionId: "v1",
    __geometryEngineOnly: true,
  });
  expect(window.__calpinagePhase2GeometryEngineForTests).toBeDefined();
  return window.__calpinagePhase2GeometryEngineForTests!.computePansFromGeometryCore;
}

function emptySource(pans: LegacyCalpinageStateLike["pans"] = []) {
  return { contours: [], traits: [], ridges: [], pans, roof: {}, placedPanels: [] as unknown[] };
}

function addLine(
  graph: ReturnType<typeof createSmartRoofSketchGraph>,
  id: string,
  start: { readonly x: number; readonly y: number; readonly id?: string; readonly nodeId?: string; readonly h?: number },
  end: { readonly x: number; readonly y: number; readonly id?: string; readonly nodeId?: string; readonly h?: number },
) {
  return addSketchSegment(graph, {
    id,
    start: start.nodeId
      ? { nodeId: start.nodeId }
      : { id: start.id, x: start.x, y: start.y, height: start.h != null ? { valueM: start.h, source: "manual", locked: true } : undefined },
    end: end.nodeId
      ? { nodeId: end.nodeId }
      : { id: end.id, x: end.x, y: end.y, height: end.h != null ? { valueM: end.h, source: "manual", locked: true } : undefined },
    role: { value: "unknown", source: "unset" },
    provenance: { source: "test" },
  }).graph;
}

function rectangleGraph(heightM?: number, moved = false) {
  const h = heightM;
  const x1 = moved ? 120 : 100;
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
  graph = addLine(graph, "s0", { id: "n0", x: 0, y: 0, h }, { id: "n1", x: x1, y: 0, h });
  graph = addLine(graph, "s1", { nodeId: "n1", x: x1, y: 0, h }, { id: "n2", x: x1, y: 100, h });
  graph = addLine(graph, "s2", { nodeId: "n2", x: x1, y: 100, h }, { id: "n3", x: 0, y: 100, h });
  graph = addLine(graph, "s3", { nodeId: "n3", x: 0, y: 100, h }, { nodeId: "n0", x: 0, y: 0, h });
  return graph;
}

function rectangleWithInteriorLine(heightM: number) {
  let graph = rectangleGraph(heightM);
  graph = addLine(graph, "middle", { id: "m0", x: 50, y: 0, h: heightM }, { id: "m1", x: 50, y: 100, h: heightM });
  return graph;
}

function gableTwoPansGraph() {
  const pxPerMeter = 10;
  const w = 10 * pxPerMeter;
  const h = 8 * pxPerMeter;
  const ridgeY = 4 * pxPerMeter;
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.001 } });
  graph = addLine(graph, "eave-top", { id: "n0", x: 0, y: 0, h: 3 }, { id: "n1", x: w, y: 0, h: 3 });
  graph = addLine(graph, "right-a", { nodeId: "n1", x: w, y: 0, h: 3 }, { id: "r1", x: w, y: ridgeY, h: 5 });
  graph = addLine(graph, "right-b", { nodeId: "r1", x: w, y: ridgeY, h: 5 }, { id: "n2", x: w, y: h, h: 3 });
  graph = addLine(graph, "eave-bottom", { nodeId: "n2", x: w, y: h, h: 3 }, { id: "n3", x: 0, y: h, h: 3 });
  graph = addLine(graph, "left-b", { nodeId: "n3", x: 0, y: h, h: 3 }, { id: "r0", x: 0, y: ridgeY, h: 5 });
  graph = addLine(graph, "left-a", { nodeId: "r0", x: 0, y: ridgeY, h: 5 }, { nodeId: "n0", x: 0, y: 0, h: 3 });
  graph = addLine(graph, "ridge", { nodeId: "r0", x: 0, y: ridgeY, h: 5 }, { nodeId: "r1", x: w, y: ridgeY, h: 5 });
  return graph;
}

function prepare(graph: ReturnType<typeof rectangleGraph>, source = emptySource()) {
  const sourceRevision = smartRoofLegacyDrawingRevision(source);
  return prepareSmartRoofDrawingApplication({
    graph,
    sourceState: source,
    sourceRevision,
    currentSourceRevision: sourceRevision,
    draftRevision: smartRoofDraftGraphRevision(graph),
    computePansFromGeometryCore: legacyEngine(),
    modelTolerancePx: 0.01,
  });
}

function metricRoofSource(pans: LegacyCalpinageStateLike["pans"] = [], metersPerPixel = 1) {
  return {
    ...emptySource(pans),
    roof: {
      scale: { metersPerPixel },
      north: { angleDeg: 0 },
      roof: { north: { angleDeg: 0 } },
      canonical3DWorldContract: {
        referenceFrame: "LOCAL_IMAGE_ENU",
        metersPerPixel,
        northAngleDeg: 0,
      },
      roofPans: [],
    },
  };
}

describe("smartRoofDrawing application candidate", () => {
  it("prepares on a temporary state and blocks missing relief without mutating the source", () => {
    const source = emptySource();
    const before = JSON.stringify(source);
    const candidate = prepare(rectangleGraph(), source);

    expect(JSON.stringify(source)).toBe(before);
    expect(candidate.status).toBe("blocked");
    expect(candidate.blockingDiagnostics.some((item) => item.code === "SMART_ROOF_RELIEF_MISSING_HEIGHT")).toBe(true);
    expect(candidate.legacyState.pans).toHaveLength(1);
    expect(candidate.persistedDrawing.graph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
  });

  it("accepts unknown lines when a flat relief is explicit", () => {
    const candidate = prepare(rectangleGraph(3.2));

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(1);
    expect(candidate.legacyState.pans[0]).toMatchObject({ roofType: "FLAT", smartRoofRelief: { status: "explicit_flat", heightM: 3.2 } });
    expect(candidate.persistedDrawing.graph.nodes.every((node) => node.height?.valueM === 3.2)).toBe(true);
    expect(candidate.persistedDrawing.graph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
  });

  it("keeps unknown structural lines as topology only and produces two surfaces with explicit flat relief", () => {
    const candidate = prepare(rectangleWithInteriorLine(4));

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(2);
    expect(candidate.legacyState.traits.some((trait) => trait.smartRoofRole === "unknown")).toBe(true);
    expect(candidate.persistedDrawing.graph.segments.find((segment) => segment.id === "middle")?.role.value).toBe("unknown");
    expect(candidate.legacyState.pans.every((pan) => pan.roofType === "FLAT")).toBe(true);
  });

  it("preserves unchanged pan ids, settings and panel references when the match is unambiguous", () => {
    const previousPan = {
      id: "stable-pan",
      name: "Pan conserve",
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      smartSourceSegmentIds: ["s0", "s1", "s2", "s3"],
      flatRoofConfig: { tiltDeg: 10 },
    };
    const source = { ...emptySource([previousPan]), placedPanels: [{ id: "panel-1", panId: "stable-pan" }] };
    const candidate = prepare(rectangleGraph(3), source);

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans[0]?.id).toBe("stable-pan");
    expect(candidate.legacyState.pans[0]?.name).toBe("Pan conserve");
    expect(candidate.panelPolicy.status).toBe("preserve");
    expect(candidate.panelPolicy.affectedPanIds).toEqual(["stable-pan"]);
  });

  it("blocks panel transfer when a panel-bearing pan keeps its id but changes geometry", () => {
    const previousPan = {
      id: "stable-pan",
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      smartSourceSegmentIds: ["s0", "s1", "s2", "s3"],
    };
    const source = { ...emptySource([previousPan]), placedPanels: [{ id: "panel-1", panId: "stable-pan" }] };
    const candidate = prepare(rectangleGraph(3, true), source);

    expect(candidate.status).toBe("blocked");
    expect(candidate.legacyState.pans[0]?.id).toBe("stable-pan");
    expect(candidate.blockingDiagnostics.some((item) => item.code === "SMART_ROOF_PANEL_REVALIDATION_REQUIRED")).toBe(true);
  });

  it("prepares a measured 10m x 8m two-slope roof without flattening the ridge", () => {
    const source = metricRoofSource([], 0.1);
    const candidate = prepare(gableTwoPansGraph(), source);
    const expectedSlopeDeg = Math.atan(2 / 4) * 180 / Math.PI;
    const expectedInclinedAreaM2 = 10 * Math.sqrt(4 ** 2 + 2 ** 2);

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(2);
    expect(candidate.legacyState.ridges).toHaveLength(0);
    expect(candidate.legacyState.traits.find((trait) => trait.id === "ridge")?.smartRoofRole).toBe("unknown");

    const pans = [...candidate.legacyState.pans].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const pan of pans) {
      expect(pan.roofType).toBe("PITCHED");
      expect(pan.smartRoofRelief).toMatchObject({ status: "explicit_vertices" });
      expect(pan.surfaceM2).toBeCloseTo(40, 6);
      expect(pan.projectedSurfaceM2).toBeCloseTo(40, 6);
      expect(pan.inclinedSurfaceM2).toBeCloseTo(expectedInclinedAreaM2, 6);
      expect(pan.tiltDeg).toBeCloseTo(expectedSlopeDeg, 6);
      expect(pan.physical?.slope?.computedDeg).toBeCloseTo(expectedSlopeDeg, 6);
      expect(pan.points?.filter((point) => point.h === 5)).toHaveLength(2);
      expect(pan.points?.filter((point) => point.h === 3)).toHaveLength(2);
    }

    const sceneResult = buildSolarScene3DFromCalpinageRuntime({
      ...candidate.legacyState,
    }, { getAllPanels: () => [] });
    expect(sceneResult.ok).toBe(true);
    expect(sceneResult.roofHeightSignal?.inclinedRoofGeometryTruthful).toBe(true);
    expect(sceneResult.officialRoofModelResult?.model.roofPlanePatches).toHaveLength(2);
    const patchAreas = sceneResult.officialRoofModelResult!.model.roofPlanePatches
      .map((patch) => patch.surface.areaM2)
      .sort((a, b) => a - b);
    expect(patchAreas[0]).toBeCloseTo(expectedInclinedAreaM2, 5);
    expect(patchAreas[1]).toBeCloseTo(expectedInclinedAreaM2, 5);
  });
});
