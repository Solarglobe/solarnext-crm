import { afterEach, describe, expect, it } from "vitest";
import { calpinageStateToLegacyRoofInput } from "../../adapter/calpinageStateToLegacyRoofInput";
import { initCalpinage } from "../../legacy/calpinage.module";
import {
  addSketchSegment,
  connectSegmentEndpointToSegment,
  createSmartRoofSketchGraph,
} from "../operations";
import {
  compileSmartRoofSketchToLegacyState,
  compileSmartRoofSketchWithLegacyEngine,
  importLegacyRoofToSmartSketch,
  type ComputePansFromGeometryCore,
} from "../legacyBridge";

declare global {
  interface Window {
    __calpinagePhase2GeometryEngineForTests?: {
      getEdgesFromState: (state: unknown, opts?: unknown) => unknown[];
      computePansFromGeometryCore: ComputePansFromGeometryCore;
      computePansFromGeometry: () => unknown;
    };
    CalpinageCanvas?: unknown;
    CalpinageMap?: unknown;
    CalpinagePans?: unknown;
    CALPINAGE_VIEWPORT_SCALE?: number;
  }
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  delete window.CALPINAGE_VIEWPORT_SCALE;
});

function legacyEngine(): Window["__calpinagePhase2GeometryEngineForTests"] {
  const container = document.createElement("div");
  document.body.appendChild(container);
  window.CalpinageCanvas = {};
  window.CalpinageMap = {};
  window.CalpinagePans = {
    panState: { pans: [], activePanId: null, activePoint: null },
    ensurePanPhysicalProps: () => undefined,
    recomputeAllPanPhysicalProps: () => undefined,
  };
  cleanup = initCalpinage(container, {
    studyId: "smart-roof-test",
    versionId: "v1",
    __geometryEngineOnly: true,
  });
  expect(window.__calpinagePhase2GeometryEngineForTests).toBeDefined();
  return window.__calpinagePhase2GeometryEngineForTests!;
}

function addLine(
  graph: ReturnType<typeof createSmartRoofSketchGraph>,
  id: string,
  start: { x: number; y: number; id?: string; nodeId?: string; h?: number },
  end: { x: number; y: number; id?: string; nodeId?: string; h?: number },
  role: "unknown" | "outline" | "trait" | "ridge" = "unknown",
) {
  return addSketchSegment(graph, {
    id,
    start: start.nodeId
      ? { nodeId: start.nodeId }
      : {
          id: start.id,
          x: start.x,
          y: start.y,
          height: start.h != null ? { valueM: start.h, source: "manual" } : undefined,
        },
    end: end.nodeId
      ? { nodeId: end.nodeId }
      : {
          id: end.id,
          x: end.x,
          y: end.y,
          height: end.h != null ? { valueM: end.h, source: "manual" } : undefined,
        },
    role: { value: role, source: role === "unknown" ? "unset" : "manual", locked: role !== "unknown" },
  }).graph;
}

function rectangleGraph(withHeights = false) {
  return rectangleGraphWithRole(withHeights, "outline");
}

function rectangleGraphWithRole(
  withHeights = false,
  role: "unknown" | "outline" | "trait" | "ridge" = "outline",
) {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
  graph = addLine(graph, "top", { id: "a", x: 0, y: 0, h: withHeights ? 4 : undefined }, { id: "b", x: 100, y: 0, h: withHeights ? 4 : undefined }, role);
  graph = addLine(graph, "right", { nodeId: "b", x: 100, y: 0 }, { id: "c", x: 100, y: 100, h: withHeights ? 4 : undefined }, role);
  graph = addLine(graph, "bottom", { nodeId: "c", x: 100, y: 100 }, { id: "d", x: 0, y: 100, h: withHeights ? 4 : undefined }, role);
  graph = addLine(graph, "left", { nodeId: "d", x: 0, y: 100 }, { nodeId: "a", x: 0, y: 0 }, role);
  return graph;
}

const L_POINTS = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 120 },
  { x: 0, y: 120 },
] as const;

function rotatePoints<T>(points: readonly T[], offset: number): readonly T[] {
  return [...points.slice(offset), ...points.slice(0, offset)];
}

function closedPolylineGraph(
  points: readonly { readonly x: number; readonly y: number; readonly h?: number }[],
  role: "unknown" | "outline" | "trait" | "ridge" = "unknown",
  prefix = "poly",
) {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
  for (let i = 0; i < points.length; i++) {
    const start = points[i]!;
    const end = points[(i + 1) % points.length]!;
    graph = addLine(
      graph,
      `${prefix}-s-${i}`,
      i === 0 ? { id: `${prefix}-n-0`, ...start } : { nodeId: `${prefix}-n-${i}`, ...start },
      (i + 1) % points.length === 0 ? { nodeId: `${prefix}-n-0`, ...end } : { id: `${prefix}-n-${i + 1}`, ...end },
      role,
    );
  }
  return graph;
}

function panAreas(pans: readonly { polygon?: readonly { x: number; y: number }[]; polygonPx?: readonly { x: number; y: number }[] }[]) {
  return pans
    .map((pan) => {
      const points = pan.polygon ?? pan.polygonPx ?? [];
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        area += a.x * b.y - b.x * a.y;
      }
      return Math.round(Math.abs(area / 2));
    })
    .sort((a, b) => a - b);
}

describe("smartRoofDrawing legacy bridge", () => {
  it("imports legacy contours, traits, ridges and contour-edge attachments without mutating the source", () => {
    const legacy = {
      contours: [{
        id: "roof",
        points: [
          { x: 0, y: 0, h: 4 },
          { x: 100, y: 0, h: 4 },
          { x: 100, y: 100, h: 4 },
          { x: 0, y: 100, h: 4 },
        ],
      }],
      ridges: [{
        id: "r1",
        a: { x: 50, y: 0, h: 7, attach: { type: "roof_contour_edge", contourId: "roof", segmentIndex: 0, t: 0.5 } },
        b: { x: 50, y: 100, h: 7, attach: { type: "roof_contour_edge", contourId: "roof", segmentIndex: 2, t: 0.5 } },
      }],
      traits: [{
        id: "t1",
        a: { x: 0, y: 50, attach: { type: "roof_contour_edge", contourId: "roof", segmentIndex: 3, t: 0.5 } },
        b: { x: 100, y: 50, attach: { type: "roof_contour_edge", contourId: "roof", segmentIndex: 1, t: 0.5 } },
      }],
    };
    const before = JSON.stringify(legacy);

    const imported = importLegacyRoofToSmartSketch(legacy);

    expect(JSON.stringify(legacy)).toBe(before);
    expect(imported.graph.segments.some((segment) => segment.role.value === "ridge")).toBe(true);
    expect(imported.graph.segments.some((segment) => segment.role.value === "trait")).toBe(true);
    expect(imported.graph.nodes.some((node) => node.id.includes(":t:0.500000"))).toBe(true);
    expect(imported.graph.nodes.some((node) => node.height?.valueM === 4)).toBe(true);
  });

  it("keeps an open contour incomplete and does not invent closure", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addLine(graph, "a", { id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, "outline");
    graph = addLine(graph, "b", { nodeId: "b", x: 10, y: 0 }, { id: "c", x: 10, y: 10 }, "outline");

    const compiled = compileSmartRoofSketchToLegacyState(graph);

    expect(compiled.status).toBe("incomplete");
    expect(compiled.legacyState.contours).toHaveLength(0);
    expect(compiled.diagnostics.some((item) => item.code === "OUTLINE_OPEN_INCOMPLETE")).toBe(true);
  });

  it("compiles unknown inner lines as legacy traits only for topology", () => {
    let graph = rectangleGraph();
    graph = addLine(graph, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");

    const compiled = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });

    expect(compiled.legacyState.traits).toHaveLength(1);
    expect(compiled.legacyState.traits[0]?.smartRoofRole).toBe("unknown");
    expect(compiled.diagnostics.some((item) => item.code === "UNKNOWN_ROLE_COMPILED_AS_TRAIT_FOR_TOPOLOGY")).toBe(true);
  });

  it("compiles a closed rectangle drawn only with unknown lines as a temporary contour candidate", () => {
    const graph = rectangleGraphWithRole(false, "unknown");

    const compiled = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });

    expect(graph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
    expect(compiled.normalizedGraph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
    expect(compiled.status).toBe("topology_ready");
    expect(compiled.legacyState.contours).toHaveLength(1);
    expect(compiled.legacyState.contours[0]?.smartRoofInferredFromUnknown).toBe(true);
    expect(compiled.legacyState.traits).toHaveLength(0);
    expect(compiled.diagnostics.some((item) => item.code === "UNKNOWN_CLOSED_LOOP_COMPILED_AS_CONTOUR_CANDIDATE")).toBe(true);
  });

  it("infers a compatible unknown inner separator as a ridge for product publication", () => {
    const engine = legacyEngine();
    let graph = rectangleGraphWithRole(false, "unknown");
    graph = addLine(graph, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");
    const sourceBefore = JSON.stringify(graph);

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(JSON.stringify(graph)).toBe(sourceBefore);
    expect(graph.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
    expect(result.normalizedGraph.segments.find((segment) => segment.id === "middle")?.role).toMatchObject({ value: "ridge", source: "inferred" });
    expect(result.legacyState.ridges).toHaveLength(1);
    expect(result.legacyState.ridges[0]?.smartRoofRole).toBe("ridge");
    expect(result.legacyState.ridges[0]?.smartRoofRoleSource).toBe("inferred");
    expect(result.legacyState.pans).toHaveLength(2);
    expect(panAreas(result.legacyState.pans)).toEqual([5000, 5000]);
  });

  it("uses the real legacy pan engine through the test hook for a two-pan roof", () => {
    const engine = legacyEngine();
    let graph = rectangleGraph();
    graph = addLine(graph, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(engine.getEdgesFromState(result.legacyState, { excludeChienAssis: true })).toHaveLength(2);
    expect(result.status).toBe("topology_ready");
    expect(result.legacyState.pans).toHaveLength(2);
    expect(panAreas(result.legacyState.pans)).toEqual([5000, 5000]);
  });

  it("supports a four-face topology when the center junction is explicit", () => {
    const engine = legacyEngine();
    let graph = rectangleGraph();
    graph = addLine(graph, "top-center", { id: "tc", x: 50, y: 0 }, { id: "center", x: 50, y: 50 }, "trait");
    graph = addLine(graph, "right-center", { id: "rc", x: 100, y: 50 }, { nodeId: "center", x: 50, y: 50 }, "trait");
    graph = addLine(graph, "bottom-center", { id: "bc", x: 50, y: 100 }, { nodeId: "center", x: 50, y: 50 }, "trait");
    graph = addLine(graph, "left-center", { id: "lc", x: 0, y: 50 }, { nodeId: "center", x: 50, y: 50 }, "trait");

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(result.legacyState.pans).toHaveLength(4);
    expect(panAreas(result.legacyState.pans)).toEqual([2500, 2500, 2500, 2500]);
  });

  it("keeps a concave L outline and the real engine produces the candidate surface", () => {
    const engine = legacyEngine();
    const graph = closedPolylineGraph(L_POINTS, "outline", "l");

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(result.legacyState.contours[0]?.points).toHaveLength(6);
    expect(result.legacyState.pans).toHaveLength(1);
    expect(result.status).toBe("topology_ready");
    expect(panAreas(result.legacyState.pans)).toEqual([8000]);
    expect(result.diagnostics.some((item) => item.code === "LEGACY_ENGINE_NO_PANS")).toBe(false);
  });

  it("keeps the concave L area stable for both orientations and rotated starts", () => {
    const engine = legacyEngine();
    const variants = [
      L_POINTS,
      [...L_POINTS].reverse(),
      rotatePoints(L_POINTS, 2),
      rotatePoints([...L_POINTS].reverse(), 3),
    ];

    for (const [index, points] of variants.entries()) {
      const result = compileSmartRoofSketchWithLegacyEngine(closedPolylineGraph(points, "unknown", `l-${index}`), {
        computePansFromGeometryCore: engine.computePansFromGeometryCore,
        modelTolerancePx: 0.01,
      });

      expect(result.legacyState.contours[0]?.points).toHaveLength(6);
      expect(result.legacyState.contours[0]?.smartRoofInferredFromUnknown).toBe(true);
      expect(panAreas(result.legacyState.pans)).toEqual([8000]);
    }
  });

  it("accepts the concave L fixture directly in the real legacy engine regardless of orientation and start point", () => {
    const engine = legacyEngine();
    const variants = [
      L_POINTS,
      [...L_POINTS].reverse(),
      rotatePoints(L_POINTS, 4),
      rotatePoints([...L_POINTS].reverse(), 1),
    ];

    for (const [index, points] of variants.entries()) {
      const tempState = {
        contours: [{
          id: `legacy-l-${index}`,
          points: points.map((point) => ({ ...point })),
        }],
        traits: [],
        ridges: [],
        pans: [],
        obstacles: [],
        roof: { roofPans: [] },
      };

      engine.computePansFromGeometryCore(tempState, { excludeChienAssis: true, topologyTolerancePx: 0.01 });

      expect(tempState.pans).toHaveLength(1);
      expect(panAreas(tempState.pans)).toEqual([8000]);
      expect(tempState.pans[0]?.polygon).toHaveLength(6);
    }
  });

  it("passes an explicitly flat concave L with known heights through the current engine path", () => {
    const engine = legacyEngine();
    const flatPoints = L_POINTS.map((point) => ({ ...point, h: 4 }));
    const graph = closedPolylineGraph(flatPoints, "unknown", "flat-l");

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(result.legacyState.contours[0]?.points.every((point) => point.h === 4)).toBe(true);
    expect(result.legacyState.pans).toHaveLength(1);
    expect(panAreas(result.legacyState.pans)).toEqual([8000]);
  });

  it("compiles two distinct buildings as two pans", () => {
    const engine = legacyEngine();
    let graph = rectangleGraph();
    graph = addLine(graph, "e2-top", { id: "e", x: 200, y: 0 }, { id: "f", x: 300, y: 0 }, "outline");
    graph = addLine(graph, "e2-right", { nodeId: "f", x: 300, y: 0 }, { id: "g", x: 300, y: 100 }, "outline");
    graph = addLine(graph, "e2-bottom", { nodeId: "g", x: 300, y: 100 }, { id: "h", x: 200, y: 100 }, "outline");
    graph = addLine(graph, "e2-left", { nodeId: "h", x: 200, y: 100 }, { nodeId: "e", x: 200, y: 0 }, "outline");

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(result.legacyState.pans).toHaveLength(2);
    expect(panAreas(result.legacyState.pans)).toEqual([10000, 10000]);
  });

  it("returns the same topology when an inner line is entered before the contour", () => {
    const engine = legacyEngine();
    let lineFirst = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
    lineFirst = addLine(lineFirst, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");
    lineFirst = addLine(lineFirst, "top", { id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, "outline");
    lineFirst = addLine(lineFirst, "right", { nodeId: "b", x: 100, y: 0 }, { id: "c", x: 100, y: 100 }, "outline");
    lineFirst = addLine(lineFirst, "bottom", { nodeId: "c", x: 100, y: 100 }, { id: "d", x: 0, y: 100 }, "outline");
    lineFirst = addLine(lineFirst, "left", { nodeId: "d", x: 0, y: 100 }, { nodeId: "a", x: 0, y: 0 }, "outline");
    let contourFirst = rectangleGraph();
    contourFirst = addLine(contourFirst, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");

    const a = compileSmartRoofSketchWithLegacyEngine(lineFirst, { computePansFromGeometryCore: engine.computePansFromGeometryCore, modelTolerancePx: 0.01 });
    const b = compileSmartRoofSketchWithLegacyEngine(contourFirst, { computePansFromGeometryCore: engine.computePansFromGeometryCore, modelTolerancePx: 0.01 });

    expect(panAreas(a.legacyState.pans)).toEqual(panAreas(b.legacyState.pans));
  });

  it("returns the same unknown topology when an inner line is entered before the contour", () => {
    const engine = legacyEngine();
    let lineFirst = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
    lineFirst = addLine(lineFirst, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");
    lineFirst = addLine(lineFirst, "top", { id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 }, "unknown");
    lineFirst = addLine(lineFirst, "right", { nodeId: "b", x: 100, y: 0 }, { id: "c", x: 100, y: 100 }, "unknown");
    lineFirst = addLine(lineFirst, "bottom", { nodeId: "c", x: 100, y: 100 }, { id: "d", x: 0, y: 100 }, "unknown");
    lineFirst = addLine(lineFirst, "left", { nodeId: "d", x: 0, y: 100 }, { nodeId: "a", x: 0, y: 0 }, "unknown");
    let contourFirst = rectangleGraphWithRole(false, "unknown");
    contourFirst = addLine(contourFirst, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");

    const a = compileSmartRoofSketchWithLegacyEngine(lineFirst, { computePansFromGeometryCore: engine.computePansFromGeometryCore, modelTolerancePx: 0.01 });
    const b = compileSmartRoofSketchWithLegacyEngine(contourFirst, { computePansFromGeometryCore: engine.computePansFromGeometryCore, modelTolerancePx: 0.01 });

    expect(panAreas(a.legacyState.pans)).toEqual([5000, 5000]);
    expect(panAreas(a.legacyState.pans)).toEqual(panAreas(b.legacyState.pans));
    expect(lineFirst.segments.every((segment) => segment.role.value === "unknown")).toBe(true);
    expect(a.normalizedGraph.segments.find((segment) => segment.id === "middle")?.role.value).toBe("ridge");
    expect(a.legacyState.ridges).toHaveLength(1);
  });

  it("keeps an unknown draft incomplete until the final closing segment is added", () => {
    let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
    graph = addLine(graph, "top", { id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 0 });
    graph = addLine(graph, "right", { nodeId: "b", x: 100, y: 0 }, { id: "c", x: 100, y: 100 });
    graph = addLine(graph, "bottom", { nodeId: "c", x: 100, y: 100 }, { id: "d", x: 0, y: 100 });
    const open = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });
    graph = addLine(graph, "left", { nodeId: "d", x: 0, y: 100 }, { nodeId: "a", x: 0, y: 0 });
    const closed = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });

    expect(open.status).toBe("incomplete");
    expect(open.legacyState.contours).toHaveLength(0);
    expect(closed.status).toBe("topology_ready");
    expect(closed.legacyState.contours).toHaveLength(1);
  });

  it("handles an unknown T-junction by splitting the contour candidate without losing the dangling line", () => {
    let graph = rectangleGraphWithRole(false, "unknown");
    graph = addLine(graph, "stem", { id: "stem-end", x: 50, y: 0 }, { id: "stem-inner", x: 50, y: 50 }, "unknown");

    const compiled = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });

    expect(compiled.status).toBe("topology_ready");
    expect(compiled.legacyState.contours).toHaveLength(1);
    expect(compiled.legacyState.traits).toHaveLength(1);
    expect(compiled.legacyState.traits[0]?.smartRoofRole).toBe("unknown");
    expect(compiled.normalizedGraph.segments.some((segment) => segment.id.startsWith("top:part-"))).toBe(true);
  });

  it("can create a T-junction through the public endpoint-to-segment operation", () => {
    let graph = rectangleGraphWithRole(false, "unknown");
    graph = addLine(graph, "stem", { id: "stem-inner", x: 50, y: 50 }, { id: "stem-end", x: 50, y: 0 }, "unknown");

    const connected = connectSegmentEndpointToSegment(graph, "stem", "end", "top", { modelTolerancePx: 0.01 });
    const compiled = compileSmartRoofSketchToLegacyState(connected.graph, { modelTolerancePx: 0.01 });

    expect(connected.diagnostics).toHaveLength(0);
    expect(compiled.legacyState.contours).toHaveLength(1);
    expect(compiled.legacyState.traits).toHaveLength(1);
  });

  it("compiles two distinct buildings drawn only with unknown lines", () => {
    const engine = legacyEngine();
    let graph = rectangleGraphWithRole(false, "unknown");
    graph = addLine(graph, "e2-top", { id: "e", x: 200, y: 0 }, { id: "f", x: 300, y: 0 }, "unknown");
    graph = addLine(graph, "e2-right", { nodeId: "f", x: 300, y: 0 }, { id: "g", x: 300, y: 100 }, "unknown");
    graph = addLine(graph, "e2-bottom", { nodeId: "g", x: 300, y: 100 }, { id: "h", x: 200, y: 100 }, "unknown");
    graph = addLine(graph, "e2-left", { nodeId: "h", x: 200, y: 100 }, { nodeId: "e", x: 200, y: 0 }, "unknown");

    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });

    expect(result.legacyState.contours).toHaveLength(2);
    expect(result.legacyState.pans).toHaveLength(2);
    expect(panAreas(result.legacyState.pans)).toEqual([10000, 10000]);
  });

  it("reports nested unknown loops as unsupported instead of silently validating a hole", () => {
    let graph = rectangleGraphWithRole(false, "unknown");
    graph = addLine(graph, "inner-top", { id: "ia", x: 25, y: 25 }, { id: "ib", x: 75, y: 25 }, "unknown");
    graph = addLine(graph, "inner-right", { nodeId: "ib", x: 75, y: 25 }, { id: "ic", x: 75, y: 75 }, "unknown");
    graph = addLine(graph, "inner-bottom", { nodeId: "ic", x: 75, y: 75 }, { id: "id", x: 25, y: 75 }, "unknown");
    graph = addLine(graph, "inner-left", { nodeId: "id", x: 25, y: 75 }, { nodeId: "ia", x: 25, y: 25 }, "unknown");

    const compiled = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });

    expect(compiled.status).toBe("ambiguous");
    expect(compiled.legacyState.contours).toHaveLength(1);
    expect(compiled.legacyState.traits).toHaveLength(0);
    expect(compiled.diagnostics.some((item) => item.code === "HOLE_OR_NESTED_OUTLINE_UNSUPPORTED")).toBe(true);
  });

  it("is independent from viewport scale when model tolerance is injected", () => {
    const engine = legacyEngine();
    let graph = rectangleGraph();
    graph = addLine(graph, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");

    window.CALPINAGE_VIEWPORT_SCALE = 1;
    const lowZoom = compileSmartRoofSketchWithLegacyEngine(graph, { computePansFromGeometryCore: engine.computePansFromGeometryCore, modelTolerancePx: 0.01 });
    window.CALPINAGE_VIEWPORT_SCALE = 30;
    const highZoom = compileSmartRoofSketchWithLegacyEngine(graph, { computePansFromGeometryCore: engine.computePansFromGeometryCore, modelTolerancePx: 0.01 });

    expect(panAreas(lowZoom.legacyState.pans)).toEqual(panAreas(highZoom.legacyState.pans));
  });

  it("preserves non-ambiguous pan ids by structural provenance after a small edit", () => {
    const engine = legacyEngine();
    let graph = rectangleGraph();
    graph = addLine(graph, "middle", { id: "m1", x: 0, y: 50 }, { id: "m2", x: 100, y: 50 }, "unknown");
    const initial = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });
    const previousPans = initial.legacyState.pans.map((pan, index) => ({ ...pan, id: `persisted-${index + 1}` }));

    let edited = rectangleGraph();
    edited = addLine(edited, "middle", { id: "m1", x: 0, y: 52 }, { id: "m2", x: 100, y: 52 }, "unknown");
    const reconciled = compileSmartRoofSketchWithLegacyEngine(edited, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
      previousPans,
    });

    expect(reconciled.legacyState.pans.map((pan) => pan.id).sort()).toEqual(["persisted-1", "persisted-2"]);
    expect(Object.keys(reconciled.mapping.panIdMapping)).toHaveLength(2);
  });

  it("detects projected crossings as ambiguous instead of validating a simple roof", () => {
    let graph = rectangleGraph();
    graph = addLine(graph, "diagonal-a", { id: "da1", x: 0, y: 0 }, { id: "da2", x: 100, y: 100 }, "unknown");
    graph = addLine(graph, "diagonal-b", { id: "db1", x: 100, y: 0 }, { id: "db2", x: 0, y: 100 }, "unknown");

    const compiled = compileSmartRoofSketchToLegacyState(graph, { modelTolerancePx: 0.01 });

    expect(compiled.status).toBe("ambiguous");
    expect(compiled.diagnostics.some((item) => item.code === "CROSSING_NOT_CONNECTED_UNSUPPORTED")).toBe(true);
  });

  it("feeds compiled pans to the existing 3D adapter on a known-height fixture", () => {
    const engine = legacyEngine();
    let graph = rectangleGraph(true);
    graph = addLine(graph, "ridge", { id: "r1", x: 0, y: 50, h: 7 }, { id: "r2", x: 100, y: 50, h: 7 }, "ridge");
    const result = compileSmartRoofSketchWithLegacyEngine(graph, {
      computePansFromGeometryCore: engine.computePansFromGeometryCore,
      modelTolerancePx: 0.01,
    });
    const runtime = {
      ...result.legacyState,
      roof: {
        scale: { metersPerPixel: 0.05 },
        roof: { north: { angleDeg: 0 } },
        roofPans: result.legacyState.pans.map((pan) => ({ id: pan.id, polygonPx: pan.polygon ?? [] })),
      },
    };

    const legacyInput = calpinageStateToLegacyRoofInput(
      runtime.roof,
      { ridges: runtime.ridges, traits: runtime.traits },
      { warnIfNoRuntime: false },
      runtime,
    );

    expect(legacyInput).not.toBeNull();
    expect(legacyInput?.pans.length).toBeGreaterThan(0);
    expect(legacyInput?.ridges).toHaveLength(1);
  });
});
