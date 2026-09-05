import { describe, expect, it } from "vitest";
import { addSketchSegment, createSmartRoofSketchGraph } from "../operations";
import {
  buildSmartRoofPersistedDrawing,
  readSmartRoofPersistedDrawing,
  SMART_ROOF_DRAWING_PERSISTENCE_VERSION,
} from "../persistence";

function graphWithHeight() {
  let graph = createSmartRoofSketchGraph({ metadata: { createdFrom: "test", modelTolerancePx: 0.01 } });
  graph = addSketchSegment(graph, {
    id: "seg-a",
    start: { id: "node-a", x: 0, y: 0, height: { valueM: 3, source: "manual", locked: true } },
    end: { id: "node-b", x: 100, y: 0, height: { valueM: 3, source: "manual", locked: true } },
    role: { value: "unknown", source: "unset" },
    provenance: { source: "test" },
  }).graph;
  return graph;
}

describe("smartRoofDrawing persistence", () => {
  it("round-trips a serializable graph without changing identities or constraints", () => {
    const graph = graphWithHeight();
    const persisted = buildSmartRoofPersistedDrawing({
      graph,
      sourceRevision: "legacy-a",
      draftRevision: "draft-a",
      panIdMapping: { "pan-1": "stable-pan" },
      appliedAtIso: "2026-09-05T00:00:00.000Z",
    });
    const read = readSmartRoofPersistedDrawing(JSON.parse(JSON.stringify(persisted)));

    expect(read.diagnostics).toEqual([]);
    expect(read.persisted).toMatchObject({
      kind: "smartRoofDrawing",
      persistenceVersion: SMART_ROOF_DRAWING_PERSISTENCE_VERSION,
      sourceRevision: "legacy-a",
      draftRevision: "draft-a",
      panIdMapping: { "pan-1": "stable-pan" },
    });
    expect(read.persisted?.graph.nodes.map((node) => node.id)).toEqual(["node-a", "node-b"]);
    expect(read.persisted?.graph.segments[0]).toMatchObject({
      id: "seg-a",
      startNodeId: "node-a",
      endNodeId: "node-b",
      role: { value: "unknown", source: "unset" },
    });
    expect(read.persisted?.graph.nodes.every((node) => node.height?.valueM === 3)).toBe(true);
  });

  it("rejects unknown versions and keeps the raw payload available to the caller", () => {
    const read = readSmartRoofPersistedDrawing({
      kind: "smartRoofDrawing",
      persistenceVersion: 999,
      graph: graphWithHeight(),
    });

    expect(read.persisted).toBeNull();
    expect(read.raw).toBeDefined();
    expect(read.diagnostics.some((item) => item.code === "SMART_ROOF_PERSISTED_VERSION_UNSUPPORTED")).toBe(true);
  });

  it("rejects dead segment references", () => {
    const persisted = buildSmartRoofPersistedDrawing({ graph: graphWithHeight() });
    const broken = JSON.parse(JSON.stringify(persisted));
    broken.graph.segments[0].endNodeId = "missing-node";

    const read = readSmartRoofPersistedDrawing(broken);

    expect(read.persisted).toBeNull();
    expect(read.raw).toBeDefined();
    expect(read.diagnostics.some((item) => item.code === "SMART_ROOF_SEGMENT_DEAD_REFERENCE")).toBe(true);
  });
});
