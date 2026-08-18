/**
 * Triangulation d’un polygone simple (sans trous) en 2D — algorithme des oreilles.
 * Entrée : contour **CCW** (aire signée > 0).
 */

export type Point2 = { readonly x: number; readonly y: number };

const EPS = 1e-10;
const EDGE_EPS = 1e-9;

export function signedArea2d(pts: readonly Point2[]): number {
  const n = pts.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return s * 0.5;
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function dist2(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orient2(a: Point2, b: Point2, c: Point2): number {
  return cross2(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
}

function segmentsIntersectStrict(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orient2(a, b, c);
  const o2 = orient2(a, b, d);
  const o3 = orient2(c, d, a);
  const o4 = orient2(c, d, b);
  return o1 * o2 < -EPS && o3 * o4 < -EPS;
}

function isValidSimplePolygonInput(vertices: readonly Point2[]): boolean {
  const n = vertices.length;
  if (n < 3) return false;
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const p = vertices[i]!;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const key = `${p.x.toFixed(10)}:${p.y.toFixed(10)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (dist2(p, vertices[(i + 1) % n]!) <= EDGE_EPS) return false;
  }
  if (seen.size < 3) return false;
  if (Math.abs(signedArea2d(vertices)) <= EPS) return false;

  for (let i = 0; i < n; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = vertices[j]!;
      const d = vertices[(j + 1) % n]!;
      if (segmentsIntersectStrict(a, b, c, d)) return false;
    }
  }
  return true;
}

function pointInTriangle2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < EPS) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -EPS && v >= -EPS && u + v <= 1 + EPS;
}

/**
 * @returns indices plats [i0,i1,i2, …] référençant les sommets du tableau d’entrée (CCW).
 */
export function triangulateSimplePolygon2dCcW(vertices: readonly Point2[]): number[] | null {
  const n = vertices.length;
  if (!isValidSimplePolygonInput(vertices)) return null;

  const pts = vertices;
  let V = pts.map((_, i) => i);
  const tri: number[] = [];
  let guard = 0;

  while (V.length > 3 && guard++ < n * n + 20) {
    let found = false;
    const m = V.length;
    for (let i = 0; i < m; i++) {
      const iPrev = V[(i + m - 1) % m]!;
      const iCur = V[i]!;
      const iNext = V[(i + 1) % m]!;
      const p = pts[iPrev]!;
      const c = pts[iCur]!;
      const q = pts[iNext]!;
      if (cross2(c.x - p.x, c.y - p.y, q.x - c.x, q.y - c.y) <= EPS) continue;
      let empty = true;
      for (const j of V) {
        if (j === iPrev || j === iCur || j === iNext) continue;
        const t = pts[j]!;
        if (pointInTriangle2(t.x, t.y, p.x, p.y, c.x, c.y, q.x, q.y)) {
          empty = false;
          break;
        }
      }
      if (empty) {
        tri.push(iPrev, iCur, iNext);
        V.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  if (V.length !== 3) return null;
  tri.push(V[0]!, V[1]!, V[2]!);
  return tri;
}
