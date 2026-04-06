/**
 * Topologie pans Phase 2 — contraintes explicites depuis les attaches (graphe calculé, non persisté).
 * Nœuds implicites sur les segments de contour pour stabiliser le split sans dépendre uniquement des intersections flottantes.
 */

import { resolvePointFromRoofContourEdgeAttach } from "./structuralSnapPhase2.js";
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
 * Contact « structurant » fort pour le graphe pans : attach Phase 2 sur contour.
 * Le fallback (snap tolérant sans attach fiable) reste géré ailleurs.
 */
export function isStructuralContourAttach(rp) {
  if (!rp || !rp.attach || typeof rp.attach !== "object") return false;
  var a = rp.attach;
  if (a.type === "roof_contour_edge") return true;
  if (a.type === "contour" && a.id != null && typeof a.pointIndex === "number") return true;
  return false;
}

/**
 * Index plat du segment `segmentIndex` sur le contour `contourId` dans la liste `contourEdges`
 * (ordre identique à getEdgesFromState + edgeSegments).
 */
export function flattenContourSegmentIndex(contourEdges, contourId, segmentIndex) {
  var flat = 0;
  for (var i = 0; i < contourEdges.length; i++) {
    var c = contourEdges[i].ref;
    if (!c || !c.points || c.points.length < 2) continue;
    if (c.id === contourId) {
      if (segmentIndex < 0 || segmentIndex >= c.points.length) return -1;
      return flat + segmentIndex;
    }
    flat += c.points.length;
  }
  return -1;
}

/**
 * Points à insérer sur les segments de contour (clé = index plat du segment dans contourSegments).
 * Exclut les projections trop proches d’un sommet (réutilisation du nœud existant, pas de micro-segment).
 *
 * @param {{ contours?: Array }} state
 * @param {Array<{ ref: { id: string; points: Array } }>} contourEdges
 * @param {Array<{ a?: object; b?: object }>} ridgeRefs
 * @param {Array<{ a?: object; b?: object }>} traitRefs
 * @param {number} mergeEps — même ordre de grandeur que MERGE_EPS_IMG dans computePansFromGeometryCore
 */
export function collectMandatoryContourSplitPointsFromStructuralEndpoints(
  state,
  contourEdges,
  ridgeRefs,
  traitRefs,
  mergeEps
) {
  var contours = state.contours || [];
  /** @type {Record<number, Array<{ x: number; y: number }>>} */
  var mandatoryByFlatSeg = {};
  var debug = [];

  function addMandatory(contourId, segIdx, pt) {
    var flat = flattenContourSegmentIndex(contourEdges, contourId, segIdx);
    if (flat < 0) {
      debug.push({ action: "skip", reason: "bad_flat_index", contourId, segmentIndex: segIdx });
      return;
    }
    var c = contours.find(function (x) {
      return x && x.id === contourId;
    });
    if (!c || !c.points) return;
    var n = c.points.length;
    var va = c.points[segIdx];
    var vb = c.points[(segIdx + 1) % n];
    if (!va || !vb) return;
    if (distImg(pt, va) <= mergeEps || distImg(pt, vb) <= mergeEps) {
      debug.push({
        action: "reuse_vertex",
        contourId,
        segmentIndex: segIdx,
        flatSegmentIndex: flat,
        reason: "endpoint_pin",
      });
      return;
    }
    if (!mandatoryByFlatSeg[flat]) mandatoryByFlatSeg[flat] = [];
    var list = mandatoryByFlatSeg[flat];
    var dup = false;
    for (var q = 0; q < list.length; q++) {
      if (distImg(list[q], pt) <= mergeEps) {
        dup = true;
        break;
      }
    }
    if (!dup) list.push({ x: pt.x, y: pt.y });
    debug.push({
      action: "inject_interior",
      contourId,
      segmentIndex: segIdx,
      flatSegmentIndex: flat,
    });
  }

  function processEndpoint(rp) {
    if (!rp || typeof rp.x !== "number") return;
    var att = rp.attach;
    if (!att || typeof att !== "object") return;
    if (att.type === "roof_contour_edge" && att.contourId != null && typeof att.segmentIndex === "number") {
      var p = resolvePointFromRoofContourEdgeAttach(att, contours);
      if (p) addMandatory(att.contourId, att.segmentIndex, p);
    }
  }

  (ridgeRefs || []).forEach(function (r) {
    if (r && r.a) processEndpoint(r.a);
    if (r && r.b) processEndpoint(r.b);
  });
  (traitRefs || []).forEach(function (t) {
    if (t && t.a) processEndpoint(t.a);
    if (t && t.b) processEndpoint(t.b);
  });

  return { mandatoryByFlatSeg: mandatoryByFlatSeg, debug: debug };
}
