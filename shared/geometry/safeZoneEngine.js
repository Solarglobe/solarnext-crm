/**
 * CP-PV-014 — Safe Zone Geometry Engine
 * Moteur pur : calcul des zones autorisées (safe zone) pour pose PV sur chaque pan.
 *
 * INVARIANTS:
 * - Tout en image-space (px). Aucune conversion world-space.
 * - Formats attendus:
 *   - pan: { id: string, polygonPx: [{x,y}, ...] }
 *   - obstacle: { id: string, polygonPx: [{x,y}, ...] }
 *
 * CP-PV-015 (visual) devra importer computeSafeZones et passer pans + obstacles
 * depuis le state calpinage (via safeZoneAdapter si structures diffèrent).
 *
 * @module safeZoneEngine
 */

import ClipperLib from "clipper-lib";

const SCALE = 10000;
const DEFAULT_EPS_AREA_PX2 = 25;
const MITER_LIMIT = 2.5;

/**
 * Convertit des points px (float) en path Clipper (int).
 * @param {Array<{x: number, y: number}>} pointsPx
 * @param {number} scale
 * @returns {Array<{X: number, Y: number}>}
 */
function toClipperPath(pointsPx, scale = SCALE) {
  if (!pointsPx || pointsPx.length < 2) return [];
  return pointsPx.map((p) => ({
    X: Math.round((Number(p.x) || 0) * scale),
    Y: Math.round((Number(p.y) || 0) * scale),
  }));
}

/**
 * Convertit un path Clipper en points px (float).
 * @param {Array<{X: number, Y: number}>} path
 * @param {number} scale
 * @returns {Array<{x: number, y: number}>}
 */
function fromClipperPath(path, scale = SCALE) {
  if (!path || path.length < 2) return [];
  return path.map((p) => ({
    x: (Number(p.X) || 0) / scale,
    y: (Number(p.Y) || 0) / scale,
  }));
}

/**
 * Aire absolue d'un polygone (px²) via formule shoelace.
 * @param {Array<{x: number, y: number}>} poly
 * @returns {number}
 */
function polygonAreaAbs(poly) {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) * 0.5;
}

/**
 * Douglas-Peucker simplification (epsilon en px).
 * Gère les polygones fermés (premier = dernier).
 * @param {Array<{x: number, y: number}>} points
 * @param {number} epsilon
 * @returns {Array<{x: number, y: number}>}
 */
function simplifyRDP(points, epsilon = 1) {
  if (!points || points.length < 4) return points || [];
  let pts = points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const isClosed =
    pts.length > 2 &&
    Math.abs(first.x - last.x) < 1e-9 &&
    Math.abs(first.y - last.y) < 1e-9;
  if (isClosed) pts = pts.slice(0, -1);
  if (pts.length < 4) return isClosed ? [...pts, { ...pts[0] }] : pts;

  const n = pts.length;
  let maxDist = 0;
  let maxIdx = 0;
  const pFirst = pts[0];
  const pLast = pts[n - 1];
  const dx = pLast.x - pFirst.x;
  const dy = pLast.y - pFirst.y;
  const lenSq = dx * dx + dy * dy + 1e-20;
  for (let i = 1; i < n - 1; i++) {
    const p = pts[i];
    const t = ((p.x - pFirst.x) * dx + (p.y - pFirst.y) * dy) / lenSq;
    const projX = pFirst.x + t * dx;
    const projY = pFirst.y + t * dy;
    const d = (p.x - projX) ** 2 + (p.y - projY) ** 2;
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist <= epsilon * epsilon) {
    const result = [pFirst, pLast];
    return isClosed ? [...result, { ...result[0] }] : result;
  }
  const left = simplifyRDP(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplifyRDP(pts.slice(maxIdx), epsilon);
  const result = [...left.slice(0, -1), ...right];
  return isClosed ? [...result, { ...result[0] }] : result;
}

const CLEAN_DISTANCE_SCALE = 0.8;
const RDP_EPSILON_PX = 1;

/**
 * Assure qu'un path est fermé (premier point = dernier point).
 * @param {Array<{X: number, Y: number}>} path
 * @returns {Array<{X: number, Y: number}>}
 */
function ensureClosedClipperPath(path) {
  if (!path || path.length < 2) return path || [];
  const first = path[0];
  const last = path[path.length - 1];
  if (first.X === last.X && first.Y === last.Y) return path;
  return [...path, { X: first.X, Y: first.Y }];
}

/**
 * Inset (shrink) d'un polygone pan.
 * @param {Array<{X: number, Y: number}>} path - path Clipper
 * @param {number} deltaPx - marge en px (positif = shrink)
 * @returns {Array<Array<{X: number, Y: number}>>}
 */
function offsetInward(path, deltaPx) {
  if (!path || path.length < 3 || deltaPx <= 0) return path ? [path] : [];
  const deltaInt = Math.round(deltaPx * SCALE);
  if (deltaInt <= 0) return [path];
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, 0.25);
  co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  co.Execute(solution, -deltaInt);
  return solution;
}

/**
 * Expand (outward) d'un polygone obstacle.
 * Utilise jtMiter pour limiter les sommets (éviter explosion avec jtRound).
 * @param {Array<{X: number, Y: number}>} path
 * @param {number} deltaPx
 * @returns {Array<Array<{X: number, Y: number}>>}
 */
function offsetOutward(path, deltaPx) {
  if (!path || path.length < 3 || deltaPx <= 0) return path ? [path] : [];
  const deltaInt = Math.round(deltaPx * SCALE);
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, 0.25);
  co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  co.Execute(solution, deltaInt);
  return solution;
}

/**
 * Union de plusieurs paths.
 * @param {Array<Array<{X: number, Y: number}>>} paths
 * @returns {Array<Array<{X: number, Y: number}>>}
 */
function unionPaths(paths) {
  const valid = (paths || []).filter((p) => p && p.length >= 3);
  if (valid.length === 0) return [];
  if (valid.length === 1) return valid;
  const c = new ClipperLib.Clipper();
  valid.forEach((p) => c.AddPath(p, ClipperLib.PolyType.ptSubject, true));
  const solution = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return solution;
}

/**
 * Différence: subject - clip.
 * @param {Array<{X: number, Y: number}>} subjectPath
 * @param {Array<Array<{X: number, Y: number}>>} clipPaths
 * @returns {Array<Array<{X: number, Y: number}>>}
 */
function differencePaths(subjectPath, clipPaths) {
  if (!subjectPath || subjectPath.length < 3) return [];
  const validClips = (clipPaths || []).filter((p) => p && p.length >= 3);
  const c = new ClipperLib.Clipper();
  c.AddPath(subjectPath, ClipperLib.PolyType.ptSubject, true);
  validClips.forEach((p) => c.AddPath(p, ClipperLib.PolyType.ptClip, true));
  const solution = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctDifference, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return solution;
}

/**
 * Calcule les safe zones pour tous les pans.
 *
 * @param {{
 *   pans: Array<{ id: string, polygonPx: Array<{x,y}> }>,
 *   obstacles: Array<{ id: string, polygonPx: Array<{x,y}> }>,
 *   marginOuterCm?: number,
 *   cmToPxFn?: (cm: number) => number,
 *   marginPxOverride?: number,
 *   eps?: number,
 *   epsAreaPx2?: number
 * }} opts
 * Chaque pan peut porter marginOuterCm / obstacleMarginCm (px via cmToPxFn) pour inset / expansion obstacles par pan (toiture plate).
 * @returns {{
 *   byPanId: Record<string, { safeZonePolygonsPx: Array<Array<{x,y}>>, marginPxUsed: number, stats: Object }>,
 *   globalUnion?: Array<Array<{x,y}>>,
 *   meta: { marginOuterCm: number, marginPxUsed: number, scaleUsed: number, obstaclesCount: number, pansCount: number }
 * }}
 */
export function computeSafeZones(opts) {
  const pans = opts?.pans || [];
  const obstacles = opts?.obstacles || [];
  const marginOuterCm = Number(opts?.marginOuterCm) || 0;
  const cmToPxFn = typeof opts?.cmToPxFn === "function" ? opts.cmToPxFn : null;
  const marginPxOverride = opts?.marginPxOverride;
  const epsAreaPx2 = Number(opts?.epsAreaPx2) || DEFAULT_EPS_AREA_PX2;
  const simplifyPolygons = opts?.simplifyPolygons === true;

  let marginPx = 0;
  if (Number.isFinite(marginPxOverride) && marginPxOverride >= 0) {
    marginPx = marginPxOverride;
  } else if (cmToPxFn && Number.isFinite(marginOuterCm) && marginOuterCm >= 0) {
    marginPx = cmToPxFn(marginOuterCm);
    if (!Number.isFinite(marginPx) || marginPx < 0) marginPx = 0;
  }

  const byPanId = {};
  const allSafeZonePaths = [];

  for (const pan of pans) {
    const polygonPx = pan?.polygonPx || pan?.polygon || pan?.points;
    if (!Array.isArray(polygonPx) || polygonPx.length < 3) {
      byPanId[pan?.id || "unknown"] = { safeZonePolygonsPx: [], marginPxUsed: marginPx, stats: { skipped: "invalid polygon" } };
      continue;
    }

    const panPath = toClipperPath(polygonPx);
    const closedPan = ensureClosedClipperPath(panPath);
    if (closedPan.length < 3) {
      byPanId[pan.id] = { safeZonePolygonsPx: [], marginPxUsed: marginPx, stats: { skipped: "path too short" } };
      continue;
    }

    let insetMarginPx = marginPx;
    if (cmToPxFn && Number.isFinite(pan.marginOuterCm) && pan.marginOuterCm >= 0) {
      const v = cmToPxFn(pan.marginOuterCm);
      if (Number.isFinite(v) && v >= 0) insetMarginPx = v;
    }

    let obstacleExpandPx = marginPx;
    if (cmToPxFn && Number.isFinite(pan.obstacleMarginCm) && pan.obstacleMarginCm >= 0) {
      const vObs = cmToPxFn(pan.obstacleMarginCm);
      if (Number.isFinite(vObs) && vObs >= 0) obstacleExpandPx = vObs;
    }

    const insetResult = offsetInward(closedPan, insetMarginPx);
    if (!insetResult || insetResult.length === 0) {
      byPanId[pan.id] = { safeZonePolygonsPx: [], marginPxUsed: insetMarginPx, stats: { skipped: "inset empty" } };
      continue;
    }

    const obstaclePaths = [];
    for (const obs of obstacles) {
      const obsPx = obs?.polygonPx || obs?.polygon || obs?.points;
      if (!Array.isArray(obsPx) || obsPx.length < 3) continue;
      const obsPath = toClipperPath(obsPx);
      const closedObs = ensureClosedClipperPath(obsPath);
      if (closedObs.length < 3) continue;
      const expanded = offsetOutward(closedObs, obstacleExpandPx);
      obstaclePaths.push(...expanded);
    }

    const unionObs = unionPaths(obstaclePaths);
    let safeZonePaths = [];
    for (const insetPath of insetResult) {
      const diff = differencePaths(insetPath, unionObs);
      safeZonePaths.push(...diff);
    }

    const filtered = safeZonePaths.filter((path) => {
      const polyPx = fromClipperPath(path);
      const area = polygonAreaAbs(polyPx);
      return area >= epsAreaPx2;
    });

    let safeZonePolygonsPx;
    if (simplifyPolygons && filtered.length > 0) {
      const cleanDistance = Math.round(CLEAN_DISTANCE_SCALE * SCALE);
      const cleaned = ClipperLib.Clipper.CleanPolygons(filtered, cleanDistance);
      safeZonePolygonsPx = cleaned
        .filter((path) => path && path.length >= 3)
        .map((path) => simplifyRDP(fromClipperPath(path), RDP_EPSILON_PX))
        .filter((p) => p && p.length >= 3 && polygonAreaAbs(p) >= epsAreaPx2);
    } else {
      safeZonePolygonsPx = filtered.map((path) => fromClipperPath(path));
    }
    allSafeZonePaths.push(...filtered);

    const totalArea = filtered.reduce(
      (sum, path) => sum + ClipperLib.Clipper.Area(path) / (SCALE * SCALE),
      0
    );
    const insetArea = insetResult.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p) / (SCALE * SCALE), 0);

    byPanId[pan.id] = {
      safeZonePolygonsPx,
      marginPxUsed: insetMarginPx,
      stats: {
        polygonCount: safeZonePolygonsPx.length,
        totalAreaPx2: totalArea,
        insetAreaPx2: insetArea,
      },
    };
  }

  const globalUnion = allSafeZonePaths.length > 0 ? unionPaths(allSafeZonePaths).map((p) => fromClipperPath(p)) : undefined;

  return {
    byPanId,
    globalUnion,
    meta: {
      marginOuterCm,
      marginPxUsed: marginPx,
      scaleUsed: SCALE,
      obstaclesCount: obstacles.length,
      pansCount: pans.length,
    },
  };
}

export { toClipperPath, fromClipperPath, polygonAreaAbs, SCALE };
