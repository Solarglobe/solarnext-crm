/**
 * Moteur de pose PV — Projection réelle du panneau (Phase 3).
 *
 * Calcul UNIQUE et FIABLE de la forme projetée d’un panneau photovoltaïque
 * sur la vue 2D (vue du dessus), à partir de la pente du pan, de l’orientation
 * du pan et de l’orientation du panneau (portrait / paysage).
 *
 * RÈGLE MÉTIER : Les dimensions catalogue du panneau (mm) ne doivent jamais
 * être utilisées directement en 2D. SEULE la forme projetée est autorisée
 * pour collisions, espacements, emplacements fantômes et règles de pose.
 */
(function (global) {
  "use strict";

  var DEBUG_PROJ = false;
  function debugProjOn() { return DEBUG_PROJ || (typeof global !== "undefined" && global.DEBUG_CALPINAGE_WIDTH) || (typeof window !== "undefined" && window.DEBUG_CALPINAGE_WIDTH); }

  var DEG_TO_RAD = Math.PI / 180;

  /**
   * Calcule le vrai axe de pente en image-space à partir du polygone du pan.
   * Identifie le segment faîtage (aligné avec roofOrientationDeg), en déduit ridgeAxis,
   * puis le perpendiculaire (axe de pente). Le sens descendant est choisi via slopeDirectionLabel
   * (S/N/E/W) ou par dot avec "vers le bas" en image (y positif).
   *
   * @param {Array<{ x: number, y: number }>} polygon - Sommets du pan en image (fermé).
   * @param {number} roofOrientationDeg - Azimut face (faîtage), degrés (0 = Nord, 90 = Est).
   * @param {string} [slopeDirectionLabel] - Sens de la pente : "S", "N", "E", "W", etc.
   * @returns {{ slopeAxis: { x: number, y: number }, perpAxis: { x: number, y: number } } | null}
   *   slopeAxis = axe de la pente (descente), perpAxis = axe du faîtage (unitaire). null si polygon invalide.
   */
  function computeTrueSlopeAxisFromPolygon(polygon, roofOrientationDeg, slopeDirectionLabel) {
    if (!polygon || polygon.length < 3) return null;
    var azRad = (Number.isFinite(roofOrientationDeg) ? roofOrientationDeg : 0) * DEG_TO_RAD;
    var faceX = Math.sin(azRad);
    var faceY = -Math.cos(azRad);

    var bestDot = -1;
    var ridgeAxis = null;
    var n = polygon.length;
    for (var i = 0; i < n; i++) {
      var a = polygon[i];
      var b = polygon[(i + 1) % n];
      var vx = (b.x != null ? b.x : b[0]) - (a.x != null ? a.x : a[0]);
      var vy = (b.y != null ? b.y : b[1]) - (a.y != null ? a.y : a[1]);
      var len = Math.hypot(vx, vy);
      if (len < 1e-6) continue;
      var dx = vx / len;
      var dy = vy / len;
      var dot = Math.abs(dx * faceX + dy * faceY);
      if (dot > bestDot) {
        bestDot = dot;
        var sign = dx * faceX + dy * faceY >= 0 ? 1 : -1;
        ridgeAxis = { x: sign * dx, y: sign * dy };
      }
    }
    if (!ridgeAxis) return null;

    var cand1 = { x: ridgeAxis.y, y: -ridgeAxis.x };
    var cand2 = { x: -ridgeAxis.y, y: ridgeAxis.x };
    var downX = 0;
    var downY = 1;
    if (slopeDirectionLabel && typeof slopeDirectionLabel === "string") {
      var L = slopeDirectionLabel.toUpperCase().charAt(0);
      if (L === "N") { downX = 0; downY = -1; }
      else if (L === "S") { downX = 0; downY = 1; }
      else if (L === "E") { downX = 1; downY = 0; }
      else if (L === "O" || L === "W") { downX = -1; downY = 0; }
    }
    var d1 = cand1.x * downX + cand1.y * downY;
    var d2 = cand2.x * downX + cand2.y * downY;
    var slopeAxis = d1 >= d2 ? cand1 : cand2;
    var norm = Math.hypot(slopeAxis.x, slopeAxis.y) || 1;
    slopeAxis = { x: slopeAxis.x / norm, y: slopeAxis.y / norm };
    return { slopeAxis: slopeAxis, perpAxis: ridgeAxis };
  }

  /**
   * Calcule le rectangle 2D projeté d’un panneau sur la vue du dessus.
   *
   * Étapes du calcul :
   * 1) Orientation panneau (portrait / paysage) → dimensions effectives en mm.
   * 2) Facteur de projection : cos(pente) appliqué UNIQUEMENT à la dimension alignée
   *    avec la pente (effectiveHeightMm après PORTRAIT/PAYSAGE) ; l’autre dimension reste inchangée.
   * 3) Rectangle centré sur center, aligné avec l’orientation du pan (azimut),
   *    exprimé dans le même repère que le toit (image space si metersPerPixel fourni).
   *
   * @param {{
   *   center: { x: number, y: number },
   *   panelWidthMm: number,
   *   panelHeightMm: number,
   *   roofSlopeDeg: number,
   *   roofOrientationDeg: number,
   *   panelOrientation: string,
   *   metersPerPixel: number
   * }} options
   *   - center : point de pose en coordonnées image (x, y).
   *   - panelWidthMm, panelHeightMm : dimensions catalogue du panneau en mm (avant orientation).
   *   - roofSlopeDeg : pente du pan en degrés (inclinaison par rapport à l’horizontale).
   *   - roofOrientationDeg : azimut du pan en degrés (0 = Nord, 90 = Est) — direction de la ligne de plus grande pente.
   *   - panelOrientation : "PORTRAIT" | "PAYSAGE". Convention : la dimension "hauteur" effective
   *     (panelHeightMm en PORTRAIT, panelWidthMm en PAYSAGE) est alignée avec la pente et reçoit cos(pente).
   *   - metersPerPixel : échelle du plan (m/px). Utilisé pour convertir les mm en unités image.
   * @returns {{
   *   points: Array<{ x: number, y: number }>,
   *   slopeAxis: { x: number, y: number },
   *   perpAxis: { x: number, y: number },
   *   halfLengthAlongSlopePx: number,
   *   halfLengthPerpPx: number
   * }}
   *   - points : les 4 sommets du rectangle projeté (ordre fermé, sens cohérent).
   *   - slopeAxis : vecteur unitaire dans le sens de la pente (référentiel image).
   *   - perpAxis : vecteur unitaire perpendiculaire à la pente (référentiel image).
   *   - halfLengthAlongSlopePx, halfLengthPerpPx : demi-longueurs en px (pour réutilisation).
   */
  function computeProjectedPanelRect(options) {
    var center = options.center;
    var panelWidthMm = options.panelWidthMm;
    var panelHeightMm = options.panelHeightMm;
    var roofSlopeDeg = options.roofSlopeDeg;
    var roofOrientationDeg = options.roofOrientationDeg;
    var panelOrientation = (options.panelOrientation || "PORTRAIT").toString().toUpperCase();
    var metersPerPixel = options.metersPerPixel;

    if (!center || typeof center.x !== "number" || typeof center.y !== "number") {
      throw new Error("computeProjectedPanelRect: center { x, y } requis.");
    }
    if (!Number.isFinite(panelWidthMm) || !Number.isFinite(panelHeightMm) || panelWidthMm <= 0 || panelHeightMm <= 0) {
      throw new Error("computeProjectedPanelRect: panelWidthMm et panelHeightMm doivent être des nombres > 0.");
    }
    if (!Number.isFinite(roofSlopeDeg) || roofSlopeDeg < 0 || roofSlopeDeg > 90) {
      throw new Error("computeProjectedPanelRect: roofSlopeDeg doit être entre 0 et 90.");
    }
    if (!Number.isFinite(roofOrientationDeg)) {
      roofOrientationDeg = 0;
    }
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
      throw new Error("computeProjectedPanelRect: metersPerPixel requis et > 0 pour un résultat en coordonnées image.");
    }

    // ——— 1) Orientation panneau → dimensions effectives (catalogue) ———
    // PORTRAIT : largeur = panelWidthMm,  hauteur = panelHeightMm
    // PAYSAGE  : largeur = panelHeightMm, hauteur = panelWidthMm (dims physiques échangées)
    var effectiveWidthMm = panelOrientation === "PAYSAGE" ? panelHeightMm : panelWidthMm;
    var effectiveHeightMm = panelOrientation === "PAYSAGE" ? panelWidthMm : panelHeightMm;

    // ——— CONVENTION (ne pas inverser) ———
    // En vue de dessus, seule la dimension ALIGNÉE avec la pente est raccourcie (× cos(pente)).
    // Convention métier : la dimension "hauteur" effective du panneau est alignée avec la pente,
    // la "largeur" effective est perpendiculaire à la pente (roofOrientationDeg définit l’azimut du pan).
    // → Dimension le long de la pente (sera × cos) = effectiveHeightMm
    // → Dimension perpendiculaire (inchangée en 2D) = effectiveWidthMm
    var dimensionAlongSlopeMm = effectiveHeightMm;   // SEULE dimension à multiplier par cos(roofSlopeDeg)
    var dimensionPerpMm = effectiveWidthMm;          // jamais modifiée par la projection

    // ——— 2) Projection : cos(pente) UNIQUEMENT sur la dimension alignée avec la pente ———
    var slopeRad = roofSlopeDeg * DEG_TO_RAD;
    var projectionFactor = Math.cos(slopeRad);
    var dimensionAlongSlopeProjMm = dimensionAlongSlopeMm * projectionFactor;
    var dimensionPerpProjMm = dimensionPerpMm;  // inchangée (pas de facteur cos)

    // ——— 3) Conversion mm → pixels (même repère que le toit) ———
    // 1 m = 1000 mm  =>  valuePx = (valueMm / 1000) / metersPerPixel
    var mmToPx = 1 / (1000 * metersPerPixel);
    // ——— 4) Axes unitaires dans le repère image (alignés avec le pan) ———
    // Si trueSlopeAxis / truePerpAxis fournis (calculés depuis le polygone), on les utilise.
    // Sinon fallback : slopeAxis = azimut face (faîtage), perpAxis = pente (Option B).
    var slopeAxis;
    var perpAxis;
    var trueSlope = options.trueSlopeAxis && options.truePerpAxis
      && typeof options.trueSlopeAxis.x === "number" && typeof options.trueSlopeAxis.y === "number"
      && typeof options.truePerpAxis.x === "number" && typeof options.truePerpAxis.y === "number";
    if (trueSlope) {
      var ns = Math.hypot(options.trueSlopeAxis.x, options.trueSlopeAxis.y) || 1;
      var np = Math.hypot(options.truePerpAxis.x, options.truePerpAxis.y) || 1;
      slopeAxis = { x: options.trueSlopeAxis.x / ns, y: options.trueSlopeAxis.y / ns };
      perpAxis = { x: options.truePerpAxis.x / np, y: options.truePerpAxis.y / np };
    } else {
      var azRad = roofOrientationDeg * DEG_TO_RAD;
      slopeAxis = { x: Math.sin(azRad), y: -Math.cos(azRad) };
      perpAxis = { x: Math.cos(azRad), y: Math.sin(azRad) };
    }

    // Demi-longueurs : dimension ×cos le long de slopeAxis (pente), dimension inchangée le long de perpAxis (faîtage).
    var halfAlongSlopePx = (dimensionAlongSlopeProjMm / 2) * mmToPx;
    var halfPerpPx = (dimensionPerpProjMm / 2) * mmToPx;
    // ——— 4b) Convention stable : u = slopeAxis, v = perpAxis TOUJOURS (pas de swap portrait/paysage).
    // Portrait/paysage agit via effectiveWidth/Height (swap dimensions), pas via swap d'axes.
    var u = slopeAxis;
    var v = perpAxis;
    var halfU = halfAlongSlopePx;
    var halfV = halfPerpPx;

    if (debugProjOn()) {
      var largeurAlongSlopeM = dimensionAlongSlopeProjMm / 1000;
      var largeurPerpM = dimensionPerpProjMm / 1000;
      console.log("[computeProjectedPanelRect] DIAG largeur panneau", {
        panelWidthMm: panelWidthMm,
        panelHeightMm: panelHeightMm,
        panelOrientation: panelOrientation,
        effectiveWidthMm: effectiveWidthMm,
        effectiveHeightMm: effectiveHeightMm,
        dimensionAlongSlopeProjMm: dimensionAlongSlopeProjMm,
        dimensionPerpProjMm: dimensionPerpProjMm,
        largeurAlongSlopeM: largeurAlongSlopeM,
        largeurPerpM: largeurPerpM,
        halfAlongSlopePx: halfAlongSlopePx,
        halfPerpPx: halfPerpPx,
      });
    }

    // ——— 5) Sommets du rectangle projeté ———
    // u = slopeAxis, v = perpAxis. Points = center ± halfU*u ± halfV*v
    var cx = center.x;
    var cy = center.y;
    var ux = u.x;
    var uy = u.y;
    var vx = v.x;
    var vy = v.y;

    var points = [
      { x: cx - halfU * ux - halfV * vx, y: cy - halfU * uy - halfV * vy },
      { x: cx + halfU * ux - halfV * vx, y: cy + halfU * uy - halfV * vy },
      { x: cx + halfU * ux + halfV * vx, y: cy + halfU * uy + halfV * vy },
      { x: cx - halfU * ux + halfV * vx, y: cy - halfU * uy + halfV * vy },
    ];

    var localRotationDeg = Number(options.localRotationDeg) || Number(options.extraRotationDeg) || 0;
    var halfAlongEffective = halfAlongSlopePx;
    var halfPerpEffective = halfPerpPx;
    if (localRotationDeg !== 0) {
      var deg = ((localRotationDeg % 360) + 360) % 360;
      var rad = deg * DEG_TO_RAD;
      var cosR = Math.cos(rad), sinR = Math.sin(rad);
      for (var ri = 0; ri < points.length; ri++) {
        var px = points[ri].x - cx;
        var py = points[ri].y - cy;
        points[ri] = { x: cx + px * cosR - py * sinR, y: cy + px * sinR + py * cosR };
      }
      /* Demi-extents effectifs : projection des 4 points tournés sur slopeAxis/perpAxis */
      var minSlope = Infinity, maxSlope = -Infinity, minPerp = Infinity, maxPerp = -Infinity;
      for (var pi = 0; pi < points.length; pi++) {
        var pt = points[pi];
        var projSlope = (pt.x - cx) * ux + (pt.y - cy) * uy;
        var projPerp = (pt.x - cx) * vx + (pt.y - cy) * vy;
        if (projSlope < minSlope) minSlope = projSlope;
        if (projSlope > maxSlope) maxSlope = projSlope;
        if (projPerp < minPerp) minPerp = projPerp;
        if (projPerp > maxPerp) maxPerp = projPerp;
      }
      halfAlongEffective = (maxSlope - minSlope) / 2;
      halfPerpEffective = (maxPerp - minPerp) / 2;
      /* Micro-assert DEV : détecte si halfs pré-rotation sont retournés par erreur (non bloquante) */
      if (Math.abs(halfAlongEffective - halfAlongSlopePx) < 1e-6 && Math.abs(halfPerpEffective - halfPerpPx) < 1e-6) {
        console.warn("[computeProjectedPanelRect] REGRESSION: localRotationDeg=" + localRotationDeg + " mais halfs identiques au pré-rotation. Utiliser les demi-extents effectifs (projection bbox).");
      }
    }
    if ((typeof global !== "undefined" && global.DEBUG_PV_ORIENT) || (typeof window !== "undefined" && window.DEBUG_PV_ORIENT)) {
      console.log("[DEBUG_PV_ORIENT] computeProjectedPanelRect", { localRotationDeg: localRotationDeg, halfAlongEffective: halfAlongEffective, halfPerpEffective: halfPerpEffective });
    }
    if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
      var extraRot = (typeof options.extraRotationDeg === "number") ? options.extraRotationDeg : null;
      console.log("[PV_AUDIT][PROJ]", panelOrientation, (typeof localRotationDeg === "number" ? localRotationDeg : (extraRot != null ? extraRot : "(none)")), halfAlongEffective, halfPerpEffective, "slopeAxis:" + slopeAxis.x + "," + slopeAxis.y, "perpAxis:" + perpAxis.x + "," + perpAxis.y);
    }

    return {
      points: points,
      slopeAxis: slopeAxis,
      perpAxis: perpAxis,
      halfLengthAlongSlopePx: halfAlongEffective,
      halfLengthPerpPx: halfPerpEffective,
    };
  }

  var PanelProjection = {
    computeProjectedPanelRect: computeProjectedPanelRect,
    computeTrueSlopeAxisFromPolygon: computeTrueSlopeAxisFromPolygon,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PanelProjection;
  } else {
    global.PanelProjection = PanelProjection;
    global.computeProjectedPanelRect = computeProjectedPanelRect;
    global.computeTrueSlopeAxisFromPolygon = computeTrueSlopeAxisFromPolygon;
  }
})(typeof window !== "undefined" ? window : this);
