import { describe, expect, it } from "vitest";
import {
  addSketchSegment,
  assertNoDeadSegmentReferences,
  connectSegmentEndpointToSegment,
  createSmartRoofSketchGraph,
  moveSketchNode,
  normalizeSketchGraph,
  removeSketchSegment,
  setSketchSegmentRole,
  setSketchSegmentHeight,
  splitSketchSegmentAtPoint,
} from "../operations";

describe("smartRoofDrawing operations", () => {
  it("moves a shared node without changing its identity", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "s1",
      start: { id: "n1", x: 0, y: 0 },
      end: { id: "shared", x: 10, y: 0 },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "s2",
      start: { nodeId: "shared" },
      end: { id: "n3", x: 10, y: 10 },
    }).graph;

    const moved = moveSketchNode(graph, "shared", { x: 12, y: 2 }).graph;

    expect(moved.nodes.find((node) => node.id === "shared")).toMatchObject({ x: 12, y: 2 });
    expect(moved.segments.filter((segment) => segment.startNodeId === "shared" || segment.endNodeId === "shared")).toHaveLength(2);
    assertNoDeadSegmentReferences(moved);
  });

  it("connects an endpoint to a segment by creating a deterministic T-junction split", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "base",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
      role: { value: "outline", source: "manual" },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "drop",
      start: { id: "c", x: 5, y: 5 },
      end: { id: "d", x: 5, y: 0 },
      role: { value: "unknown", source: "unset" },
    }).graph;

    const result = connectSegmentEndpointToSegment(graph, "drop", "end", "base", { modelTolerancePx: 0.01 });

    expect(result.mapping?.segments?.base).toHaveLength(2);
    expect(result.graph.segments.find((segment) => segment.id === "drop")?.endNodeId).toBe("base:junction-0.500000");
    expect(result.graph.segments.some((segment) => segment.id === "base")).toBe(false);
    assertNoDeadSegmentReferences(result.graph);
  });

  it("splits a segment while keeping parent provenance", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "ridge-a",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
      role: { value: "ridge", source: "manual", locked: true },
    }).graph;

    const result = splitSketchSegmentAtPoint(graph, "ridge-a", { x: 4, y: 0, nodeId: "j" }, { modelTolerancePx: 0.01 });

    expect(result.mapping?.segments?.["ridge-a"]).toEqual(["ridge-a:part-1", "ridge-a:part-2"]);
    expect(result.graph.segments.map((segment) => segment.provenance?.parentSegmentIds?.[0])).toEqual(["ridge-a", "ridge-a"]);
  });

  it("changes a role without changing identity or connections", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "line",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
    }).graph;

    const updated = setSketchSegmentRole(graph, "line", { value: "ridge", source: "manual", locked: true }).graph;

    expect(updated.segments[0]).toMatchObject({ id: "line", startNodeId: "a", endNodeId: "b" });
    expect(updated.segments[0]?.role.value).toBe("ridge");
  });

  it("removes a segment without leaving dead references", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "line",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
    }).graph;

    const updated = removeSketchSegment(graph, "line").graph;

    expect(updated.segments).toHaveLength(0);
    expect(updated.nodes).toHaveLength(0);
    assertNoDeadSegmentReferences(updated);
  });

  it("merges duplicate segments when constraints are compatible", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "a",
      start: { id: "n1", x: 0, y: 0 },
      end: { id: "n2", x: 10, y: 0 },
      role: { value: "unknown", source: "unset" },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "b",
      start: { nodeId: "n2" },
      end: { nodeId: "n1" },
      role: { value: "trait", source: "manual" },
    }).graph;

    const normalized = normalizeSketchGraph(graph, { modelTolerancePx: 0.01 });

    expect(normalized.graph.segments).toHaveLength(1);
    expect(normalized.graph.segments[0]?.role.value).toBe("trait");
    expect(normalized.mapping?.segments?.b).toEqual(["a"]);
  });

  it("keeps conflicting duplicate segments and reports the conflict", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "ridge",
      start: { id: "n1", x: 0, y: 0 },
      end: { id: "n2", x: 10, y: 0 },
      role: { value: "ridge", source: "manual", locked: true },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "trait",
      start: { nodeId: "n1" },
      end: { nodeId: "n2" },
      role: { value: "trait", source: "manual", locked: true },
    }).graph;

    const normalized = normalizeSketchGraph(graph, { modelTolerancePx: 0.01 });

    expect(normalized.graph.segments).toHaveLength(2);
    expect(normalized.diagnostics.some((item) => item.code === "SEGMENT_ROLE_CONFLICT")).toBe(true);
  });

  it("keeps locked endpoint heights by default and only overrides them when explicitly requested", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "ridge",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
    }).graph;
    graph.nodes = graph.nodes.map((node) => ({
      ...node,
      height: { valueM: 3, source: "manual", locked: true },
    }));

    const guarded = setSketchSegmentHeight(graph, "ridge", { valueM: 5, source: "manual", locked: true }, { applyToEndpoints: true });
    expect(guarded.graph.nodes.map((node) => node.height?.valueM)).toEqual([3, 3]);
    expect(guarded.diagnostics.some((item) => item.code === "LOCKED_ENDPOINT_HEIGHT_CONFLICT")).toBe(true);

    const overridden = setSketchSegmentHeight(graph, "ridge", { valueM: 5, source: "manual", locked: true }, {
      applyToEndpoints: true,
      overrideLockedEndpoints: true,
    });
    expect(overridden.graph.nodes.map((node) => node.height?.valueM)).toEqual([5, 5]);
    expect(overridden.diagnostics.some((item) => item.code === "LOCKED_ENDPOINT_HEIGHT_CONFLICT")).toBe(false);
  });

  it("does not merge same-coordinate nodes from distinct groups", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "building-a",
      groupId: "a",
      start: { id: "a1", x: 0, y: 0, groupId: "a" },
      end: { id: "a2", x: 10, y: 0, groupId: "a" },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "building-b",
      groupId: "b",
      start: { id: "b1", x: 0, y: 0, groupId: "b" },
      end: { id: "b2", x: 10, y: 0, groupId: "b" },
    }).graph;

    const normalized = normalizeSketchGraph(graph, { modelTolerancePx: 0.01 });

    expect(normalized.graph.nodes.some((node) => node.id === "a1")).toBe(true);
    expect(normalized.graph.nodes.some((node) => node.id === "b1")).toBe(true);
  });

  it("is idempotent for T-junction normalization", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "base",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "drop",
      start: { id: "c", x: 5, y: 5 },
      end: { id: "d", x: 5, y: 0 },
    }).graph;

    const once = normalizeSketchGraph(graph, { modelTolerancePx: 0.01 }).graph;
    const twice = normalizeSketchGraph(once, { modelTolerancePx: 0.01 }).graph;

    expect(twice).toEqual(once);
  });

  it("detects colinear overlaps without choosing between constraints", () => {
    let graph = createSmartRoofSketchGraph();
    graph = addSketchSegment(graph, {
      id: "long",
      start: { id: "a", x: 0, y: 0 },
      end: { id: "b", x: 10, y: 0 },
    }).graph;
    graph = addSketchSegment(graph, {
      id: "partial",
      start: { id: "c", x: 4, y: 0 },
      end: { id: "d", x: 8, y: 0 },
    }).graph;

    const normalized = normalizeSketchGraph(graph, { modelTolerancePx: 0.01 });

    expect(normalized.diagnostics.some((item) => item.code === "COLINEAR_OVERLAP_REVIEW_REQUIRED")).toBe(true);
  });
});
