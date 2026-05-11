/**
 * polygonUtils.ts
 *
 * Geometry helpers extraits du moteur legacy pvPlacementEngine.js (L.108–244).
 * Fonctions pures — aucune référence à window.* ou global.*.
 * Utilisées par le moteur de placement PV (calpinage).
 */

/** Point 2D canonique utilisé dans tout ce module. */
export type Point2D = { x: number; y: number };

/** Bounding-box 2D axis-aligned (AABB). */
export type BBox2D = { minX: number; maxX: number; minY: number; maxY: number };

/** Segment défini par deux extrémités ou par les propriétés start/end. */
export type Segment2D =
  | [Point2D, Point2D]
  | { start: Point2D; end: Point2D };

// ---------------------------------------------------------------------------
// 1. pointInPolygon
// ---------------------------------------------------------------------------

/**
 * Teste si le point `pt` est à l'intérieur du polygone `poly`
 * (algorithme ray-casting, complexité O(n)).
 *
 * @param pt  - Point à tester.
 * @param poly - Tableau de sommets du polygone (minimum 3 points).
 * @returns `true` si le point est dans le polygone.
 */
export function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  if (!poly || poly.length < 3) return false;
  const n = poly.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi === yj) continue;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// 2. distancePointToSegment
// ---------------------------------------------------------------------------

/**
 * Distance euclidienne minimale entre le point `p` et le segment [a, b].
 * Accepte les points sous forme `{ x, y }`.
 *
 * @param p - Point source.
 * @param a - Première extrémité du segment.
 * @param b - Deuxième extrémité du segment.
 * @returns Distance minimale (≥ 0).
 */
export function distancePointToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const ax = a.x, ay = a.y;
  const bx = b.x, by = b.y;
  const px = p.x, py = p.y;
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  // Évite la division par zéro pour les segments dégénérés (a === b).
  const denom = abx * abx + aby * aby + 1e-20;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
  const qx = ax + t * abx, qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

// ---------------------------------------------------------------------------
// 3. minDistancePointToPolygonEdges
// ---------------------------------------------------------------------------

/**
 * Distance minimale entre le point `p` et l'ensemble des arêtes du polygone `poly`.
 *
 * @param p    - Point source.
 * @param poly - Polygone (tableau de sommets).
 * @returns Distance minimale, ou `Infinity` si le polygone est invalide.
 */
export function minDistancePointToPolygonEdges(p: Point2D, poly: Point2D[]): number {
  if (!poly || poly.length < 2) return Infinity;
  let d = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const segD = distancePointToSegment(p, poly[i], poly[j]);
    if (segD < d) d = segD;
  }
  return d;
}

// ---------------------------------------------------------------------------
// 4. minDistancePolygonToSegments
// ---------------------------------------------------------------------------

/**
 * Distance minimale entre les sommets/arêtes d'un polygone et une liste de segments.
 * Calcule dans les deux sens :
 *   - chaque sommet du polygone vers chaque segment,
 *   - chaque extrémité de segment vers chaque arête du polygone.
 *
 * @param poly     - Polygone source (tableau de sommets).
 * @param segments - Liste de segments (tableaux [p0,p1] ou objets { start, end }).
 * @returns Distance minimale, ou `Infinity` si les entrées sont invalides.
 */
export function minDistancePolygonToSegments(poly: Point2D[], segments: Segment2D[]): number {
  if (!poly || poly.length < 2 || !segments || segments.length === 0) return Infinity;
  let d = Infinity;
  for (const seg of segments) {
    const s0: Point2D = Array.isArray(seg) ? seg[0] : seg.start;
    const s1: Point2D = Array.isArray(seg) ? seg[1] : seg.end;
    if (!s0 || !s1) continue;

    // Sommets du polygone → segment courant
    for (const pt of poly) {
      const dp = distancePointToSegment(pt, s0, s1);
      if (dp < d) d = dp;
    }

    // Extrémités du segment → arêtes du polygone
    for (let j = 0; j < poly.length; j++) {
      const k = (j + 1) % poly.length;
      const dp2 = distancePointToSegment(s0, poly[j], poly[k]);
      if (dp2 < d) d = dp2;
      const dp3 = distancePointToSegment(s1, poly[j], poly[k]);
      if (dp3 < d) d = dp3;
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// 5. segmentIntersect
// ---------------------------------------------------------------------------

/**
 * Calcule l'intersection entre les segments [a1,a2] et [b1,b2].
 *
 * @returns Le point d'intersection `{ x, y }` si les segments se croisent,
 *          `null` s'ils sont parallèles ou ne se croisent pas dans leurs limites.
 */
export function segmentIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): Point2D | null {
  const ax = a2.x - a1.x, ay = a2.y - a1.y;
  const bx = b2.x - b1.x, by = b2.y - b1.y;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-12) return null; // Segments parallèles ou confondus
  const cx = b1.x - a1.x, cy = b1.y - a1.y;
  const t = (cx * by - cy * bx) / denom;
  const s = (cx * ay - cy * ax) / denom;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return { x: a1.x + t * ax, y: a1.y + t * ay };
}

// ---------------------------------------------------------------------------
// 6. polygonBBox2D
// ---------------------------------------------------------------------------

/**
 * Calcule la bounding-box axis-aligned (AABB) d'un polygone.
 * Utilisée comme préfiltre rapide avant les tests d'intersection
 * polygone/polygone (réduit le coût quand beaucoup de panneaux).
 *
 * @param poly - Polygone (tableau de sommets).
 * @returns `BBox2D` ou `null` si le polygone est vide.
 */
export function polygonBBox2D(poly: Point2D[]): BBox2D | null {
  if (!poly || poly.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// 7. bboxOverlap2D
// ---------------------------------------------------------------------------

/**
 * Teste si deux bounding-boxes 2D se chevauchent (test AABB séparation d'axes).
 *
 * @param a - Première AABB.
 * @param b - Deuxième AABB.
 * @returns `true` si les boîtes se chevauchent (y compris sur un bord).
 */
export function bboxOverlap2D(a: BBox2D | null, b: BBox2D | null): boolean {
  return (
    a != null &&
    b != null &&
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY
  );
}

// ---------------------------------------------------------------------------
// 8. polygonIntersectsPolygon
// ---------------------------------------------------------------------------

/**
 * Teste si deux polygones se chevauchent (intersection ou inclusion).
 *
 * Algorithme :
 *   1. Préfiltre AABB rapide.
 *   2. Test de chaque sommet de polyA dans polyB (inclusion).
 *   3. Test de chaque sommet de polyB dans polyA (inclusion inverse).
 *   4. Test croisé de toutes les arêtes (intersection de segments).
 *
 * @param polyA - Premier polygone.
 * @param polyB - Deuxième polygone.
 * @returns `true` si les deux polygones partagent au moins un point.
 */
export function polygonIntersectsPolygon(polyA: Point2D[], polyB: Point2D[]): boolean {
  if (!polyA || polyA.length < 2 || !polyB || polyB.length < 2) return false;

  // Préfiltre AABB
  const bbA = polygonBBox2D(polyA);
  const bbB = polygonBBox2D(polyB);
  if (!bboxOverlap2D(bbA, bbB)) return false;

  // Inclusion de sommets
  for (const pt of polyA) {
    if (pointInPolygon(pt, polyB)) return true;
  }
  for (const pt of polyB) {
    if (pointInPolygon(pt, polyA)) return true;
  }

  // Intersection d'arêtes
  for (let ai = 0; ai < polyA.length; ai++) {
    const a1 = polyA[ai], a2 = polyA[(ai + 1) % polyA.length];
    for (let bi = 0; bi < polyB.length; bi++) {
      const b1 = polyB[bi], b2 = polyB[(bi + 1) % polyB.length];
      if (segmentIntersect(a1, a2, b1, b2) !== null) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 9. minDistanceBetweenPolygons
// ---------------------------------------------------------------------------

/**
 * Calcule la distance minimale entre deux polygones convexes ou concaves.
 * Calcule dans les deux sens (sommets de A vers arêtes de B, et inversement).
 *
 * @param polyA - Premier polygone.
 * @param polyB - Deuxième polygone.
 * @returns Distance minimale, ou `Infinity` si les entrées sont invalides.
 */
export function minDistanceBetweenPolygons(polyA: Point2D[], polyB: Point2D[]): number {
  if (!polyA || polyA.length < 2 || !polyB || polyB.length < 2) return Infinity;
  let d = Infinity;

  // Sommets de A → arêtes de B
  for (const pt of polyA) {
    const toB = minDistancePointToPolygonEdges(pt, polyB);
    if (toB < d) d = toB;
  }

  // Sommets de B → arêtes de A
  for (const pt of polyB) {
    const toA = minDistancePointToPolygonEdges(pt, polyA);
    if (toA < d) d = toA;
  }

  return d;
}
