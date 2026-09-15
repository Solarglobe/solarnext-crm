import { describe, expect, it } from "vitest";
import { triangulateConstrainedRoof } from "../triangulateConstrainedRoof";

describe("constrained roof surface", () => {
  const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    { x: 2, y: 1 }, { x: 2, y: 4 }];
  it("covers the footprint once and includes both hips and the boundary ridge", () => {
    const result = triangulateConstrainedRoof(points, [0, 1, 2, 3], [[0, 4], [1, 4], [4, 5]])!;
    expect(result).not.toBeNull();
    expect(result.boundary[2]).toEqual([2, 5, 3]);
    const edges = new Set(result.triangles.flatMap(t => t.map((a, i) => [a, t[(i + 1) % 3]!].sort().join(":"))));
    for (const edge of ["0:4", "1:4", "4:5"]) expect(edges.has(edge)).toBe(true);
    const area = result.triangles.reduce((sum, [a, b, c]) => {
      const p = points[a]!, q = points[b]!, r = points[c]!;
      return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
    }, 0);
    expect(area).toBeCloseTo(16, 10);
  });
  it("refuses crossed breaklines rather than inventing their intersection height", () => {
    expect(triangulateConstrainedRoof(points.slice(0, 4), [0, 1, 2, 3], [[0, 2], [1, 3]])).toBeNull();
  });
  it("refuses a ridge outside the measured footprint", () => {
    expect(triangulateConstrainedRoof([...points, { x: 5, y: 2 }], [0, 1, 2, 3], [[4, 6]])).toBeNull();
  });
  it("preserves a concave footprint without filling its recess", () => {
    const concave = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
    const result = triangulateConstrainedRoof(concave, [0, 1, 2, 3, 4, 5], [])!;
    expect(result.triangles).toHaveLength(4);
    for (const t of result.triangles) {
      const x = t.reduce((s, i) => s + concave[i]!.x, 0) / 3;
      const y = t.reduce((s, i) => s + concave[i]!.y, 0) / 3;
      expect(x <= 1 || y <= 1).toBe(true);
    }
  });
});
