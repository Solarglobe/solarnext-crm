/**
 * Bundle IIFE pour unifiedHitTest — utilisé par calpinage.html.
 * Source: frontend/src/modules/calpinage/core/unifiedHitTest.js
 * Expose window.unifiedHitTest
 */
(function (global) {
  "use strict";

  var VERTEX_HIT_RADIUS_PX = 8;
  var HIT_TOL_OBSTACLE_PX = 8;
  var SEGMENT_INSERT_HIT_RADIUS_PX = 6;

  function pointInPolygonImage(pt, poly) {
    if (!poly || poly.length < 3) return false;
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

  function distToSegmentImage(pt, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
    var t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (len * len);
    t = Math.max(0, Math.min(1, t));
    var q = { x: a.x + t * dx, y: a.y + t * dy };
    return Math.hypot(pt.x - q.x, pt.y - q.y);
  }

  function distSegmentScreen(screenPt, imgA, imgB, imageToScreen) {
    var a = imageToScreen(imgA);
    var b = imageToScreen(imgB);
    var ax = a.x, ay = a.y, bx = b.x, by = b.y;
    var px = screenPt.x, py = screenPt.y;
    var abx = bx - ax, aby = by - ay;
    var apx = px - ax, apy = py - ay;
    var t = (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-10);
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * abx, qy = ay + t * aby;
    return Math.hypot(px - qx, py - qy);
  }

  function pointNearPolygonImage(pt, poly, tol) {
    if (!poly || poly.length < 2) return false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (distToSegmentImage(pt, poly[j], poly[i]) <= tol) return true;
    }
    return false;
  }

  function unifiedHitTest(params) {
    var screenPt = params.screenPt;
    var screenToImage = params.screenToImage;
    var imageToScreen = params.imageToScreen;
    var obstacles = params.obstacles;
    var roofExtensions = params.roofExtensions || [];
    var shadowVolumes = params.shadowVolumes || [];
    var context = params.context || {};
    var ridges = context.ridges || [];
    var traits = context.traits || [];
    var measures = context.measures || context.mesures || [];
    var contours = context.contours || [];
    var resolveRidgePoint = context.resolveRidgePoint || (function (p) { return p; });
    var metersPerPixel = context.metersPerPixel || 1;
    var vpScale = context.vpScale != null ? context.vpScale : 1;
    var tolImg = Math.max(0.5, VERTEX_HIT_RADIUS_PX / vpScale);
    var imgPt = screenToImage(screenPt);

    function hitVertexScreen(ptScreen, imgPtRef) {
      var s = imageToScreen(imgPtRef);
      return Math.hypot(ptScreen.x - s.x, ptScreen.y - s.y) <= VERTEX_HIT_RADIUS_PX;
    }
    function hitSegmentScreen(ptScreen, imgA, imgB) {
      return distSegmentScreen(ptScreen, imgA, imgB, imageToScreen) <= VERTEX_HIT_RADIUS_PX;
    }

    var rxList = roofExtensions;
    for (var ri = rxList.length - 1; ri >= 0; ri--) {
      var rx = rxList[ri];
      if (!rx) continue;
      var pts = (rx.contour && rx.contour.points) ? rx.contour.points : [];
      for (var i = 0; i < pts.length; i++) {
        if (hitVertexScreen(screenPt, pts[i])) {
          return { type: "roofExtension", index: ri, subType: "vertex", data: { vertexIndex: i, pointRef: pts[i] } };
        }
      }
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        if (hitSegmentScreen(screenPt, a, b)) {
          return { type: "roofExtension", index: ri, subType: "contour-edge", data: { segmentIndex: i } };
        }
      }
      if (rx.ridge && rx.ridge.a && rx.ridge.b) {
        if (hitVertexScreen(screenPt, rx.ridge.a)) return { type: "roofExtension", index: ri, subType: "ridge-a", data: { pointRef: rx.ridge.a } };
        if (hitVertexScreen(screenPt, rx.ridge.b)) return { type: "roofExtension", index: ri, subType: "ridge-b", data: { pointRef: rx.ridge.b } };
      }
      if (rx.hips) {
        if (rx.hips.left && rx.hips.left.a && hitVertexScreen(screenPt, rx.hips.left.a)) return { type: "roofExtension", index: ri, subType: "hip-left-a", data: { pointRef: rx.hips.left.a } };
        if (rx.hips.left && rx.hips.left.b && hitVertexScreen(screenPt, rx.hips.left.b)) return { type: "roofExtension", index: ri, subType: "hip-left-b", data: { pointRef: rx.hips.left.b } };
        if (rx.hips.right && rx.hips.right.a && hitVertexScreen(screenPt, rx.hips.right.a)) return { type: "roofExtension", index: ri, subType: "hip-right-a", data: { pointRef: rx.hips.right.a } };
        if (rx.hips.right && rx.hips.right.b && hitVertexScreen(screenPt, rx.hips.right.b)) return { type: "roofExtension", index: ri, subType: "hip-right-b", data: { pointRef: rx.hips.right.b } };
      }
      if (pts.length >= 3 && pointInPolygonImage(imgPt, pts)) {
        return { type: "roofExtension", index: ri, subType: "body", data: { area: "contour" } };
      }
      if (rx.ridge && rx.ridge.a && rx.ridge.b && hitSegmentScreen(screenPt, rx.ridge.a, rx.ridge.b)) {
        return { type: "roofExtension", index: ri, subType: "body", data: { area: "ridge" } };
      }
      if (rx.hips && rx.hips.left && rx.hips.left.a && rx.hips.left.b && hitSegmentScreen(screenPt, rx.hips.left.a, rx.hips.left.b)) {
        return { type: "roofExtension", index: ri, subType: "body", data: { area: "hip-left" } };
      }
      if (rx.hips && rx.hips.right && rx.hips.right.a && rx.hips.right.b && hitSegmentScreen(screenPt, rx.hips.right.a, rx.hips.right.b)) {
        return { type: "roofExtension", index: ri, subType: "body", data: { area: "hip-right" } };
      }
    }

    var svList = shadowVolumes || [];
    for (var i = svList.length - 1; i >= 0; i--) {
      var sv = svList[i];
      if (!sv || sv.type !== "shadow_volume") continue;
      var wPx = (sv.width || 0.6) / metersPerPixel;
      var dPx = (sv.depth || 0.6) / metersPerPixel;
      var rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
      var rotRad = (rotDeg * Math.PI) / 180;
      var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
      var cx = sv.x, cy = sv.y;
      function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }
      if (sv.shape === "tube") {
        var r = wPx / 2;
        var d = Math.hypot(imgPt.x - cx, imgPt.y - cy);
        if (d <= r) return { type: "shadowVolume", index: i, subType: "body", data: { volume: sv } };
      } else {
        var hw = wPx / 2, hd = dPx / 2;
        var pts = [rotPt(-hw, -hd), rotPt(hw, -hd), rotPt(hw, hd), rotPt(-hw, hd)];
        if (pointInPolygonImage(imgPt, pts)) return { type: "shadowVolume", index: i, subType: "body", data: { volume: sv } };
      }
    }

    var obsList = obstacles || [];

    function hitPolygonObstacleVertexOrSegment(o, obstacleIndex) {
      if (!o || !o.points || !Array.isArray(o.points) || o.points.length < 2) return null;
      var m = o.shapeMeta;
      if (m && (m.originalType === "circle" || m.originalType === "rect")) return null;
      var pts = o.points;
      var n = pts.length;
      var vi, si, dist;
      if (n >= 3) {
        for (vi = 0; vi < n; vi++) {
          if (hitVertexScreen(screenPt, pts[vi])) {
            return { type: "obstacle-vertex", obstacleIndex: obstacleIndex, vertexIndex: vi };
          }
        }
        for (si = 0; si < n; si++) {
          dist = distSegmentScreen(screenPt, pts[si], pts[(si + 1) % n], imageToScreen);
          if (dist < SEGMENT_INSERT_HIT_RADIUS_PX) {
            return { type: "obstacle-segment", obstacleIndex: obstacleIndex, segmentIndex: si };
          }
        }
      } else if (n === 2) {
        for (vi = 0; vi < n; vi++) {
          if (hitVertexScreen(screenPt, pts[vi])) {
            return { type: "obstacle-vertex", obstacleIndex: obstacleIndex, vertexIndex: vi };
          }
        }
        dist = distSegmentScreen(screenPt, pts[0], pts[1], imageToScreen);
        if (dist < SEGMENT_INSERT_HIT_RADIUS_PX) {
          return { type: "obstacle-segment", obstacleIndex: obstacleIndex, segmentIndex: 0 };
        }
      }
      return null;
    }

    for (var i = obsList.length - 1; i >= 0; i--) {
      var o = obsList[i];
      if (!o) continue;
      var polyManip = hitPolygonObstacleVertexOrSegment(o, i);
      if (polyManip) return polyManip;
      var hit = false;
      var subType = "body";
      if (o.points && Array.isArray(o.points) && o.points.length >= 3) {
        hit = pointInPolygonImage(imgPt, o.points) || pointNearPolygonImage(imgPt, o.points, tolImg);
      } else if (o.shapeMeta) {
        var m = o.shapeMeta;
        if (m.originalType === "circle" && typeof m.radius === "number") {
          var d = Math.hypot(imgPt.x - m.centerX, imgPt.y - m.centerY);
          hit = d <= m.radius + tolImg;
        } else if (m.originalType === "rect" && typeof m.width === "number" && typeof m.height === "number") {
          var hw = m.width / 2, hh = m.height / 2;
          var angle = typeof m.angle === "number" ? m.angle : 0;
          var c = Math.cos(angle), s = Math.sin(angle);
          var corners = [
            { x: m.centerX - hw * c + hh * s, y: m.centerY - hw * s - hh * c },
            { x: m.centerX + hw * c + hh * s, y: m.centerY + hw * s - hh * c },
            { x: m.centerX + hw * c - hh * s, y: m.centerY + hw * s + hh * c },
            { x: m.centerX - hw * c - hh * s, y: m.centerY - hw * s + hh * c },
          ];
          hit = pointInPolygonImage(imgPt, corners) || pointNearPolygonImage(imgPt, corners, tolImg);
        }
      } else if (o.type === "circle" && typeof o.r === "number") {
        var d = Math.hypot(imgPt.x - o.x, imgPt.y - o.y);
        hit = d <= o.r + tolImg;
      } else if (o.type === "rect" && typeof o.w === "number" && typeof o.h === "number") {
        var hw = o.w / 2, hh = o.h / 2;
        var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        var angle = typeof o.angle === "number" ? o.angle : 0;
        var c = Math.cos(angle), s = Math.sin(angle);
        var corners = [
          { x: cx - hw * c + hh * s, y: cy - hw * s - hh * c },
          { x: cx + hw * c + hh * s, y: cy + hw * s - hh * c },
          { x: cx + hw * c - hh * s, y: cy + hw * s + hh * c },
          { x: cx - hw * c - hh * s, y: cy - hw * s + hh * c },
        ];
        hit = pointInPolygonImage(imgPt, corners) || pointNearPolygonImage(imgPt, corners, tolImg);
      }
      if (hit) return { type: "obstacle", index: i, subType: subType, data: { obstacle: o } };
    }

    var ridgeArr = ridges || [];
    for (var i = ridgeArr.length - 1; i >= 0; i--) {
      var r = ridgeArr[i];
      if (!r || !r.a || !r.b || r.roofRole === "chienAssis") continue;
      var ra = resolveRidgePoint(r.a);
      var rb = resolveRidgePoint(r.b);
      if (!ra || !rb) continue;
      if (hitVertexScreen(screenPt, ra)) return { type: "ridge", index: i, subType: "vertex", data: { pointIndex: 0 } };
      if (hitVertexScreen(screenPt, rb)) return { type: "ridge", index: i, subType: "vertex", data: { pointIndex: 1 } };
      if (hitSegmentScreen(screenPt, ra, rb)) return { type: "ridge", index: i, subType: "segment", data: {} };
    }

    var traitArr = traits || [];
    for (var i = traitArr.length - 1; i >= 0; i--) {
      var t = traitArr[i];
      if (!t || !t.a || !t.b || t.roofRole === "chienAssis") continue;
      if (hitVertexScreen(screenPt, t.a)) return { type: "trait", index: i, subType: "vertex", data: { pointIndex: 0 } };
      if (hitVertexScreen(screenPt, t.b)) return { type: "trait", index: i, subType: "vertex", data: { pointIndex: 1 } };
      if (hitSegmentScreen(screenPt, t.a, t.b)) return { type: "trait", index: i, subType: "segment", data: {} };
    }

    var mesureArr = measures || [];
    for (var i = mesureArr.length - 1; i >= 0; i--) {
      var m = mesureArr[i];
      if (!m || !m.a || !m.b) continue;
      if (hitSegmentScreen(screenPt, m.a, m.b)) return { type: "mesure", index: i, subType: "segment", data: {} };
    }

    var contourArr = contours || [];
    for (var ci = contourArr.length - 1; ci >= 0; ci--) {
      var c = contourArr[ci];
      if (!c || !c.points || c.points.length < 2 || c.roofRole === "chienAssis") continue;
      var pts = c.points;
      for (var i = 0; i < pts.length; i++) {
        if (hitVertexScreen(screenPt, pts[i])) return { type: "contour", index: ci, subType: "vertex", data: { vertexIndex: i } };
      }
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        if (hitSegmentScreen(screenPt, pts[i], pts[j])) return { type: "contour", index: ci, subType: "segment", data: { segmentIndex: i } };
      }
    }

    return { type: null, index: -1 };
  }

  global.unifiedHitTest = unifiedHitTest;
})(typeof window !== "undefined" ? window : this);
