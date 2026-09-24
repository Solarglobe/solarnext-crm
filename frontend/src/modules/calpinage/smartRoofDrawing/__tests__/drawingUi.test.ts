import { initCalpinage } from "../../legacy/calpinage.module";
import {
  captureRoofModelingGeometrySnapshot,
  pushRoofModelingPastSnapshot,
  resetRoofModelingHistoryForTests,
  undoRoofModeling,
} from "../../runtime/roofModelingHistory";
// Le prototype reste testable explicitement, mais il est désactivé en production.
vi.mock("../drawingFeatureFlag", () => ({
  isSmartRoofDrawingEnabled: () => window.localStorage.getItem("calpinage_smart_roof_drawing") === "true",
  smartRoofDrawingLocalStorageKey: () => "calpinage_smart_roof_drawing",
}));
import {
  addSketchNode,
  addSketchSegment,
  buildSmartRoofPersistedDrawing,
  createSmartRoofSketchGraph,
  type ComputePansFromGeometryCore,
  type LegacyCalpinageStateLike,
} from "../index";

declare global {
  interface Window {
    __calpinagePhase2GeometryEngineForTests?: {
      computePansFromGeometryCore: ComputePansFromGeometryCore;
    };
    __calpinageSmartRoofDrawing?: {
      enabled: boolean;
      isActive: () => boolean;
      open: () => unknown;
      close: (opts?: { force?: boolean }) => boolean;
      getState: () => any;
      activeStateUnchanged: () => boolean;
      setTool: (tool: "draw" | "select") => unknown;
      prepareApplication: () => any;
      apply: () => any;
      setSelectedHeight: (valueM: number) => unknown;
      setFlatHeight: (valueM: number) => unknown;
      setSelectedRole: (role: "unknown" | "outline" | "trait" | "ridge") => unknown;
      protectedSnapshot: () => string | null;
      buildExport: () => any;
      undo: () => unknown;
      redo: () => unknown;
      deleteSelection: () => unknown;
    };
    CALPINAGE_STATE?: Record<string, unknown>;
    CalpinageCanvas?: unknown;
    CalpinageMap?: unknown;
    CalpinagePans?: unknown;
  }
}

let cleanup: (() => void) | null = null;

async function flushCalpinageAsyncLoad(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

afterEach(async () => {
  await flushCalpinageAsyncLoad();
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  window.localStorage?.removeItem("calpinage_smart_roof_drawing");
  delete window.__calpinagePhase2GeometryEngineForTests;
  delete window.__calpinageSmartRoofDrawing;
  delete (window as any).__calpinageApplyCurrentHeightSelectionForTests;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  resetRoofModelingHistoryForTests();
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

function mountCalpinage(options: Record<string, unknown> = {}, fresh = true): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  window.history.replaceState(null, "", fresh ? "/?fresh=1" : "/");
  prepareWindowStubs();
  cleanup = initCalpinage(container, {
    studyId: "smart-roof-drawing-ui-test",
    versionId: "v1",
    ...options,
  });
  return container;
}

function rectangleState(): LegacyCalpinageStateLike & Record<string, unknown> {
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
    roof: { roofPans: [] },
    placedPanels: [{ id: "panel-1", panId: "persisted-pan" }],
    validatedRoofData: { pans: [{ id: "persisted-pan" }] },
    history: [{ type: "active-history" }],
  };
}

function addUnknownLine(
  graph: ReturnType<typeof createSmartRoofSketchGraph>,
  id: string,
  start: { readonly id?: string; readonly nodeId?: string; readonly x: number; readonly y: number; readonly h?: number },
  end: { readonly id?: string; readonly nodeId?: string; readonly x: number; readonly y: number; readonly h?: number },
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

function screenshotLikeSmartRoofDrawing() {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
  graph = addUnknownLine(graph, "roof-top", { id: "n0", x: 0, y: 0, h: 3 }, { id: "n1", x: 100, y: 0, h: 3 });
  graph = addUnknownLine(graph, "roof-right-top", { nodeId: "n1", x: 100, y: 0, h: 3 }, { id: "n2", x: 100, y: 55, h: 5 });
  graph = addUnknownLine(graph, "roof-right-bottom", { nodeId: "n2", x: 100, y: 55, h: 5 }, { id: "n3", x: 100, y: 120, h: 3 });
  graph = addUnknownLine(graph, "roof-bottom", { nodeId: "n3", x: 100, y: 120, h: 3 }, { id: "n4", x: 0, y: 120, h: 3 });
  graph = addUnknownLine(graph, "roof-left-bottom", { nodeId: "n4", x: 0, y: 120, h: 3 }, { id: "n5", x: 0, y: 55, h: 5 });
  graph = addUnknownLine(graph, "roof-left-top", { nodeId: "n5", x: 0, y: 55, h: 5 }, { nodeId: "n0", x: 0, y: 0, h: 3 });
  graph = addUnknownLine(graph, "main-ridge", { nodeId: "n5", x: 0, y: 55, h: 5 }, { nodeId: "n2", x: 100, y: 55, h: 5 });

  graph = addUnknownLine(graph, "dormer-front", { id: "d0", x: 42, y: 86, h: 3.1 }, { id: "d1", x: 58, y: 86, h: 3.1 });
  graph = addUnknownLine(graph, "dormer-right", { nodeId: "d1", x: 58, y: 86, h: 3.1 }, { id: "d2", x: 58, y: 106, h: 3.1 });
  graph = addUnknownLine(graph, "dormer-back", { nodeId: "d2", x: 58, y: 106, h: 3.1 }, { id: "d3", x: 42, y: 106, h: 3.1 });
  graph = addUnknownLine(graph, "dormer-left", { nodeId: "d3", x: 42, y: 106, h: 3.1 }, { nodeId: "d0", x: 42, y: 86, h: 3.1 });
  graph = addUnknownLine(graph, "dormer-ridge", { id: "dr0", x: 50, y: 86, h: 4 }, { id: "dr1", x: 50, y: 106, h: 4 });
  graph = addSketchNode(graph, { id: "unfinished-click", x: -25, y: 35, provenance: { source: "test" } }).graph;
  return buildSmartRoofPersistedDrawing({ graph, appliedAtIso: "2026-09-07T00:00:00.000Z" });
}

function persistedSmartRectangleDrawing() {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
  graph = addUnknownLine(graph, "s0", { id: "n0", x: 0, y: 0, h: 4 }, { id: "n1", x: 100, y: 0, h: 4 });
  graph = addUnknownLine(graph, "s1", { nodeId: "n1", x: 100, y: 0, h: 4 }, { id: "n2", x: 100, y: 100, h: 4 });
  graph = addUnknownLine(graph, "s2", { nodeId: "n2", x: 100, y: 100, h: 4 }, { id: "n3", x: 0, y: 100, h: 4 });
  graph = addUnknownLine(graph, "s3", { nodeId: "n3", x: 0, y: 100, h: 4 }, { nodeId: "n0", x: 0, y: 0, h: 4 });
  return buildSmartRoofPersistedDrawing({ graph, appliedAtIso: "2026-09-07T00:00:00.000Z" });
}

describe("smartRoofDrawing Phase 2 UI integration", () => {

  it("exports the restored roof sources after 3D modeling Undo", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    mountCalpinage();
    await flushCalpinageAsyncLoad();
    const source = rectangleState();
    source.roof = { ...(window.CALPINAGE_STATE!.roof as Record<string, unknown>), roofPans: [] };
    source.ridges = [{ id: "ridge-1", a: { x: 0, y: 0, h: 5 }, b: { x: 100, y: 0, h: 5 } }];
    source.traits = [{ id: "trait-1", a: { x: 0, y: 100, h: 5 }, b: { x: 100, y: 100, h: 5 } }];
    Object.assign(window.CALPINAGE_STATE!, source);
    const baseline = structuredClone(window.__calpinageSmartRoofDrawing!.buildExport());
    expect(baseline).not.toBeNull();
    const runtime = window.CALPINAGE_STATE!;
    const before = captureRoofModelingGeometrySnapshot(runtime);
    (runtime.contours as any[])[0].points[0].h = 8;
    (runtime.ridges as any[])[0].a.h = 8;
    (runtime.traits as any[])[0].b.h = 8;
    (runtime.pans as any[])[0].points[0].h = 8;
    pushRoofModelingPastSnapshot(before);
    expect(undoRoofModeling(runtime)).toBe(true);
    expect(typeof (window as any).__calpinageRefreshLegacyUiAfterPanVertexHeightEdit).toBe("function");
    (window as any).__calpinageRefreshLegacyUiAfterPanVertexHeightEdit();
    const exported = window.__calpinageSmartRoofDrawing!.buildExport();
    expect(exported).not.toBeNull();
    expect(exported.roofState.contoursBati).toEqual(baseline.roofState.contoursBati);
    expect(exported.roofState.ridges).toEqual(baseline.roofState.ridges);
    expect(exported.roofState.traits).toEqual(baseline.roofState.traits);
    const panGeometry = (pans: any[]) => pans.map((pan) => ({
      id: pan.id,
      points: pan.points.map((point: any) => ({ id: point.id, x: point.x, y: point.y, h: point.h })),
      polygon: pan.polygon,
      polygonPx: pan.polygonPx,
      ridgeIds: pan.ridgeIds,
    }));
    expect(panGeometry(exported.pans)).toEqual(panGeometry(baseline.pans));
  });
  it("keeps the normal roof drawing menu by default", async () => {
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();

    const openButton = container.querySelector<HTMLButtonElement>("#calpinage-smart-roof-open");
    const drawingButton = container.querySelector<HTMLButtonElement>("#calpinage-tool-dessin-toiture")!;
    const dropdown = container.querySelector<HTMLElement>("#calpinage-dessin-toiture-dropdown")!;
    expect(window.__calpinageSmartRoofDrawing).toBeUndefined();
    expect(openButton).toBeNull();
    expect(drawingButton.textContent).toContain("Dessin toiture");
    expect(dropdown.querySelector('[data-tool="contour"]')).not.toBeNull();
    expect(dropdown.querySelector('[data-tool="trait"]')).not.toBeNull();
    expect(dropdown.querySelector('[data-tool="ridge"]')).not.toBeNull();
  });

  it("replaces only the roof drawing menu with Dessiner when the flag is enabled", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();
    Object.assign(window.CALPINAGE_STATE!, rectangleState());

    const drawingButton = container.querySelector<HTMLButtonElement>("#calpinage-tool-dessin-toiture")!;
    const dropdown = container.querySelector<HTMLElement>("#calpinage-dessin-toiture-dropdown")!;

    expect(container.querySelector("#calpinage-smart-roof-open")).toBeNull();
    expect(container.querySelector("#calpinage-smart-roof-session-bar")).toBeNull();
    expect(container.querySelector("#calpinage-smart-roof-new-volume")).toBeNull();
    expect(container.querySelector("#calpinage-smart-roof-apply")).toBeNull();
    expect(container.querySelector("#calpinage-smart-roof-close")).toBeNull();
    expect(drawingButton.textContent).toContain("Dessiner");
    expect(drawingButton.textContent).not.toContain("Dessin toiture");
    expect(container.querySelector<HTMLButtonElement>("#calpinage-btn-height-edit")?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#calpinage-tool-obstacle")).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>("#calpinage-tool-shadow-volume")).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>("#calpinage-tool-roof-extension")).not.toBeNull();

    drawingButton.click();
    expect(window.__calpinageSmartRoofDrawing).toBeDefined();
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(true);
    expect(dropdown.hidden).toBe(true);
    expect(container.querySelector("#zone-b-toolbar")?.classList.contains("smart-roof-drawing-active")).toBe(true);

    const firstDraft = window.__calpinageSmartRoofDrawing!.getState();
    expect(firstDraft.sourceImportCount).toBe(1);
    expect(firstDraft.graph.segments).toHaveLength(4);
    const phase2Data = (window as any).getPhase2Data();
    expect(phase2Data.contourClosed).toBe(true);
    expect(phase2Data.canValidate).toBe(true);
    expect(phase2Data.validateHint).toContain("Toiture reconnue");

    window.__calpinageSmartRoofDrawing!.open();
    expect(window.__calpinageSmartRoofDrawing!.getState().sourceImportCount).toBe(1);
  });

  it("keeps the normal height editor wired to selected smart roof vertices only", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();
    Object.assign(window.CALPINAGE_STATE!, rectangleState());

    container.querySelector<HTMLButtonElement>("#calpinage-tool-dessin-toiture")!.click();
    container.querySelector<HTMLButtonElement>("#calpinage-btn-height-edit")!.click();

    const contour = (window.CALPINAGE_STATE!.contours as any[])[0];
    const firstNodeId = contour.points[0].smartSourceNodeId;
    const secondNodeId = contour.points[1].smartSourceNodeId;
    const untouchedNodeId = contour.points[2].smartSourceNodeId;
    window.CALPINAGE_STATE!.selectedHeightPoint = { type: "contour", index: 0, pointIndex: 0 };
    window.CALPINAGE_STATE!.selectedHeightPoints = [
      { type: "contour", index: 0, pointIndex: 0 },
      { type: "contour", index: 0, pointIndex: 1 },
    ];

    (window as any).__calpinageApplyCurrentHeightSelectionForTests(6);
    await flushCalpinageAsyncLoad();

    const graphNodes = window.__calpinageSmartRoofDrawing!.getState().graph.nodes as any[];
    const first = graphNodes.find((node) => node.id === firstNodeId);
    const second = graphNodes.find((node) => node.id === secondNodeId);
    const untouched = graphNodes.find((node) => node.id === untouchedNodeId);
    expect(first?.height?.valueM).toBe(6);
    expect(second?.height?.valueM).toBe(6);
    expect(untouched?.height?.valueM).toBe(4);
    expect(contour.points[0].h).toBe(6);
    expect(contour.points[1].h).toBe(6);
    expect(contour.points[2].h).toBe(4);
  });

  it("opens the persisted smart graph before normal height editing so reopened studies do not diverge", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();
    Object.assign(window.CALPINAGE_STATE!, {
      contours: [],
      traits: [],
      ridges: [],
      pans: [],
      smartRoofDrawing: persistedSmartRectangleDrawing(),
    });

    expect(window.__calpinageSmartRoofDrawing?.isActive()).toBe(false);
    container.querySelector<HTMLButtonElement>("#calpinage-btn-height-edit")!.click();
    await flushCalpinageAsyncLoad();

    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(true);
    const contour = (window.CALPINAGE_STATE!.contours as any[])[0];
    expect(contour.points[0].smartSourceNodeId).toBe("n0");
    window.CALPINAGE_STATE!.selectedHeightPoint = { type: "contour", index: 0, pointIndex: 0 };
    window.CALPINAGE_STATE!.selectedHeightPoints = [{ type: "contour", index: 0, pointIndex: 0 }];

    (window as any).__calpinageApplyCurrentHeightSelectionForTests(7);
    await flushCalpinageAsyncLoad();

    const node = (window.__calpinageSmartRoofDrawing!.getState().graph.nodes as any[]).find((item) => item.id === "n0");
    expect(node?.height?.valueM).toBe(7);
    expect((window.CALPINAGE_STATE!.contours as any[])[0].points[0].h).toBe(7);
  });

  it("keeps the normal Phase 2 validation fed by a recognized smart drawing with a dormer and an unfinished point", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();
    Object.assign(window.CALPINAGE_STATE!, {
      contours: [],
      traits: [],
      ridges: [],
      pans: [],
      roofExtensions: [],
      smartRoofDrawing: screenshotLikeSmartRoofDrawing(),
    });

    container.querySelector<HTMLButtonElement>("#calpinage-tool-dessin-toiture")!.click();
    await flushCalpinageAsyncLoad();

    const smartState = window.__calpinageSmartRoofDrawing!.getState();
    const phase2Data = (window as any).getPhase2Data();
    expect(smartState.graph.nodes.some((node: any) => node.id === "unfinished-click")).toBe(true);
    expect(smartState.compile.result.legacyState.pans.length).toBeGreaterThanOrEqual(2);
    expect(smartState.compile.result.legacyState.roofExtensions.length).toBe(1);
    expect((window.CALPINAGE_STATE!.pans as any[]).length).toBeGreaterThanOrEqual(2);
    expect((window.CALPINAGE_STATE!.roofExtensions as any[]).length).toBe(1);
    expect(phase2Data.contourClosed).toBe(true);
    expect(phase2Data.canValidate).toBe(true);
    expect(phase2Data.validateHint).toContain("Toiture reconnue");
    expect(container.querySelector<HTMLButtonElement>("#btn-validate-roof")!.disabled).toBe(false);
  });

  it("cleans the experimental drawing API on unmount", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    mountCalpinage();
    await flushCalpinageAsyncLoad();
    expect(window.__calpinageSmartRoofDrawing).toBeDefined();

    window.__calpinageSmartRoofDrawing!.open();
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(true);

    cleanup?.();
    cleanup = null;

    expect(window.__calpinageSmartRoofDrawing).toBeUndefined();
  });

  it("applies a flat smart draft as one active-study transaction and keeps persisted graph/export", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();
    const source = rectangleState();
    source.roof = { ...(window.CALPINAGE_STATE!.roof as Record<string, unknown>), roofPans: [] };
    Object.assign(window.CALPINAGE_STATE!, source);

    container.querySelector<HTMLButtonElement>("#calpinage-tool-dessin-toiture")!.click();
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(true);
    window.__calpinageSmartRoofDrawing!.setFlatHeight(4);

    const candidate = window.__calpinageSmartRoofDrawing!.prepareApplication();
    expect(candidate.status, JSON.stringify(candidate.blockingDiagnostics, null, 2)).toBe("ready");
    expect(candidate.legacyState.pans[0].id).toBe("persisted-pan");
    expect(candidate.panelPolicy.status).toBe("preserve");

    const result = window.__calpinageSmartRoofDrawing!.apply();
    expect(result.ok).toBe(true);
    expect(result.candidate.legacyState.pans[0].id).toBe("persisted-pan");
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(false);
    expect(window.CALPINAGE_STATE!.smartRoofDrawing).toMatchObject({ kind: "smartRoofDrawing", persistenceVersion: 1 });
    expect(window.CALPINAGE_STATE!.placedPanels).toEqual([{ id: "panel-1", panId: "persisted-pan" }]);
    expect((window.CALPINAGE_STATE!.pans as any[])[0].id).toBe("persisted-pan");

    const exported = window.__calpinageSmartRoofDrawing!.buildExport();
    expect(exported.smartRoofDrawing).toMatchObject({ kind: "smartRoofDrawing", persistenceVersion: 1 });
    expect(exported.pans[0].id).toBe("persisted-pan");
    const savedPayloads: any[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      const value = key ? window.localStorage.getItem(key) : null;
      if (!value || !value.includes('"smartRoofDrawing"')) continue;
      savedPayloads.push(JSON.parse(value));
    }
    expect(savedPayloads.length).toBeGreaterThan(0);
    expect(savedPayloads.some((payload) => payload?.smartRoofDrawing?.kind === "smartRoofDrawing" && payload?.pans?.[0]?.id === "persisted-pan")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    expect(window.CALPINAGE_STATE!.smartRoofDrawing).toMatchObject({ kind: "smartRoofDrawing", persistenceVersion: 1 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
    expect(window.CALPINAGE_STATE!.smartRoofDrawing).toMatchObject({ kind: "smartRoofDrawing", persistenceVersion: 1 });
    expect((window.CALPINAGE_STATE!.pans as any[])[0].id).toBe("persisted-pan");

    cleanup?.();
    cleanup = null;
    document.body.innerHTML = "";
    mountCalpinage({}, false);
    await flushCalpinageAsyncLoad();

    expect(window.CALPINAGE_STATE!.smartRoofDrawing).toMatchObject({ kind: "smartRoofDrawing", persistenceVersion: 1 });
    expect((window.CALPINAGE_STATE!.pans as any[])[0].id).toBe("persisted-pan");
    window.__calpinageSmartRoofDrawing!.open();
    expect(window.__calpinageSmartRoofDrawing!.getState().sourceImportCount).toBe(0);
    expect(window.__calpinageSmartRoofDrawing!.getState().graph.nodes.every((node: any) => node.height?.valueM === 4)).toBe(true);
  });
});
