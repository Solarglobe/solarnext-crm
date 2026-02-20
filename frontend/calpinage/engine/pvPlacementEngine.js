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

  function polygonIntersectsPolygon(polyA, polyB) {
    if (!polyA || polyA.length < 2 || !polyB || polyB.length < 2) return false;
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
   * Valide un panneau (polygone projeté) : collision obstacle OU collision autre panneau activé uniquement.
   * Rouge si et seulement si : intersection avec obstacle OU intersection avec autre panneau enabled.
   * @param {Object} [roofConstraints] - optionnel : { ridgeSegments, traitSegments } pour test keepout faîtage/trait
   */
  function validatePanelPolygon(panelPoly, forbiddenPolys, otherPanelPolys, roofConstraints) {
    if (!panelPoly || panelPoly.length < 3) return false;

    /* 0) PV STRICT : panneau inside pan + marginOuterCm keepout (DEV+STRICT) */
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

    /* 1) Obstacles : intersection => invalid */
    if (forbiddenPolys && forbiddenPolys.length > 0) {
      for (var o = 0; o < forbiddenPolys.length; o++) {
        var obs = forbiddenPolys[o];
        if (!obs || obs.length < 3) continue;
        if (polygonIntersectsPolygon(panelPoly, obs)) return false;
      }
    }

    /* 2) Autres panneaux activés : intersection => invalid */
    if (otherPanelPolys && otherPanelPolys.length > 0) {
      for (var k = 0; k < otherPanelPolys.length; k++) {
        var other = otherPanelPolys[k];
        if (!other || other.length < 2) continue;
        if (polygonIntersectsPolygon(panelPoly, other)) return false;
      }
    }

    /* 3) Ridge/trait keepout : sommet panneau sur segment faîtage/trait => invalid */
    var forbiddenSegs = roofConstraints
      ? ((roofConstraints.ridgeSegments || []).concat(roofConstraints.traitSegments || []))
      : [];

    var pvEps = (roofConstraints && roofConstraints.eps && typeof roofConstraints.eps.PV_IMG === "number")
      ? roofConstraints.eps.PV_IMG
      : 1e-6; // fallback sécurité

    if (forbiddenSegs.length > 0 && minDistancePolygonToSegments(panelPoly, forbiddenSegs) < pvEps) {
      return false;
    }
    return true;
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
    var orientation = (rules && (rules.orientation === "PORTRAIT" || rules.orientation === "PAYSAGE")) ? rules.orientation : "PORTRAIT";
    return APB.createBlock({
      panId: panId,
      center: center,
      getProjectionContext: getProjectionContext,
      orientation: orientation,
    });
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
  function recomputeBlock(blockId, rules, context) {
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
    var ctx = getProjectionContext();
    if (!ctx || !ctx.roofConstraints) return;
    var forbiddenPolys = ctx.roofConstraints.obstaclePolygons || [];
    for (var i = 0; i < block.panels.length; i++) {
      var proj = getEffectivePanelProjection(block, i);
      if (!proj || !proj.points || proj.points.length < 3) {
        block.panels[i].state = "invalid";
        continue;
      }
      var otherPanelPolys = collectOtherPanelPolysForValidation(block, i, getProjectionContext);
      var ok = validatePanelPolygon(proj.points, forbiddenPolys, otherPanelPolys, ctx.roofConstraints);
      block.panels[i].state = ok ? "valid" : "invalid";
    }
  }

  /** Polygones des autres panneaux (enabled uniquement) pour la validation espacement. Exclut le panneau d'index excludeIndex du bloc. Utilise la projection effective (rotation locale incluse). */
  function collectOtherPanelPolysForValidation(block, excludePanelIndex, getProjectionContext) {
    var out = [];
    var APB = getAPB();
    var frozen = APB && typeof APB.getFrozenBlocks === "function" ? APB.getFrozenBlocks() : [];
    var active = APB && APB.getActiveBlock && APB.getActiveBlock();
    var i, j, bl, p, proj;
    for (i = 0; i < frozen.length; i++) {
      bl = frozen[i];
      if (!bl.panels || bl.id === block.id) continue;
      for (j = 0; j < bl.panels.length; j++) {
        p = bl.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(bl, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    if (active && active.panels && (active.id !== block.id || block.panels)) {
      for (j = 0; j < active.panels.length; j++) {
        if (active.id === block.id && j === excludePanelIndex) continue;
        p = active.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(active, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    if (!active || active.id !== block.id) {
      for (j = 0; j < block.panels.length; j++) {
        if (j === excludePanelIndex) continue;
        p = block.panels[j];
        if (p.enabled === false) continue;
        proj = getEffectivePanelProjection(block, j);
        if (proj && proj.points && proj.points.length >= 2) out.push(proj.points);
      }
    }
    return out;
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
    return {
      points: out,
      slopeAxis: proj.slopeAxis ? rotAxis(proj.slopeAxis) : undefined,
      perpAxis: proj.perpAxis ? rotAxis(proj.perpAxis) : undefined,
      halfLengthAlongSlopePx: proj.halfLengthAlongSlopePx,
      halfLengthPerpPx: proj.halfLengthPerpPx,
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
   * Migration : si des panneaux n'ont pas panel.grid, reconstruit (row,col) à partir des centres et de la projection.
   * Référence p0 = premier panneau avec center et projection. Axes et pas déduits de la projection + spacing.
   *
   * @param {Object} block - Bloc
   * @param {function(): Object} getProjectionContext - Contexte
   */
  function ensureBlockGrid(block, getProjectionContext) {
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
    var spacingAlongPx = (Number.isFinite(pvRules.spacingYcm) ? pvRules.spacingYcm : 0) * cmToPx;
    var spacingPerpPx = (Number.isFinite(pvRules.spacingXcm) ? pvRules.spacingXcm : 0) * cmToPx;
    var stepAlong = 2 * halfAlong + spacingAlongPx;
    var stepPerp = 2 * halfPerp + spacingPerpPx;
    if (stepAlong <= 0) stepAlong = 1;
    if (stepPerp <= 0) stepPerp = 1;

    if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
      console.log("[PV_AUDIT][GRID]", block.id, halfAlong, halfPerp, stepAlong, stepPerp, spacingAlongPx, spacingPerpPx, "slopeAxis:" + slopeAxis.x + "," + slopeAxis.y, "perpAxis:" + perpAxis.x + "," + perpAxis.y);
    }

    var c0 = p0.center;
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
      panelOrientation: (ctx.panelParams.panelOrientation || "PORTRAIT").toString().toUpperCase(),
      roofSlopeDeg: ctx.roofParams.roofSlopeDeg,
      roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0,
      metersPerPixel: ctx.roofParams.metersPerPixel,
    };
    if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) {
      projectOptsBase.trueSlopeAxis = ctx.roofParams.trueSlopeAxis;
      projectOptsBase.truePerpAxis = ctx.roofParams.truePerpAxis;
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
      if (typeof projectOptsBase.localRotationDeg === "number") { projectOpts.localRotationDeg = projectOptsBase.localRotationDeg; }
      var proj;
      try {
        proj = computeProjectedPanelRect(projectOpts);
      } catch (e) { continue; }
      if (!proj || !proj.points || proj.points.length < 4) continue;
      if (rotationDeg) proj = rotateProjectionByDegrees(proj, c, rotationDeg);

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
   * Ajoute un panneau au bloc actif à la position donnée (extension OpenSolar). Recalcule projections et validation.
   *
   * @param {Object} block - Bloc actif
   * @param {{ x: number, y: number }} center - Centre en image
   * @param {function(): Object} getProjectionContext - Contexte
   * @returns {{ success: boolean, reason?: string }}
   */
  function addPanelAtCenter(block, center, getProjectionContext) {
    var APB = getAPB();
    if (!APB || typeof APB.addPanelAtCenter !== "function") return { success: false, reason: "ActivePlacementBlock indisponible." };
    if (!block || !block.isActive || block !== APB.getActiveBlock()) return { success: false, reason: "Bloc non actif." };
    var result = APB.addPanelAtCenter(center, getProjectionContext);
    if (!result.success) return result;
    recomputeBlockProjections(block, getProjectionContext);
    updatePanelValidationForBlock(block, getProjectionContext);
    return { success: true };
  }

  /**
   * Bascule l'état enabled d'un panneau du bloc actif (clic pour désactiver / réactiver).
   *
   * @param {Object} block - Bloc actif
   * @param {number} panelIndex - Index du panneau
   * @returns {boolean}
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

  // Exposition des helpers APB pour le rendu / hit-test (calpinage.html les utilise)
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
    removePanelAtIndex: removePanelAtIndex,
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
