import { afterEach, describe, expect, it, vi } from "vitest";
import { initCalpinage } from "../../legacy/calpinage.module";
import {
  createSmartRoofDrawingDraftRuntimeApi,
  buildSmartRoofPersistedDrawing,
  smartRoofLegacyDrawingRevision,
  type ComputePansFromGeometryCore,
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
    studyId: "smart-roof-drawing-session-test",
    versionId: "v1",
    __geometryEngineOnly: true,
  });
  expect(window.__calpinagePhase2GeometryEngineForTests).toBeDefined();
  return window.__calpinagePhase2GeometryEngineForTests!.computePansFromGeometryCore;
}

function emptySource() {
  return { contours: [], traits: [], ridges: [], pans: [], roof: {} };
}

function rectangleSource() {
  return {
    contours: [{
      id: "roof",
      points: [
        { x: 0, y: 0, h: 4 },
        { x: 100, y: 0, h: 4 },
        { x: 100, y: 100, h: 4 },
        { x: 0, y: 100, h: 4 },
      ],
    }],
    traits: [],
    ridges: [],
    pans: [{
      id: "persisted-pan",
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      smartSourceSegmentIds: [
        "legacy:contour:roof:s:0",
        "legacy:contour:roof:s:1",
        "legacy:contour:roof:s:2",
        "legacy:contour:roof:s:3",
      ],
    }],
    roof: {},
    placedPanels: [{ id: "panel-1", panId: "persisted-pan" }],
    history: [{ marker: "legacy-history" }],
  };
}

function drawRectangle(runtime: ReturnType<typeof createSmartRoofDrawingDraftRuntimeApi>): void {
  runtime.pointerDown({ x: 0, y: 0 }, 1);
  runtime.pointerDown({ x: 100, y: 0 }, 1);
  runtime.pointerDown({ x: 100, y: 100 }, 1);
  runtime.pointerDown({ x: 0, y: 100 }, 1);
  runtime.pointerDown({ x: 0, y: 0 }, 1);
}

describe("smartRoofDrawing draft session", () => {
  it("opens from an active legacy copy once and keeps active state untouched", () => {
    const source = rectangleSource();
    const before = JSON.stringify(source);
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: source,
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });

    const state = runtime.getState();

    expect(state.sourceImportCount).toBe(1);
    expect(state.sourceRevision).toBe(smartRoofLegacyDrawingRevision(source));
    expect(state.graph.segments).toHaveLength(4);
    expect(state.compile.status).toBe("computed");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("creates unknown segments by mouse-like clicks and compiles a rectangle", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });

    drawRectangle(runtime);
    const state = runtime.getState();

    expect(state.graph.segments).toHaveLength(4);
    expect(state.graph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
    expect(state.chain).toBeNull();
    expect(state.compile.status).toBe("computed");
    expect(state.compile.result.legacyState.pans).toHaveLength(1);
  });

  it("connects to existing segments by splitting a T-junction without confirming a business role", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    drawRectangle(runtime);
    runtime.pointerDown({ x: 50, y: 0 }, 1);
    runtime.pointerDown({ x: 50, y: 50 }, 1);

    const state = runtime.getState();

    expect(state.graph.nodes.some((node) => node.id.includes("draft-junction"))).toBe(true);
    expect(state.graph.segments.some((segment) => segment.id.includes(":part-"))).toBe(true);
    expect(state.graph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
    expect(state.compile.result.legacyState.traits.some((trait) => trait.smartRoofRole === "unknown")).toBe(true);
  });

  it("moves a shared node while preserving connected segment ids", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    drawRectangle(runtime);
    const before = runtime.getState();
    const movedNodeId = before.graph.nodes.find((node) => node.x === 0 && node.y === 0)!.id;
    const segmentIds = before.graph.segments.map((segment) => segment.id).sort();

    runtime.setTool("select");
    runtime.pointerDown({ x: 0, y: 0 }, 1);
    runtime.pointerMove({ x: 25, y: 20 }, 1);
    expect(runtime.getState().graph.nodes.find((node) => node.id === movedNodeId)?.x).toBe(0);
    runtime.pointerUp({ x: 25, y: 20 });

    const after = runtime.getState();
    expect(after.graph.nodes.find((node) => node.id === movedNodeId)).toMatchObject({ x: 25, y: 20 });
    expect(after.graph.segments.map((segment) => segment.id).sort()).toEqual(segmentIds);
    expect(after.undoStack.length).toBeGreaterThan(0);
  });

  it("deletes selected segments and supports undo / redo in draft history only", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    drawRectangle(runtime);
    const firstSegment = runtime.getState().graph.segments[0]!;

    runtime.setTool("select");
    runtime.pointerDown({ x: 50, y: 0 }, 1);
    expect(runtime.getState().selected).toEqual({ type: "segment", segmentId: firstSegment.id });
    runtime.deleteSelection();
    expect(runtime.getState().graph.segments).toHaveLength(3);
    expect(runtime.getState().compile.status).toBe("incomplete");

    runtime.undo();
    expect(runtime.getState().graph.segments).toHaveLength(4);
    runtime.redo();
    expect(runtime.getState().graph.segments).toHaveLength(3);
  });

  it("keeps the result tied to the current draft revision and marks external source changes stale", () => {
    const source = rectangleSource();
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: source,
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    const firstRevision = runtime.getState().compile.revision;

    runtime.pointerDown({ x: 0, y: 50 }, 1);
    runtime.pointerDown({ x: 100, y: 50 }, 1);
    expect(runtime.getState().compile.revision).not.toBe(firstRevision);
    expect(runtime.getState().sourceImportCount).toBe(1);

    source.contours[0]!.points[1] = { x: 120, y: 0, h: 4 };
    runtime.checkSourceRevision(source);
    expect(runtime.getState().compile.status).toBe("source_stale");
    expect(runtime.getState().diagnostics.some((item) => item.code === "DRAFT_SOURCE_REVISION_STALE")).toBe(true);
  });

  it("stores manual relief corrections in the draft graph and prepares an applicable flat candidate", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    drawRectangle(runtime);

    runtime.setAllNodeHeights({ valueM: 3.5, source: "manual", locked: true });
    const state = runtime.getState();
    const candidate = runtime.prepareApplication(emptySource());

    expect(state.graph.nodes.every((node) => node.height?.valueM === 3.5)).toBe(true);
    expect(candidate.status).toBe("ready");
    expect(candidate.legacyState.pans[0]).toMatchObject({ roofType: "FLAT", smartRoofRelief: { status: "explicit_flat", heightM: 3.5 } });
    expect(candidate.persistedDrawing.graph.nodes.map((node) => node.id).sort()).toEqual(state.graph.nodes.map((node) => node.id).sort());
  });

  it("lets an explicit selected-line height override a previous flat height correction", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    drawRectangle(runtime);
    runtime.setAllNodeHeights({ valueM: 3, source: "manual", locked: true });

    runtime.setTool("select");
    runtime.pointerDown({ x: 50, y: 0 }, 1);
    runtime.setSelectedSegmentHeight({ valueM: 5, source: "manual", locked: true });

    const state = runtime.getState();
    const selected = state.selected?.type === "segment"
      ? state.graph.segments.find((segment) => segment.id === state.selected?.segmentId)
      : null;
    expect(selected).toBeTruthy();
    const endpointHeights = [selected!.startNodeId, selected!.endNodeId]
      .map((nodeId) => state.graph.nodes.find((node) => node.id === nodeId)?.height?.valueM)
      .sort();
    expect(endpointHeights).toEqual([5, 5]);
    expect(state.graph.segments.find((segment) => segment.id === selected!.id)?.height?.valueM).toBe(5);
  });

  it("loads a persisted smart graph directly instead of reimporting legacy projections", () => {
    const engine = legacyEngine();
    const firstRuntime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: engine,
      modelTolerancePx: 0.01,
    });
    drawRectangle(firstRuntime);
    firstRuntime.setAllNodeHeights({ valueM: 2.8, source: "manual", locked: true });
    const persisted = buildSmartRoofPersistedDrawing({
      graph: firstRuntime.getState().graph,
      sourceRevision: "legacy-after-apply",
      draftRevision: firstRuntime.getState().compile.revision,
    });

    const sourceWithPersistedGraph = {
      ...rectangleSource(),
      smartRoofDrawing: persisted,
    };
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: sourceWithPersistedGraph,
      computePansFromGeometryCore: engine,
      modelTolerancePx: 0.01,
    });

    expect(runtime.getState().sourceImportCount).toBe(0);
    expect(runtime.getState().graph.nodes.map((node) => node.id).sort()).toEqual(firstRuntime.getState().graph.nodes.map((node) => node.id).sort());
    expect(runtime.getState().graph.nodes.every((node) => node.height?.valueM === 2.8)).toBe(true);
  });

  it("disposes its local history and refuses later interactions", () => {
    const runtime = createSmartRoofDrawingDraftRuntimeApi({
      sourceState: emptySource(),
      computePansFromGeometryCore: legacyEngine(),
      modelTolerancePx: 0.01,
    });
    runtime.pointerDown({ x: 0, y: 0 }, 1);
    runtime.dispose();

    expect(() => runtime.getState()).toThrow(/disposed/);
  });
});
