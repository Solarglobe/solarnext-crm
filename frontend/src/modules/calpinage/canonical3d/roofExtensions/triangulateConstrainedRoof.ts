import { ShapeUtils, Vector2 } from "three";

type Point = { readonly x: number; readonly y: number };
type Triangle = [number, number, number];
type Edge = readonly [number, number];

/** Planar roof triangulation. Input breaklines must not cross one another.
 * Heights are supplied by the caller; this never invents an intersection height.
 * A failed constraint returns null instead of silently omitting a hip or ridge.
 */
export function triangulateConstrainedRoof(
  points: readonly Point[], outline: readonly number[], constraints: readonly Edge[],
): { triangles: Triangle[]; boundary: number[][] } | null {
  const span = Math.max(1, ...points.map(p => Math.abs(p.x)), ...points.map(p => Math.abs(p.y)));
  const eps = 1e-10 * span * span;
  const cross = (a: number, b: number, c: number) =>
    (points[b]!.x - points[a]!.x) * (points[c]!.y - points[a]!.y) -
    (points[b]!.y - points[a]!.y) * (points[c]!.x - points[a]!.x);
  const onEdge = (p: number, a: number, b: number) => Math.abs(cross(a, b, p)) <= eps &&
    (points[p]!.x - points[a]!.x) * (points[p]!.x - points[b]!.x) +
    (points[p]!.y - points[a]!.y) * (points[p]!.y - points[b]!.y) <= eps;
  const crosses = (a: number, b: number, c: number, d: number) =>
    cross(a, b, c) * cross(a, b, d) < -eps * eps && cross(c, d, a) * cross(c, d, b) < -eps * eps;
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const ccw = (t: Triangle): Triangle => cross(...t) >= 0 ? t : [t[0], t[2], t[1]];
  const splitEdge = (a: number, b: number) => points.map((_, i) => i).filter(i => onEdge(i, a, b))
    .sort((i, j) => Math.hypot(points[i]!.x - points[a]!.x, points[i]!.y - points[a]!.y) -
      Math.hypot(points[j]!.x - points[a]!.x, points[j]!.y - points[a]!.y));
  const boundary = outline.map((a, i) => splitEdge(a, outline[(i + 1) % outline.length]!));
  const desired: Edge[] = [];
  for (const [a, b] of constraints) {
    if (a === b) continue;
    const chain = splitEdge(a, b);
    for (let i = 1; i < chain.length; i++) desired.push([chain[i - 1]!, chain[i]!]);
  }
  for (let i = 0; i < desired.length; i++) {
    for (let j = i + 1; j < desired.length; j++) {
      if (crosses(...desired[i]!, ...desired[j]!)) return null;
    }
  }
  let triangles: Triangle[] = ShapeUtils.triangulateShape(outline.map(i => new Vector2(points[i]!.x, points[i]!.y)), [])
    .map(t => ccw(t.map(i => outline[i]!) as Triangle));
  if (!triangles.length) return null;
  for (let p = 0; p < points.length; p++) {
    if (outline.includes(p)) continue;
    let inserted = false;
    const next: Triangle[] = [];
    for (const t of triangles) {
      const signs = t.map((a, i) => cross(a, t[(i + 1) % 3]!, p));
      if (signs.some(s => s < -eps)) { next.push(t); continue; }
      inserted = true;
      for (let i = 0; i < 3; i++) {
        if (signs[i]! > eps) next.push(ccw([t[i]!, t[(i + 1) % 3]!, p]));
      }
    }
    if (!inserted) return null; // Outside the actual footprint.
    triangles = next;
  }
  const protectedEdges = new Set<string>();
  for (const [a, b] of desired) {
    let present = false;
    for (let attempt = 0; attempt < triangles.length * triangles.length; attempt++) {
      const edges = new Map<string, { a: number; b: number; owners: number[] }>();
      triangles.forEach((t, ti) => t.forEach((u, i) => {
        const v = t[(i + 1) % 3]!, k = key(u, v);
        const edge = edges.get(k) ?? { a: u, b: v, owners: [] };
        edge.owners.push(ti); edges.set(k, edge);
      }));
      if (edges.has(key(a, b))) { present = true; break; }
      let flipped = false;
      for (const [k, e] of edges) {
        if (e.owners.length !== 2 || protectedEdges.has(k) || !crosses(a, b, e.a, e.b)) continue;
        const [i, j] = e.owners;
        const c = triangles[i!]!.find(v => v !== e.a && v !== e.b)!;
        const d = triangles[j!]!.find(v => v !== e.a && v !== e.b)!;
        if (!crosses(c, d, e.a, e.b)) continue;
        triangles[i!] = ccw([c, d, e.a]); triangles[j!] = ccw([d, c, e.b]);
        flipped = true; break;
      }
      if (!flipped) return null;
    }
    if (!present) return null;
    protectedEdges.add(key(a, b));
  }
  return { triangles, boundary };
}
