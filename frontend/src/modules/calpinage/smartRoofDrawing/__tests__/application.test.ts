import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSafeZonesFromCalpinageState, isPanelInsideSafeZone } from "../../../../../calpinage/engine/safeZoneAdapter.js";
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
  start: { readonly x: number; readonly y: number; readonly id?: string; readonly nodeId?: string; readonly h?: number; readonly groupId?: string | null },
  end: { readonly x: number; readonly y: number; readonly id?: string; readonly nodeId?: string; readonly h?: number; readonly groupId?: string | null },
  options: { readonly groupId?: string | null; readonly levelId?: string | null } = {},
) {
  const groupId = options.groupId ?? start.groupId ?? end.groupId ?? null;
  return addSketchSegment(graph, {
    id,
    start: start.nodeId
      ? { nodeId: start.nodeId }
      : { id: start.id, x: start.x, y: start.y, groupId, levelId: options.levelId ?? null, height: start.h != null ? { valueM: start.h, source: "manual", locked: true } : undefined },
    end: end.nodeId
      ? { nodeId: end.nodeId }
      : { id: end.id, x: end.x, y: end.y, groupId, levelId: options.levelId ?? null, height: end.h != null ? { valueM: end.h, source: "manual", locked: true } : undefined },
    groupId,
    levelId: options.levelId ?? null,
    role: { value: "unknown", source: "unset" },
    provenance: { source: "test" },
  }).graph;
}

function panelAt(cx: number, cy: number, half = 0.1) {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
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

function gableTwoPansGraph(withHeights = true, ridgeMetersFromTop = 4) {
  const pxPerMeter = 10;
  const w = 10 * pxPerMeter;
  const h = 8 * pxPerMeter;
  const ridgeY = ridgeMetersFromTop * pxPerMeter;
  const eaveH = withHeights ? 3 : undefined;
  const ridgeH = withHeights ? 5 : undefined;
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.001 } });
  graph = addLine(graph, "eave-top", { id: "n0", x: 0, y: 0, h: eaveH }, { id: "n1", x: w, y: 0, h: eaveH });
  graph = addLine(graph, "right-a", { nodeId: "n1", x: w, y: 0, h: eaveH }, { id: "r1", x: w, y: ridgeY, h: ridgeH });
  graph = addLine(graph, "right-b", { nodeId: "r1", x: w, y: ridgeY, h: ridgeH }, { id: "n2", x: w, y: h, h: eaveH });
  graph = addLine(graph, "eave-bottom", { nodeId: "n2", x: w, y: h, h: eaveH }, { id: "n3", x: 0, y: h, h: eaveH });
  graph = addLine(graph, "left-b", { nodeId: "n3", x: 0, y: h, h: eaveH }, { id: "r0", x: 0, y: ridgeY, h: ridgeH });
  graph = addLine(graph, "left-a", { nodeId: "r0", x: 0, y: ridgeY, h: ridgeH }, { nodeId: "n0", x: 0, y: 0, h: eaveH });
  graph = addLine(graph, "ridge", { nodeId: "r0", x: 0, y: ridgeY, h: ridgeH }, { nodeId: "r1", x: w, y: ridgeY, h: ridgeH });
  return graph;
}

function appendGroupedGable(input: {
  readonly graph: ReturnType<typeof createSmartRoofSketchGraph>;
  readonly prefix: string;
  readonly groupId: string | null;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly eaveH: number;
  readonly ridgeH: number;
}) {
  const midY = (input.y0 + input.y1) / 2;
  let graph = input.graph;
  const p = input.prefix;
  const group = input.groupId;
  graph = addLine(graph, `${p}-eave-top`, { id: `${p}-n0`, x: input.x0, y: input.y0, h: input.eaveH }, { id: `${p}-n1`, x: input.x1, y: input.y0, h: input.eaveH }, { groupId: group });
  graph = addLine(graph, `${p}-right-a`, { nodeId: `${p}-n1`, x: input.x1, y: input.y0, h: input.eaveH }, { id: `${p}-r1`, x: input.x1, y: midY, h: input.ridgeH }, { groupId: group });
  graph = addLine(graph, `${p}-right-b`, { nodeId: `${p}-r1`, x: input.x1, y: midY, h: input.ridgeH }, { id: `${p}-n2`, x: input.x1, y: input.y1, h: input.eaveH }, { groupId: group });
  graph = addLine(graph, `${p}-eave-bottom`, { nodeId: `${p}-n2`, x: input.x1, y: input.y1, h: input.eaveH }, { id: `${p}-n3`, x: input.x0, y: input.y1, h: input.eaveH }, { groupId: group });
  graph = addLine(graph, `${p}-left-b`, { nodeId: `${p}-n3`, x: input.x0, y: input.y1, h: input.eaveH }, { id: `${p}-r0`, x: input.x0, y: midY, h: input.ridgeH }, { groupId: group });
  graph = addLine(graph, `${p}-left-a`, { nodeId: `${p}-r0`, x: input.x0, y: midY, h: input.ridgeH }, { nodeId: `${p}-n0`, x: input.x0, y: input.y0, h: input.eaveH }, { groupId: group });
  graph = addLine(graph, `${p}-ridge`, { nodeId: `${p}-r0`, x: input.x0, y: midY, h: input.ridgeH }, { nodeId: `${p}-r1`, x: input.x1, y: midY, h: input.ridgeH }, { groupId: group });
  return graph;
}

function adjacentDistinctGabledVolumesGraph() {
  let graph = createSmartRoofSketchGraph({
    groups: [
      { id: "volume-a", label: "A", kind: "building" },
      { id: "volume-b", label: "B", kind: "building" },
    ],
    metadata: { createdFrom: "test", modelTolerancePx: 0.001 },
  });
  graph = appendGroupedGable({ graph, prefix: "a", groupId: "volume-a", x0: 0, x1: 100, y0: 0, y1: 80, eaveH: 3, ridgeH: 5 });
  graph = appendGroupedGable({ graph, prefix: "b", groupId: "volume-b", x0: 100, x1: 200, y0: 0, y1: 80, eaveH: 5, ridgeH: 7 });
  return graph;
}

function adjacentSameHeightConnectedGabledVolumesGraph() {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.001 } });
  graph = appendGroupedGable({ graph, prefix: "a", groupId: null, x0: 0, x1: 100, y0: 0, y1: 80, eaveH: 3, ridgeH: 5 });
  graph = addLine(graph, "b-eave-top", { nodeId: "a-n1", x: 100, y: 0, h: 3 }, { id: "b-n1", x: 200, y: 0, h: 3 });
  graph = addLine(graph, "b-right-a", { nodeId: "b-n1", x: 200, y: 0, h: 3 }, { id: "b-r1", x: 200, y: 40, h: 5 });
  graph = addLine(graph, "b-right-b", { nodeId: "b-r1", x: 200, y: 40, h: 5 }, { id: "b-n2", x: 200, y: 80, h: 3 });
  graph = addLine(graph, "b-eave-bottom", { nodeId: "b-n2", x: 200, y: 80, h: 3 }, { nodeId: "a-n2", x: 100, y: 80, h: 3 });
  graph = addLine(graph, "b-left-b", { nodeId: "a-n2", x: 100, y: 80, h: 3 }, { nodeId: "a-r1", x: 100, y: 40, h: 5 });
  graph = addLine(graph, "b-left-a", { nodeId: "a-r1", x: 100, y: 40, h: 5 }, { nodeId: "a-n1", x: 100, y: 0, h: 3 });
  graph = addLine(graph, "b-ridge", { nodeId: "a-r1", x: 100, y: 40, h: 5 }, { nodeId: "b-r1", x: 200, y: 40, h: 5 });
  return graph;
}

function hippedFourPansGraph(withHeights = false) {
  const pxPerMeter = 10;
  const w = 10 * pxPerMeter;
  const h = 8 * pxPerMeter;
  const eaveH = withHeights ? 3 : undefined;
  const ridgeH = withHeights ? 5 : undefined;
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.001 } });
  graph = addLine(graph, "eave-top", { id: "n0", x: 0, y: 0, h: eaveH }, { id: "n1", x: w, y: 0, h: eaveH });
  graph = addLine(graph, "eave-right", { nodeId: "n1", x: w, y: 0, h: eaveH }, { id: "n2", x: w, y: h, h: eaveH });
  graph = addLine(graph, "eave-bottom", { nodeId: "n2", x: w, y: h, h: eaveH }, { id: "n3", x: 0, y: h, h: eaveH });
  graph = addLine(graph, "eave-left", { nodeId: "n3", x: 0, y: h, h: eaveH }, { nodeId: "n0", x: 0, y: 0, h: eaveH });
  graph = addLine(graph, "ridge", { id: "r0", x: 4 * pxPerMeter, y: 4 * pxPerMeter, h: ridgeH }, { id: "r1", x: 6 * pxPerMeter, y: 4 * pxPerMeter, h: ridgeH });
  graph = addLine(graph, "hip-nw", { nodeId: "n0", x: 0, y: 0, h: eaveH }, { nodeId: "r0", x: 4 * pxPerMeter, y: 4 * pxPerMeter, h: ridgeH });
  graph = addLine(graph, "hip-sw", { nodeId: "n3", x: 0, y: h, h: eaveH }, { nodeId: "r0", x: 4 * pxPerMeter, y: 4 * pxPerMeter, h: ridgeH });
  graph = addLine(graph, "hip-ne", { nodeId: "n1", x: w, y: 0, h: eaveH }, { nodeId: "r1", x: 6 * pxPerMeter, y: 4 * pxPerMeter, h: ridgeH });
  graph = addLine(graph, "hip-se", { nodeId: "n2", x: w, y: h, h: eaveH }, { nodeId: "r1", x: 6 * pxPerMeter, y: 4 * pxPerMeter, h: ridgeH });
  return graph;
}

function lFivePansGraph(withHeights = false) {
  const eaveH = withHeights ? 3 : undefined;
  const ridgeH = withHeights ? 4.5 : undefined;
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.001 } });
  graph = addLine(graph, "outline-0", { id: "n0", x: 0, y: 0, h: eaveH }, { id: "n1", x: 12, y: 0, h: eaveH });
  graph = addLine(graph, "outline-1", { nodeId: "n1", x: 12, y: 0, h: eaveH }, { id: "n2", x: 12, y: 6, h: eaveH });
  graph = addLine(graph, "outline-2", { nodeId: "n2", x: 12, y: 6, h: eaveH }, { id: "n3", x: 6, y: 6, h: eaveH });
  graph = addLine(graph, "outline-3", { nodeId: "n3", x: 6, y: 6, h: eaveH }, { id: "n4", x: 6, y: 12, h: eaveH });
  graph = addLine(graph, "outline-4", { nodeId: "n4", x: 6, y: 12, h: eaveH }, { id: "n5", x: 0, y: 12, h: eaveH });
  graph = addLine(graph, "outline-5", { nodeId: "n5", x: 0, y: 12, h: eaveH }, { nodeId: "n0", x: 0, y: 0, h: eaveH });
  graph = addLine(graph, "ridge-horizontal", { id: "rh0", x: 0, y: 3, h: ridgeH }, { id: "rh1", x: 12, y: 3, h: ridgeH });
  graph = addLine(graph, "ridge-vertical", { id: "center", x: 3, y: 3, h: ridgeH }, { id: "rv1", x: 3, y: 12, h: ridgeH });
  graph = addLine(graph, "valley-left", { id: "vl0", x: 0, y: 6, h: eaveH }, { nodeId: "center", x: 3, y: 3, h: ridgeH });
  graph = addLine(graph, "valley-concave", { nodeId: "n3", x: 6, y: 6, h: eaveH }, { nodeId: "center", x: 3, y: 3, h: ridgeH });
  return graph;
}

function flatRoofWithSimpleDormerGraph(withDormerRidge = true, scale = 1) {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.001 } });
  graph = addLine(graph, "roof-0", { id: "n0", x: 0, y: 0 }, { id: "n1", x: 10 * scale, y: 0 });
  graph = addLine(graph, "roof-1", { nodeId: "n1", x: 10 * scale, y: 0 }, { id: "n2", x: 10 * scale, y: 8 * scale });
  graph = addLine(graph, "roof-2", { nodeId: "n2", x: 10 * scale, y: 8 * scale }, { id: "n3", x: 0, y: 8 * scale });
  graph = addLine(graph, "roof-3", { nodeId: "n3", x: 0, y: 8 * scale }, { nodeId: "n0", x: 0, y: 0 });
  graph = addLine(graph, "dormer-0", { id: "d0", x: 3 * scale, y: 2 * scale }, { id: "d1", x: 5 * scale, y: 2 * scale });
  graph = addLine(graph, "dormer-1", { nodeId: "d1", x: 5 * scale, y: 2 * scale }, { id: "d2", x: 5 * scale, y: 5 * scale });
  graph = addLine(graph, "dormer-2", { nodeId: "d2", x: 5 * scale, y: 5 * scale }, { id: "d3", x: 3 * scale, y: 5 * scale });
  graph = addLine(graph, "dormer-3", { nodeId: "d3", x: 3 * scale, y: 5 * scale }, { nodeId: "d0", x: 3 * scale, y: 2 * scale });
  if (withDormerRidge) {
    graph = addLine(graph, "dormer-ridge", { id: "dr0", x: 4 * scale, y: 2 * scale }, { id: "dr1", x: 4 * scale, y: 5 * scale });
  }
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
  it("prepares on a temporary state and proposes an estimated flat relief without mutating the source", () => {
    const source = emptySource();
    const before = JSON.stringify(source);
    const candidate = prepare(rectangleGraph(), source);

    expect(JSON.stringify(source)).toBe(before);
    expect(candidate.status).toBe("ready");
    expect(candidate.blockingDiagnostics.some((item) => item.code === "SMART_ROOF_RELIEF_MISSING_HEIGHT")).toBe(false);
    expect(candidate.diagnostics.some((item) => item.code === "SMART_ROOF_RELIEF_ESTIMATED_FLAT")).toBe(true);
    expect(candidate.legacyState.pans).toHaveLength(1);
    expect(candidate.legacyState.pans[0]).toMatchObject({ roofType: "FLAT", smartRoofRelief: { status: "estimated_flat", heightM: 3 } });
    expect(candidate.persistedDrawing.graph.segments.every((segment) => segment.role.value === "outline" && segment.role.source === "inferred")).toBe(true);
  });

  it("accepts unknown lines when a flat relief is explicit", () => {
    const candidate = prepare(rectangleGraph(3.2));

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(1);
    expect(candidate.legacyState.pans[0]).toMatchObject({ roofType: "FLAT", smartRoofRelief: { status: "explicit_flat", heightM: 3.2 } });
    expect(candidate.persistedDrawing.graph.nodes.every((node) => node.height?.valueM === 3.2)).toBe(true);
    expect(candidate.persistedDrawing.graph.segments.every((segment) => segment.role.value === "outline" && segment.role.source === "inferred")).toBe(true);
  });

  it("infers an unknown structural separator as ridge while preserving explicit flat relief", () => {
    const candidate = prepare(rectangleWithInteriorLine(4));

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(2);
    expect(candidate.legacyState.ridges.some((ridge) => ridge.smartRoofRole === "ridge" && ridge.smartRoofRoleSource === "inferred")).toBe(true);
    expect(candidate.persistedDrawing.graph.segments.find((segment) => segment.id === "middle")?.role).toMatchObject({ value: "ridge", source: "inferred" });
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
    expect(candidate.legacyState.ridges).toHaveLength(1);
    expect(candidate.legacyState.ridges.find((ridge) => ridge.id === "ridge")?.smartRoofRole).toBe("ridge");
    expect(candidate.legacyState.ridges.find((ridge) => ridge.id === "ridge")?.smartRoofRoleSource).toBe("inferred");

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

  it("recognises an unknown two-slope roof and proposes estimated ridge relief", () => {
    const source = metricRoofSource([], 0.1);
    const candidate = prepare(gableTwoPansGraph(false), source);
    const expectedSlopeDeg = Math.atan(2 / 4) * 180 / Math.PI;
    const expectedInclinedAreaM2 = 10 * Math.sqrt(4 ** 2 + 2 ** 2);

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.ridges).toHaveLength(1);
    expect(candidate.legacyState.ridges[0]).toMatchObject({ id: "ridge", smartRoofRole: "ridge", smartRoofRoleSource: "inferred" });
    expect(candidate.legacyState.pans).toHaveLength(2);
    expect(candidate.diagnostics.some((item) => item.code === "SMART_ROOF_RELIEF_ESTIMATED_PITCHED")).toBe(true);

    for (const pan of candidate.legacyState.pans) {
      expect(pan.surfaceM2).toBeCloseTo(40, 6);
      expect(pan.inclinedSurfaceM2).toBeCloseTo(expectedInclinedAreaM2, 6);
      expect(pan.tiltDeg).toBeCloseTo(expectedSlopeDeg, 6);
      expect(pan.smartRoofRelief).toMatchObject({ status: "estimated_vertices" });
      expect(pan.points?.filter((point) => point.h === 5 && point.smartRoofHeightSource === "estimated")).toHaveLength(2);
      expect(pan.points?.filter((point) => point.h === 3 && point.smartRoofHeightSource === "default")).toHaveLength(2);
    }
  });

  it("keeps an offset unknown ridge asymmetric instead of recentering it", () => {
    const source = metricRoofSource([], 0.1);
    const candidate = prepare(gableTwoPansGraph(false, 3), source);
    const projectedAreas = candidate.legacyState.pans.map((pan) => pan.projectedSurfaceM2).sort((a, b) => a - b);
    const slopes = candidate.legacyState.pans.map((pan) => pan.tiltDeg).sort((a, b) => a - b);

    expect(candidate.status).toBe("ready");
    expect(projectedAreas[0]).toBeCloseTo(30, 6);
    expect(projectedAreas[1]).toBeCloseTo(50, 6);
    expect(slopes[0]).toBeCloseTo(Math.atan(2 / 5) * 180 / Math.PI, 6);
    expect(slopes[1]).toBeCloseTo(Math.atan(2 / 3) * 180 / Math.PI, 6);
  });

  it("keeps adjacent distinct volumes from averaging coincident raccord heights", () => {
    const candidate = prepare(adjacentDistinctGabledVolumesGraph(), metricRoofSource([], 0.1));
    const heightPairs = candidate.legacyState.pans
      .map((pan) => {
        const heights = (pan.points ?? []).map((point) => Number(point.h)).filter(Number.isFinite);
        return {
          min: Math.min(...heights),
          max: Math.max(...heights),
          area: Number(pan.projectedSurfaceM2 ?? pan.surfaceM2),
          slope: Number(pan.tiltDeg ?? pan.slopeDeg),
        };
      })
      .sort((a, b) => a.min - b.min || a.max - b.max || a.area - b.area);
    const raccordHeights = candidate.persistedDrawing.graph.nodes
      .filter((node) => Math.abs(node.x - 100) <= 0.001)
      .map((node) => ({ id: node.id, groupId: node.groupId, height: node.height?.valueM }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.contours).toHaveLength(2);
    expect(candidate.legacyState.ridges).toHaveLength(2);
    expect(candidate.legacyState.pans).toHaveLength(4);
    expect(heightPairs.map((item) => [item.min, item.max])).toEqual([[3, 5], [3, 5], [5, 7], [5, 7]]);
    expect(heightPairs.every((item) => item.area.toFixed(6) === "40.000000")).toBe(true);
    expect(heightPairs.every((item) => Number.isFinite(item.slope) && item.slope > 20)).toBe(true);
    expect(raccordHeights.filter((item) => item.groupId === "volume-a").map((item) => item.height).sort()).toEqual([3, 3, 5]);
    expect(raccordHeights.filter((item) => item.groupId === "volume-b").map((item) => item.height).sort()).toEqual([5, 5, 7]);
    expect(raccordHeights.some((item) => item.height === 4 || item.height === 6)).toBe(false);
    expect(candidate.diagnostics.some((item) => item.code === "NODE_HEIGHT_CONFLICT")).toBe(false);
  });

  it("does not force a distinct-volume split when adjacent roofs really share the same raccord heights", () => {
    const candidate = prepare(adjacentSameHeightConnectedGabledVolumesGraph(), metricRoofSource([], 0.1));
    const sharedNodeIds = candidate.persistedDrawing.graph.nodes
      .filter((node) => Math.abs(node.x - 100) <= 0.001)
      .map((node) => node.id)
      .sort();

    expect(candidate.status).toBe("ready");
    expect(candidate.persistedDrawing.graph.groups).toHaveLength(0);
    expect(sharedNodeIds).toEqual(["a-n1", "a-n2", "a-r1"]);
    expect(candidate.legacyState.pans.length).toBeGreaterThanOrEqual(2);
    expect(candidate.diagnostics.some((item) => item.code === "NODE_HEIGHT_CONFLICT")).toBe(false);
  });

  it("recognises an unknown four-pan hipped roof with ridge and hips", () => {
    const source = metricRoofSource([], 0.1);
    const candidate = prepare(hippedFourPansGraph(false), source);
    const projectedTotal = candidate.legacyState.pans.reduce((sum, pan) => sum + Number(pan.projectedSurfaceM2 ?? 0), 0);

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(4);
    expect(projectedTotal).toBeCloseTo(80, 6);
    expect(candidate.legacyState.ridges.map((ridge) => ridge.id)).toEqual(["ridge"]);
    expect(candidate.legacyState.traits.filter((trait) => trait.smartRoofRole === "hip")).toHaveLength(4);
    expect(candidate.legacyState.pans.every((pan) => pan.smartRoofRelief?.status === "estimated_vertices")).toBe(true);
    expect(candidate.legacyState.pans.every((pan) => Number.isFinite(pan.tiltDeg))).toBe(true);
  });

  it("recognises the reference L roof without filling the concavity", () => {
    const source = metricRoofSource([], 1);
    const candidate = prepare(lFivePansGraph(false), source);
    const projectedTotal = candidate.legacyState.pans.reduce((sum, pan) => sum + Number(pan.projectedSurfaceM2 ?? 0), 0);

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(5);
    expect(projectedTotal).toBeCloseTo(108, 6);
    expect(candidate.legacyState.contours[0]?.points).toHaveLength(10);
    expect(candidate.legacyState.ridges.map((ridge) => ridge.smartRoofRole)).toContain("ridge");
    expect(candidate.legacyState.traits.filter((trait) => trait.smartRoofRole === "valley")).toHaveLength(2);
    expect(candidate.legacyState.pans.every((pan) => pan.smartRoofRelief?.status === "estimated_vertices")).toBe(true);
  });

  it("recognises a simple dormer from unknown nested lines and feeds the existing 3D extension path", () => {
    const source = metricRoofSource([], 0.1);
    const candidate = prepare(flatRoofWithSimpleDormerGraph(true, 10), source);

    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans).toHaveLength(1);
    expect(candidate.legacyState.roofExtensions).toHaveLength(1);
    const extension = candidate.legacyState.roofExtensions[0]!;
    expect(extension).toMatchObject({
      type: "roof_extension",
      kind: "dormer",
      visualModel: "manual_outline_gable",
      smartRoofRole: "dormer",
      smartRoofRoleSource: "inferred",
      ridgeHeightRelM: 1,
      heightReference: "support_plane_normal",
    });
    expect(extension.supportPanId).toBe(String(candidate.legacyState.pans[0]!.id));
    expect(extension.smartSourceSegmentIds).toHaveLength(6);
    expect(extension.smartSourceSegmentIds.every((id) => id.startsWith("dormer-"))).toBe(true);
    expect(extension.smartSourceRidgeSegmentId).toBe("dormer-ridge");
    expect(candidate.legacyState.traits.some((trait) => trait.id === "dormer-ridge")).toBe(false);
    expect(extension.contour.points.every((point) => point.heightRelM === 0 && point.smartRoofHeightSource === "default")).toBe(true);
    expect(extension.ridge.a.heightRelM).toBe(1);
    expect(extension.ridge.b.heightRelM).toBe(1);

    const sceneResult = buildSolarScene3DFromCalpinageRuntime({
      ...candidate.legacyState,
    }, { getAllPanels: () => [] });
    expect(sceneResult.ok).toBe(true);
    expect(sceneResult.scene?.extensionVolumes).toHaveLength(1);
    const volume = sceneResult.scene?.extensionVolumes[0];
    expect(volume?.kind).toBe("dormer");
    expect(volume?.heightM).toBeGreaterThan(0.5);
    expect(volume?.faces.length).toBeGreaterThanOrEqual(6);
    expect(volume?.surfaceAreaM2).toBeGreaterThan(0);
    expect(volume?.topology?.miniRoof?.hasMiniRoofPlanes).toBe(true);
    expect(volume?.topology?.miniRoof?.hasSupportSeam).toBe(true);
    expect(volume?.topology?.preparedUses?.keepout).toBe("footprint");

    const safeZones = computeSafeZonesFromCalpinageState({
      ...candidate.legacyState,
      metersPerPixel: 1,
    }).byPanId[String(extension.supportPanId)]?.safeZonePolygonsPx ?? [];
    expect(safeZones.length).toBeGreaterThan(0);
    expect(isPanelInsideSafeZone(panelAt(10, 10, 1), safeZones)).toBe(true);
    expect(isPanelInsideSafeZone(panelAt(40, 35, 10), safeZones)).toBe(false);
  });

  it("blocks a nested unknown loop without a dormer ridge instead of filling it as a main contour", () => {
    const candidate = prepare(flatRoofWithSimpleDormerGraph(false), metricRoofSource([], 1));

    expect(candidate.status).toBe("blocked");
    expect(candidate.legacyState.roofExtensions).toHaveLength(0);
    expect(candidate.blockingDiagnostics.some((item) => item.code === "HOLE_OR_NESTED_OUTLINE_UNSUPPORTED")).toBe(true);
    expect(candidate.legacyState.pans).toHaveLength(1);
  });
});
