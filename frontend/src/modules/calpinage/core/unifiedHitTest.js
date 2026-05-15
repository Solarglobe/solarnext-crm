/**
 * Hit-test unifié pour le calpinage.
 * Ordre strict : roofExtensions → shadowVolumes → obstacles → ridge → trait → mesure → contour.
 * Tout en image-space sauf handles (si nécessaires).
 * Parcours des tableaux de la fin vers le début.
 *
 * Primitives géométriques 2D migrées vers geometryCore2d.js :
 *   pointInPolygon2d, distPointToSegment2d, pointNearPolygon2d.
 * Conservé local : distSegmentScreen (dépend de la transformation screen/image — pas une primitive pure).
 */
import {
  pointInPolygon2d,
  distPointToSegment2d,
  pointNearPolygon2d,
} from "./geometryCore2d.js";

const VERTEX_HIT_RADIUS_PX = 8;
const ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX = 14;
const ROOF_EXTENSION_EDGE_HIT_RADIUS_PX = 6;
const HIT_TOL_OBSTACLE_PX = 8;
const SEGMENT_INSERT_HIT_RADIUS_PX = 6;

// Alias locaux pour compatibilité avec les appels internes existants
const pointInPolygonImage = pointInPolygon2d;
const distToSegmentImage = distPointToSegment2d;
const pointNearPolygonImage = pointNearPolygon2d;

function distSegmentScreen(screenPt, imgA, imgB, imageToScreen) {
  const a = imageToScreen(imgA);
  const b = imageToScreen(imgB);
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
  const px = screenPt.x, py = screenPt.y;
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  let t = (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-10);
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx, qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

/**
 * @param {Object} params
 * @param {{ x: number, y: number }} params.screenPt - Point en coordonnées écran
 * @param {Function} params.screenToImage - (screenPt) => { x, y } image
 * @param {Function} params.imageToScreen - (imgPt) => { x, y } écran
 * @param {Array} params.obstacles
 * @param {Array} params.roofExtensions
 * @param {Array} params.shadowVolumes
 * @param {Object} params.context - { ridges, traits, measures, contours, resolveRidgePoint, metersPerPixel?, vpScale? }
 * @returns {{ type: string, index: number, subType?: string, data?: any } | { type: null }}
 */
export function unifiedHitTest({
  screenPt,
  screenToImage,
  imageToScreen,
  obstacles,
  roofExtensions,
  shadowVolumes,
  context,
}) {
  const imgPt = screenToImage(screenPt);
  const ridges = (context && context.ridges) || [];
  const traits = (context && context.traits) || [];
  const measures = (context && context.measures) || (context && context.mesures) || [];
  const contours = (context && context.contours) || [];
  const resolveRidgePoint = (context && context.resolveRidgePoint) || ((p) => p);
  const metersPerPixel = (context && context.metersPerPixel) || 1;
  const vpScale = (context && context.vpScale) != null ? context.vpScale : 1;
  const selectedRoofExtensionIndex = context && context.selectedRoofExtensionIndex;
  const tolImg = Math.max(0.5, VERTEX_HIT_RADIUS_PX / vpScale);

  // Helper: distance écran pour tests vertex/segment (tolérance en px)
  function hitVertexScreen(ptScreen, imgPtRef, radiusPx = VERTEX_HIT_RADIUS_PX) {
    const s = imageToScreen(imgPtRef);
    return Math.hypot(ptScreen.x - s.x, ptScreen.y - s.y) <= radiusPx;
  }
  function hitSegmentScreen(ptScreen, imgA, imgB, radiusPx = VERTEX_HIT_RADIUS_PX) {
    return distSegmentScreen(ptScreen, imgA, imgB, imageToScreen) <= radiusPx;
  }

  // 1. roofExtensions (fin → début)
  const rxList = roofExtensions || [];
  for (let ri = rxList.length - 1; ri >= 0; ri--) {
    const rx = rxList[ri];
    if (!rx) continue;
    const pts = (rx.contour && rx.contour.points) ? rx.contour.points : [];

    // Priorité 0 : edge midpoint handles (redimensionnement par arête)
    if (selectedRoofExtensionIndex === ri && pts.length === 4) {
      for (let ei = 0; ei < 4; ei++) {
        const eiA = pts[ei], eiB = pts[(ei + 1) % 4];
        const emS = { x: (imageToScreen(eiA).x + imageToScreen(eiB).x) / 2,
                      y: (imageToScreen(eiA).y + imageToScreen(eiB).y) / 2 };
        if (Math.hypot(screenPt.x - emS.x, screenPt.y - emS.y) <= 11) {
          return { type: "roofExtension", index: ri, subType: "edge-mid", data: { edgeIndex: ei, pts: pts } };
        }
      }
    }
    // Priorité 1 : vertices de contour
    for (let i = 0; i < pts.length; i++) {
      if (hitVertexScreen(screenPt, pts[i], ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) {
        return { type: "roofExtension", index: ri, subType: "vertex", data: { vertexIndex: i, pointRef: pts[i] } };
      }
    }
    // Priorité 2 : vertices ridge/hip — testés AVANT corps, qu'il y ait dormerModel ou non
    if (rx.ridge && rx.ridge.a && rx.ridge.b) {
      if (hitVertexScreen(screenPt, rx.ridge.a, ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) return { type: "roofExtension", index: ri, subType: "ridge-a", data: { pointRef: rx.ridge.a } };
      if (hitVertexScreen(screenPt, rx.ridge.b, ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) return { type: "roofExtension", index: ri, subType: "ridge-b", data: { pointRef: rx.ridge.b } };
    }
    if (rx.hips) {
      if (rx.hips.left && rx.hips.left.a && hitVertexScreen(screenPt, rx.hips.left.a, ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) return { type: "roofExtension", index: ri, subType: "hip-left-a", data: { pointRef: rx.hips.left.a } };
      if (rx.hips.left && rx.hips.left.b && hitVertexScreen(screenPt, rx.hips.left.b, ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) return { type: "roofExtension", index: ri, subType: "hip-left-b", data: { pointRef: rx.hips.left.b } };
      if (rx.hips.right && rx.hips.right.a && hitVertexScreen(screenPt, rx.hips.right.a, ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) return { type: "roofExtension", index: ri, subType: "hip-right-a", data: { pointRef: rx.hips.right.a } };
      if (rx.hips.right && rx.hips.right.b && hitVertexScreen(screenPt, rx.hips.right.b, ROOF_EXTENSION_VERTEX_HIT_RADIUS_PX)) return { type: "roofExtension", index: ri, subType: "hip-right-b", data: { pointRef: rx.hips.right.b } };
    }
    // Priorité 3 : arêtes de contour (insertion de point)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (hitSegmentScreen(screenPt, a, b, ROOF_EXTENSION_EDGE_HIT_RADIUS_PX)) {
        return { type: "roofExtension", index: ri, subType: "contour-edge", data: { segmentIndex: i } };
      }
    }
    // Priorité 4 : corps (intérieur du polygone)
    if (pts.length >= 3 && pointInPolygonImage(imgPt, pts)) {
      return { type: "roofExtension", index: ri, subType: "body", data: { area: "contour" } };
    }
    // Priorité 5 : segments ridge/hip (clic sur la ligne, pas sur le vertex)
    if (rx.ridge && rx.ridge.a && rx.ridge.b && hitSegmentScreen(screenPt, rx.ridge.a, rx.ridge.b, ROOF_EXTENSION_EDGE_HIT_RADIUS_PX)) {
      return { type: "roofExtension", index: ri, subType: "body", data: { area: "ridge" } };
    }
    if (rx.hips && rx.hips.left && rx.hips.left.a && rx.hips.left.b && hitSegmentScreen(screenPt, rx.hips.left.a, rx.hips.left.b, ROOF_EXTENSION_EDGE_HIT_RADIUS_PX)) {
      return { type: "roofExtension", index: ri, subType: "body", data: { area: "hip-left" } };
    }
    if (rx.hips && rx.hips.right && rx.hips.right.a && rx.hips.right.b && hitSegmentScreen(screenPt, rx.hips.right.a, rx.hips.right.b, ROOF_EXTENSION_EDGE_HIT_RADIUS_PX)) {
      return { type: "roofExtension", index: ri, subType: "body", data: { area: "hip-right" } };
    }
  }

  // 2. shadowVolumes (fin → début)
  const svList = shadowVolumes || [];
  for (let i = svList.length - 1; i >= 0; i--) {
    const sv = svList[i];
    if (!sv || sv.type !== "shadow_volume") continue;
    const wPx = (sv.width || 0.6) / metersPerPixel;
    const dPx = (sv.depth || 0.6) / metersPerPixel;
    const rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
    const rotRad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
    const cx = sv.x, cy = sv.y;
    function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }
    if (sv.shape === "tube") {
      const r = wPx / 2;
      const d = Math.hypot(imgPt.x - cx, imgPt.y - cy);
      if (d <= r) return { type: "shadowVolume", index: i, subType: "body", data: { volume: sv } };
    } else {
      const hw = wPx / 2, hd = dPx / 2;
      const pts = [rotPt(-hw, -hd), rotPt(hw, -hd), rotPt(hw, hd), rotPt(-hw, hd)];
      if (pointInPolygonImage(imgPt, pts)) return { type: "shadowVolume", index: i, subType: "body", data: { volume: sv } };
    }
  }

  // 3. obstacles (fin → début) — par obstacle : sommets/arêtes polygone libre puis corps (z-order)
  const obsList = obstacles || [];

  /** Polygone éditable par points (ex. zone libre) : pas cercle/rect pilotés par shapeMeta. */
  function hitPolygonObstacleVertexOrSegment(o, obstacleIndex) {
    if (!o || !o.points || !Array.isArray(o.points) || o.points.length < 2) return null;
    const m = o.shapeMeta;
    if (m && (m.originalType === "circle" || m.originalType === "rect")) return null;
    const pts = o.points;
    const n = pts.length;
    if (n >= 3) {
      for (let vi = 0; vi < n; vi++) {
        if (hitVertexScreen(screenPt, pts[vi])) {
          return { type: "obstacle-vertex", obstacleIndex, vertexIndex: vi };
        }
      }
      for (let si = 0; si < n; si++) {
        const a = pts[si];
        const b = pts[(si + 1) % n];
        const dist = distSegmentScreen(screenPt, a, b, imageToScreen);
        if (dist < SEGMENT_INSERT_HIT_RADIUS_PX) {
          return { type: "obstacle-segment", obstacleIndex, segmentIndex: si };
        }
      }
    } else if (n === 2) {
      for (let vi = 0; vi < n; vi++) {
        if (hitVertexScreen(screenPt, pts[vi])) {
          return { type: "obstacle-vertex", obstacleIndex, vertexIndex: vi };
        }
      }
      const dist = distSegmentScreen(screenPt, pts[0], pts[1], imageToScreen);
      if (dist < SEGMENT_INSERT_HIT_RADIUS_PX) {
        return { type: "obstacle-segment", obstacleIndex, segmentIndex: 0 };
      }
    }
    return null;
  }

  for (let i = obsList.length - 1; i >= 0; i--) {
    const o = obsList[i];
    if (!o) continue;
    const polyManip = hitPolygonObstacleVertexOrSegment(o, i);
    if (polyManip) return polyManip;
    let hit = false;
    let subType = "body";
    if (o.points && Array.isArray(o.points) && o.points.length >= 3) {
      hit = pointInPolygonImage(imgPt, o.points) || pointNearPolygonImage(imgPt, o.points, tolImg);
    } else if (o.shapeMeta) {
      const m = o.shapeMeta;
      if (m.originalType === "circle" && typeof m.radius === "number") {
        const d = Math.hypot(imgPt.x - m.centerX, imgPt.y - m.centerY);
        hit = d <= m.radius + tolImg;
      } else if (m.originalType === "rect" && typeof m.width === "number" && typeof m.height === "number") {
        const hw = m.width / 2, hh = m.height / 2;
        const angle = typeof m.angle === "number" ? m.angle : 0;
        const c = Math.cos(angle), s = Math.sin(angle);
        const corners = [
          { x: m.centerX - hw * c + hh * s, y: m.centerY - hw * s - hh * c },
          { x: m.centerX + hw * c + hh * s, y: m.centerY + hw * s - hh * c },
          { x: m.centerX + hw * c - hh * s, y: m.centerY + hw * s + hh * c },
          { x: m.centerX - hw * c - hh * s, y: m.centerY - hw * s + hh * c },
        ];
        hit = pointInPolygonImage(imgPt, corners) || pointNearPolygonImage(imgPt, corners, tolImg);
      }
    } else if (o.type === "circle" && typeof o.r === "number") {
      const d = Math.hypot(imgPt.x - o.x, imgPt.y - o.y);
      hit = d <= o.r + tolImg;
    } else if (o.type === "rect" && typeof o.w === "number" && typeof o.h === "number") {
      const hw = o.w / 2, hh = o.h / 2;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const angle = typeof o.angle === "number" ? o.angle : 0;
      const c = Math.cos(angle), s = Math.sin(angle);
      const corners = [
        { x: cx - hw * c + hh * s, y: cy - hw * s - hh * c },
        { x: cx + hw * c + hh * s, y: cy + hw * s - hh * c },
        { x: cx + hw * c - hh * s, y: cy + hw * s + hh * c },
        { x: cx - hw * c - hh * s, y: cy - hw * s + hh * c },
      ];
      hit = pointInPolygonImage(imgPt, corners) || pointNearPolygonImage(imgPt, corners, tolImg);
    }
    if (hit) return { type: "obstacle", index: i, subType, data: { obstacle: o } };
  }

  // 4. ridge (fin → début)
  const ridgeArr = ridges || [];
  for (let i = ridgeArr.length - 1; i >= 0; i--) {
    const r = ridgeArr[i];
    if (!r || !r.a || !r.b || r.roofRole === "chienAssis") continue;
    const ra = resolveRidgePoint(r.a);
    const rb = resolveRidgePoint(r.b);
    if (!ra || !rb) continue;
    if (hitVertexScreen(screenPt, ra)) return { type: "ridge", index: i, subType: "vertex", data: { pointIndex: 0 } };
    if (hitVertexScreen(screenPt, rb)) return { type: "ridge", index: i, subType: "vertex", data: { pointIndex: 1 } };
    if (hitSegmentScreen(screenPt, ra, rb)) return { type: "ridge", index: i, subType: "segment", data: {} };
  }

  // 5. trait (fin → début)
  const traitArr = traits || [];
  for (let i = traitArr.length - 1; i >= 0; i--) {
    const t = traitArr[i];
    if (!t || !t.a || !t.b || t.roofRole === "chienAssis") continue;
    if (hitVertexScreen(screenPt, t.a)) return { type: "trait", index: i, subType: "vertex", data: { pointIndex: 0 } };
    if (hitVertexScreen(screenPt, t.b)) return { type: "trait", index: i, subType: "vertex", data: { pointIndex: 1 } };
    if (hitSegmentScreen(screenPt, t.a, t.b)) return { type: "trait", index: i, subType: "segment", data: {} };
  }

  // 6. mesure (fin → début)
  const mesureArr = measures || [];
  for (let i = mesureArr.length - 1; i >= 0; i--) {
    const m = mesureArr[i];
    if (!m || !m.a || !m.b) continue;
    if (hitSegmentScreen(screenPt, m.a, m.b)) return { type: "mesure", index: i, subType: "segment", data: {} };
  }

  // 7. contour (fin → début)
  const contourArr = contours || [];
  for (let ci = contourArr.length - 1; ci >= 0; ci--) {
    const c = contourArr[ci];
    if (!c || !c.points || c.points.length < 2 || c.roofRole === "chienAssis") continue;
    const pts = c.points;
    for (let i = 0; i < pts.length; i++) {
      if (hitVertexScreen(screenPt, pts[i])) return { type: "contour", index: ci, subType: "vertex", data: { vertexIndex: i } };
    }
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (hitSegmentScreen(screenPt, pts[i], pts[j])) return { type: "contour", index: ci, subType: "segment", data: { segmentIndex: i } };
    }
  }

  return { type: null, index: -1 };
}
