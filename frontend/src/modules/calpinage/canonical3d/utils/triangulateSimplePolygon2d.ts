/**
 * Triangulation d’un polygone simple (sans trous) en 2D — algorithme des oreilles.
 * Entrée : contour **CCW** (aire signée > 0).
 */

export type Point2 = { readonly x: number; readonly y: number };

const EPS = 1e-10;

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
  if (n < 3) return null;

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
