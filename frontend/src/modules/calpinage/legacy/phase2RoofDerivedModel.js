/**
 * Modèle toiture dérivé Phase 2 — source de vérité : computePansFromGeometryCore (pans),
 * puis planes et miroirs pour consommateurs (export, 3D, shading).
 *
 * Ne modifie pas le schéma JSON persistant des contours ; enrichit seulement des champs dérivés.
 */

/** @type {string} */
export var DERIVED_ROOF_TOPOLOGY_SOURCE = "computePansFromGeometryCore_v1";

/**
 * Remplit state.planes à partir des polygones pans (même topologie que le graphe pans).
 * @param {{ pans?: Array<{ id?: string; polygon?: Array<{x:number;y:number}>; points?: Array<{x:number;y:number}> }>; planes?: unknown[]; contours?: Array<{ points?: Array<{x:number;y:number}>; roofRole?: string }> }} state
 */
export function deriveRoofPlanesFromPans(state) {
  if (!state) return [];
  var pans = state.pans || [];
  var out = [];
  for (var i = 0; i < pans.length; i++) {
    var p = pans[i];
    if (!p) continue;
    var poly = p.polygon || p.points;
    if (!poly || poly.length < 3) continue;
    var pts = [];
    for (var k = 0; k < poly.length; k++) {
      var pt = poly[k];
      if (pt && typeof pt.x === "number" && typeof pt.y === "number") pts.push({ x: pt.x, y: pt.y });
    }
    if (pts.length < 3) continue;
    out.push({
      points: pts,
      derivedFromPanId: p.id != null ? p.id : null,
      derivedTopologySource: DERIVED_ROOF_TOPOLOGY_SOURCE,
    });
  }
  state.planes = out;
  return out;
}

/**
 * Si aucun pan dérivé (géométrie vide / dégénérée), replis proche legacy : un plan par contour bâti.
 * @param {{ pans?: unknown[]; planes?: unknown[]; contours?: Array<{ points?: Array<{x:number;y:number}>; roofRole?: string }> }} state
 */
export function deriveRoofPlanesFallbackFromContoursOnly(state) {
  if (!state) return [];
  state.planes = [];
  var contours = (state.contours || []).filter(function (c) {
    return c && c.roofRole !== "chienAssis" && c.points && c.points.length >= 3;
  });
  for (var i = 0; i < contours.length; i++) {
    var c = contours[i];
    state.planes.push({
      points: c.points.map(function (pt) {
        return { x: pt.x, y: pt.y };
      }),
      derivedFromPanId: null,
      derivedTopologySource: "contour_fallback_no_pans",
    });
  }
  return state.planes;
}

/**
 * Miroir des pans sur state.roof.roofPans pour mapCalpinageRoofToLegacyRoofGeometryInput et shading.
 * @param {{ roof?: Record<string, unknown>; pans?: Array<Record<string, unknown>> }} state
 */
export function syncRoofPansMirrorFromPans(state) {
  if (!state) return;
  if (!state.roof || typeof state.roof !== "object") state.roof = {};
  var pans = state.pans || [];
  state.roof.roofPans = pans.map(function (p, idx) {
    if (!p) return null;
    var poly = p.polygon || p.points;
    var base = {
      id: p.id != null ? p.id : "pan-" + (idx + 1),
      polygon: Array.isArray(p.polygon) ? p.polygon.map(function (pt) {
        return { x: pt.x, y: pt.y };
      }) : null,
      points: Array.isArray(p.points)
        ? p.points.map(function (pt) {
            return { x: pt.x, y: pt.y, h: typeof pt.h === "number" ? pt.h : undefined };
          })
        : null,
    };
    if (Array.isArray(poly)) {
      base.polygonPx = poly.map(function (pt) {
        return { x: pt.x, y: pt.y };
      });
    }
    return base;
  }).filter(Boolean);
}

/**
 * Pipeline unique : pans (vérité dérivée) → planes + miroir roofPans.
 * @param {{ pans?: unknown[]; contours?: unknown[]; roof?: Record<string, unknown>; planes?: unknown[] }} state
 * @param {{ skipFallback?: boolean }} opts
 */
export function applyDerivedRoofTopologyAfterPans(state, opts) {
  opts = opts || {};
  var pans = state && state.pans ? state.pans : [];
  if (pans.length === 0 && !opts.skipFallback) {
    deriveRoofPlanesFallbackFromContoursOnly(state);
  } else {
    deriveRoofPlanesFromPans(state);
  }
  syncRoofPansMirrorFromPans(state);
  if (typeof window !== "undefined" && window.CALPINAGE_DEBUG_DERIVED_ROOF && typeof console !== "undefined" && console.log) {
    var rp = state && state.roof && state.roof.roofPans ? state.roof.roofPans.length : 0;
    console.log("[Calpinage derived topology] pans=" + pans.length + " planes=" + (state.planes || []).length + " roofPans=" + rp);
  }
  return state.planes || [];
}
