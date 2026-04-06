/**
 * Moteur de pose PV — Génération des emplacements fantômes (Phase 3).
 *
 * Produit UNIQUEMENT des emplacements 100 % valides. Aucun affichage, aucun
 * fallback, aucune tolérance implicite. Référence unique : computeProjectedPanelRect().
 *
 * RÈGLE MÉTIER : Si un panneau ne peut pas être posé à un endroit,
 * cet emplacement N'EXISTE PAS visuellement.
 */
(function (global) {
  "use strict";

  function pointInPolygon(pt, poly) {
    if (!poly || poly.length < 3) return false;
    var n = poly.length;
    var inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[i].x, yi = poly[i].y;
      var xj = poly[j].x, yj = poly[j].y;
      if (yi === yj) continue;
      if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distPointToSegment(px, py, ax, ay, bx, by) {
    var abx = bx - ax, aby = by - ay;
    var apx = px - ax, apy = py - ay;
    var denom = abx * abx + aby * aby + 1e-20;
    var t = (apx * abx + apy * aby) / denom;
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * abx, qy = ay + t * aby;
    return Math.hypot(px - qx, py - qy);
  }

  function distPointToPolygon(px, py, polygon) {
    if (!polygon || polygon.length < 2) return Infinity;
    var d = Infinity;
    for (var i = 0, n = polygon.length; i < n; i++) {
      var j = (i + 1) % n;
      var segD = distPointToSegment(px, py, polygon[i].x, polygon[i].y, polygon[j].x, polygon[j].y);
      if (segD < d) d = segD;
    }
    return d;
  }

  /** Distance minimale des sommets d'un polygone au bord d'un autre (polygone = liste d'arêtes). */
  function minDistPointsToPolygon(points, polygon) {
    if (!points || points.length === 0 || !polygon || polygon.length < 2) return Infinity;
    var d = Infinity;
    for (var i = 0; i < points.length; i++) {
      var pd = distPointToPolygon(points[i].x, points[i].y, polygon);
      if (pd < d) d = pd;
    }
    return d;
  }

  /** Intersection de deux segments [a1,a2] et [b1,b2]. Retourne point d'intersection ou null. */
  function segmentIntersect(a1, a2, b1, b2) {
    var ax = a2.x - a1.x, ay = a2.y - a1.y;
    var bx = b2.x - b1.x, by = b2.y - b1.y;
    var denom = ax * by - ay * bx;
    if (Math.abs(denom) < 1e-12) return null;
    var cx = b1.x - a1.x, cy = b1.y - a1.y;
    var t = (cx * by - cy * bx) / denom;
    var s = (cx * ay - cy * ax) / denom;
    if (t < 0 || t > 1 || s < 0 || s > 1) return null;
    return { x: a1.x + t * ax, y: a1.y + t * ay };
  }

  /** Vrai si au moins une arête de rectPoints croise un segment [s0,s1]. */
  function rectCrossesSegment(rectPoints, s0, s1) {
    if (!rectPoints || rectPoints.length < 2) return false;
    var n = rectPoints.length;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      if (segmentIntersect(rectPoints[i], rectPoints[j], s0, s1)) return true;
    }
    return false;
  }

  /** Vrai si un segment de rectPoints intersecte une arête de polygon. */
  function rectCrossesPolygon(rectPoints, polygon) {
    if (!polygon || polygon.length < 2) return false;
    for (var i = 0, n = polygon.length; i < n; i++) {
      var j = (i + 1) % n;
      if (rectCrossesSegment(rectPoints, polygon[i], polygon[j])) return true;
    }
    return false;
  }

  /** Vrai si le rectangle (points) chevauche l'obstacle : un point dedans ou intersection d'arêtes. */
  function rectOverlapsObstacle(rectPoints, obstaclePoints) {
    if (!obstaclePoints || obstaclePoints.length < 3) return false;
    for (var i = 0; i < rectPoints.length; i++) {
      if (pointInPolygon(rectPoints[i], obstaclePoints)) return true;
    }
    for (var k = 0; k < obstaclePoints.length; k++) {
      if (pointInPolygon(obstaclePoints[k], rectPoints)) return true;
    }
    if (rectCrossesPolygon(rectPoints, obstaclePoints)) return true;
    return false;
  }

  /** Vrai si les deux rectangles (listes de points) se chevauchent. */
  function rectOverlapsRect(pointsA, pointsB) {
    if (!pointsA || pointsA.length < 3 || !pointsB || pointsB.length < 3) return false;
    for (var i = 0; i < pointsA.length; i++) {
      if (pointInPolygon(pointsA[i], pointsB)) return true;
    }
    for (var j = 0; j < pointsB.length; j++) {
      if (pointInPolygon(pointsB[j], pointsA)) return true;
    }
    if (rectCrossesPolygon(pointsA, pointsB)) return true;
    return false;
  }

  /** Distance minimale des sommets de rect aux arêtes d'un obstacle (recul setback). */
  function minVertexDistToObstaclePolygon(rectPoints, obstaclePoints) {
    if (!rectPoints || !obstaclePoints || obstaclePoints.length < 2) return Infinity;
    var d = Infinity;
    for (var i = 0; i < rectPoints.length; i++) {
      var dd = distPointToPolygon(rectPoints[i].x, rectPoints[i].y, obstaclePoints);
      if (dd < d) d = dd;
    }
    return d;
  }

  /** Tous les points de rectPoints sont dans poly et à au moins marginPx du bord. */
  function rectInsidePolygonWithMargin(rectPoints, roofPolygon, marginPx) {
    if (!roofPolygon || roofPolygon.length < 3 || !rectPoints) return false;
    for (var i = 0; i < rectPoints.length; i++) {
      if (!pointInPolygon(rectPoints[i], roofPolygon)) return false;
    }
    if (!Number.isFinite(marginPx) || marginPx <= 0) return true;
    var minDist = minDistPointsToPolygon(rectPoints, roofPolygon);
    return minDist >= marginPx;
  }

  /**
   * Calcule les emplacements fantômes valides autour d'un panneau maître.
   * Un emplacement n'est retourné que s'il passe toutes les validations.
   *
   * @param {{
   *   masterPanelProjection: { points: Array<{x,y}>, slopeAxis: {x,y}, perpAxis: {x,y}, halfLengthAlongSlopePx: number, halfLengthPerpPx: number },
   *   masterCenter: { x: number, y: number },
   *   roofPolygon: Array<{ x: number, y: number }>,
   *   roofConstraints: { marginPx: number, ridgeSegments: Array<[ {x,y}, {x,y} ]>, obstaclePolygons: Array<Array<{x,y}>> },
   *   existingPanelsProjections: Array<{ points: Array<{x,y}> }>,
   *   pvRules: { spacingXcm: number, spacingYcm: number, marginOuterCm?: number },
   *   panelParams: { panelWidthMm: number, panelHeightMm: number, panelOrientation: string },
   *   roofParams: { roofSlopeDeg: number, roofOrientationDeg: number, metersPerPixel: number }
   * }} options
   * @returns {Array<{ center: { x: number, y: number }, projection: Object }>}
   *   Liste des emplacements valides uniquement (centre + projection complète).
   */
  function computeGhostSlots(options) {
    var masterProj = options.masterPanelProjection;
    var masterCenter = options.masterCenter;
    var roofPolygon = options.roofPolygon;
    var roofConstraints = options.roofConstraints || {};
    var existingPanelsProjections = options.existingPanelsProjections || [];
    var pvRules = options.pvRules || {};
    var panelParams = options.panelParams;
    var roofParams = options.roofParams;

    if (!masterProj || !masterProj.points || masterProj.points.length < 4) return [];
    if (!masterCenter || typeof masterCenter.x !== "number" || typeof masterCenter.y !== "number") return [];
    if (!roofPolygon || roofPolygon.length < 3) return [];
    if (!panelParams || !roofParams) return [];

    var computeProjectedPanelRect = null;
    if (typeof options.computeProjectedPanelRect === "function") {
      computeProjectedPanelRect = options.computeProjectedPanelRect;
    }
    if (typeof computeProjectedPanelRect !== "function" && typeof window !== "undefined" && window.__CALPINAGE_GET_RUNTIME__) {
      try {
        var _rt = window.__CALPINAGE_GET_RUNTIME__();
        if (_rt && typeof _rt.getComputeProjectedPanelRect === "function") {
          computeProjectedPanelRect = _rt.getComputeProjectedPanelRect();
        }
      } catch (_e) { /* ignore */ }
    }
    if (typeof computeProjectedPanelRect !== "function") {
      computeProjectedPanelRect = (typeof global !== "undefined" && global.computeProjectedPanelRect) || (typeof window !== "undefined" && window.computeProjectedPanelRect);
    }
    if (typeof computeProjectedPanelRect !== "function") return [];

    var marginPx = roofConstraints.marginPx;
    if (marginPx == null && Number.isFinite(pvRules.marginOuterCm) && Number.isFinite(roofParams.metersPerPixel) && roofParams.metersPerPixel > 0) {
      marginPx = (pvRules.marginOuterCm / 100) / roofParams.metersPerPixel;
    }
    if (!Number.isFinite(marginPx) || marginPx < 0) marginPx = 0;

    var ridgeSegments = roofConstraints.ridgeSegments || [];
    var obstaclePolygons = roofConstraints.obstaclePolygons || [];

    var mpp = roofParams.metersPerPixel;
    if (!Number.isFinite(mpp) || mpp <= 0) return [];
    var cmToPx = (1 / 100) / mpp;
    var spacingXpx = Number.isFinite(pvRules.spacingXcm) && pvRules.spacingXcm >= 0 ? pvRules.spacingXcm * cmToPx : 0;
    var spacingYpx = Number.isFinite(pvRules.spacingYcm) && pvRules.spacingYcm >= 0 ? pvRules.spacingYcm * cmToPx : 0;

    var slopeAxis = masterProj.slopeAxis;
    var perpAxis = masterProj.perpAxis;
    var halfAlong = masterProj.halfLengthAlongSlopePx;
    var halfPerp = masterProj.halfLengthPerpPx;

    var projectOpts = {
      panelWidthMm: panelParams.panelWidthMm,
      panelHeightMm: panelParams.panelHeightMm,
      panelOrientation: (panelParams.panelOrientation || "PORTRAIT").toString().toUpperCase(),
      roofSlopeDeg: roofParams.roofSlopeDeg,
      roofOrientationDeg: roofParams.roofOrientationDeg,
      metersPerPixel: mpp,
    };
    if (roofParams.trueSlopeAxis && roofParams.truePerpAxis) {
      projectOpts.trueSlopeAxis = roofParams.trueSlopeAxis;
      projectOpts.truePerpAxis = roofParams.truePerpAxis;
    }
    if (Number.isFinite(roofParams.supportTiltDeg)) {
      projectOpts.supportTiltDeg = roofParams.supportTiltDeg;
    }

    var directions = [
      { id: "haut", center: { x: masterCenter.x - (halfPerp * 2 + spacingXpx) * perpAxis.x, y: masterCenter.y - (halfPerp * 2 + spacingXpx) * perpAxis.y } },
      { id: "bas", center: { x: masterCenter.x + (halfPerp * 2 + spacingXpx) * perpAxis.x, y: masterCenter.y + (halfPerp * 2 + spacingXpx) * perpAxis.y } },
      { id: "gauche", center: { x: masterCenter.x - (halfAlong * 2 + spacingYpx) * slopeAxis.x, y: masterCenter.y - (halfAlong * 2 + spacingYpx) * slopeAxis.y } },
      { id: "droite", center: { x: masterCenter.x + (halfAlong * 2 + spacingYpx) * slopeAxis.x, y: masterCenter.y + (halfAlong * 2 + spacingYpx) * slopeAxis.y } },
    ];

    var out = [];

    for (var d = 0; d < directions.length; d++) {
      var candCenter = directions[d].center;
      projectOpts.center = candCenter;
      var proj;
      try {
        proj = computeProjectedPanelRect(projectOpts);
      } catch (e) {
        continue;
      }
      if (!proj || !proj.points || proj.points.length < 4) continue;

      if (!rectInsidePolygonWithMargin(proj.points, roofPolygon, marginPx)) continue;

      var crossesRidge = false;
      for (var r = 0; r < ridgeSegments.length; r++) {
        var seg = ridgeSegments[r];
        if (seg && seg.length >= 2 && rectCrossesSegment(proj.points, seg[0], seg[1])) {
          crossesRidge = true;
          break;
        }
      }
      if (crossesRidge) continue;

      var obsMarginPx = Number.isFinite(roofConstraints.obstacleMarginPx) ? roofConstraints.obstacleMarginPx : 0;
      var needObsSetback = obsMarginPx > 0 && roofParams && roofParams.roofType === "FLAT";
      var crossesObstacle = false;
      for (var o = 0; o < obstaclePolygons.length; o++) {
        var obsP = obstaclePolygons[o];
        if (rectOverlapsObstacle(proj.points, obsP)) {
          crossesObstacle = true;
          break;
        }
        if (needObsSetback && minVertexDistToObstaclePolygon(proj.points, obsP) < obsMarginPx) {
          crossesObstacle = true;
          break;
        }
      }
      if (crossesObstacle) continue;

      var overlapsPanel = false;
      for (var p = 0; p < existingPanelsProjections.length; p++) {
        var other = existingPanelsProjections[p];
        if (other && other.points && other.points.length >= 3 && rectOverlapsRect(proj.points, other.points)) {
          overlapsPanel = true;
          break;
        }
      }
      if (overlapsPanel) continue;

      out.push({
        direction: directions[d].id,
        center: { x: candCenter.x, y: candCenter.y },
        projection: proj,
      });
    }

    return out;
  }

  var GhostSlots = {
    computeGhostSlots: computeGhostSlots,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GhostSlots;
  } else {
    global.GhostSlots = GhostSlots;
    global.computeGhostSlots = computeGhostSlots;
  }
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
