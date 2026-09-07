import { describe, expect, it } from "vitest";
import { reconcileSmartRoofPanIdentities, type SmartRoofPanLike } from "../panReconciliation";

function pan(
  id: string,
  x: number,
  smartSourceSegmentIds: readonly string[],
): SmartRoofPanLike {
  return {
    id,
    name: id.replace(/^pan-(\d+)$/, "Pan $1"),
    polygon: [
      { x, y: 0 },
      { x: x + 1, y: 0 },
      { x: x + 1, y: 1 },
      { x, y: 1 },
    ],
    smartSourceSegmentIds,
  };
}

describe("smart roof pan reconciliation", () => {
  it("renumbers only the generated pan ids that collide with already reconciled ids", () => {
    const previous = [pan("pan-4", 30, ["persisted"])];
    const next = [
      pan("pan-1", 0, ["a"]),
      pan("pan-2", 10, ["b"]),
      pan("pan-3", 20, ["c"]),
      pan("pan-4", 30, ["persisted"]),
      pan("pan-4", 40, ["new"]),
    ];

    const result = reconcileSmartRoofPanIdentities(previous, next);

    expect(result.pans.map((item) => item.id)).toEqual(["pan-1", "pan-2", "pan-3", "pan-4", "pan-5"]);
    expect(result.pans[4]?.name).toBe("Pan 5");
    expect(result.panIdMapping).toEqual({ "pan-4": "pan-4" });
    expect(result.diagnostics.map((item) => item.code)).toContain("PAN_ID_DUPLICATE_RENUMBERED");
  });
});
