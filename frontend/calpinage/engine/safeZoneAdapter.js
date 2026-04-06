/**
 * CP-PV-014 — Adaptateur pour Safe Zone Engine
 * CP-PV-015 — Safe Zone Visual + Panel Validation
 *
 * Mappe les structures calpinage (state.pans, state.obstacles, shadowVolumes, roofExtensions)
 * vers le format attendu par computeSafeZones. Fournit drawSafeZoneOverlay et isPanelInsideSafeZone.
 *
 * @module safeZoneAdapter
 */

import { computeSafeZones, polygonAreaAbs } from "@shared/geometry/safeZoneEngine.js";

const TUBE_SEGMENTS = 24;

/**
 * Convertit un shadow volume en polygonPx (obstacle-like).
 * @param {Object} sv - { id, type, x, y, width, depth, rotation, shape }
 * @param {number} mpp - meters per pixel
 * @returns {{ id: string, polygonPx: Array<{x,y}> }|null}
 */
function shadowVolumeToObstacle(sv, mpp) {
  if (!sv || sv.type !== "shadow_volume") return null;
  const cx = Number(sv.x) || 0;
  const cy = Number(sv.y) || 0;
  const wM = Number(sv.width) || 0.6;
  const dM = Number(sv.depth) || 0.6;
  const wPx = wM / mpp;
  const dPx = dM / mpp;
  const rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  function rotPt(lx, ly) {
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  }
  let polygonPx;
  if (sv.shape === "tube") {
    const r = wPx / 2;
    polygonPx = [];
    for (let i = 0; i < TUBE_SEGMENTS; i++) {
      const a = (i / TUBE_SEGMENTS) * Math.PI * 2;
      polygonPx.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  } else {
    const hw = wPx / 2;
    const hd = dPx / 2;
    polygonPx = [
      rotPt(-hw, -hd),
      rotPt(hw, -hd),
      rotPt(hw, hd),
      rotPt(-hw, hd),
    ];
  }
  if (!polygonPx || polygonPx.length < 3) return null;
  return {
    id: "sv:" + (sv.id != null ? String(sv.id) : "sv"),
    polygonPx: polygonPx.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
  };
}

/**
 * Convertit une roof extension en obstacle (contour.points).
 * @param {Object} rx - { id, contour: { points } }
 * @returns {{ id: string, polygonPx: Array<{x,y}> }|null}
 */
function roofExtensionToObstacle(rx) {
  if (!rx || !rx.contour || !rx.contour.points) return null;
  const pts = rx.contour.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  const polygonPx = pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  const first = polygonPx[0];
  const last = polygonPx[polygonPx.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    polygonPx.push({ x: first.x, y: first.y });
  }
  return {
    id: "rx:" + (rx.id != null ? String(rx.id) : "rx"),
    polygonPx,
  };
}

/** Point-in-polygon (ray casting). */
function pointInPolygon(pt, poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi === yj) continue;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Segment intersection (strict, no endpoint touch). */
function segmentIntersect(a1, a2, b1, b2) {
  const ax = a2.x - a1.x, ay = a2.y - a1.y;
  const bx = b2.x - b1.x, by = b2.y - b1.y;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-10) return false;
  const cx = b1.x - a1.x, cy = b1.y - a1.y;
  const t = (cx * by - cy * bx) / denom;
  const s = (cx * ay - cy * ax) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && s > 1e-9 && s < 1 - 1e-9;
}

/** Centroid of polygon. */
function polygonCentroid(poly) {
  if (!poly || poly.length < 2) return null;
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    cx += poly[i].x;
    cy += poly[i].y;
  }
  return { x: cx / poly.length, y: cy / poly.length };
}

/**
 * Teste si un point est à l'intérieur de la safe zone (multi-polygone avec trous).
 * Les trous sont inférés : polygone dont le centroïde est dans un polygone plus grand.
 */
function isPointInSafeZone(pt, safeZonePolygonsPx) {
  if (!safeZonePolygonsPx || safeZonePolygonsPx.length === 0) return false;
  const byArea = [...safeZonePolygonsPx].sort((a, b) => polygonAreaAbs(b) - polygonAreaAbs(a));
  const outers = [];
  const holes = [];
  for (const poly of byArea) {
    const c = polygonCentroid(poly);
    const insideLarger = outers.some((o) => pointInPolygon(c, o));
    if (insideLarger) holes.push(poly);
    else outers.push(poly);
  }
  const insideAnyOuter = outers.some((o) => pointInPolygon(pt, o));
  const insideAnyHole = holes.some((h) => pointInPolygon(pt, h));
  return insideAnyOuter && !insideAnyHole;
}

/**
 * Pré-calcule les arêtes des polygones safe zone pour validation rapide.
 * @param {Array<Array<{x: number, y: number}>>} safeZonePolygonsPx
 * @returns {Array<{a: {x,y}, b: {x,y}}>}
 */
export function buildSafeZoneEdgesCache(safeZonePolygonsPx) {
  const p = window.__SAFE_ZONE_PROF__;
  const t0 = p ? performance.now() : 0;
  if (!safeZonePolygonsPx || safeZonePolygonsPx.length === 0) return [];
  const edges = [];
  for (const poly of safeZonePolygonsPx) {
    if (!poly || poly.length < 2) continue;
    const m = poly.length;
    for (let j = 0; j < m; j++) {
      edges.push({ a: poly[j], b: poly[(j + 1) % m] });
    }
  }
  if (p) {
    p.buildEdgesCalls++;
    const dt = performance.now() - t0;
    p.buildEdgesTimes.push(dt);
  }
  return edges;
}

/**
 * Vérifie si un panneau est entièrement dans la safe zone.
 * Règles : tous les sommets dedans ET aucune intersection segmentaire avec le bord.
 * Si edgesCache est fourni, évite de recalculer les segments à chaque appel.
 *
 * @param {Array<{x: number, y: number}>} panelPolygonPx
 * @param {Array<Array<{x: number, y: number}>>} safeZonePolygonsPx
 * @param {Array<{a: {x,y}, b: {x,y}}>} [edgesCache] - optionnel, pré-calculé par buildSafeZoneEdgesCache
 * @returns {boolean}
 */
export function isPanelInsideSafeZone(panelPolygonPx, safeZonePolygonsPx, edgesCache) {
  const prof = window.__SAFE_ZONE_PROF__;
  const t0 = prof ? performance.now() : 0;
  if (!panelPolygonPx || panelPolygonPx.length < 3 || !safeZonePolygonsPx || safeZonePolygonsPx.length === 0) return false;
  for (let i = 0; i < panelPolygonPx.length; i++) {
    if (!isPointInSafeZone(panelPolygonPx[i], safeZonePolygonsPx)) return false;
  }
  const n = panelPolygonPx.length;
  const edges = edgesCache && edgesCache.length > 0 ? edgesCache : buildSafeZoneEdgesCache(safeZonePolygonsPx);
  for (let i = 0; i < n; i++) {
    const a1 = panelPolygonPx[i];
    const a2 = panelPolygonPx[(i + 1) % n];
    for (const { a: b1, b: b2 } of edges) {
      if (segmentIntersect(a1, a2, b1, b2)) return false;
    }
  }
  if (prof) {
    prof.isPanelCalls++;
    const dt = performance.now() - t0;
    prof.isPanelTimes.push(dt);
  }
  return true;
}

/**
 * Construit un Path2D pour l'overlay safe zone (réutilisable pour dessin rapide).
 * @param {Array<Array<{x: number, y: number}>>} polygonsPx
 * @param {function({x: number, y: number}): {x: number, y: number}} imageToScreen
 * @returns {Path2D|null}
 */
export function buildSafeZonePath2D(polygonsPx, imageToScreen) {
  if (!polygonsPx || polygonsPx.length === 0 || typeof imageToScreen !== "function") return null;
  const path = new Path2D();
  for (const poly of polygonsPx) {
    if (!poly || poly.length < 2) continue;
    const sp0 = imageToScreen(poly[0]);
    path.moveTo(sp0.x, sp0.y);
    for (let i = 1; i < poly.length; i++) {
      const sp = imageToScreen(poly[i]);
      path.lineTo(sp.x, sp.y);
    }
    path.closePath();
  }
  return path;
}

/**
 * Dessine l'overlay safe zone (contours uniquement, stroke rouge).
 * Si path2dCache est fourni, utilise ctx.stroke(path2d) pour un dessin rapide.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<{x: number, y: number}>>} polygonsPx
 * @param {function({x: number, y: number}): {x: number, y: number}} imageToScreen
 * @param {Path2D|null} [path2dCache] - optionnel, pré-calculé par buildSafeZonePath2D
 */
export function drawSafeZoneOverlay(ctx, polygonsPx, imageToScreen, path2dCache) {
  const prof = window.__SAFE_ZONE_PROF__;
  const t0 = prof ? performance.now() : 0;
  if (!ctx || !polygonsPx || polygonsPx.length === 0 || typeof imageToScreen !== "function") return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,0,0,0.9)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  if (path2dCache) {
    ctx.stroke(path2dCache);
  } else {
    ctx.beginPath();
    for (const poly of polygonsPx) {
      if (!poly || poly.length < 2) continue;
      const sp0 = imageToScreen(poly[0]);
      ctx.moveTo(sp0.x, sp0.y);
      for (let i = 1; i < poly.length; i++) {
        const sp = imageToScreen(poly[i]);
        ctx.lineTo(sp.x, sp.y);
      }
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
  if (prof) {
    prof.drawOverlayCalls++;
    const dt = performance.now() - t0;
    prof.drawOverlayTimes.push(dt);
  }
}

/**
 * Extrait polygonPx d'un pan (accepte polygon, polygonPx, points).
 * @param {Object} pan
 * @returns {Array<{x: number, y: number}>|null}
 */
function getPanPolygonPx(pan) {
  const pts = pan?.polygonPx ?? pan?.polygon ?? pan?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
}

/**
 * Extrait polygonPx d'un obstacle (accepte polygonPx, polygon, points).
 * @param {Object} obstacle
 * @returns {Array<{x: number, y: number}>|null}
 */
function getObstaclePolygonPx(obstacle) {
  const pts = obstacle?.polygonPx ?? obstacle?.polygon ?? obstacle?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
}

/**
 * Adapte state calpinage et appelle computeSafeZones.
 * Fusionne obstacles + shadowVolumes (convertis) + roofExtensions (contours).
 *
 * @param {{
 *   pans: Array<Object>,
 *   obstacles?: Array<Object>,
 *   shadowVolumes?: Array<Object>,
 *   roofExtensions?: Array<Object>,
 *   marginOuterCm?: number,
 *   metersPerPixel?: number,
 *   marginPxOverride?: number
 * }} opts
 * @returns {ReturnType<typeof computeSafeZones>}
 */
export function computeSafeZonesFromCalpinageState(opts) {
  const prof = window.__SAFE_ZONE_PROF__;
  if (prof) prof.computeCalls++;
  const pans = opts?.pans || [];
  const obstacles = opts?.obstacles || [];
  const shadowVolumes = opts?.shadowVolumes || [];
  const roofExtensions = opts?.roofExtensions || [];
  const marginOuterCm = opts?.marginOuterCm ?? 0;
  const metersPerPixel = opts?.metersPerPixel;
  const marginPxOverride = opts?.marginPxOverride;

  const pansForEngine = pans
    .map((p) => {
      const polygonPx = getPanPolygonPx(p);
      if (!polygonPx) return null;
      const base = { id: p.id || "unknown", polygonPx };
      if (p.roofType === "FLAT" && p.flatRoofConfig && typeof p.flatRoofConfig === "object") {
        const fc = p.flatRoofConfig;
        if (typeof fc.setbackRoofEdgeCm === "number" && Number.isFinite(fc.setbackRoofEdgeCm)) {
          base.marginOuterCm = Math.max(0, fc.setbackRoofEdgeCm);
        }
        if (typeof fc.setbackObstacleCm === "number" && Number.isFinite(fc.setbackObstacleCm)) {
          base.obstacleMarginCm = Math.max(0, fc.setbackObstacleCm);
        }
      }
      return base;
    })
    .filter(Boolean);

  const obstaclesFromState = obstacles
    .map((o) => {
      const polygonPx = getObstaclePolygonPx(o);
      if (!polygonPx) return null;
      return { id: o.id || "unknown", polygonPx };
    })
    .filter(Boolean);

  const mpp = typeof metersPerPixel === "number" && metersPerPixel > 0 ? metersPerPixel : 1;
  const svObstacles = shadowVolumes
    .map((sv) => shadowVolumeToObstacle(sv, mpp))
    .filter(Boolean);
  const rxObstacles = roofExtensions
    .map((rx) => roofExtensionToObstacle(rx))
    .filter(Boolean);

  const obstaclesForEngine = [...obstaclesFromState, ...svObstacles, ...rxObstacles];

  const cmToPxFn = mpp > 0 ? (cm) => (cm / 100) / mpp : null;

  return computeSafeZones({
    pans: pansForEngine,
    obstacles: obstaclesForEngine,
    marginOuterCm,
    cmToPxFn,
    marginPxOverride,
    simplifyPolygons: true,
  });
}

export { computeSafeZones };
