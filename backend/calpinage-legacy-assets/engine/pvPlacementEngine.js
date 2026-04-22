/**
 * Moteur de placement PV — API claire et testable (Phase 3).
 *
 * Contient toute la logique métier : création bloc, validation, recompute, suppression.
 * Ne connaît pas le DOM ni le canvas. Manipule uniquement des données.
 *
 * buildProjectionContext() est une fonction PURE : aucun accès global, tous les paramètres sont explicites.
 * getProjectionContextForPan() dans calpinage.html est un simple adaptateur UI qui appelle buildProjectionContext().
 *
 * @module pvPlacementEngine
 */

(function (global) {
  "use strict";

  function getAPB() {
    return (typeof global !== "undefined" && global.ActivePlacementBlock) ||
      (typeof window !== "undefined" && window.ActivePlacementBlock);
  }

  function getComputeProjectedPanelRect() {
    return (typeof global !== "undefined" && global.computeProjectedPanelRect) ||
      (typeof window !== "undefined" && window.computeProjectedPanelRect);
  }

  function normalizePanelOrientationStr(v) {
    var u = (v != null ? String(v) : "PORTRAIT").toUpperCase();
    if (u === "LANDSCAPE" || u === "PAYSAGE") return "PAYSAGE";
    var l = (v != null ? String(v) : "").toLowerCase();
    if (l === "landscape" || l === "paysage") return "PAYSAGE";
    return "PORTRAIT";
  }

  // ---------------------------------------------------------------------------
  // buildProjectionContext — PURE, sans dépendance globale
  // ---------------------------------------------------------------------------

  /**
   * Construit le contexte de projection pour computeProjectedPanelRect.
   * Aucune dépendance globale. Orientation lue uniquement depuis les paramètres (règles UI), jamais inférée.
   *
   * @param {{
   *   pan?: { polygon?: Array<{x: number, y: number}> },
   *   roofPolygon?: Array<{x: number, y: number}>,
   *   roofParams: { roofSlopeDeg: number, roofOrientationDeg?: number, metersPerPixel: number },
   *   panelParams: { panelWidthMm: number, panelHeightMm: number, panelOrientation?: string },
   *   pvRules?: { spacingXcm?: number, spacingYcm?: number, marginOuterCm?: number, orientation?: string },
   *   roofConstraints?: { marginPx?: number, ridgeSegments?: Array, obstaclePolygons?: Array },
   *   existingProjections?: Array<{ points: Array<{x,y}> }>
   * }} opts
   * @returns {{
   *   roofPolygon: Array<{x,y}>,
   *   roofConstraints: { marginPx: number, ridgeSegments: Array, obstaclePolygons: Array },
   *   roofParams: Object,
   *   panelParams: Object,
   *   pvRules: Object,
   *   existingPanelsProjections: Array
   * } | null}
   */
  function buildProjectionContext(opts) {
    if (!opts || !opts.roofParams || !opts.panelParams) return null;
    var pan = opts.pan;
    var roofPolygon = opts.roofPolygon != null ? opts.roofPolygon : (pan && pan.polygon);
    if (!roofPolygon || roofPolygon.length < 3) return null;
    var roofParams = opts.roofParams;
    var panelParams = opts.panelParams;
    var pvRules = opts.pvRules || {};
    var existingProjections = opts.existingProjections || [];
    var roofConstraints = opts.roofConstraints || {};
    var mpp = roofParams.metersPerPixel;
    var marginOuterCm = Number.isFinite(pvRules.marginOuterCm) ? pvRules.marginOuterCm : 0;
    var marginPx = (roofConstraints && Number.isFinite(roofConstraints.marginPx))
      ? roofConstraints.marginPx
      : ((typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0)
          ? (marginOuterCm / 100) / mpp
          : 0);
    var orientationRaw = (pvRules.orientation != null)
      ? pvRules.orientation
      : (panelParams.panelOrientation != null ? panelParams.panelOrientation : "PORTRAIT");
    var panelOrientation = String(orientationRaw).toUpperCase();
    if (panelOrientation === "LANDSCAPE") panelOrientation = "PAYSAGE";
    if (panelOrientation !== "PORTRAIT" && panelOrientation !== "PAYSAGE") panelOrientation = "PORTRAIT";
    var panelParamsOut = {};
    for (var k in panelParams) if (panelParams.hasOwnProperty(k)) panelParamsOut[k] = panelParams[k];
    panelParamsOut.panelOrientation = panelOrientation;
    return {
      roofPolygon: roofPolygon,
        roofConstraints: {
        marginPx: marginPx,
        ridgeSegments: roofConstraints.ridgeSegments || [],
        traitSegments: roofConstraints.traitSegments || [],
        obstaclePolygons: roofConstraints.obstaclePolygons || [],
        roofPolygon: roofPolygon,
        eps: roofConstraints.eps,
        obstacleMarginPx: roofConstraints.obstacleMarginPx,
      },
      roofParams: roofParams,
      panelParams: panelParamsOut,
      pvRules: pvRules,
      existingPanelsProjections: existingProjections,
    };
  }

  // ---------------------------------------------------------------------------
  // Validation unique — obstacles, traits/faîtage, espacement inter-panneaux (sans limite pan)
  // ---------------------------------------------------------------------------

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

  function distancePointToSegment(p, a, b) {
    var ax = a.x != null ? a.x : a[0];
    var ay = a.y != null ? a.y : a[1];
    var bx = b.x != null ? b.x : b[0];
    var by = b.y != null ? b.y : b[1];
    var px = p.x, py = p.y;
    var abx = bx - ax, aby = by - ay;
    var apx = px - ax, apy = py - ay;
    var denom = abx * abx + aby * aby + 1e-20;
    var t = (apx * abx + apy * aby) / denom;
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * abx, qy = ay + t * aby;
    return Math.hypot(px - qx, py - qy);
  }

  function minDistancePointToPolygonEdges(p, poly) {
    if (!poly || poly.length < 2) return Infinity;
    var d = Infinity;
    for (var i = 0, n = poly.length; i < n; i++) {
      var j = (i + 1) % n;
      var a = poly[i], b = poly[j];
      var segD = distancePointToSegment(p, a, b);
      if (segD < d) d = segD;
    }
    return d;
  }

  function minDistancePolygonToSegments(poly, segments) {
    if (!poly || poly.length < 2 || !segments || segments.length === 0) return Infinity;
    var d = Infinity;
    for (var si = 0; si < segments.length; si++) {
      var seg = segments[si];
      var s0 = Array.isArray(seg) ? seg[0] : seg.start;
      var s1 = Array.isArray(seg) ? seg[1] : seg.end;
      if (!s0 || !s1) continue;
      for (var i = 0; i < poly.length; i++) {
        var pt = poly[i];
        var dp = distancePointToSegment(pt, s0, s1);
        if (dp < d) d = dp;
      }
      for (var j = 0; j < poly.length; j++) {
        var k = (j + 1) % poly.length;
        var p0 = poly[j], p1 = poly[k];
        var dp2 = distancePointToSegment({ x: s0.x, y: s0.y }, p0, p1);
        if (dp2 < d) d = dp2;
        var dp3 = distancePointToSegment({ x: s1.x, y: s1.y }, p0, p1);
        if (dp3 < d) d = dp3;
      }
    }
    return d;
  }

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

  /** AABB — préfiltre rapide avant intersection polygone/polygone (réduit le coût quand beaucoup de panneaux). */
  function polygonBBox2D(poly) {
    if (!poly || poly.length === 0) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      var x = p.x != null ? p.x : p[0];
      var y = p.y != null ? p.y : p[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function bboxOverlap2D(a, b) {
    return a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function polygonIntersectsPolygon(polyA, polyB) {
    if (!polyA || polyA.length < 2 || !polyB || polyB.length < 2) return false;
    var bbA = polygonBBox2D(polyA);
    var bbB = polygonBBox2D(polyB);
    if (!bboxOverlap2D(bbA, bbB)) return false;
    for (var i = 0; i < polyA.length; i++) {
      if (pointInPolygon(polyA[i], polyB)) return true;
    }
    for (var j = 0; j < polyB.length; j++) {
      if (pointInPolygon(polyB[j], polyA)) return true;
    }
    for (var ai = 0; ai < polyA.length; ai++) {
      var a1 = polyA[ai], a2 = polyA[(ai + 1) % polyA.length];
      for (var bi = 0; bi < polyB.length; bi++) {
        var b1 = polyB[bi], b2 = polyB[(bi + 1) % polyB.length];
        if (segmentIntersect(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  function minDistanceBetweenPolygons(polyA, polyB) {
    if (!polyA || polyA.length < 2 || !polyB || polyB.length < 2) return Infinity;
    var d = Infinity;
    for (var i = 0; i < polyA.length; i++) {
      var pt = polyA[i];
      var toB = minDistancePointToPolygonEdges(pt, polyB);
      if (toB < d) d = toB;
    }
    for (var j = 0; j < polyB.length; j++) {
      var pt2 = polyB[j];
      var toA = minDistancePointToPolygonEdges(pt2, polyA);
      if (toA < d) d = toA;
    }
    return d;
  }

  /**
   * Étapes 0–1 (strict + obstacles) et 3 (faîtage/trait), sans test inter-panneaux.
   * Découpé pour mutualiser avec la validation indexée (gros blocs).
   */
  function validatePanelPolygonSteps0And1(panelPoly, forbiddenPolys, roofConstraints) {
    if (!panelPoly || panelPoly.length < 3) return false;

    var pvStrict = (typeof global !== "undefined" && global.__CALPINAGE_PV_STRICT__) || (typeof window !== "undefined" && window.__CALPINAGE_PV_STRICT__);
    if (pvStrict && roofConstraints && roofConstraints.roofPolygon && roofConstraints.roofPolygon.length >= 3) {
      var panPoly = roofConstraints.roofPolygon;
      var marginPx = (roofConstraints.marginPx != null && Number.isFinite(roofConstraints.marginPx)) ? roofConstraints.marginPx : 0;
      for (var vi = 0; vi < panelPoly.length; vi++) {
        var pt = panelPoly[vi];
        if (!pointInPolygon(pt, panPoly)) return false;
        var distToEdge = minDistancePointToPolygonEdges(pt, panPoly);
        if (distToEdge < marginPx) return false;
      }
    }

    if (forbiddenPolys && forbiddenPolys.length > 0) {
      for (var o = 0; o < forbiddenPolys.length; o++) {
        var obs = forbiddenPolys[o];
        if (!obs || obs.length < 3) continue;
        if (polygonIntersectsPolygon(panelPoly, obs)) return false;
      }
    }
    var obsMarginPx = (roofConstraints && roofConstraints.obstacleMarginPx != null && Number.isFinite(roofConstraints.obstacleMarginPx))
      ? roofConstraints.obstacleMarginPx : 0;
    if (obsMarginPx > 0 && forbiddenPolys && forbiddenPolys.length > 0) {
      for (var o2 = 0; o2 < forbiddenPolys.length; o2++) {
        var obs2 = forbiddenPolys[o2];
        if (!obs2 || obs2.length < 3) continue;
        if (minDistanceBetweenPolygons(panelPoly, obs2) < obsMarginPx) return false;
      }
    }
    return true;
  }

  function validatePanelPolygonStep3Ridge(panelPoly, roofConstraints) {
    var forbiddenSegs = roofConstraints
      ? ((roofConstraints.ridgeSegments || []).concat(roofConstraints.traitSegments || []))
      : [];
    var pvEps = (roofConstraints && roofConstraints.eps && typeof roofConstraints.eps.PV_IMG === "number")
      ? roofConstraints.eps.PV_IMG
      : 1e-6;
    if (forbiddenSegs.length > 0 && minDistancePolygonToSegments(panelPoly, forbiddenSegs) < pvEps) {
      return false;
    }
    return true;
  }

  /**
   * Détaille pourquoi un candidat auto-remplissage est invalide (aperçu rouge / commit filtré).
   */
  function validateAutofillCandidateDetailed(panelPoly, validationCaches, block, hypotheticalPanelIndex) {
    var roofConstraints = validationCaches.roofConstraints;
    var forbiddenPolys = validationCaches.forbiddenPolys;
    var base = {
      valid: false,
      invalidReason: null,
      collidesExisting: false,
      outOfBounds: false,
      overlapsKeepout: false,
      overlapsObstacle: false,
      overlapsPanel: false,
    };
    if (!panelPoly || panelPoly.length < 3) {
      base.invalidReason = "geometry";
      base.outOfBounds = true;
      return base;
    }
    var pvStrict = (typeof global !== "undefined" && global.__CALPINAGE_PV_STRICT__) ||
      (typeof window !== "undefined" && window.__CALPINAGE_PV_STRICT__);
    if (pvStrict && roofConstraints && roofConstraints.roofPolygon && roofConstraints.roofPolygon.length >= 3) {
      var panPoly = roofConstraints.roofPolygon;
      var marginPx = (roofConstraints.marginPx != null && Number.isFinite(roofConstraints.marginPx)) ? roofConstraints.marginPx : 0;
      for (var vi = 0; vi < panelPoly.length; vi++) {
        var pt = panelPoly[vi];
        if (!pointInPolygon(pt, panPoly)) {
          base.invalidReason = "out_of_bounds";
          base.outOfBounds = true;
          return base;
        }
        var distToEdge = minDistancePointToPolygonEdges(pt, panPoly);
        if (distToEdge < marginPx) {
          base.invalidReason = "margin";
          base.outOfBounds = true;
          return base;
        }
      }
    }
    if (forbiddenPolys && forbiddenPolys.length > 0) {
      for (var o = 0; o < forbiddenPolys.length; o++) {
        var obs = forbiddenPolys[o];
        if (!obs || obs.length < 3) continue;
        if (polygonIntersectsPolygon(panelPoly, obs)) {
          base.invalidReason = "obstacle";
          base.overlapsObstacle = true;
          return base;
        }
      }
    }
    var obsMarginAf = (roofConstraints && roofConstraints.obstacleMarginPx != null && Number.isFinite(roofConstraints.obstacleMarginPx))
      ? roofConstraints.obstacleMarginPx : 0;
    if (obsMarginAf > 0 && forbiddenPolys && forbiddenPolys.length > 0) {
      for (var ox = 0; ox < forbiddenPolys.length; ox++) {
        var obx = forbiddenPolys[ox];
        if (!obx || obx.length < 3) continue;
        if (minDistanceBetweenPolygons(panelPoly, obx) < obsMarginAf) {
          base.invalidReason = "obstacle";
          base.overlapsObstacle = true;
          return base;
        }
      }
    }
    var frozenPolys = validationCaches.frozenPolys;
    var j, other;
    for (j = 0; j < frozenPolys.length; j++) {
      other = frozenPolys[j];
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) {
        base.invalidReason = "overlap_panel";
        base.overlapsPanel = true;
        return base;
      }
    }
    var active = validationCaches.active;
    var activePolys = validationCaches.activePolys;
    if (active && active.panels && activePolys) {
      for (j = 0; j < active.panels.length; j++) {
        if (active.id === block.id && j === hypotheticalPanelIndex) continue;
        if (active.panels[j].enabled === false) continue;
        other = activePolys[j];
        if (!other || other.length < 2) continue;
        if (polygonIntersectsPolygon(panelPoly, other)) {
          base.invalidReason = "overlap_panel";
          base.overlapsPanel = true;
          return base;
        }
      }
    }
    var blockPolys = validationCaches.blockPolys;
    if ((!active || active.id !== block.id) && blockPolys) {
      for (j = 0; j < block.panels.length; j++) {
        if (j === hypotheticalPanelIndex) continue;
        if (block.panels[j].enabled === false) continue;
        other = blockPolys[j];
        if (!other || other.length < 2) continue;
        if (polygonIntersectsPolygon(panelPoly, other)) {
          base.invalidReason = "overlap_panel";
          base.overlapsPanel = true;
          return base;
        }
      }
    }
    if (!validatePanelPolygonStep3Ridge(panelPoly, roofConstraints)) {
      base.invalidReason = "ridge_trait";
      base.overlapsKeepout = true;
      return base;
    }
    base.valid = true;
    base.invalidReason = null;
    return base;
  }

  /**
   * Valide un panneau (polygone projeté) : collision obstacle OU collision autre panneau activé uniquement.
   * Rouge si et seulement si : intersection avec obstacle OU intersection avec autre panneau enabled.
   * @param {Object} [roofConstraints] - optionnel : { ridgeSegments, traitSegments } pour test keepout faîtage/trait
   */
  function validatePanelPolygon(panelPoly, forbiddenPolys, otherPanelPolys, roofConstraints) {
    if (!validatePanelPolygonSteps0And1(panelPoly, forbiddenPolys, roofConstraints)) return false;

    if (otherPanelPolys && otherPanelPolys.length > 0) {
      for (var k = 0; k < otherPanelPolys.length; k++) {
        var other = otherPanelPolys[k];
        if (!other || other.length < 2) continue;
        if (polygonIntersectsPolygon(panelPoly, other)) return false;
      }
    }

    return validatePanelPolygonStep3Ridge(panelPoly, roofConstraints);
  }

  /**
   * Même règles que validatePanelPolygon, sans construire un tableau « autres panneaux » par index
   * (évite O(P²) allocations + parcourt les caches une fois par paire testée).
   */
  function validatePanelPolygonIndexed(panelPoly, forbiddenPolys, roofConstraints, block, panelIndex, frozenPolys, active, activePolys, blockPolys) {
    if (!validatePanelPolygonSteps0And1(panelPoly, forbiddenPolys, roofConstraints)) return false;

    var j, other;
    for (j = 0; j < frozenPolys.length; j++) {
      other = frozenPolys[j];
      if (!other || other.length < 2) continue;
      if (polygonIntersectsPolygon(panelPoly, other)) return false;
    }

    if (active && active.panels && activePolys) {
      for (j = 0; j < active.panels.length; j++) {
        if (active.id === block.id && j === panelIndex) continue;
        if (active.panels[j].enabled === false) continue;
        other = activePolys[j];
        if (!other || other.length < 2) continue;
        if (polygonIntersectsPolygon(panelPoly, other)) return false;
      }
    }

    if ((!active || active.id !== block.id) && blockPolys) {
      for (j = 0; j < block.panels.length; j++) {
        if (j === panelIndex) continue;
        if (block.panels[j].enabled === false) continue;
        other = blockPolys[j];
        if (!other || other.length < 2) continue;
        if (polygonIntersectsPolygon(panelPoly, other)) return false;
      }
    }

    return validatePanelPolygonStep3Ridge(panelPoly, roofConstraints);
  }

  /**
   * Précalcule les polygones effectifs pour la validation (un passage par panneau extérieur au lieu d’une reconstruction complète à chaque index).
   */
  function buildValidationCaches(block, getProjectionContext) {
    if (!block || !block.panels || typeof getProjectionContext !== "function") return null;
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofConstraints) return null;
    var APB = getAPB();
    var frozen = APB && typeof APB.getFrozenBlocks === "function" ? APB.getFrozenBlocks() : [];
    var active = APB && APB.getActiveBlock && APB.getActiveBlock();
    var frozenPolys = [];
    var fi, bl, j, p, proj;
    for (fi = 0; fi < frozen.length; fi++) {
      bl = frozen[fi];
      if (!bl.panels || bl.id === block.id) continue;
      for (j = 0; j < bl.panels.length; j++) {
        p = bl.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(bl, j);
        if (proj && proj.points && proj.points.length >= 2) frozenPolys.push(proj.points);
      }
    }
    var activePolys = null;
    if (active && active.panels) {
      activePolys = [];
      for (j = 0; j < active.panels.length; j++) {
        p = active.panels[j];
        if (p.enabled === false) {
          activePolys.push(null);
          continue;
        }
        proj = getEffectivePanelProjection(active, j);
        activePolys.push(proj && proj.points && proj.points.length >= 2 ? proj.points : null);
      }
    }
    var blockPolys = [];
    for (j = 0; j < block.panels.length; j++) {
      p = block.panels[j];
      if (p.enabled === false) {
        blockPolys.push(null);
        continue;
      }
      proj = getEffectivePanelProjection(block, j);
      blockPolys.push(proj && proj.points && proj.points.length >= 2 ? proj.points : null);
    }
    return {
      ctx: ctx,
      forbiddenPolys: ctx.roofConstraints.obstaclePolygons || [],
      roofConstraints: ctx.roofConstraints,
      frozenPolys: frozenPolys,
      active: active,
      activePolys: activePolys,
      blockPolys: blockPolys,
    };
  }

  function isFlatRoofContext(ctx) {
    return !!(ctx && (ctx.roofType === "FLAT" || (ctx.roofParams && ctx.roofParams.roofType === "FLAT")));
  }

  /** Même construction que ActivePlacementBlock.addPanelAtCenter (projection + rotation bloc). */
  function computePanelProjectionAtCenterForBlock(block, center, getProjectionContext) {
    if (!block || !center || typeof getProjectionContext !== "function") return null;
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofParams || !ctx.panelParams) return null;
    var computeProjectedPanelRect = getComputeProjectedPanelRect();
    if (typeof computeProjectedPanelRect !== "function") return null;
    var blockOrient = (block.orientation === "PAYSAGE" || block.orientation === "landscape") ? "PAYSAGE" : "PORTRAIT";
    var projectOpts = {
      center: { x: center.x, y: center.y },
      panelWidthMm: ctx.panelParams.panelWidthMm,
      panelHeightMm: ctx.panelParams.panelHeightMm,
      panelOrientation: blockOrient,
      roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
      roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
      metersPerPixel: ctx.roofParams.metersPerPixel,
    };
    if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
      projectOpts.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
      projectOpts.truePerpAxis = ctx.roofParams.truePerpAxis;
    }
    if (Number.isFinite(ctx.roofParams.supportTiltDeg)) {
      projectOpts.supportTiltDeg = ctx.roofParams.supportTiltDeg;
    }
    projectOpts.localRotationDeg = 0;
    var proj;
    try {
      proj = computeProjectedPanelRect(projectOpts);
    } catch (e) {
      return null;
    }
    if (!proj || !proj.points || proj.points.length < 4) return null;
    var rotationDeg = (block.rotation || 0) % 360;
    if (rotationDeg < 0) rotationDeg += 360;
    if (rotationDeg) proj = rotateProjectionByDegrees(proj, center, rotationDeg);
    return proj;
  }

  /**
   * Toiture plate : même chaîne que l’autofill (marge sommets, safe zone si hook global, validateAutofillCandidateDetailed).
   */
  function validateFlatGhostProjection(block, getProjectionContext, projPoints, center, caches) {
    if (!projPoints || projPoints.length < 3 || !center || typeof center.x !== "number" || typeof center.y !== "number") return false;
    var ctx = getProjectionContext();
    if (!ctx || !isFlatRoofContext(ctx)) return true;
    if (!ctx.roofPolygon || ctx.roofPolygon.length < 3) return false;
    if (!caches) caches = buildValidationCaches(block, getProjectionContext);
    if (!caches) return false;
    if (!pointInPolygon(center, ctx.roofPolygon)) return false;
    var rc = ctx.roofConstraints || {};
    var autofillMarginPx = (rc.marginPx != null && Number.isFinite(rc.marginPx)) ? rc.marginPx : 0;
    if (!autofillPanelFullyInsidePanWithMargin(projPoints, ctx.roofPolygon, autofillMarginPx)) return false;
    var szOkFn = (typeof window !== "undefined" && typeof window.__CALPINAGE_GHOST_SAFE_ZONE_OK__ === "function") ? window.__CALPINAGE_GHOST_SAFE_ZONE_OK__ : null;
    if (szOkFn && !szOkFn(projPoints)) return false;
    var hypo = block.panels.length;
    var det = validateAutofillCandidateDetailed(projPoints, caches, block, hypo);
    return !!(det && det.valid);
  }

  // ---------------------------------------------------------------------------
  // API Blocs — délégation à ActivePlacementBlock avec contexte explicite
  // ---------------------------------------------------------------------------

  /**
   * Crée un nouveau bloc actif au centre donné sur le pan.
   *
   * @param {string} panId - Id du pan
   * @param {{ x: number, y: number }} center - Centre en espace image
   * @param {Object} rules - Règles PV (compatibilité, peut être utilisé par le caller)
   * @param {Object} context - Contexte retourné par buildProjectionContext()
   * @returns {{ block: Object | null, success: boolean, reason?: string }}
   */
  function createBlock(panId, center, rules, context) {
    var APB = getAPB();
    if (!APB || typeof APB.createBlock !== "function") {
      return { block: null, success: false, reason: "ActivePlacementBlock indisponible." };
    }
    if (!context || !context.roofPolygon || context.roofPolygon.length < 3 || !context.roofParams || !context.panelParams) {
      return { block: null, success: false, reason: "Contexte de projection incomplet." };
    }
    var mpp = context.roofParams.metersPerPixel;
    if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) {
      return { block: null, success: false, reason: "Échelle (m/px) indisponible — recharge la vue ou refais la capture." };
    }
    var getProjectionContext = function () { return context; };
    var orientationPass = undefined;
    if (rules && rules.orientation != null) {
      var ro = String(rules.orientation).toUpperCase();
      if (ro === "PAYSAGE" || ro === "LANDSCAPE") orientationPass = "PAYSAGE";
      else if (ro === "PORTRAIT") orientationPass = "PORTRAIT";
      else {
        var rl = String(rules.orientation).toLowerCase();
        if (rl === "landscape" || rl === "paysage") orientationPass = "PAYSAGE";
        else if (rl === "portrait") orientationPass = "PORTRAIT";
        else orientationPass = "PORTRAIT";
      }
    }
    var _res = APB.createBlock({
      panId: panId,
      center: center,
      getProjectionContext: getProjectionContext,
      orientation: orientationPass,
    });
    return _res;
  }

  /**
   * Définit le bloc actif (éditable). Un seul bloc actif à la fois.
   *
   * @param {string} blockId - Id du bloc à activer
   * @returns {{ success: boolean, reason?: string }}
   */
  function setActiveBlock(blockId) {
    var APB = getAPB();
    if (!APB || typeof APB.setActiveBlock !== "function") {
      return { success: false, reason: "ActivePlacementBlock indisponible." };
    }
    var ok = APB.setActiveBlock(blockId);
    return { success: ok };
  }

  /**
   * Démarre une manipulation (rotation/déplacement) sur le bloc. À appeler avant setManipulationTransform.
   * @param {string} blockId - Id du bloc à manipuler
   * @returns {boolean} true si le bloc est prêt pour la manipulation
   */
  function beginManipulation(blockId) {
    var APB = getAPB();
    if (!APB || typeof APB.beginManipulation !== "function") return false;
    return APB.beginManipulation(blockId);
  }

  /**
   * Resélectionne un bloc (équivalent à setActiveBlock pour un bloc figé).
   *
   * @param {string} blockId - Id du bloc à resélectionner
   * @returns {{ success: boolean, reason?: string }}
   */
  function reselectBlock(blockId) {
    return setActiveBlock(blockId);
  }

  /**
   * Recalcule les projections de tous les panneaux du bloc à partir des règles et du contexte.
   * Les centres (image) ne sont pas modifiés. Applique block.rotation aux projections.
   *
   * @param {string} blockId - Id du bloc
   * @param {Object} rules - Règles PV (non utilisé ici, contexte porte déjà les infos)
   * @param {Object} context - Contexte retourné par buildProjectionContext()
   * @returns {{ success: boolean, reason?: string }}
   */
  function recomputeBlock(blockId, rules, context, opts) {
    if (typeof window !== "undefined" && window.CALPINAGE_IS_MANIPULATING) return { success: false, reason: "Manipulation en cours." };
    var APB = getAPB();
    if (!APB || typeof APB.recomputeBlockProjections !== "function") {
      return { success: false, reason: "ActivePlacementBlock indisponible." };
    }
    var block = getBlockById(blockId);
    if (!block) return { success: false, reason: "Bloc introuvable." };
    if (!context || !context.roofParams || !context.panelParams) {
      return { success: false, reason: "Contexte de projection incomplet." };
    }
    var getProjectionContext = function () { return context; };
    APB.recomputeBlockProjections(block, getProjectionContext);
    var gridOpts = (opts && opts.pivotPanelId) ? { pivotPanelId: opts.pivotPanelId } : undefined;
    ensureBlockGrid(block, getProjectionContext, gridOpts);
    return { success: true };
  }

  /**
   * Recalcule les projections de tous les panneaux du bloc (objet bloc passé directement).
   * Utilisé après rotation 90° ou quand le contexte change. Applique block.rotation.
   *
   * @param {Object} block - Bloc (actif ou figé)
   * @param {function(): Object} getProjectionContext - Fonction retournant le contexte
   */
  function recomputeBlockProjections(block, getProjectionContext) {
    if (typeof window !== "undefined" && window.CALPINAGE_IS_MANIPULATING) return;
    var APB = getAPB();
    if (!APB || typeof APB.recomputeBlockProjections !== "function" || !block) return;
    if (typeof getProjectionContext !== "function") return;
    APB.recomputeBlockProjections(block, getProjectionContext);
  }

  /**
   * Met à jour panel.state pour chaque panneau du bloc avec la règle unique validatePanelPolygon.
   *
   * @param {Object} block - Bloc (actif ou figé)
   * @param {function(): Object} getProjectionContext - Fonction retournant le contexte (roofPolygon, roofConstraints, etc.)
   */
  function updatePanelValidationForBlock(block, getProjectionContext) {
    if (typeof window !== "undefined" && window.CALPINAGE_IS_MANIPULATING) return;
    if (!block || !block.panels || typeof getProjectionContext !== "function") return;
    var caches = buildValidationCaches(block, getProjectionContext);
    if (!caches) return;
    var forbiddenPolys = caches.forbiddenPolys;
    var roofConstraints = caches.roofConstraints;
    var frozenPolys = caches.frozenPolys;
    var active = caches.active;
    var activePolys = caches.activePolys;
    var blockPolys = caches.blockPolys;
    for (var i = 0; i < block.panels.length; i++) {
      var projPts = blockPolys[i];
      if (!projPts || projPts.length < 3) {
        block.panels[i].state = "invalid";
        continue;
      }
      var ok = validatePanelPolygonIndexed(projPts, forbiddenPolys, roofConstraints, block, i, frozenPolys, active, activePolys, blockPolys);
      block.panels[i].state = ok ? "valid" : "invalid";
    }
  }

  /**
   * Supprime un bloc (actif ou figé). Ne met pas à jour CALPINAGE_STATE.placedPanels (à faire par l'appelant).
   *
   * @param {string} blockId - Id du bloc à supprimer
   * @returns {{ success: boolean, reason?: string }}
   */
  function removeBlock(blockId) {
    var APB = getAPB();
    if (!APB || typeof APB.removeBlock !== "function") {
      return { success: false, reason: "ActivePlacementBlock indisponible." };
    }
    if (!blockId) return { success: false, reason: "blockId requis." };
    APB.removeBlock(blockId);
    return { success: true };
  }

  /**
   * Valide chaque panneau du bloc avec une fonction fournie (sans effet de bord UI).
   * Pour le bloc actif, délègue à updatePanelValidation. Pour un bloc figé, applique la validation
   * en lecture seule sur les panels (sans modifier l’état interne si le bloc n’est pas actif).
   *
   * @param {string} blockId - Id du bloc
   * @param {Object} rules - Règles PV (pass-through pour le caller)
   * @param {Object} context - Contexte (pass-through pour le caller)
   * @param {function(panId: string, centerX: number, centerY: number, existingRects: Array): boolean} validatePanelAtCenter - Validateur (panId, centerX, centerY, existingRects) => boolean
   * @returns {{ success: boolean, valid: boolean, invalidCount?: number }}
   */
  function validateBlock(blockId, rules, context, validatePanelAtCenter) {
    var APB = getAPB();
    if (!APB) return { success: false, valid: false };
    var block = getBlockById(blockId);
    if (!block || !block.panels || typeof validatePanelAtCenter !== "function") {
      return { success: false, valid: false };
    }
    if (block.isActive && typeof APB.updatePanelValidation === "function") {
      APB.updatePanelValidation(function (center, proj, panelIndex) {
        var rects = collectExistingRectsExcluding(block, panelIndex);
        return validatePanelAtCenter(block.panId, center.x, center.y, rects);
      });
      return { success: true, valid: true };
    }
    var invalidCount = 0;
    for (var i = 0; i < block.panels.length; i++) {
      var p = block.panels[i];
      var rects = collectExistingRectsExcluding(block, i);
      if (!validatePanelAtCenter(block.panId, p.center.x, p.center.y, rects)) invalidCount++;
    }
    return { success: true, valid: invalidCount === 0, invalidCount: invalidCount };
  }

  /** Rects des autres panneaux (autres blocs + autres panneaux du même bloc, en excluant excludePanelIndex). */
  function collectExistingRectsExcluding(block, excludePanelIndex) {
    var APB = getAPB();
    var out = [];
    var frozen = APB && typeof APB.getFrozenBlocks === "function" ? APB.getFrozenBlocks() : [];
    var i, j, bl, p, pr, w, h;
    for (i = 0; i < frozen.length; i++) {
      bl = frozen[i];
      if (!bl.panels || bl.id === block.id) continue;
      for (j = 0; j < bl.panels.length; j++) {
        p = bl.panels[j];
        pr = p.projection;
        w = pr && typeof pr.halfLengthPerpPx === "number" ? 2 * pr.halfLengthPerpPx : 0;
        h = pr && typeof pr.halfLengthAlongSlopePx === "number" ? 2 * pr.halfLengthAlongSlopePx : 0;
        out.push({ x: p.center.x, y: p.center.y, widthPx: w, heightPx: h });
      }
    }
    var active = APB && APB.getActiveBlock && APB.getActiveBlock();
    if (active && active.panels && active.id === block.id) {
      for (j = 0; j < active.panels.length; j++) {
        if (j === excludePanelIndex) continue;
        p = active.panels[j];
        if (!p.center || !p.projection) continue;
        pr = p.projection;
        w = pr.halfLengthPerpPx != null ? 2 * pr.halfLengthPerpPx : 0;
        h = pr.halfLengthAlongSlopePx != null ? 2 * pr.halfLengthAlongSlopePx : 0;
        out.push({ x: p.center.x, y: p.center.y, widthPx: w, heightPx: h });
      }
    } else if (block.panels) {
      for (j = 0; j < block.panels.length; j++) {
        if (j === excludePanelIndex) continue;
        p = block.panels[j];
        if (!p.center || !p.projection) continue;
        pr = p.projection;
        w = pr.halfLengthPerpPx != null ? 2 * pr.halfLengthPerpPx : 0;
        h = pr.halfLengthAlongSlopePx != null ? 2 * pr.halfLengthAlongSlopePx : 0;
        out.push({ x: p.center.x, y: p.center.y, widthPx: w, heightPx: h });
      }
    }
    return out;
  }

  function getBlockById(blockId) {
    var APB = getAPB();
    if (!APB) return null;
    var active = APB.getActiveBlock && APB.getActiveBlock();
    if (active && active.id === blockId) return active;
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks();
    if (frozen) {
      for (var i = 0; i < frozen.length; i++) {
        if (frozen[i].id === blockId) return frozen[i];
      }
    }
    return null;
  }

  /**
   * Retourne tous les blocs (actif + figés). Actif en premier s'il existe.
   */
  function getBlocks() {
    var APB = getAPB();
    if (!APB) return [];
    var active = APB.getActiveBlock && APB.getActiveBlock();
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks() || [];
    if (active) return [active].concat(frozen);
    return frozen.slice();
  }

  /**
   * Retourne le bloc actuellement actif (éditable), ou null.
   */
  function getActiveBlock() {
    var APB = getAPB();
    return APB && typeof APB.getActiveBlock === "function" ? APB.getActiveBlock() : null;
  }

  /**
   * Retourne le bloc "focus" : actif s'il existe, sinon le bloc figé sélectionné (APB.getSelectedBlock).
   */
  function getSelectedBlock() {
    var APB = getAPB();
    return APB && typeof APB.getSelectedBlock === "function" ? APB.getSelectedBlock() : null;
  }

  /**
   * Source de vérité unique pour la cible UI : bloc actif ou bloc figé sélectionné.
   * À utiliser pour rotation, ghosts, hit-tests (pas getActiveBlock/getSelectedBlock directement).
   */
  function getFocusBlock() {
    var APB = getAPB();
    if (!APB) return null;
    if (APB.getFocusBlock && typeof APB.getFocusBlock === "function")
      return APB.getFocusBlock();
    return (APB.getActiveBlock ? APB.getActiveBlock() : null) ||
      (APB.getSelectedBlock ? APB.getSelectedBlock() : null) ||
      null;
  }

  /**
   * Fin du bloc actif (clic dans le vide). À appeler depuis l'orchestrateur.
   */
  function endBlock() {
    var APB = getAPB();
    if (APB && typeof APB.endBlock === "function") APB.endBlock();
  }

  /**
   * Désélectionne tout : fige le bloc actif s'il existe et efface la sélection (plus de focusBlock).
   */
  function clearSelection() {
    var APB = getAPB();
    if (APB && typeof APB.clearSelection === "function") APB.clearSelection();
  }

  function isPhase3FixLogs() {
    if (typeof window === "undefined") return false;
    if (window.__PHASE3_FIX_LOGS__ === true) return true;
    try {
      var h = window.location && window.location.hostname;
      return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    } catch (_e) {
      return false;
    }
  }

  function rotateProjectionByDegrees(proj, center, deg) {
    if (!proj || !proj.points || proj.points.length === 0) return proj;
    if (!deg || deg % 360 === 0) return proj;
    var rad = (deg % 360) * (Math.PI / 180);
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var cx = center.x, cy = center.y;
    var out = [];
    for (var i = 0; i < proj.points.length; i++) {
      var p = proj.points[i];
      var dx = p.x - cx, dy = p.y - cy;
      out.push({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos });
    }
    var rotAxis = function (v) {
      if (!v || typeof v.x !== "number") return v;
      return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
    };
    var newSlope = proj.slopeAxis ? rotAxis(proj.slopeAxis) : undefined;
    var newPerp = proj.perpAxis ? rotAxis(proj.perpAxis) : undefined;
    var halfAlong = proj.halfLengthAlongSlopePx;
    var halfPerp = proj.halfLengthPerpPx;
    var rfn =
      (typeof global !== "undefined" && global.recomputeProjectionHalfExtentsFromGeometry) ||
      (typeof window !== "undefined" && window.recomputeProjectionHalfExtentsFromGeometry);
    if (typeof rfn === "function" && newSlope && newPerp && out.length >= 3) {
      var hh = rfn({ x: cx, y: cy }, out, newSlope, newPerp);
      halfAlong = hh.halfLengthAlongSlopePx;
      halfPerp = hh.halfLengthPerpPx;
      if (isPhase3FixLogs()) {
        console.info("[PHASE3-FIX][ROTATION]", {
          where: "rotateProjectionByDegrees",
          deg: deg,
          deltaHalfAlong: Number((halfAlong - proj.halfLengthAlongSlopePx).toFixed(6)),
          deltaHalfPerp: Number((halfPerp - proj.halfLengthPerpPx).toFixed(6)),
          halfAlong: halfAlong,
          halfPerp: halfPerp,
        });
      }
    }
    return {
      points: out,
      slopeAxis: newSlope,
      perpAxis: newPerp,
      halfLengthAlongSlopePx: halfAlong,
      halfLengthPerpPx: halfPerp,
    };
  }

  /**
   * Supprime réellement un panneau du bloc (splice). Recalcule projections et validation.
   *
   * @param {Object} block - Bloc (actif ou figé)
   * @param {number} panelIndex - Index du panneau à supprimer
   * @param {function(): Object} getProjectionContext - Contexte
   * @returns {{ success: boolean, reason?: string }}
   */
  function removePanelAtIndex(block, panelIndex, getProjectionContext) {
    if (!block || !block.panels) return { success: false, reason: "Bloc ou panels absent." };
    if (panelIndex < 0 || panelIndex >= block.panels.length) return { success: false, reason: "Index panneau invalide." };
    if (typeof getProjectionContext !== "function") return { success: false, reason: "Contexte requis." };
    block.panels.splice(panelIndex, 1);
    recomputeBlockProjections(block, getProjectionContext);
    updatePanelValidationForBlock(block, getProjectionContext);
    return { success: true };
  }

  /**
   * Supprime un panneau du bloc par son id (sélection stable).
   *
   * @param {Object} block - Bloc (actif ou figé)
   * @param {string} panelId - Id du panneau à supprimer (ou "legacy-N" pour rétrocompat)
   * @param {function(): Object} getProjectionContext - Contexte
   * @returns {{ success: boolean, reason?: string }}
   */
  function removePanelById(block, panelId, getProjectionContext) {
    if (!block || !panelId) return { success: false, reason: "Bloc ou panelId requis." };
    var idx = -1;
    if (typeof panelId === "string" && panelId.indexOf("legacy-") === 0) {
      idx = parseInt(panelId.slice(7), 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= (block.panels ? block.panels.length : 0)) idx = -1;
    } else {
      var APB = getAPB();
      if (APB && typeof APB.getPanelIndexById === "function") idx = APB.getPanelIndexById(block, panelId);
    }
    return removePanelAtIndex(block, idx, getProjectionContext);
  }

  /**
   * Migration : si des panneaux n'ont pas panel.grid, reconstruit (row,col) à partir des centres et de la projection.
   * Référence c0 = pivotCenter ou centre du pivotPanelId, sinon p0.center (premier panneau).
   *
   * @param {Object} block - Bloc
   * @param {function(): Object} getProjectionContext - Contexte
   * @param {{ pivotPanelId?: string, pivotCenter?: {x:number,y:number} }} [opts] - Pivot optionnel (panneau sélectionné)
   */
  function ensureBlockGrid(block, getProjectionContext, opts) {
    if (!block || !block.panels || block.panels.length === 0 || typeof getProjectionContext !== "function") return;
    var needsGrid = false;
    for (var i = 0; i < block.panels.length; i++) {
      var g = block.panels[i] && block.panels[i].grid;
      if (!g || typeof g.row !== "number" || typeof g.col !== "number") {
        needsGrid = true;
        break;
      }
    }
    if (!needsGrid) return;
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofParams || !ctx.panelParams) return;
    var p0 = null;
    for (var j = 0; j < block.panels.length; j++) {
      var p = block.panels[j];
      if (p && p.center && p.projection && p.projection.points && p.projection.points.length >= 4) {
        p0 = p;
        break;
      }
    }
    if (!p0) return;

    var c0 = p0.center;
    if (opts && opts.pivotCenter && typeof opts.pivotCenter.x === "number" && typeof opts.pivotCenter.y === "number") {
      c0 = opts.pivotCenter;
    } else if (opts && opts.pivotPanelId) {
      var APB = getAPB();
      var idx = APB && typeof APB.getPanelIndexById === "function" ? APB.getPanelIndexById(block, opts.pivotPanelId) : -1;
      if (idx >= 0 && block.panels[idx] && block.panels[idx].center) {
        c0 = block.panels[idx].center;
      }
    }

    var proj = p0.projection;
    var slopeAxis = proj.slopeAxis || { x: 1, y: 0 };
    var perpAxis = proj.perpAxis || { x: 0, y: 1 };
    var normSlope = Math.hypot(slopeAxis.x, slopeAxis.y) || 1;
    slopeAxis = { x: slopeAxis.x / normSlope, y: slopeAxis.y / normSlope };
    var normPerp = Math.hypot(perpAxis.x, perpAxis.y) || 1;
    perpAxis = { x: perpAxis.x / normPerp, y: perpAxis.y / normPerp };

    var halfAlong = proj.halfLengthAlongSlopePx || 0;
    var halfPerp = proj.halfLengthPerpPx || 0;
    var mpp = ctx.roofParams.metersPerPixel;
    var pvRules = ctx.pvRules || {};
    var cmToPx = (typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0) ? (1 / 100) / mpp : 0;
    var spacingPanels = Number.isFinite(pvRules.spacingXcm) ? pvRules.spacingXcm : 0;
    var spacingRows = Number.isFinite(pvRules.spacingYcm) ? pvRules.spacingYcm : 0;
    var spacingAlongPx = spacingRows * cmToPx;
    var spacingPerpPx = spacingPanels * cmToPx;
    var stepAlong = 2 * halfAlong + spacingAlongPx;
    var stepPerp = 2 * halfPerp + spacingPerpPx;
    if (stepAlong <= 0) stepAlong = 1;
    if (stepPerp <= 0) stepPerp = 1;

    if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
      console.log("[PV_AUDIT][GRID]", block.id, halfAlong, halfPerp, stepAlong, stepPerp, spacingAlongPx, spacingPerpPx, "slopeAxis:" + slopeAxis.x + "," + slopeAxis.y, "perpAxis:" + perpAxis.x + "," + perpAxis.y);
    }
    for (var k = 0; k < block.panels.length; k++) {
      var pi = block.panels[k];
      var ci = pi.center;
      if (!ci || typeof ci.x !== "number" || typeof ci.y !== "number") continue;
      var dx = ci.x - c0.x, dy = ci.y - c0.y;
      var u = (dx * slopeAxis.x + dy * slopeAxis.y) / stepAlong;
      var v = (dx * perpAxis.x + dy * perpAxis.y) / stepPerp;
      var row = Math.round(u);
      var col = Math.round(v);
      pi.grid = { row: row, col: col };
    }
  }

  /**
   * Calcule les ghosts d'extension de façon PURE : ne modifie aucune propriété de block,
   * aucune projection existante. Utilise uniquement block.panels, panel.center, panel.rotation
   * et dimensions du contexte. Tous les calculs utilisent des objets temporaires.
   * Ne doit jamais appeler recomputeProjections, updateProjection, commitManipulation, applyTransform.
   *
   * @param {Object} block - Bloc (actif ou figé)
   * @param {function(): Object} getProjectionContext - Contexte
   * @returns {Array<{ center: {x,y}, rotationDeg: number, projection: { points: Array<{x,y}> } }>}
   */
  function computeExpansionGhosts(block, getProjectionContext) {
    if (typeof window !== "undefined" && window.CALPINAGE_IS_MANIPULATING) return [];
    if (!block || !block.panels || typeof getProjectionContext !== "function") return [];
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofParams || !ctx.panelParams) return [];

    var panels = block.panels;
    if (panels.length === 0) return [];
    var computeProjectedPanelRect = getComputeProjectedPanelRect();
    if (typeof computeProjectedPanelRect !== "function") return [];

    var mpp = ctx.roofParams.metersPerPixel;
    var pvRules = ctx.pvRules || {};
    var cmToPx = (typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0) ? (1 / 100) / mpp : 0;
    var spacingAlongPx = (Number.isFinite(pvRules.spacingYcm) ? pvRules.spacingYcm : 0) * cmToPx;
    var spacingPerpPx = (Number.isFinite(pvRules.spacingXcm) ? pvRules.spacingXcm : 0) * cmToPx;

    var rotationDeg = (block.rotation || 0) % 360;
    if (rotationDeg < 0) rotationDeg += 360;

    var projectOptsBase = {
      panelWidthMm: ctx.panelParams.panelWidthMm,
      panelHeightMm: ctx.panelParams.panelHeightMm,
      panelOrientation: normalizePanelOrientationStr(ctx.panelParams.panelOrientation),
      roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
      roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
      metersPerPixel: ctx.roofParams.metersPerPixel,
    };
    if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
      projectOptsBase.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
      projectOptsBase.truePerpAxis = ctx.roofParams.truePerpAxis;
    }
    if (Number.isFinite(ctx.roofParams.supportTiltDeg)) {
      projectOptsBase.supportTiltDeg = ctx.roofParams.supportTiltDeg;
    }
    if (typeof ctx.panelParams.localRotationDeg === "number") {
      projectOptsBase.localRotationDeg = ctx.panelParams.localRotationDeg;
    }

    var firstCenter = null;
    for (var f = 0; f < panels.length; f++) {
      var pc = panels[f].center;
      if (pc && typeof pc.x === "number" && typeof pc.y === "number") {
        firstCenter = { x: pc.x, y: pc.y };
        break;
      }
    }
    if (!firstCenter) return [];

    var refProjOpts = { center: { x: firstCenter.x, y: firstCenter.y }, panelWidthMm: projectOptsBase.panelWidthMm, panelHeightMm: projectOptsBase.panelHeightMm, panelOrientation: projectOptsBase.panelOrientation, roofSlopeDeg: projectOptsBase.roofSlopeDeg, roofOrientationDeg: projectOptsBase.roofOrientationDeg, metersPerPixel: projectOptsBase.metersPerPixel };
    if (projectOptsBase.trueSlopeAxis && projectOptsBase.truePerpAxis) { refProjOpts.trueSlopeAxis = projectOptsBase.trueSlopeAxis; refProjOpts.truePerpAxis = projectOptsBase.truePerpAxis; }
    if (Number.isFinite(projectOptsBase.supportTiltDeg)) { refProjOpts.supportTiltDeg = projectOptsBase.supportTiltDeg; }
    if (typeof projectOptsBase.localRotationDeg === "number") { refProjOpts.localRotationDeg = projectOptsBase.localRotationDeg; }
    var refProj;
    try {
      refProj = computeProjectedPanelRect(refProjOpts);
    } catch (e) { return []; }
    if (!refProj || !refProj.points || refProj.points.length < 4) return [];
    if (rotationDeg) refProj = rotateProjectionByDegrees(refProj, firstCenter, rotationDeg);

    var slopeAxis = refProj.slopeAxis || { x: 1, y: 0 };
    var perpAxis = refProj.perpAxis || { x: 0, y: 1 };
    var normSlope = Math.hypot(slopeAxis.x, slopeAxis.y) || 1;
    slopeAxis = { x: slopeAxis.x / normSlope, y: slopeAxis.y / normSlope };
    var normPerp = Math.hypot(perpAxis.x, perpAxis.y) || 1;
    perpAxis = { x: perpAxis.x / normPerp, y: perpAxis.y / normPerp };

    var halfAlong = refProj.halfLengthAlongSlopePx != null ? refProj.halfLengthAlongSlopePx : 0;
    var halfPerp = refProj.halfLengthPerpPx != null ? refProj.halfLengthPerpPx : 0;
    var stepAlong = 2 * halfAlong + spacingAlongPx;
    var stepPerp = 2 * halfPerp + spacingPerpPx;
    if (stepAlong <= 0) stepAlong = 1;
    if (stepPerp <= 0) stepPerp = 1;

    var ghostCachesFlat = null;
    if (isFlatRoofContext(ctx)) {
      ghostCachesFlat = buildValidationCaches(block, getProjectionContext);
      if (!ghostCachesFlat) return [];
    }

    if ((typeof global !== "undefined" && global.DEBUG_PV_ORIENT) || (typeof window !== "undefined" && window.DEBUG_PV_ORIENT)) {
      console.log("[DEBUG_PV_ORIENT] computeExpansionGhosts", { stepAlongPx: stepAlong, stepPerpPx: stepPerp });
    }

    var debugWidth = (typeof global !== "undefined" && global.DEBUG_CALPINAGE_WIDTH) || (typeof window !== "undefined" && window.DEBUG_CALPINAGE_WIDTH);
    if (debugWidth && Number.isFinite(mpp) && mpp > 0) {
      var largeurProjeteeAlongM = (2 * halfAlong) * mpp;
      var largeurProjeteePerpM = (2 * halfPerp) * mpp;
      var stepAlongM = stepAlong * mpp;
      var stepPerpM = stepPerp * mpp;
      var spacingAlongM = spacingAlongPx * mpp;
      var spacingPerpM = spacingPerpPx * mpp;
      var largeurUtilePanM = null;
      var longueurUtilePanM = null;
      var nombreMaxTheoriquePerp = null;
      var nombreMaxTheoriqueAlong = null;
      if (ctx.roofPolygon && ctx.roofPolygon.length >= 3 && perpAxis && slopeAxis) {
        var pax = perpAxis.x, pay = perpAxis.y;
        var sax = slopeAxis.x, say = slopeAxis.y;
        var minP = Infinity, maxP = -Infinity, minA = Infinity, maxA = -Infinity;
        for (var qi = 0; qi < ctx.roofPolygon.length; qi++) {
          var pt = ctx.roofPolygon[qi];
          var px = pt.x != null ? pt.x : pt[0], py = pt.y != null ? pt.y : pt[1];
          var projP = px * pax + py * pay;
          var projA = px * sax + py * say;
          if (projP < minP) minP = projP;
          if (projP > maxP) maxP = projP;
          if (projA < minA) minA = projA;
          if (projA > maxA) maxA = projA;
        }
        if (minP !== Infinity && maxP !== -Infinity) {
          largeurUtilePanM = (maxP - minP) * mpp;
          if (stepPerpM > 0) nombreMaxTheoriquePerp = Math.floor(largeurUtilePanM / stepPerpM);
        }
        if (minA !== Infinity && maxA !== -Infinity) {
          longueurUtilePanM = (maxA - minA) * mpp;
          if (stepAlongM > 0) nombreMaxTheoriqueAlong = Math.floor(longueurUtilePanM / stepAlongM);
        }
      }
      console.log("[computeExpansionGhosts] DIAG pas largeur / pan", {
        panelWidthMm: ctx.panelParams.panelWidthMm,
        panelHeightMm: ctx.panelParams.panelHeightMm,
        panelOrientation: ctx.panelParams.panelOrientation,
        halfAlongPx: halfAlong,
        halfPerpPx: halfPerp,
        largeurProjetee1PanneauAlongM: largeurProjeteeAlongM,
        largeurProjetee1PanneauPerpM: largeurProjeteePerpM,
        spacingXcm: pvRules.spacingXcm,
        spacingYcm: pvRules.spacingYcm,
        spacingAlongM: spacingAlongM,
        spacingPerpM: spacingPerpM,
        stepAlongPx: stepAlong,
        stepPerpPx: stepPerp,
        stepAlongM: stepAlongM,
        stepPerpM: stepPerpM,
        largeurUtilePanM: largeurUtilePanM,
        longueurUtilePanM: longueurUtilePanM,
        nombreMaxTheoriquePerp: nombreMaxTheoriquePerp,
        nombreMaxTheoriqueAlong: nombreMaxTheoriqueAlong,
      });
    }

    var candidateCenters = [];
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      var center = p.center;
      if (!center || typeof center.x !== "number" || typeof center.y !== "number") continue;
      var cx = center.x;
      var cy = center.y;
      candidateCenters.push({ center: { x: cx - stepAlong * slopeAxis.x, y: cy - stepAlong * slopeAxis.y } });
      candidateCenters.push({ center: { x: cx + stepAlong * slopeAxis.x, y: cy + stepAlong * slopeAxis.y } });
      candidateCenters.push({ center: { x: cx - stepPerp * perpAxis.x, y: cy - stepPerp * perpAxis.y } });
      candidateCenters.push({ center: { x: cx + stepPerp * perpAxis.x, y: cy + stepPerp * perpAxis.y } });
    }

    var TOL = 1;
    function sameCenter(a, b) {
      return Math.abs(a.x - b.x) <= TOL && Math.abs(a.y - b.y) <= TOL;
    }
    var deduped = [];
    for (var k = 0; k < candidateCenters.length; k++) {
      var cand = candidateCenters[k];
      var dup = false;
      for (var d = 0; d < deduped.length; d++) {
        if (sameCenter(deduped[d].center, cand.center)) {
          dup = true;
          break;
        }
      }
      if (!dup) deduped.push(cand);
    }

    var ghosts = [];
    for (var g = 0; g < deduped.length; g++) {
      var item = deduped[g];
      var c = item.center;
      var projectOpts = { center: { x: c.x, y: c.y }, panelWidthMm: projectOptsBase.panelWidthMm, panelHeightMm: projectOptsBase.panelHeightMm, panelOrientation: projectOptsBase.panelOrientation, roofSlopeDeg: projectOptsBase.roofSlopeDeg, roofOrientationDeg: projectOptsBase.roofOrientationDeg, metersPerPixel: projectOptsBase.metersPerPixel };
      if (projectOptsBase.trueSlopeAxis && projectOptsBase.truePerpAxis) { projectOpts.trueSlopeAxis = projectOptsBase.trueSlopeAxis; projectOpts.truePerpAxis = projectOptsBase.truePerpAxis; }
      if (Number.isFinite(projectOptsBase.supportTiltDeg)) { projectOpts.supportTiltDeg = projectOptsBase.supportTiltDeg; }
      if (typeof projectOptsBase.localRotationDeg === "number") { projectOpts.localRotationDeg = projectOptsBase.localRotationDeg; }
      var proj;
      try {
        proj = computeProjectedPanelRect(projectOpts);
      } catch (e) { continue; }
      if (!proj || !proj.points || proj.points.length < 4) continue;
      if (rotationDeg) proj = rotateProjectionByDegrees(proj, c, rotationDeg);

      if (isFlatRoofContext(ctx)) {
        if (!ghostCachesFlat) continue;
        if (!validateFlatGhostProjection(block, getProjectionContext, proj.points, c, ghostCachesFlat)) continue;
      }

      var pointsCopy = [];
      for (var pi = 0; pi < proj.points.length; pi++) pointsCopy.push({ x: proj.points[pi].x, y: proj.points[pi].y });
      ghosts.push({
        center: { x: c.x, y: c.y },
        rotationDeg: rotationDeg,
        projection: { points: pointsCopy },
      });
    }
    if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
      var panelOrient = (ctx.panelParams && ctx.panelParams.panelOrientation) || "PORTRAIT";
      var localRot = (ctx.panelParams && typeof ctx.panelParams.localRotationDeg === "number") ? ctx.panelParams.localRotationDeg : "(none)";
      console.log("[PV_AUDIT][GHOSTS]", block.id, panelOrient, localRot, halfAlong, halfPerp, stepAlong, stepPerp, spacingAlongPx, spacingPerpPx, ghosts.length);
    }
    return ghosts;
  }

  /**
   * Polygones de tous les panneaux existants (figés + actif) pour validation d'un panneau hypothétique.
   */
  function collectAllExistingPanelPolysForAutofill() {
    var out = [];
    var APB = getAPB();
    if (!APB) return out;
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks() ? APB.getFrozenBlocks() : [];
    var active = APB.getActiveBlock && APB.getActiveBlock();
    var i, j, bl, p, proj;
    for (i = 0; i < frozen.length; i++) {
      bl = frozen[i];
      if (!bl.panels) continue;
      for (j = 0; j < bl.panels.length; j++) {
        p = bl.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(bl, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    if (active && active.panels) {
      for (j = 0; j < active.panels.length; j++) {
        p = active.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(active, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    return out;
  }

  function isCenterOccupiedByExistingPanel(center, tolerancePx) {
    var TOL = tolerancePx != null ? tolerancePx : 1;
    var APB = getAPB();
    if (!APB || !center) return false;
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks() ? APB.getFrozenBlocks() : [];
    var active = APB.getActiveBlock && APB.getActiveBlock();
    function checkBlock(bl) {
      if (!bl || !bl.panels) return false;
      for (var j = 0; j < bl.panels.length; j++) {
        var c = bl.panels[j].center;
        if (!c || typeof c.x !== "number" || typeof c.y !== "number") continue;
        if (Math.abs(c.x - center.x) <= TOL && Math.abs(c.y - center.y) <= TOL) return true;
      }
      return false;
    }
    for (var i = 0; i < frozen.length; i++) {
      if (checkBlock(frozen[i])) return true;
    }
    if (active && checkBlock(active)) return true;
    return false;
  }

  function collectAllExistingPanelPolysForAutofillExcludingPan(excludePanId) {
    if (!excludePanId) return collectAllExistingPanelPolysForAutofill();
    var out = [];
    var APB = getAPB();
    if (!APB) return out;
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks() ? APB.getFrozenBlocks() : [];
    var active = APB.getActiveBlock && APB.getActiveBlock();
    var i, j, bl, p, proj;
    for (i = 0; i < frozen.length; i++) {
      bl = frozen[i];
      if (!bl || bl.panId === excludePanId || !bl.panels) continue;
      for (j = 0; j < bl.panels.length; j++) {
        p = bl.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(bl, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    if (active && active.panId !== excludePanId && active.panels) {
      for (j = 0; j < active.panels.length; j++) {
        p = active.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(active, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    return out;
  }

  function isCenterOccupiedByExistingPanelExcludingPan(center, tolerancePx, excludePanId) {
    var TOL = tolerancePx != null ? tolerancePx : 1;
    var APB = getAPB();
    if (!APB || !center) return false;
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks() ? APB.getFrozenBlocks() : [];
    var active = APB.getActiveBlock && APB.getActiveBlock();
    function checkBlock(bl) {
      if (!bl || (excludePanId && bl.panId === excludePanId) || !bl.panels) return false;
      for (var j = 0; j < bl.panels.length; j++) {
        var c = bl.panels[j].center;
        if (!c || typeof c.x !== "number" || typeof c.y !== "number") continue;
        if (Math.abs(c.x - center.x) <= TOL && Math.abs(c.y - center.y) <= TOL) return true;
      }
      return false;
    }
    for (var i = 0; i < frozen.length; i++) {
      if (checkBlock(frozen[i])) return true;
    }
    if (active && checkBlock(active)) return true;
    return false;
  }

  /**
   * Retire tous les blocs figés sur ce pan, puis vide le bloc actif s’il est sur ce pan (prépare auto-implantation optimale).
   */
  function clearPlacementOnPanForOptimize(panId, getProjectionContext) {
    if (!panId || typeof getProjectionContext !== "function") {
      return { success: false, reason: "panId et getProjectionContext requis." };
    }
    var APB = getAPB();
    if (!APB) return { success: false, reason: "ActivePlacementBlock indisponible." };
    var active = APB.getActiveBlock && APB.getActiveBlock();
    var frozen = APB.getFrozenBlocks && APB.getFrozenBlocks() ? APB.getFrozenBlocks().slice() : [];
    var idsToRemove = [];
    for (var i = 0; i < frozen.length; i++) {
      var bl = frozen[i];
      if (bl && bl.panId === panId && (!active || bl.id !== active.id)) idsToRemove.push(bl.id);
    }
    for (var r = 0; r < idsToRemove.length; r++) removeBlock(idsToRemove[r]);
    active = APB.getActiveBlock && APB.getActiveBlock();
    if (active && active.panId === panId && active.panels) {
      while (active.panels.length > 0) {
        removePanelAtIndex(active, active.panels.length - 1, getProjectionContext);
      }
    }
    return { success: true };
  }

  /**
   * Auto-remplissage : tous les sommets du polygone projeté dans le pan + marge bord (aligné sur l’overlay rouge / règles marges).
   * Indépendant de __CALPINAGE_PV_STRICT__ — évite les propositions « centre dedans mais coin hors pan ».
   */
  function autofillPanelFullyInsidePanWithMargin(panelPoly, panPoly, marginPx) {
    if (!panelPoly || panelPoly.length < 3 || !panPoly || panPoly.length < 3) return false;
    var mpx = (marginPx != null && Number.isFinite(marginPx)) ? marginPx : 0;
    for (var vi = 0; vi < panelPoly.length; vi++) {
      var pt = panelPoly[vi];
      if (!pt || typeof pt.x !== "number" || typeof pt.y !== "number") return false;
      if (!pointInPolygon(pt, panPoly)) return false;
      if (mpx > 0) {
        var distToEdge = minDistancePointToPolygonEdges(pt, panPoly);
        if (distToEdge < mpx) return false;
      }
    }
    return true;
  }

  /**
   * Grille auto-fill : même trame que computeExpansionGhosts — ancrage sur le premier panneau réel du bloc
   * (centre + projection de référence). Les centres déjà occupés (tous pans / blocs figés inclus) sont exclus du commit.
   * Par défaut : parcours de toute la bbox du pan en indices (u,v), sans plafond 64/200 (hangars).
   * maxGridCells : garde-fou perf / mémoire (défaut 500000). maxCommit / maxGridSpan : optionnels (rétrocompat tests).
   * @param {{ maxCommit?: number, maxPreviewItems?: number, maxGridSpan?: number, maxGridCells?: number, optimizePan?: boolean }} [opts]
   */
  function computeAutofillGridPreview(block, getProjectionContext, opts) {
    opts = opts || {};
    var maxCommitCap = (typeof opts.maxCommit === "number" && Number.isFinite(opts.maxCommit) && opts.maxCommit >= 0)
      ? Math.floor(opts.maxCommit)
      : null;
    var maxPreviewItems = (typeof opts.maxPreviewItems === "number" && Number.isFinite(opts.maxPreviewItems) && opts.maxPreviewItems >= 0)
      ? Math.floor(opts.maxPreviewItems)
      : 350000;
    var legacyGridSpanClamp = (typeof opts.maxGridSpan === "number" && Number.isFinite(opts.maxGridSpan) && opts.maxGridSpan > 0);
    var maxGridSpanLegacy = legacyGridSpanClamp ? Math.floor(opts.maxGridSpan) : 0;
    var maxGridCells = (typeof opts.maxGridCells === "number" && Number.isFinite(opts.maxGridCells) && opts.maxGridCells > 0)
      ? Math.floor(opts.maxGridCells)
      : 500000;
    if (!block || !block.panels || block.panels.length === 0 || typeof getProjectionContext !== "function") {
      return { success: false, reason: "Bloc sans panneau ou contexte invalide." };
    }
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofParams || !ctx.panelParams) {
      return { success: false, reason: "Contexte de projection incomplet." };
    }
    var flatRoofAf = isFlatRoofContext(ctx);
    var roofPolygon = ctx.roofPolygon;
    if (!roofPolygon || roofPolygon.length < 3) {
      return { success: false, reason: "Polygone de pan indisponible." };
    }
    var computeProjectedPanelRect = getComputeProjectedPanelRect();
    if (typeof computeProjectedPanelRect !== "function") {
      return { success: false, reason: "computeProjectedPanelRect indisponible." };
    }

    var panelOrientationStr = normalizePanelOrientationStr(ctx.panelParams.panelOrientation);
    var panels = block.panels;
    var APBaf = getAPB();
    var refCenter = null;
    /* FLAT : même pivot que computeExpansionGhosts (premier panel.center), pas getEffectivePanelCenter (manip). */
    if (!flatRoofAf && APBaf && typeof APBaf.getEffectivePanelCenter === "function" && panels.length > 0) {
      var eff0 = APBaf.getEffectivePanelCenter(block, 0);
      if (eff0 && typeof eff0.x === "number" && typeof eff0.y === "number") {
        refCenter = { x: eff0.x, y: eff0.y };
      }
    }
    if (!refCenter) {
      for (var f0 = 0; f0 < panels.length; f0++) {
        var pc0 = panels[f0].center;
        if (pc0 && typeof pc0.x === "number" && typeof pc0.y === "number") {
          refCenter = { x: pc0.x, y: pc0.y };
          break;
        }
      }
    }
    if (!refCenter) {
      return { success: false, reason: "Centre de référence introuvable." };
    }
    var gridBase = { x: refCenter.x, y: refCenter.y };

    var mpp = ctx.roofParams.metersPerPixel;
    var pvRules = ctx.pvRules || {};
    var cmToPx = (typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0) ? (1 / 100) / mpp : 0;

    var spacingAlongPx = (Number.isFinite(pvRules.spacingYcm) ? pvRules.spacingYcm : 0) * cmToPx;
    var spacingPerpPx = (Number.isFinite(pvRules.spacingXcm) ? pvRules.spacingXcm : 0) * cmToPx;

    var rotationDeg = (block.rotation || 0) % 360;
    if (rotationDeg < 0) rotationDeg += 360;
    /* FLAT : uniquement block.rotation — aligné sur computeExpansionGhosts (pas manipulationTransform.rotationDeg). */
    if (!flatRoofAf && block.manipulationTransform && typeof block.manipulationTransform.rotationDeg === "number" && Number.isFinite(block.manipulationTransform.rotationDeg)) {
      rotationDeg = (rotationDeg + block.manipulationTransform.rotationDeg) % 360;
      if (rotationDeg < 0) rotationDeg += 360;
    }

    var projectOptsBase = {
      panelWidthMm: ctx.panelParams.panelWidthMm,
      panelHeightMm: ctx.panelParams.panelHeightMm,
      panelOrientation: normalizePanelOrientationStr(ctx.panelParams.panelOrientation),
      roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
      roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
      metersPerPixel: ctx.roofParams.metersPerPixel,
    };
    if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
      projectOptsBase.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
      projectOptsBase.truePerpAxis = ctx.roofParams.truePerpAxis;
    }
    if (Number.isFinite(ctx.roofParams.supportTiltDeg)) {
      projectOptsBase.supportTiltDeg = ctx.roofParams.supportTiltDeg;
    }
    var firstPlaced = panels[0];
    if (firstPlaced && typeof firstPlaced.localRotationDeg === "number" && Number.isFinite(firstPlaced.localRotationDeg)) {
      projectOptsBase.localRotationDeg = firstPlaced.localRotationDeg;
    } else if (typeof ctx.panelParams.localRotationDeg === "number") {
      projectOptsBase.localRotationDeg = ctx.panelParams.localRotationDeg;
    }

    var refProjOpts = { center: { x: refCenter.x, y: refCenter.y } };
    for (var rk in projectOptsBase) if (projectOptsBase.hasOwnProperty(rk)) refProjOpts[rk] = projectOptsBase[rk];
    var refProj;
    try { refProj = computeProjectedPanelRect(refProjOpts); } catch (e) { return { success: false, reason: "Erreur projection référence." }; }
    if (!refProj || !refProj.points || refProj.points.length < 4) return { success: false, reason: "Projection de référence invalide." };
    if (rotationDeg) refProj = rotateProjectionByDegrees(refProj, refCenter, rotationDeg);

    var slopeAxis = refProj.slopeAxis || { x: 1, y: 0 };
    var perpAxis = refProj.perpAxis || { x: 0, y: 1 };
    var normSlope = Math.hypot(slopeAxis.x, slopeAxis.y) || 1;
    slopeAxis = { x: slopeAxis.x / normSlope, y: slopeAxis.y / normSlope };
    var normPerp = Math.hypot(perpAxis.x, perpAxis.y) || 1;
    perpAxis = { x: perpAxis.x / normPerp, y: perpAxis.y / normPerp };

    var halfAlong = refProj.halfLengthAlongSlopePx != null ? refProj.halfLengthAlongSlopePx : 0;
    var halfPerp = refProj.halfLengthPerpPx != null ? refProj.halfLengthPerpPx : 0;
    var stepAlong = 2 * halfAlong + spacingAlongPx;
    var stepPerp = 2 * halfPerp + spacingPerpPx;
    if (stepAlong <= 0) stepAlong = 1;
    if (stepPerp <= 0) stepPerp = 1;

    var validationCaches = buildValidationCaches(block, getProjectionContext);
    if (!validationCaches) {
      return { success: false, reason: "Contexte de validation indisponible." };
    }
    var hypotheticalPanelIndex = block.panels.length;

    function runGridAtAnchor(anchor, collectPreview) {
      var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (var qi = 0; qi < roofPolygon.length; qi++) {
        var rpt = roofPolygon[qi];
        var rdx = rpt.x - anchor.x, rdy = rpt.y - anchor.y;
        var ru = (rdx * slopeAxis.x + rdy * slopeAxis.y) / stepAlong;
        var rv = (rdx * perpAxis.x + rdy * perpAxis.y) / stepPerp;
        if (ru < minU) minU = ru;
        if (ru > maxU) maxU = ru;
        if (rv < minV) minV = rv;
        if (rv > maxV) maxV = rv;
      }
      var iuMin = Math.floor(minU) - 1;
      var iuMax = Math.ceil(maxU) + 1;
      var ivMin = Math.floor(minV) - 1;
      var ivMax = Math.ceil(maxV) + 1;
      if (legacyGridSpanClamp) {
        iuMin = Math.max(-maxGridSpanLegacy, iuMin);
        iuMax = Math.min(maxGridSpanLegacy, iuMax);
        ivMin = Math.max(-maxGridSpanLegacy, ivMin);
        ivMax = Math.min(maxGridSpanLegacy, ivMax);
      }

      var nCells = (iuMax - iuMin + 1) * (ivMax - ivMin + 1);
      if (nCells > maxGridCells) {
        return {
          validCenters: [],
          previewItems: [],
          gridSpanU: iuMax - iuMin,
          gridSpanV: ivMax - ivMin,
          validGeometryCount: 0,
          geometryCandidatesChecked: 0,
          slotsInPanCount: 0,
          aborted: true,
          abortNCells: nCells,
          abortMaxGridCells: maxGridCells,
        };
      }

      var validList = [];
      var previewList = [];
      var validGeometryCount = 0;
      var geometryCandidatesChecked = 0;
      var slotsInPanCount = 0;
      var rcMargin = validationCaches.roofConstraints || {};
      var autofillMarginPx = (rcMargin.marginPx != null && Number.isFinite(rcMargin.marginPx)) ? rcMargin.marginPx : 0;
      var szOkFn = (typeof window !== "undefined" && window.__CALPINAGE_AUTOFILL_SAFE_ZONE_OK__);
      var occTolPx = 1;

      function copyCorners(pts) {
        var out = [];
        for (var ci = 0; ci < pts.length; ci++) out.push({ x: pts[ci].x, y: pts[ci].y });
        return out;
      }

      function pushPreviewItem(iu, iv, cx, cy, proj, valid, detail) {
        if (!collectPreview || previewList.length >= maxPreviewItems) return;
        var corners = proj && proj.points ? copyCorners(proj.points) : [];
        var item = {
          id: "autofill-" + block.id + "-" + iu + "-" + iv,
          center: { x: cx, y: cy },
          corners: corners,
          orientation: panelOrientationStr,
          rotationDeg: rotationDeg,
          projection: proj,
          valid: valid,
          invalidReason: detail && detail.invalidReason != null ? detail.invalidReason : null,
          collidesExisting: !!(detail && detail.collidesExisting),
          outOfBounds: !!(detail && detail.outOfBounds),
          overlapsKeepout: !!(detail && detail.overlapsKeepout),
          overlapsObstacle: !!(detail && detail.overlapsObstacle),
          overlapsPanel: !!(detail && detail.overlapsPanel),
          iu: iu,
          iv: iv,
        };
        previewList.push(item);
      }

      for (var iu = iuMin; iu <= iuMax; iu++) {
        for (var iv = ivMin; iv <= ivMax; iv++) {
          var cx = anchor.x + iu * stepAlong * slopeAxis.x + iv * stepPerp * perpAxis.x;
          var cy = anchor.y + iu * stepAlong * slopeAxis.y + iv * stepPerp * perpAxis.y;
          var candidate = { x: cx, y: cy };

          var projectOpts = { center: { x: cx, y: cy } };
          for (var pk in projectOptsBase) if (projectOptsBase.hasOwnProperty(pk)) projectOpts[pk] = projectOptsBase[pk];

          var proj;
          try { proj = computeProjectedPanelRect(projectOpts); } catch (eProj) { continue; }
          if (!proj || !proj.points || proj.points.length < 4) continue;
          if (rotationDeg) proj = rotateProjectionByDegrees(proj, candidate, rotationDeg);

          if (!pointInPolygon(candidate, roofPolygon)) {
            pushPreviewItem(iu, iv, cx, cy, proj, false, {
              invalidReason: "center_outside_pan",
              outOfBounds: true,
            });
            continue;
          }
          slotsInPanCount++;

          if (isCenterOccupiedByExistingPanel(candidate, occTolPx)) {
            pushPreviewItem(iu, iv, cx, cy, proj, false, {
              invalidReason: "collides_existing",
              collidesExisting: true,
            });
            continue;
          }

          if (!autofillPanelFullyInsidePanWithMargin(proj.points, roofPolygon, autofillMarginPx)) {
            pushPreviewItem(iu, iv, cx, cy, proj, false, {
              invalidReason: "vertex_outside_or_margin",
              outOfBounds: true,
            });
            continue;
          }

          if (typeof szOkFn === "function" && !szOkFn(proj.points)) {
            pushPreviewItem(iu, iv, cx, cy, proj, false, {
              invalidReason: "safe_zone",
              overlapsKeepout: true,
            });
            continue;
          }

          geometryCandidatesChecked++;
          var det = validateAutofillCandidateDetailed(
            proj.points,
            validationCaches,
            block,
            hypotheticalPanelIndex
          );
          if (!det.valid) {
            pushPreviewItem(iu, iv, cx, cy, proj, false, det);
            continue;
          }
          validGeometryCount++;
          pushPreviewItem(iu, iv, cx, cy, proj, true, det);
          if (maxCommitCap === null || validList.length < maxCommitCap) {
            validList.push({ x: cx, y: cy, iu: iu, iv: iv });
          }
        }
      }

      validList.sort(function (a, b) {
        if (a.iv !== b.iv) return a.iv - b.iv;
        return a.iu - b.iu;
      });
      var centersOnly = [];
      for (var si = 0; si < validList.length; si++) centersOnly.push({ x: validList[si].x, y: validList[si].y });

      return {
        validCenters: centersOnly,
        previewItems: previewList,
        gridSpanU: iuMax - iuMin,
        gridSpanV: ivMax - ivMin,
        validGeometryCount: validGeometryCount,
        geometryCandidatesChecked: geometryCandidatesChecked,
        slotsInPanCount: slotsInPanCount,
      };
    }

    var full = runGridAtAnchor(gridBase, true);
    if (full.aborted) {
      return {
        success: false,
        reason: "Auto-remplissage : surface trop grande pour une passe (" + full.abortNCells + " cases > " + full.abortMaxGridCells + "). Zoomez ou divisez le relevé.",
        validCenters: [],
        previewItems: [],
        stats: {
          candidatesAnalyzed: 0,
          validFound: 0,
          validGeometryInPan: 0,
          previewCount: 0,
          gridSpanU: full.gridSpanU,
          gridSpanV: full.gridSpanV,
          autofillGridNudge: null,
          aborted: true,
          abortNCells: full.abortNCells,
        },
      };
    }
    var validCenters = full.validCenters;
    var previewItems = full.previewItems;

    return {
      success: true,
      validCenters: validCenters,
      previewItems: previewItems,
      stats: {
        candidatesAnalyzed: full.slotsInPanCount != null ? full.slotsInPanCount : (full.geometryCandidatesChecked || previewItems.length),
        validFound: validCenters.length,
        validGeometryInPan: full.validGeometryCount != null ? full.validGeometryCount : validCenters.length,
        previewCount: previewItems.length,
        gridSpanU: full.gridSpanU,
        gridSpanV: full.gridSpanV,
        autofillGridNudge: null,
      },
    };
  }

  /**
   * Filtre les centres à commit : pas de doublon entre eux, pas de centre déjà occupé (tous blocs).
   */
  function filterAutofillCommitCenters(centers, tolerancePx) {
    if (!centers || centers.length === 0) return [];
    var TOL = tolerancePx != null && Number.isFinite(tolerancePx) ? tolerancePx : 2;
    var out = [];
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      if (!c || typeof c.x !== "number" || typeof c.y !== "number") continue;
      if (isCenterOccupiedByExistingPanel(c, TOL)) continue;
      var dup = false;
      for (var j = 0; j < out.length; j++) {
        if (Math.abs(out[j].x - c.x) <= TOL && Math.abs(out[j].y - c.y) <= TOL) {
          dup = true;
          break;
        }
      }
      if (!dup) out.push({ x: c.x, y: c.y });
    }
    return out;
  }

  /**
   * Ajoute plusieurs panneaux en un seul batch (pas de recompute intermédiaire).
   * À appeler dans un beginPvPlacementBatch / endPvPlacementBatch.
   *
   * @param {Object} block - Bloc actif
   * @param {Array<{x,y}>} centers - Liste des centres à poser
   * @param {function(): Object} getProjectionContext - Contexte
   * @returns {{ success: boolean, added: number, failed: number, reason?: string }}
   */
  function addPanelsAtCentersBatch(block, centers, getProjectionContext) {
    var APB = getAPB();
    if (!APB || typeof APB.addPanelAtCenter !== "function") {
      return { success: false, added: 0, failed: 0, reason: "ActivePlacementBlock indisponible." };
    }
    if (!block || !block.isActive || block !== APB.getActiveBlock()) {
      return { success: false, added: 0, failed: 0, reason: "Bloc non actif." };
    }
    if (!centers || centers.length === 0) {
      return { success: false, added: 0, failed: 0, reason: "Aucun centre fourni." };
    }
    var ctxBatch = typeof getProjectionContext === "function" ? getProjectionContext() : null;
    var cachesBatch = null;
    if (isFlatRoofContext(ctxBatch)) {
      cachesBatch = buildValidationCaches(block, getProjectionContext);
    }
    var added = 0, failed = 0;
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      if (!c || typeof c.x !== "number" || typeof c.y !== "number") { failed++; continue; }
      if (isFlatRoofContext(ctxBatch)) {
        var projB = computePanelProjectionAtCenterForBlock(block, c, getProjectionContext);
        if (!projB || !projB.points || !validateFlatGhostProjection(block, getProjectionContext, projB.points, c, cachesBatch)) {
          failed++;
          continue;
        }
      }
      var res = APB.addPanelAtCenter({ x: c.x, y: c.y }, getProjectionContext);
      if (res && res.success) {
        added++;
        if (isFlatRoofContext(ctxBatch)) {
          cachesBatch = buildValidationCaches(block, getProjectionContext);
        }
      } else {
        failed++;
      }
    }
    return { success: added > 0, added: added, failed: failed };
  }

  function addPanelAtCenter(block, center, getProjectionContext) {
    var APB = getAPB();
    if (!APB || typeof APB.addPanelAtCenter !== "function") return { success: false, reason: "ActivePlacementBlock indisponible." };
    if (!block || !block.isActive || block !== APB.getActiveBlock()) return { success: false, reason: "Bloc non actif." };
    var ctxPre = typeof getProjectionContext === "function" ? getProjectionContext() : null;
    if (isFlatRoofContext(ctxPre)) {
      var cachesPre = buildValidationCaches(block, getProjectionContext);
      var projPre = computePanelProjectionAtCenterForBlock(block, center, getProjectionContext);
      if (!projPre || !projPre.points) return { success: false, reason: "Projection invalide." };
      if (!validateFlatGhostProjection(block, getProjectionContext, projPre.points, center, cachesPre)) {
        return { success: false, reason: "Emplacement non valide." };
      }
    }
    var result = APB.addPanelAtCenter(center, getProjectionContext);
    if (!result.success) return result;
    recomputeBlockProjections(block, getProjectionContext);
    updatePanelValidationForBlock(block, getProjectionContext);
    return { success: true };
  }

  /**
   * Bascule l'état enabled d'un panneau du bloc actif (clic pour désactiver / réactiver).
   */
  function togglePanelEnabled(block, panelIndex) {
    var APB = getAPB();
    if (!APB || typeof APB.togglePanelEnabled !== "function") return false;
    if (!block || block !== APB.getActiveBlock()) return false;
    return APB.togglePanelEnabled(panelIndex);
  }

  /**
   * Réinitialise le moteur (bloc actif et blocs figés). Utile pour tests ou reset.
   */
  function reset() {
    var APB = getAPB();
    if (APB && typeof APB.reset === "function") APB.reset();
  }

  function getBlockCenter(block) {
    var APB = getAPB();
    return APB && typeof APB.getBlockCenter === "function" ? APB.getBlockCenter(block) : null;
  }

  function getEffectivePanelCenter(block, panelIndex) {
    var APB = getAPB();
    return APB && typeof APB.getEffectivePanelCenter === "function" ? APB.getEffectivePanelCenter(block, panelIndex) : null;
  }

  function getEffectivePanelProjection(block, panelIndex) {
    var APB = getAPB();
    return APB && typeof APB.getEffectivePanelProjection === "function" ? APB.getEffectivePanelProjection(block, panelIndex) : null;
  }

  function setManipulationTransform(offsetX, offsetY, rotationDeg) {
    var APB = getAPB();
    if (APB && typeof APB.setManipulationTransform === "function") {
      APB.setManipulationTransform(offsetX, offsetY, rotationDeg);
    }
  }

  function clearManipulationTransform() {
    var APB = getAPB();
    if (APB && typeof APB.clearManipulationTransform === "function") {
      APB.clearManipulationTransform();
    }
  }

  function commitManipulation() {
    var APB = getAPB();
    if (APB && typeof APB.commitManipulation === "function") APB.commitManipulation();
  }

  function cancelManipulation() {
    var APB = getAPB();
    if (APB && typeof APB.cancelManipulation === "function") APB.cancelManipulation();
  }

  function getFrozenBlocks() {
    var APB = getAPB();
    return APB && typeof APB.getFrozenBlocks === "function" ? APB.getFrozenBlocks() : [];
  }

  /**
   * Retourne tous les panneaux posés (blocs figés + bloc actif).
   * Structure : { id, panId, orientation, rotationDeg, center, polygonPx, state, enabled }
   */
  function getAllPanels() {
    var panels = [];
    var APB = getAPB();
    var frozen = (APB && typeof APB.getFrozenBlocks === "function") ? APB.getFrozenBlocks() : [];
    var active = (APB && APB.getActiveBlock) ? APB.getActiveBlock() : null;

    function pushPanelFromBlock(block, p, idx) {
      var proj = getEffectivePanelProjection(block, idx);
      var polygonPx = null;
      if (proj && Array.isArray(proj.points) && proj.points.length >= 3) {
        polygonPx = proj.points.map(function (pt) { return { x: pt.x, y: pt.y }; });
      }
      panels.push({
        id: block.id + "_" + idx,
        panId: block.panId || null,
        orientation: block.orientation || null,
        rotationDeg: block.rotation || 0,
        center: p.center ? { x: p.center.x, y: p.center.y } : null,
        polygonPx: polygonPx,
        state: p.state != null ? p.state : null,
        enabled: p.enabled != null ? p.enabled : true
      });
    }

    frozen.forEach(function (block) {
      if (!block || !Array.isArray(block.panels)) return;
      block.panels.forEach(function (p, idx) {
        pushPanelFromBlock(block, p, idx);
      });
    });
    if (active && Array.isArray(active.panels)) {
      var inFrozen = false;
      for (var fi = 0; fi < frozen.length; fi++) {
        if (frozen[fi] && frozen[fi].id === active.id) { inFrozen = true; break; }
      }
      if (!inFrozen) {
        active.panels.forEach(function (p, idx) {
          pushPanelFromBlock(active, p, idx);
        });
      }
    }
    return panels;
  }

  function restoreFrozenBlocks(blocks) {
    var APB = getAPB();
    if (APB && typeof APB.restoreFrozenBlocks === "function") APB.restoreFrozenBlocks(blocks);
  }

  function updatePanelValidation(validatePanel) {
    var APB = getAPB();
    if (APB && typeof APB.updatePanelValidation === "function") APB.updatePanelValidation(validatePanel);
  }

  var pvPlacementEngine = {
    buildProjectionContext: buildProjectionContext,
    createBlock: createBlock,
    setActiveBlock: setActiveBlock,
    beginManipulation: beginManipulation,
    reselectBlock: reselectBlock,
    recomputeBlock: recomputeBlock,
    recomputeBlockProjections: recomputeBlockProjections,
    updatePanelValidationForBlock: updatePanelValidationForBlock,
    validatePanelPolygon: validatePanelPolygon,
    computeExpansionGhosts: computeExpansionGhosts,
    addPanelAtCenter: addPanelAtCenter,
    addPanelsAtCentersBatch: addPanelsAtCentersBatch,
    computeAutofillGridPreview: computeAutofillGridPreview,
    filterAutofillCommitCenters: filterAutofillCommitCenters,
    isCenterOccupiedByExistingPanel: isCenterOccupiedByExistingPanel,
    clearPlacementOnPanForOptimize: clearPlacementOnPanForOptimize,
    collectAllExistingPanelPolysForAutofill: collectAllExistingPanelPolysForAutofill,
    removePanelAtIndex: removePanelAtIndex,
    removePanelById: removePanelById,
    ensureBlockGrid: ensureBlockGrid,
    togglePanelEnabled: togglePanelEnabled,
    removeBlock: removeBlock,
    validateBlock: validateBlock,
    getBlocks: getBlocks,
    getActiveBlock: getActiveBlock,
    getSelectedBlock: getSelectedBlock,
    getFocusBlock: getFocusBlock,
    getBlockById: getBlockById,
    endBlock: endBlock,
    clearSelection: clearSelection,
    reset: reset,
    getBlockCenter: getBlockCenter,
    getEffectivePanelCenter: getEffectivePanelCenter,
    getEffectivePanelProjection: getEffectivePanelProjection,
    setManipulationTransform: setManipulationTransform,
    clearManipulationTransform: clearManipulationTransform,
    commitManipulation: commitManipulation,
    cancelManipulation: cancelManipulation,
    getFrozenBlocks: getFrozenBlocks,
    getAllPanels: getAllPanels,
    restoreFrozenBlocks: restoreFrozenBlocks,
    updatePanelValidation: updatePanelValidation,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = pvPlacementEngine;
  } else {
    global.pvPlacementEngine = pvPlacementEngine;
  }
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
