/**
 * Snap / commit unifiés Phase 2 — outils structurants (faîtage, trait).
 * Fonctions pures testables ; l'état CALPINAGE_STATE reste dans calpinage.module.js.
 */

import { dist2d } from "../core/geometryCore2d.js";

/**
 * Distance entre deux points image.
 * @deprecated Préférer dist2d() depuis geometryCore2d.js.
 * Conservé en export pour compatibilité ascendante.
 * @param {{ x: number; y: number }} a @param {{ x: number; y: number }} b
 */
export function distImg(a, b) {
  return dist2d(a, b);
}

/**
 * Projection orthogonale du point sur le segment [a,b], t clampé [0,1].
 *
 * NOTE : conserve l'epsilon 1e-20 (au lieu de GEOM2D_EPS=1e-12 du core) car cette
 * fonction est critique pour le snap structural. Le comportement est identique en
 * pratique pour des coordonnées image (px), mais on ne change pas l'epsilon pour
 * ne pas modifier subtilement le résultat dans les cas limites (très courts segments).
 */
export function projectPointOnSegmentClamped(pt, a, b) {
  var ax = a.x;
  var ay = a.y;
  var bx = b.x;
  var by = b.y;
  var px = pt.x;
  var py = pt.y;
  var abx = bx - ax;
  var aby = by - ay;
  var ab2 = abx * abx + aby * aby + 1e-20;
  var t = ((px - ax) * abx + (py - ay) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return {
    x: ax + t * abx,
    y: ay + t * aby,
    t: t,
  };
}

var VERTEX_PIN_IMG = 0.55;

/**
 * Snap prioritaire sur le bord du contour bâti : retourne le meilleur projet sur une arête
 * + attach sémantique (sommet ou arête avec paramètre t).
 * @param {number} maxDistImg distance max image (px)
 */
export function buildRoofContourEdgeSnapDetailed(imgPt, buildingContours, maxDist) {
  if (!buildingContours || !buildingContours.length) return null;
  var best = null;
  var bestDist = maxDist;
  for (var ci = 0; ci < buildingContours.length; ci++) {
    var contour = buildingContours[ci];
    var pts = contour && contour.points;
    if (!pts || pts.length < 2) continue;
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % n];
      if (!a || !b || typeof a.x !== "number" || typeof b.x !== "number") continue;
      var proj = projectPointOnSegmentClamped(imgPt, a, b);
      var d = distImg(imgPt, proj);
      if (d >= bestDist) continue;
      var t = proj.t;
      var da = distImg(proj, a);
      var db = distImg(proj, b);
      var kind;
      /** @type {Record<string, unknown>} */
      var attach;
      if (da <= VERTEX_PIN_IMG || t <= 1e-5) {
        kind = "roof_contour_vertex";
        attach = { type: "contour", id: contour.id, pointIndex: i };
      } else if (db <= VERTEX_PIN_IMG || t >= 1 - 1e-5) {
        kind = "roof_contour_vertex";
        var j = (i + 1) % n;
        attach = { type: "contour", id: contour.id, pointIndex: j };
      } else {
        kind = "roof_contour_edge";
        attach = {
          type: "roof_contour_edge",
          contourId: contour.id,
          segmentIndex: i,
          t: t,
          roofRole: contour.roofRole != null ? contour.roofRole : null,
        };
      }
      bestDist = d;
      best = {
        x: proj.x,
        y: proj.y,
        dist: d,
        kind: kind,
        attach: attach,
      };
    }
  }
  return best;
}

/**
 * Valide un payload de snap figé avant commit (contour / trait encore présents).
 * @param {string} tool "ridge" | "trait"
 */
export function validateStructuralSnapPayload(payload, tool, contours, traits) {
  if (!payload || typeof payload.x !== "number" || typeof payload.y !== "number") return false;
  if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return false;
  var a = payload.attach;
  if (!a || typeof a !== "object") return true;
  if (a.type === "contour" && a.id != null && typeof a.pointIndex === "number") {
    var c = (contours || []).find(function (x) {
      return x && x.id === a.id;
    });
    if (!c || !c.points || a.pointIndex < 0 || a.pointIndex >= c.points.length) return false;
    return true;
  }
  if (a.type === "roof_contour_edge" && a.contourId != null && typeof a.segmentIndex === "number") {
    var c2 = (contours || []).find(function (x) {
      return x && x.id === a.contourId;
    });
    if (!c2 || !c2.points || c2.points.length < 2) return false;
    if (a.segmentIndex < 0 || a.segmentIndex >= c2.points.length) return false;
    return true;
  }
  if (a.type === "trait" && a.id != null && typeof a.pointIndex === "number") {
    var t = (traits || []).find(function (x) {
      return x && x.id === a.id;
    });
    if (!t) return false;
    return true;
  }
  if (tool === "trait" && a.type === "roof_edge" && typeof a.mode === "string") {
    return true;
  }
  return true;
}

/**
 * Résout la position XY d'un point de faîtage avec attach roof_contour_edge (contour édité).
 */
export function resolvePointFromRoofContourEdgeAttach(attach, contours) {
  if (!attach || attach.type !== "roof_contour_edge") return null;
  var c = (contours || []).find(function (x) {
    return x && x.id === attach.contourId;
  });
  if (!c || !c.points || c.points.length < 2) return null;
  var i = attach.segmentIndex;
  var pts = c.points;
  var n = pts.length;
  if (i < 0 || i >= n) return null;
  var a = pts[i];
  var b = pts[(i + 1) % n];
  var t = typeof attach.t === "number" && Number.isFinite(attach.t) ? attach.t : 0.5;
  t = Math.max(0, Math.min(1, t));
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
}
