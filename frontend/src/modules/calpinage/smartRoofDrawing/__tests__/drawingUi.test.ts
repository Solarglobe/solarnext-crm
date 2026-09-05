import { initCalpinage } from "../../legacy/calpinage.module";
import type { ComputePansFromGeometryCore, LegacyCalpinageStateLike } from "../legacyBridge";

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
  window.history.replaceState(null, "", "/");
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

describe("smartRoofDrawing Phase 2 UI integration", () => {
  it("keeps the experimental drawing entry disabled by default", async () => {
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();

    const openButton = container.querySelector<HTMLButtonElement>("#calpinage-smart-roof-open");
    expect(window.__calpinageSmartRoofDrawing).toBeUndefined();
    expect(openButton?.hidden).toBe(true);
    expect(openButton ? getComputedStyle(openButton).display : "none").toBe("none");
  });

  it("opens and closes an isolated draft session without mutating active study data", async () => {
    window.localStorage.setItem("calpinage_smart_roof_drawing", "true");
    const container = mountCalpinage();
    await flushCalpinageAsyncLoad();
    Object.assign(window.CALPINAGE_STATE!, rectangleState());
    const before = JSON.stringify(window.CALPINAGE_STATE);

    const openButton = container.querySelector<HTMLButtonElement>("#calpinage-smart-roof-open")!;
    const sessionBar = container.querySelector<HTMLElement>("#calpinage-smart-roof-session-bar")!;
    openButton.click();

    expect(window.__calpinageSmartRoofDrawing).toBeDefined();
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(true);
    expect(openButton.hidden).toBe(true);
    expect(sessionBar.hidden).toBe(false);
    expect(container.querySelector("#zone-b-toolbar")?.classList.contains("smart-roof-drawing-active")).toBe(true);
    expect(window.__calpinageSmartRoofDrawing!.activeStateUnchanged()).toBe(true);
    expect(JSON.stringify(window.CALPINAGE_STATE)).toBe(before);

    const firstDraft = window.__calpinageSmartRoofDrawing!.getState();
    expect(firstDraft.sourceImportCount).toBe(1);
    expect(firstDraft.graph.segments).toHaveLength(4);

    window.__calpinageSmartRoofDrawing!.open();
    expect(window.__calpinageSmartRoofDrawing!.getState().sourceImportCount).toBe(1);

    window.__calpinageSmartRoofDrawing!.setTool("select");
    expect(window.__calpinageSmartRoofDrawing!.getState().tool).toBe("select");
    window.__calpinageSmartRoofDrawing!.setTool("draw");
    expect(window.__calpinageSmartRoofDrawing!.getState().tool).toBe("draw");

    expect(window.__calpinageSmartRoofDrawing!.close({ force: true })).toBe(true);
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(false);
    expect(sessionBar.hidden).toBe(true);
    expect(openButton.hidden).toBe(false);
    expect(getComputedStyle(openButton).display).not.toBe("none");
    expect(JSON.stringify(window.CALPINAGE_STATE)).toBe(before);
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

    container.querySelector<HTMLButtonElement>("#calpinage-smart-roof-open")!.click();
    expect(window.__calpinageSmartRoofDrawing!.isActive()).toBe(true);
    window.__calpinageSmartRoofDrawing!.setFlatHeight(4);

    const candidate = window.__calpinageSmartRoofDrawing!.prepareApplication();
    expect(candidate.status).toBe("ready");
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
    expect(window.CALPINAGE_STATE!.smartRoofDrawing).toBeNull();
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
