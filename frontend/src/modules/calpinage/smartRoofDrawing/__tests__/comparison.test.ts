import { afterEach, describe, expect, it, vi } from "vitest";
import { initCalpinage } from "../../legacy/calpinage.module";
import { createSmartRoofComparisonRuntimeApi } from "../comparisonRuntime";
import { runSmartRoofDrawingComparison } from "../comparison";
import type { ComputePansFromGeometryCore, LegacyCalpinageStateLike } from "../legacyBridge";

declare global {
  interface Window {
    __calpinagePhase2GeometryEngineForTests?: {
      getEdgesFromState: (state: unknown, opts?: unknown) => unknown[];
      computePansFromGeometryCore: ComputePansFromGeometryCore;
      computePansFromGeometry: () => unknown;
    };
    __calpinageSmartRoofComparison?: {
      enabled: boolean;
      run: () => unknown;
      getLastReport: () => unknown;
    };
    __calpinageSmartRoofComparisonLastReport?: unknown;
    __CALPINAGE_SMART_ROOF_COMPARISON__?: boolean;
    CALPINAGE_STATE?: Record<string, unknown>;
    CalpinageCanvas?: unknown;
    CalpinageMap?: unknown;
    CalpinagePans?: unknown;
    CALPINAGE_VIEWPORT_SCALE?: number;
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
  window.localStorage?.removeItem("calpinage_smart_roof_comparison");
  delete window.__CALPINAGE_SMART_ROOF_COMPARISON__;
  delete window.__calpinagePhase2GeometryEngineForTests;
  delete window.__calpinageSmartRoofComparison;
  delete window.__calpinageSmartRoofComparisonLastReport;
  delete window.CALPINAGE_VIEWPORT_SCALE;
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

function mountCalpinage(options: Record<string, unknown> = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  window.history.replaceState(null, "", "/?fresh=1");
  prepareWindowStubs();
  cleanup = initCalpinage(container, {
    studyId: "smart-roof-comparison-test",
    versionId: "v1",
    ...options,
  });
  return container;
}

function legacyEngine(): Window["__calpinagePhase2GeometryEngineForTests"] {
  mountCalpinage({ __geometryEngineOnly: true });
  expect(window.__calpinagePhase2GeometryEngineForTests).toBeDefined();
  return window.__calpinagePhase2GeometryEngineForTests!;
}

function rectangleState(): LegacyCalpinageStateLike {
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
    history: [{ type: "before-comparison" }],
  };
}

describe("smartRoofDrawing comparison runtime", () => {
  it("runs through the real pan engine on a cloned state and leaves active data untouched", () => {
    const engine = legacyEngine();
    const activeState = rectangleState();
    const before = JSON.stringify(activeState);
    const runtime = createSmartRoofComparisonRuntimeApi({
      getState: () => activeState,
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    const report = runtime.run();

    expect(JSON.stringify(activeState)).toBe(before);
    expect(report.mutationGuard.checked).toBe(true);
    expect(report.mutationGuard.activeStateMutated).toBe(false);
    expect(report.status).toBe("computed");
    expect(report.classifications).toContain("geometry_computed");
    expect(report.current.panCount).toBe(1);
    expect(report.experimental.panCount).toBe(1);
    expect(report.divergences).toHaveLength(0);
    expect(report.experimental.panIdMapping).toEqual({ "pan-1": "persisted-pan" });
    expect(runtime.getLastReport()).toBe(report);
  });

  it("attaches reports to a drawing revision and updates it after a geometry edit", () => {
    const engine = legacyEngine();
    const activeState = rectangleState() as LegacyCalpinageStateLike & { contours: NonNullable<LegacyCalpinageStateLike["contours"]> };
    const runtime = createSmartRoofComparisonRuntimeApi({
      getState: () => activeState,
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    const first = runtime.run();
    activeState.contours[0] = {
      ...activeState.contours[0]!,
      points: [
        { x: 0, y: 0, h: 4 },
        { x: 120, y: 0, h: 4 },
        { x: 120, y: 100, h: 4 },
        { x: 0, y: 100, h: 4 },
      ],
    };
    const second = runtime.run();

    expect(second.drawingRevision).not.toBe(first.drawingRevision);
    expect(second.experimental.totalArea).toBe(12000);
    expect(second.divergences.some((item) => item.code === "PAN_AREA_DIVERGENCE")).toBe(true);
  });

  it("keeps compilation tolerance independent from viewport zoom in comparison mode", () => {
    const engine = legacyEngine();
    const activeState = rectangleState();

    window.CALPINAGE_VIEWPORT_SCALE = 1;
    const lowZoom = runSmartRoofDrawingComparison({
      state: activeState,
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });
    window.CALPINAGE_VIEWPORT_SCALE = 30;
    const highZoom = runSmartRoofDrawingComparison({
      state: activeState,
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(lowZoom.experimental.totalArea).toBe(highZoom.experimental.totalArea);
    expect(lowZoom.experimental.surfaces.map((surface) => surface.key)).toEqual(highZoom.experimental.surfaces.map((surface) => surface.key));
  });

  it("does not expose the application comparison API while the feature flag is disabled", async () => {
    mountCalpinage();
    await flushCalpinageAsyncLoad();

    expect(window.__calpinageSmartRoofComparison).toBeUndefined();
    expect(window.__calpinagePhase2GeometryEngineForTests).toBeUndefined();
  });

  it("exposes a read-only application comparison command only when the flag is enabled", async () => {
    window.__CALPINAGE_SMART_ROOF_COMPARISON__ = true;
    mountCalpinage();
    await flushCalpinageAsyncLoad();
    expect(window.__calpinagePhase2GeometryEngineForTests).toBeUndefined();
    expect(window.__calpinageSmartRoofComparison).toBeDefined();

    Object.assign(window.CALPINAGE_STATE!, rectangleState());
    const before = JSON.stringify(window.CALPINAGE_STATE);
    const report = window.__calpinageSmartRoofComparison!.run() as { mutationGuard: { activeStateMutated: boolean }; experimental: { panCount: number } };

    expect(JSON.stringify(window.CALPINAGE_STATE)).toBe(before);
    expect(report.mutationGuard.activeStateMutated).toBe(false);
    expect(report.experimental.panCount).toBe(1);
    expect(window.__calpinageSmartRoofComparisonLastReport).toBeDefined();
  });

  it("cleans the application comparison command on unmount and does not keep stale runtime state", async () => {
    window.__CALPINAGE_SMART_ROOF_COMPARISON__ = true;
    mountCalpinage();
    await flushCalpinageAsyncLoad();
    const firstApi = window.__calpinageSmartRoofComparison;
    expect(firstApi).toBeDefined();

    cleanup?.();
    cleanup = null;
    expect(window.__calpinageSmartRoofComparison).toBeUndefined();
    expect(window.__calpinageSmartRoofComparisonLastReport).toBeUndefined();

    mountCalpinage();
    await flushCalpinageAsyncLoad();
    expect(window.__calpinageSmartRoofComparison).toBeDefined();
    expect(window.__calpinageSmartRoofComparison).not.toBe(firstApi);
  });
});
