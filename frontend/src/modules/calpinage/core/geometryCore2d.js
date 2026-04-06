/**
 * Noyau géométrique 2D partagé — Calpinage.
 *
 * Fonctions pures, sans dépendance UI/DOM ni état.
 * Toutes les coordonnées sont en espace image (px) sauf mention contraire.
 *
 * Algorithmes alignés sur les implémentations existantes dans le codebase ;
 * unification des epsilons sur GEOM2D_EPS = 1e-12 (compromis entre les
 * variantes 1e-20, 1e-12 et 1e-10 trouvées en audit).
 *
 * RÈGLE : ce fichier ne doit jamais importer de modules applicatifs.
 * Tests : core/__tests__/geometryCore2d.test.js
 */

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Epsilon numérique pour éviter la division par zéro (segments dégénérés). */
export var GEOM2D_EPS = 1e-12;

/**
 * Nombre de segments utilisé par défaut lors de la discrétisation d'un cercle.
 * Identique à CIRCLE_SEGMENTS dans geoEntity3D.ts et nearShadingCore.cjs.
 */
export var CIRCLE_SEGMENTS_DEFAULT = 16;

// ─── Primitives de base ─────────────────────────────────────────────────────

/**
 * Distance euclidienne entre deux points 2D.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function dist2d(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ─── Point dans polygone ─────────────────────────────────────────────────────

/**
 * Test d'appartenance point-dans-polygone (ray casting).
 * Algorithme identique aux 6 implémentations du codebase (pvPlacementEngine,
 * ghostSlots, unifiedHitTest, nearShadingCore, hitTest.ts, obstacles.ts).
 *
 * Précondition : poly doit avoir au moins 3 points.
 * Cas dégénéré : arêtes horizontales (yi === yj) ignorées.
 *
 * @param {{ x: number, y: number }} pt
 * @param {Array<{ x: number, y: number }>} poly
 * @returns {boolean}
 */
export function pointInPolygon2d(pt, poly) {
  if (!pt || !poly || poly.length < 3) return false;
  var inside = false;
  var n = poly.length;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = poly[i].x, yi = poly[i].y;
    var xj = poly[j].x, yj = poly[j].y;
    if (yi === yj) continue;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ─── Projection et distance point-segment ───────────────────────────────────

/**
 * Projection orthogonale d'un point sur le segment [a, b], paramètre t clampé [0, 1].
 * Retourne le point projeté et le paramètre t.
 *
 * Algorithme identique à projectPointOnSegmentClamped() de structuralSnapPhase2.js
 * (avec epsilon GEOM2D_EPS au lieu de 1e-20 — comportement identique en pratique
 * pour des coordonnées image px).
 *
 * @param {{ x: number, y: number }} pt
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {{ x: number, y: number, t: number }}
 */
export function projectPointOnSegment2d(pt, a, b) {
  var abx = b.x - a.x;
  var aby = b.y - a.y;
  var ab2 = abx * abx + aby * aby + GEOM2D_EPS;
  var t = ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return {
    x: a.x + t * abx,
    y: a.y + t * aby,
    t: t,
  };
}

/**
 * Distance (scalaire) d'un point à un segment [a, b].
 * Délègue à projectPointOnSegment2d.
 *
 * @param {{ x: number, y: number }} pt
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function distPointToSegment2d(pt, a, b) {
  var proj = projectPointOnSegment2d(pt, a, b);
  return Math.hypot(pt.x - proj.x, pt.y - proj.y);
}

// ─── Intersection de segments ────────────────────────────────────────────────

/**
 * Calcule l'intersection de deux segments [a1, a2] et [b1, b2].
 * Retourne le point d'intersection ou null si parallèles / n'intersectent pas.
 *
 * Algorithme identique à segmentIntersect() dans pvPlacementEngine.js,
 * ghostSlots.js et segmentIntersection() dans calpinage.module.js.
 *
 * @param {{ x: number, y: number }} a1
 * @param {{ x: number, y: number }} a2
 * @param {{ x: number, y: number }} b1
 * @param {{ x: number, y: number }} b2
 * @returns {{ x: number, y: number } | null}
 */
export function segmentIntersection2d(a1, a2, b1, b2) {
  var ax = a2.x - a1.x, ay = a2.y - a1.y;
  var bx = b2.x - b1.x, by = b2.y - b1.y;
  var denom = ax * by - ay * bx;
  if (Math.abs(denom) < GEOM2D_EPS) return null;
  var cx = b1.x - a1.x, cy = b1.y - a1.y;
  var t = (cx * by - cy * bx) / denom;
  var s = (cx * ay - cy * ax) / denom;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return { x: a1.x + t * ax, y: a1.y + t * ay };
}

// ─── Polygone — métriques globales ──────────────────────────────────────────

/**
 * Centroïde d'un polygone (moyenne arithmétique des sommets).
 * Algorithme identique à polygonCentroid() dans nearShadingCore.cjs et
 * computeCentroidPx() dans geoEntity3D.ts.
 *
 * @param {Array<{ x: number, y: number }>} poly
 * @returns {{ x: number, y: number }}
 */
export function polygonCentroid2d(poly) {
  if (!poly || poly.length < 3) return { x: 0, y: 0 };
  var sumX = 0, sumY = 0;
  for (var i = 0; i < poly.length; i++) {
    sumX += typeof poly[i].x === "number" ? poly[i].x : 0;
    sumY += typeof poly[i].y === "number" ? poly[i].y : 0;
  }
  return { x: sumX / poly.length, y: sumY / poly.length };
}

/**
 * Bounding box d'un polygone.
 * Retourne null si le polygone est vide ou dégénéré.
 *
 * @param {Array<{ x: number, y: number }>} poly
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number } | null}
 */
export function polygonBoundingBox2d(poly) {
  if (!poly || poly.length === 0) return null;
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var i = 0; i < poly.length; i++) {
    var px = typeof poly[i].x === "number" ? poly[i].x : 0;
    var py = typeof poly[i].y === "number" ? poly[i].y : 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
}

// ─── Polygone — tests de proximité et appartenance ──────────────────────────

/**
 * Vrai si le point pt est à distance ≤ tol d'au moins une arête du polygone.
 * Algorithme identique à pointNearPolygonImage() dans unifiedHitTest.js et
 * pointNearPolygon() dans obstacles.ts.
 *
 * @param {{ x: number, y: number }} pt
 * @param {Array<{ x: number, y: number }>} poly
 * @param {number} tol tolérance en pixels image
 * @returns {boolean}
 */
export function pointNearPolygon2d(pt, poly, tol) {
  if (!poly || poly.length < 2) return false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distPointToSegment2d(pt, poly[j], poly[i]) <= tol) return true;
  }
  return false;
}

/**
 * Distance minimale du point pt au bord (arêtes) d'un polygone.
 * Retourne Infinity si le polygone a moins de 2 points.
 *
 * @param {{ x: number, y: number }} pt
 * @param {Array<{ x: number, y: number }>} poly
 * @returns {number}
 */
export function minDistPointToPolygonEdges2d(pt, poly) {
  if (!poly || poly.length < 2) return Infinity;
  var d = Infinity;
  for (var i = 0; i < poly.length; i++) {
    var j = (i + 1) % poly.length;
    var segD = distPointToSegment2d(pt, poly[i], poly[j]);
    if (segD < d) d = segD;
  }
  return d;
}

/**
 * Vrai si les deux polygones se chevauchent (au moins un point de l'un dans l'autre,
 * ou au moins une paire d'arêtes s'intersecte).
 *
 * Algorithme identique à polygonIntersectsPolygon() dans pvPlacementEngine.js.
 *
 * @param {Array<{ x: number, y: number }>} polyA
 * @param {Array<{ x: number, y: number }>} polyB
 * @returns {boolean}
 */
export function polygonsIntersect2d(polyA, polyB) {
  if (!polyA || polyA.length < 2 || !polyB || polyB.length < 2) return false;
  for (var i = 0; i < polyA.length; i++) {
    if (pointInPolygon2d(polyA[i], polyB)) return true;
  }
  for (var j = 0; j < polyB.length; j++) {
    if (pointInPolygon2d(polyB[j], polyA)) return true;
  }
  for (var ai = 0; ai < polyA.length; ai++) {
    var a1 = polyA[ai], a2 = polyA[(ai + 1) % polyA.length];
    for (var bi = 0; bi < polyB.length; bi++) {
      var b1 = polyB[bi], b2 = polyB[(bi + 1) % polyB.length];
      if (segmentIntersection2d(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// ─── Discrétisation de cercle ────────────────────────────────────────────────

/**
 * Discrétise un cercle en polygone régulier.
 * Algorithme identique à circleToPolygon() dans nearShadingCore.cjs et geoEntity3D.ts.
 *
 * @param {number} cx centre x
 * @param {number} cy centre y
 * @param {number} radius
 * @param {number} [n] nombre de segments (défaut : CIRCLE_SEGMENTS_DEFAULT = 16)
 * @returns {Array<{ x: number, y: number }>}
 */
export function circleToPolygon2d(cx, cy, radius, n) {
  var segments = (typeof n === "number" && n >= 3) ? n : CIRCLE_SEGMENTS_DEFAULT;
  var pts = [];
  for (var i = 0; i < segments; i++) {
    var a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}
