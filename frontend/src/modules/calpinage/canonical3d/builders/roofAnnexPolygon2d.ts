/**
 * Géométrie 2D pour binding annexes ↔ pans (repère local bâtiment XY, m).
 * Utilisé par bindRoofAnnexesToRoofPatches — pas de runtime calpinage.
 */

export type XY = Readonly<{ x: number; y: number }>;
export type Ring2D = readonly XY[];

const EPS = 1e-9;
const EPS_AREA = 1e-10;

export function polygonSignedAreaM2(poly: Ring2D): number {
  let s = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonAreaM2(poly: Ring2D): number {
  return Math.abs(polygonSignedAreaM2(poly));
}

export function centroid2d(poly: Ring2D): XY {
  let cx = 0;
  let cy = 0;
  const n = poly.length;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / n, y: cy / n };
}

/** Ray casting — contour fermé, tolérance limitée sur les arêtes. */
export function pointInPolygon2dXY(px: number, py: number, poly: Ring2D): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersect =
      pi.y > py !== pj.y > py && px < ((pj.x - pi.x) * (py - pi.y)) / (pj.y - pi.y + EPS) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function cross(o: XY, a: XY, b: XY): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Intersection propre segment-segment (exclut extrémités seules), retourne null si absent. */
export function segmentProperIntersection2d(
  a1: XY,
  a2: XY,
  b1: XY,
  b2: XY,
): { x: number; y: number } | null {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < EPS) return null;
  const t =
    ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u =
    ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
    return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
  }
  return null;
}

function lineIntersectionInside(
  p1: XY,
  p2: XY,
  q1: XY,
  q2: XY,
): XY | null {
  const d = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
  if (Math.abs(d) < EPS) return null;
  const t =
    ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / d;
  const u =
    ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / d;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  }
  return null;
}

/** Indique si le segment [a1,a2] intersecte le polygone (arêtes ou sommets). */
export function segmentCrossesPolygonBoundary(a1: XY, a2: XY, poly: Ring2D): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const b1 = poly[i]!;
    const b2 = poly[(i + 1) % n]!;
    if (segmentProperIntersection2d(a1, a2, b1, b2)) return true;
    const hit = lineIntersectionInside(a1, a2, b1, b2);
    if (hit) {
      const t =
        Math.abs(a2.x - a1.x) > EPS ? (hit.x - a1.x) / (a2.x - a1.x) : (hit.y - a1.y) / (a2.y - a1.y);
      if (t > EPS && t < 1 - EPS) return true;
    }
  }
  return false;
}

function isConvexCCW(poly: Ring2D): boolean {
  if (poly.length < 3) return false;
  const a = polygonSignedAreaM2(poly);
  if (a <= EPS_AREA) return false;
  const n = poly.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const o = poly[i]!;
    const p = poly[(i + 1) % n]!;
    const q = poly[(i + 2) % n]!;
    const c = cross(o, p, q);
    if (Math.abs(c) < EPS) continue;
    if (sign === 0) sign = c > 0 ? 1 : -1;
    else if ((c > 0 ? 1 : -1) !== sign) return false;
  }
  return sign > 0;
}

function ensureCCW(poly: Ring2D): XY[] {
  const a = polygonSignedAreaM2(poly);
  if (a < 0) return [...poly].reverse();
  return [...poly];
}

function insideConvexEdge(p: XY, edgeStart: XY, edgeEnd: XY): boolean {
  return cross(edgeStart, edgeEnd, p) >= -EPS;
}

/**
 * Sutherland–Hodgman : intersection de deux polygones convexes (CCW).
 * `clip` = fenêtre ; `subject` = polygone à découper.
 */
export function convexPolygonIntersection(clip: Ring2D, subject: Ring2D): XY[] {
  if (clip.length < 3 || subject.length < 3) return [];
  let output = ensureCCW(subject);
  const clipRing = ensureCCW(clip);
  const nC = clipRing.length;
  for (let i = 0; i < nC; i++) {
    const A = clipRing[i]!;
    const B = clipRing[(i + 1) % nC]!;
    const input = output;
    output = [];
    if (input.length === 0) return [];
    const nI = input.length;
    for (let j = 0; j < nI; j++) {
      const S = input[j]!;
      const E = input[(j + 1) % nI]!;
      const sIn = insideConvexEdge(S, A, B);
      const eIn = insideConvexEdge(E, A, B);
      if (sIn && eIn) {
        output.push(E);
      } else if (sIn && !eIn) {
        const inter = lineIntersectionInside(S, E, A, B);
        if (inter) output.push(inter);
      } else if (!sIn && eIn) {
        const inter = lineIntersectionInside(S, E, A, B);
        if (inter) output.push(inter);
        output.push(E);
      }
    }
  }
  if (output.length < 3) return [];
  const ar = polygonAreaM2(output);
  if (ar < EPS_AREA) return [];
  return output;
}

/**
 * Aire d’intersection footprint ∩ patch.
 * Si l’un des deux n’est pas convexe, découpe le sujet en éventail depuis le premier sommet.
 */
export function intersectionAreaM2(patch: Ring2D, footprint: Ring2D): number {
  if (patch.length < 3 || footprint.length < 3) return 0;
  const patchConvex = isConvexCCW(patch);
  const footConvex = isConvexCCW(footprint);
  if (patchConvex && footConvex) {
    return polygonAreaM2(convexPolygonIntersection(patch, footprint));
  }
  if (patchConvex && !footConvex) {
    let sum = 0;
    const fp = ensureCCW(footprint);
    const o = fp[0]!;
    for (let i = 1; i < fp.length - 1; i++) {
      const tri: XY[] = [o, fp[i]!, fp[i + 1]!];
      if (polygonAreaM2(tri) < EPS_AREA) continue;
      sum += polygonAreaM2(convexPolygonIntersection(patch, tri));
    }
    return sum;
  }
  if (!patchConvex && footConvex) {
    let sum = 0;
    const pr = ensureCCW(patch);
    const o = pr[0]!;
    for (let i = 1; i < pr.length - 1; i++) {
      const tri: XY[] = [o, pr[i]!, pr[i + 1]!];
      if (polygonAreaM2(tri) < EPS_AREA) continue;
      sum += polygonAreaM2(convexPolygonIntersection(tri, footprint));
    }
    return sum;
  }
  /** Les deux non convexes : approximation conservative par bbox intersection (diagnostic requis côté appelant). */
  return 0;
}

export function regularNGonAroundCenter(cx: number, cy: number, radiusM: number, n: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push({ x: cx + radiusM * Math.cos(t), y: cy + radiusM * Math.sin(t) });
  }
  return out;
}
