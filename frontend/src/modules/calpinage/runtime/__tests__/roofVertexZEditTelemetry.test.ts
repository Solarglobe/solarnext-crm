import { describe, expect, it, vi } from "vitest";
import { emitRoofVertexZTelemetry, generateRoofZDragSessionId } from "../roofVertexZEditTelemetry";

describe("roofVertexZEditTelemetry", () => {
  it("generateRoofZDragSessionId produit des ids distincts", () => {
    const a = generateRoofZDragSessionId();
    const b = generateRoofZDragSessionId();
    expect(a.startsWith("rvz_")).toBe(true);
    expect(b.startsWith("rvz_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("emitRoofVertexZTelemetry appelle le hook window si défini", () => {
    const hook = vi.fn();
    (window as unknown as { __CALPINAGE_ROOF_Z_TELEMETRY__?: (r: unknown) => void }).__CALPINAGE_ROOF_Z_TELEMETRY__ =
      hook;
    emitRoofVertexZTelemetry({
      event: "roof_vertex_z_commit_attempt",
      panId: "p1",
      vertexIndex: 0,
      heightM: 5,
      dragSessionId: null,
      source: "test",
    });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toMatchObject({ event: "roof_vertex_z_commit_attempt", panId: "p1" });
    delete (window as unknown as { __CALPINAGE_ROOF_Z_TELEMETRY__?: unknown }).__CALPINAGE_ROOF_Z_TELEMETRY__;
  });
});
