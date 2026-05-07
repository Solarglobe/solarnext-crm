/**
 * Bundle exécutable du moteur canvas (source: canvasEngine.ts, viewport.ts, primitives.ts, hitTest.ts, interaction.ts).
 * Permet d'utiliser le moteur dans calpinage.html sans chaîne de build.
 */
(function (global) {
  "use strict";

  /** Tolérance écran (px) cohérente avec le zoom si CALPINAGE_VIEWPORT_FIT_SCALE est défini (module legacy). */
  function calpinageAdaptiveScreenHitPx(basePx, vpScale) {
    var b = typeof basePx === "number" && isFinite(basePx) ? basePx : 8;
    if (vpScale === undefined || vpScale === null || !isFinite(vpScale) || vpScale <= 0) return b;
    var fit =
      typeof global.CALPINAGE_VIEWPORT_FIT_SCALE === "number" &&
      isFinite(global.CALPINAGE_VIEWPORT_FIT_SCALE) &&
      global.CALPINAGE_VIEWPORT_FIT_SCALE > 0
        ? global.CALPINAGE_VIEWPORT_FIT_SCALE
        : vpScale;
    var zr = fit / vpScale;
    return Math.max(5, Math.min(26, b * zr));
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} [container] - Container pour getBoundingClientRect (ex: canvas-wrapper).
   *   Si absent, utilise canvas.parentElement. CRITIQUE pour éviter 300x150 et half-height.
   */
  function CanvasEngine(canvas, container) {
    this.canvas = canvas;
    this.container = container || canvas.parentElement;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.width = 0;
    this.height = 0;
    this._destroyed = false;
    this.resize();
  }

  /**
   * Redimensionne le canvas à la taille réelle du container (getBoundingClientRect).
   * Évite le bug 300x150 et half-height. Pas de listener interne — le module appelle resize().
   */
  CanvasEngine.prototype.resize = function () {
    if (this._destroyed || !this.canvas || !this.ctx) return;
    var el = this.container || this.canvas;
    var rect = el.getBoundingClientRect();
    var width = Math.max(0, rect.width);
    var height = Math.max(0, rect.height);
    var dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.width = Math.round(width);
    this.height = Math.round(height);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  CanvasEngine.prototype.destroy = function () {
    this._destroyed = true;
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  };

  CanvasEngine.prototype.clear = function () {
    if (this._destroyed || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
  };

  function Viewport() {
    this.scale = 1;
    this.offset = { x: 0, y: 0 };
  }

  Viewport.prototype.worldToScreen = function (p) {
    return {
      x: p.x * this.scale + this.offset.x,
      y: -p.y * this.scale + this.offset.y,
    };
  };

  Viewport.prototype.screenToWorld = function (p) {
    return {
      x: (p.x - this.offset.x) / this.scale,
      y: -(p.y - this.offset.y) / this.scale,
    };
  };

  Viewport.prototype.pan = function (dx, dy) {
    this.offset.x += dx;
    this.offset.y += dy;
  };

  Viewport.prototype.zoom = function (factor, center) {
    var worldBefore = this.screenToWorld(center);
    var newScale = this.scale * factor;
    if (this.minScale != null && typeof this.minScale === "number" && isFinite(this.minScale) && newScale < this.minScale) {
      newScale = this.minScale;
    }
    if (this.maxScale != null && typeof this.maxScale === "number" && isFinite(this.maxScale) && newScale > this.maxScale) {
      newScale = this.maxScale;
    }
    var actualFactor = newScale / this.scale;
    if (!isFinite(actualFactor) || Math.abs(actualFactor - 1) < 1e-9) return;
    this.scale = newScale;
    this.offset.x = center.x - worldBefore.x * this.scale;
    this.offset.y = center.y + worldBefore.y * this.scale;
  };

  function drawPoint(ctx, vp, p, r) {
    if (r === undefined) r = 4;
    var s = vp.worldToScreen(p);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPolygon(ctx, vp, pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    var first = vp.worldToScreen(pts[0]);
    ctx.moveTo(first.x, first.y);
    for (var i = 1; i < pts.length; i++) {
      var pt = vp.worldToScreen(pts[i]);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function hitPoint(p, mouseWorld, tolMeters) {
    if (tolMeters === undefined) tolMeters = 0.15;
    return dist(p, mouseWorld) <= tolMeters;
  }

  function hitPolygon(poly, mouseWorld) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y;
      var xj = poly[j].x, yj = poly[j].y;
      if (yj === yi) continue;
      var intersect =
        yi > mouseWorld.y !== yj > mouseWorld.y &&
        mouseWorld.x < ((xj - xi) * (mouseWorld.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  var SNAPPING_ENABLED = false;
  function snap(value, step) {
    if (step === undefined) step = 0.5;
    return Math.round(value / step) * step;
  }

  function InteractionManager(viewport, points, polygons) {
    this.viewport = viewport;
    this.points = points;
    this.polygons = polygons;
    this.selectedPoint = null;
    this.selectedPolygon = null;
    this.dragging = false;
    this.dragStartWorld = null;
  }

  InteractionManager.prototype.onMouseDown = function (screen) {
    var world = this.viewport.screenToWorld(screen);
    this.selectedPoint = null;
    this.selectedPolygon = null;

    for (var i = 0; i < this.points.length; i++) {
      var p = this.points[i];
      if (hitPoint(p, world)) {
        this.selectedPoint = p;
        this.dragging = true;
        this.dragStartWorld = { x: world.x, y: world.y };
        return;
      }
    }

    for (var j = 0; j < this.polygons.length; j++) {
      var poly = this.polygons[j];
      if (hitPolygon(poly, world)) {
        this.selectedPolygon = poly;
        this.dragging = true;
        this.dragStartWorld = { x: world.x, y: world.y };
        return;
      }
    }
  };

  InteractionManager.prototype.onMouseMove = function (screen) {
    if (!this.dragging || !this.dragStartWorld) return;

    var world = this.viewport.screenToWorld(screen);
    var dx = world.x - this.dragStartWorld.x;
    var dy = world.y - this.dragStartWorld.y;

    if (this.selectedPoint) {
      this.selectedPoint.x += dx;
      this.selectedPoint.y += dy;
      if (SNAPPING_ENABLED) {
        this.selectedPoint.x = snap(this.selectedPoint.x, 0.5);
        this.selectedPoint.y = snap(this.selectedPoint.y, 0.5);
      }
    }

    if (this.selectedPolygon) {
      for (var k = 0; k < this.selectedPolygon.length; k++) {
        var pt = this.selectedPolygon[k];
        pt.x += dx;
        pt.y += dy;
        if (SNAPPING_ENABLED) {
          pt.x = snap(pt.x, 0.5);
          pt.y = snap(pt.y, 0.5);
        }
      }
    }

    this.dragStartWorld = { x: world.x, y: world.y };
  };

  InteractionManager.prototype.onMouseUp = function () {
    this.dragging = false;
    this.dragStartWorld = null;
  };

  /* --- Obstacles toiture (2D) : draw + hitTest --- */
  var OBSTACLE_STROKE = "rgba(51, 65, 85, 0.82)";
  var OBSTACLE_FILL = "rgba(71, 85, 105, 0.18)";
  var OBSTACLE_SELECTED_STROKE = "rgba(30, 64, 175, 0.88)";
  var OBSTACLE_SELECTED_LINE_WIDTH = 1.8;
  var OBSTACLE_PREVIEW_DASH = [5, 5];
  /** Rayon visuel poignées — hit élargi dans hitTestObstacleHandles */
  var HANDLE_RADIUS_PX = 4.6;
  var RECT_CORNER_HANDLE_RADIUS_PX = 5.5;
  var RECT_EDGE_HANDLE_RADIUS_PX = 4.2;
  var HANDLE_FILL = "rgba(255, 255, 255, 0.82)";
  var HANDLE_STROKE_OUTER = "rgba(15, 23, 42, 0.72)";
  var HANDLE_STROKE_ACCENT = "rgba(37, 99, 235, 0.82)";

  function rotatePointImage(p, cx, cy, angle) {
    var dx = p.x - cx, dy = p.y - cy;
    var c = Math.cos(angle), s = Math.sin(angle);
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }

  /** Tourne le point (px,py) autour de (cx,cy) de l'angle ang (rad). */
  function rotatePoint(px, py, cx, cy, ang) {
    return rotatePointImage({ x: px, y: py }, cx, cy, ang);
  }

  /** Centre effectif d'un obstacle (image space). */
  function getObstacleCenter(obstacle) {
    if (obstacle.shapeMeta && typeof obstacle.shapeMeta.centerX === "number") {
      return { x: obstacle.shapeMeta.centerX, y: obstacle.shapeMeta.centerY };
    }
    if (obstacle.points && obstacle.points.length) {
      var cx = 0, cy = 0;
      obstacle.points.forEach(function (p) { cx += p.x; cy += p.y; });
      return { x: cx / obstacle.points.length, y: cy / obstacle.points.length };
    }
    return { x: obstacle.x || 0, y: obstacle.y || 0 };
  }

  /** Convertit un point écran en coordonnées locales de l'obstacle (rotation inverse autour du centre). */
  function screenToLocal(screenPt, obstacle, screenToImage) {
    var imgPt = screenToImage(screenPt);
    var center = getObstacleCenter(obstacle);
    var angle = (obstacle.shapeMeta && typeof obstacle.shapeMeta.angle === "number") ? obstacle.shapeMeta.angle : (typeof obstacle.angle === "number" ? obstacle.angle : 0);
    return rotatePointImage(imgPt, center.x, center.y, -angle);
  }

  function obstacleDrawCircle(ctx, imageToScreen, cx, cy, r, dashed, scale, selected) {
    if (scale === undefined) scale = 1;
    var s = imageToScreen({ x: cx, y: cy });
    var rScreen = Math.abs(r) * scale;
    ctx.beginPath();
    ctx.arc(s.x, s.y, rScreen, 0, Math.PI * 2);
    if (dashed) ctx.setLineDash(OBSTACLE_PREVIEW_DASH);
    ctx.strokeStyle = selected ? OBSTACLE_SELECTED_STROKE : OBSTACLE_STROKE;
    ctx.lineWidth = selected ? OBSTACLE_SELECTED_LINE_WIDTH : 2;
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);
    if (!dashed) {
      ctx.fillStyle = OBSTACLE_FILL;
      ctx.fill();
      ctx.stroke();
    }
  }

  function obstacleDrawRect(ctx, imageToScreen, x, y, w, h, dashed, selected) {
    var tl = imageToScreen({ x: x, y: y });
    var tr = imageToScreen({ x: x + w, y: y });
    var br = imageToScreen({ x: x + w, y: y + h });
    var bl = imageToScreen({ x: x, y: y + h });
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    if (dashed) ctx.setLineDash(OBSTACLE_PREVIEW_DASH);
    ctx.strokeStyle = selected ? OBSTACLE_SELECTED_STROKE : OBSTACLE_STROKE;
    ctx.lineWidth = selected ? OBSTACLE_SELECTED_LINE_WIDTH : 2;
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);
    if (!dashed) {
      ctx.fillStyle = OBSTACLE_FILL;
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawHandleDisc(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r + 0.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.50)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = HANDLE_FILL;
    ctx.fill();
    ctx.strokeStyle = HANDLE_STROKE_OUTER;
    ctx.lineWidth = 1.05;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r - 1.2), 0, Math.PI * 2);
    ctx.strokeStyle = HANDLE_STROKE_ACCENT;
    ctx.lineWidth = 0.85;
    ctx.stroke();
  }

  function drawObstacleHandles(ctx, obstacle, imageToScreen, scale, emphasizeRotate) {
    if (scale === undefined) scale = 1;
    if (emphasizeRotate === undefined) emphasizeRotate = false;
    var m = obstacle.shapeMeta;
    if (!m) return;
    if (m.originalType === "circle" && typeof m.radius === "number") {
      var h = imageToScreen({ x: m.centerX + m.radius, y: m.centerY });
      drawHandleDisc(ctx, h.x, h.y, HANDLE_RADIUS_PX);
    } else if (m.originalType === "rect" && typeof m.width === "number" && typeof m.height === "number") {
      var hw = m.width / 2, hh = m.height / 2;
      var angleR = typeof m.angle === "number" ? m.angle : 0;
      var cornersLocal = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ];
      for (var i = 0; i < cornersLocal.length; i++) {
        var lp = cornersLocal[i];
        var rotPt = rotatePointImage({ x: m.centerX + lp.x, y: m.centerY + lp.y }, m.centerX, m.centerY, angleR);
        var c = imageToScreen(rotPt);
        drawHandleDisc(ctx, c.x, c.y, RECT_CORNER_HANDLE_RADIUS_PX);
      }
      var edgeLocals = [
        { x: 0, y: -hh },
        { x: hw, y: 0 },
        { x: 0, y: hh },
        { x: -hw, y: 0 },
      ];
      for (var ei = 0; ei < edgeLocals.length; ei++) {
        var elp = edgeLocals[ei];
        var erot = rotatePointImage({ x: m.centerX + elp.x, y: m.centerY + elp.y }, m.centerX, m.centerY, angleR);
        var es = imageToScreen(erot);
        drawHandleDisc(ctx, es.x, es.y, RECT_EDGE_HANDLE_RADIUS_PX);
      }
      /* Rotation handle: geometrically attached, follows rotation (SolarGlobe premium) */
      var halfH = m.height / 2;
      var angle = m.angle || 0;
      var cosA = Math.cos(angle);
      var sinA = Math.sin(angle);

      /* Bord supérieur réel (axe local -Y) */
      var edgeWorldX = m.centerX + (sinA * halfH);
      var edgeWorldY = m.centerY + (-cosA * halfH);

      var HANDLE_OFFSET_PX = 28;
      var offsetLocalY = halfH + (HANDLE_OFFSET_PX / scale);
      var handleWorldX = m.centerX + (sinA * offsetLocalY);
      var handleWorldY = m.centerY + (-cosA * offsetLocalY);

      var handleScreen = imageToScreen({ x: handleWorldX, y: handleWorldY });
      var edgeScreen = imageToScreen({ x: edgeWorldX, y: edgeWorldY });

      /* Ligne de liaison PREMIUM (top-edge → handle) */
      ctx.save();
      ctx.strokeStyle = "rgba(37, 99, 235, 0.30)";
      ctx.lineWidth = 0.9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(edgeScreen.x, edgeScreen.y);
      ctx.lineTo(handleScreen.x, handleScreen.y);
      ctx.stroke();
      ctx.restore();

      /* Handle rotation premium (rayon visuel 10px, hitbox inchangée) */
      var hovered = !!emphasizeRotate;
      ctx.save();
      if (hovered) {
        ctx.shadowBlur = 6;
        ctx.shadowColor = "rgba(37, 99, 235, 0.55)";
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(handleScreen.x, handleScreen.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(96, 165, 250, 0.85)";
      ctx.stroke();
      ctx.shadowBlur = 0;
      /* Icône rotation arc */
      ctx.beginPath();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = "rgba(191, 219, 254, 0.95)";
      ctx.arc(handleScreen.x, handleScreen.y, 4.2, Math.PI * 0.2, Math.PI * 1.7);
      ctx.stroke();
      /* Pointe flèche */
      var arrowAngle = Math.PI * 1.7;
      var ax = handleScreen.x + Math.cos(arrowAngle) * 4.2;
      var ay = handleScreen.y + Math.sin(arrowAngle) * 4.2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 3, ay - 1.5);
      ctx.lineTo(ax - 0.8, ay - 3.5);
      ctx.closePath();
      ctx.fillStyle = "rgba(191, 219, 254, 0.95)";
      ctx.fill();
      ctx.restore();
    }
  }

  var POLYGON_VERTEX_HANDLE_RADIUS_PX = 7;

  /**
   * Dessine les handles des shadow volumes (cube, tube) avec design premium pour le handle rotation.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} volume - { type, shape, x, y, width, depth, height, rotation }
   * @param {Function} imageToScreen
   * @param {number} vpScale
   * @param {number} mpp - meters per pixel
   * @param {boolean} [hoveredRotate] - glow sur le handle rotation au survol
   */
  function drawShadowVolumeHandles(ctx, volume, imageToScreen, vpScale, mpp, hoveredRotate) {
    if (!volume || volume.type !== "shadow_volume") return;
    if (vpScale === undefined) vpScale = 1;
    if (mpp === undefined) mpp = 1;
    if (hoveredRotate === undefined) hoveredRotate = false;

    var wPx = (volume.width || 0.6) / mpp, dPx = (volume.depth || 0.6) / mpp;
    var rotDeg = typeof volume.rotation === "number" ? volume.rotation : 0;
    var rotRad = (rotDeg * Math.PI) / 180;
    var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
    var cx = volume.x, cy = volume.y;
    var isTube = volume.shape === "tube";
    var r = isTube ? wPx / 2 : 0;

    function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }

    function drawRotateHandlePremium(edgeImg, handleImg) {
      var edgeScreen = imageToScreen(edgeImg);
      var handleScreen = imageToScreen(handleImg);
      ctx.save();
      ctx.strokeStyle = "rgba(37, 99, 235, 0.30)";
      ctx.lineWidth = 0.9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(edgeScreen.x, edgeScreen.y);
      ctx.lineTo(handleScreen.x, handleScreen.y);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      if (hoveredRotate) {
        ctx.shadowBlur = 6;
        ctx.shadowColor = "rgba(37, 99, 235, 0.55)";
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(handleScreen.x, handleScreen.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(96, 165, 250, 0.85)";
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = "rgba(191, 219, 254, 0.95)";
      ctx.arc(handleScreen.x, handleScreen.y, 4.2, Math.PI * 0.2, Math.PI * 1.7);
      ctx.stroke();
      var arrowAngle = Math.PI * 1.7;
      var ax = handleScreen.x + Math.cos(arrowAngle) * 4.2;
      var ay = handleScreen.y + Math.sin(arrowAngle) * 4.2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 3, ay - 1.5);
      ctx.lineTo(ax - 0.8, ay - 3.5);
      ctx.closePath();
      ctx.fillStyle = "rgba(191, 219, 254, 0.95)";
      ctx.fill();
      ctx.restore();
    }

    if (isTube) {
      /* Tube : rayon sur l’axe local +X ; rotation au nord local (cohérent cube / rect) */
      var radiusImg = rotPt(r, 0);
      var radSc = imageToScreen(radiusImg);
      drawHandleDisc(ctx, radSc.x, radSc.y, 7);
      var HANDLE_OFFSET_PX = 28;
      var offsetImg = HANDLE_OFFSET_PX / vpScale;
      var edgeTopTube = rotPt(0, -r);
      var handleRotTube = rotPt(0, -(r + offsetImg));
      drawRotateHandlePremium(edgeTopTube, handleRotTube);
    } else {
      var hw = wPx / 2, hd = dPx / 2;
      var cornersLocal = [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: hd },
        { x: -hw, y: hd },
      ];
      for (var ci = 0; ci < cornersLocal.length; ci++) {
        var lp = cornersLocal[ci];
        var crot = rotatePointImage({ x: cx + lp.x, y: cy + lp.y }, cx, cy, rotRad);
        var csc = imageToScreen(crot);
        drawHandleDisc(ctx, csc.x, csc.y, RECT_CORNER_HANDLE_RADIUS_PX);
      }
      var edgeLocals = [
        { x: 0, y: -hd },
        { x: hw, y: 0 },
        { x: 0, y: hd },
        { x: -hw, y: 0 },
      ];
      for (var ei = 0; ei < edgeLocals.length; ei++) {
        var elp = edgeLocals[ei];
        var erot = rotatePointImage({ x: cx + elp.x, y: cy + elp.y }, cx, cy, rotRad);
        var esc = imageToScreen(erot);
        drawHandleDisc(ctx, esc.x, esc.y, RECT_EDGE_HANDLE_RADIUS_PX);
      }
      var HANDLE_OFFSET_PX = 28;
      var offsetImg = HANDLE_OFFSET_PX / vpScale;
      var hdCube = dPx / 2;
      var edgeImg = rotPt(0, -hdCube);
      var handleImg = rotPt(0, -(hdCube + offsetImg));
      drawRotateHandlePremium(edgeImg, handleImg);
    }
  }

  /**
   * HitTest des handles shadow volume — aligné sur drawShadowVolumeHandles (même position rotation).
   */
  function hitTestShadowVolumeHandles(screenPt, volume, imageToScreen, vpScale, mpp) {
    if (!volume || volume.type !== "shadow_volume") return null;
    if (vpScale === undefined) vpScale = 1;
    if (mpp === undefined) mpp = 1;

    var wPx = (volume.width || 0.6) / mpp, dPx = (volume.depth || 0.6) / mpp;
    var rotDeg = typeof volume.rotation === "number" ? volume.rotation : 0;
    var rotRad = (rotDeg * Math.PI) / 180;
    var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
    var cx = volume.x, cy = volume.y;
    var isTube = volume.shape === "tube";
    var r = isTube ? wPx / 2 : 0;
    var cornerR =
      typeof RECT_CORNER_HANDLE_RADIUS_PX === "number" && Number.isFinite(RECT_CORNER_HANDLE_RADIUS_PX)
        ? RECT_CORNER_HANDLE_RADIUS_PX
        : 8;
    var tolPxRectCorners = cornerR + 10;
    var tolEdge =
      typeof RECT_EDGE_HANDLE_RADIUS_PX === "number" && Number.isFinite(RECT_EDGE_HANDLE_RADIUS_PX)
        ? RECT_EDGE_HANDLE_RADIUS_PX + 10
        : 15;
    var tolRadiusTube = calpinageAdaptiveScreenHitPx(14, vpScale);

    function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }

    var HANDLE_OFFSET_PX = 28;
    var offsetImg = HANDLE_OFFSET_PX / vpScale;

    if (isTube) {
      var hdTube = r;
      var rotateImgT = rotPt(0, -(hdTube + offsetImg));
      var rotateScT = imageToScreen(rotateImgT);
      if (Math.hypot(screenPt.x - rotateScT.x, screenPt.y - rotateScT.y) <= 20) return { handle: "rotate" };
      var radiusSc = imageToScreen(rotPt(r, 0));
      if (Math.hypot(screenPt.x - radiusSc.x, screenPt.y - radiusSc.y) <= tolRadiusTube) return { handle: "radius" };
      return null;
    }

    var hw = wPx / 2, hd = dPx / 2;
    var rotateSc = imageToScreen(rotPt(0, -(hd + offsetImg)));
    if (Math.hypot(screenPt.x - rotateSc.x, screenPt.y - rotateSc.y) <= 20) return { handle: "rotate" };

    var cornersLocal = [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ];
    for (var i = 0; i < cornersLocal.length; i++) {
      var lp = cornersLocal[i];
      var crot = rotatePointImage({ x: cx + lp.x, y: cy + lp.y }, cx, cy, rotRad);
      var c = imageToScreen(crot);
      if (Math.hypot(screenPt.x - c.x, screenPt.y - c.y) <= tolPxRectCorners) return { handle: i };
    }
    var edgeLocalsHit = [
      { x: 0, y: -hd },
      { x: hw, y: 0 },
      { x: 0, y: hd },
      { x: -hw, y: 0 },
    ];
    for (var ej = 0; ej < edgeLocalsHit.length; ej++) {
      var elpH = edgeLocalsHit[ej];
      var erotH = rotatePointImage({ x: cx + elpH.x, y: cy + elpH.y }, cx, cy, rotRad);
      var cH = imageToScreen(erotH);
      if (Math.hypot(screenPt.x - cH.x, screenPt.y - cH.y) <= tolEdge) return { handle: "e" + ej };
    }
    return null;
  }

  function drawPolygonVertexHandles(ctx, obstacle, imageToScreen) {
    if (!obstacle || !obstacle.points || obstacle.points.length < 3) return;
    var m = obstacle.shapeMeta;
    if (m && (m.originalType === "circle" || m.originalType === "rect")) return;
    for (var vi = 0; vi < obstacle.points.length; vi++) {
      var pt = obstacle.points[vi];
      var s = imageToScreen(pt);
      drawHandleDisc(ctx, s.x, s.y, POLYGON_VERTEX_HANDLE_RADIUS_PX);
    }
  }

  function drawObstacles(ctx, obstacles, imageToScreen, preview, scale, selectedIndex, opts) {
    if (scale === undefined) scale = 1;
    opts = opts || {};
    var emphasizeRotate = !!opts.emphasizeRotate;
    var list = obstacles || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (selectedIndex === i && o.shapeMeta) {
        drawObstacleHandles(ctx, o, imageToScreen, scale, emphasizeRotate);
      }
      if (selectedIndex === i && o.points && o.points.length >= 3) {
        var m = o.shapeMeta;
        if (!m || m.originalType !== "circle" && m.originalType !== "rect") {
          drawPolygonVertexHandles(ctx, o, imageToScreen);
        }
      }
    }
    if (preview) {
      if (preview.type === "circle" && typeof preview.r === "number") {
        obstacleDrawCircle(ctx, imageToScreen, preview.x, preview.y, preview.r, true, scale, false);
      } else if (preview.type === "rect" && typeof preview.w === "number" && typeof preview.h === "number") {
        var px = preview.x + preview.w / 2, py = preview.y + preview.h / 2;
        obstacleDrawRect(ctx, imageToScreen, px - preview.w / 2, py - preview.h / 2, preview.w, preview.h, true, false);
      }
    }
  }

  function hitTestObstacleHandles(screenPt, obstacle, imageToScreen, scale) {
    if (scale === undefined) scale = 1;
    var m = obstacle.shapeMeta;
    if (!m) return null;
    var SAFE_HANDLE_RADIUS_PX =
      (typeof HANDLE_RADIUS_PX === "number" && Number.isFinite(HANDLE_RADIUS_PX))
        ? HANDLE_RADIUS_PX
        : 7;
    var tolPxCircle = SAFE_HANDLE_RADIUS_PX + 6;
    if (!Number.isFinite(tolPxCircle)) tolPxCircle = 14;
    var cornerR =
      typeof RECT_CORNER_HANDLE_RADIUS_PX === "number" && Number.isFinite(RECT_CORNER_HANDLE_RADIUS_PX)
        ? RECT_CORNER_HANDLE_RADIUS_PX
        : 8;
    var tolPxRectCorners = cornerR + 10;
    if (!Number.isFinite(tolPxRectCorners)) tolPxRectCorners = 18;
    if (m.originalType === "circle" && typeof m.radius === "number") {
      var handleScreen = imageToScreen({ x: m.centerX + m.radius, y: m.centerY });
      if (Math.hypot(screenPt.x - handleScreen.x, screenPt.y - handleScreen.y) <= tolPxCircle) return { handle: "radius" };
      return null;
    }
    if (m.originalType === "rect" && typeof m.width === "number" && typeof m.height === "number") {
      /* Rotation handle: same math as draw (geometrically attached, follows rotation) */
      var halfH = m.height / 2;
      var angle = m.angle || 0;
      var cosA = Math.cos(angle);
      var sinA = Math.sin(angle);
      var HANDLE_OFFSET_PX = 28;
      var offsetLocalY = halfH + (HANDLE_OFFSET_PX / scale);
      var handleWorldX = m.centerX + (sinA * offsetLocalY);
      var handleWorldY = m.centerY + (-cosA * offsetLocalY);
      var handleScreen = imageToScreen({ x: handleWorldX, y: handleWorldY });
      var dx = screenPt.x - handleScreen.x;
      var dy = screenPt.y - handleScreen.y;
      var HANDLE_RADIUS_PX = 12;
      if (Math.hypot(dx, dy) <= HANDLE_RADIUS_PX + 8) return { handle: "rotate" };
      var hw = m.width / 2, hh = m.height / 2;
      var angleR = typeof m.angle === "number" ? m.angle : 0;
      var cornersLocal = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ];
      for (var i = 0; i < cornersLocal.length; i++) {
        var lp = cornersLocal[i];
        var rotPt = rotatePointImage({ x: m.centerX + lp.x, y: m.centerY + lp.y }, m.centerX, m.centerY, angleR);
        var c = imageToScreen(rotPt);
        if (Math.hypot(screenPt.x - c.x, screenPt.y - c.y) <= tolPxRectCorners) return { handle: i };
      }
      var tolEdge =
        typeof RECT_EDGE_HANDLE_RADIUS_PX === "number" && Number.isFinite(RECT_EDGE_HANDLE_RADIUS_PX)
          ? RECT_EDGE_HANDLE_RADIUS_PX + 10
          : 15;
      var edgeLocalsHit = [
        { x: 0, y: -hh },
        { x: hw, y: 0 },
        { x: 0, y: hh },
        { x: -hw, y: 0 },
      ];
      for (var ej = 0; ej < edgeLocalsHit.length; ej++) {
        var elpH = edgeLocalsHit[ej];
        var erotH = rotatePointImage({ x: m.centerX + elpH.x, y: m.centerY + elpH.y }, m.centerX, m.centerY, angleR);
        var cH = imageToScreen(erotH);
        if (Math.hypot(screenPt.x - cH.x, screenPt.y - cH.y) <= tolEdge) return { handle: "e" + ej };
      }
      return null;
    }
    return null;
  }

  function pointInPolygonObstacle(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y;
      var xj = poly[j].x, yj = poly[j].y;
      if (yi === yj) continue;
      if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function hitTestOneObstacle(screenPt, obstacle, imageToScreen, tolPx, scale) {
    if (scale === undefined) scale = 1;
    if (tolPx === undefined) tolPx = calpinageAdaptiveScreenHitPx(8, scale);
    var m = obstacle.shapeMeta;
    if (m && m.originalType === "circle" && typeof m.radius === "number") {
      var c = imageToScreen({ x: m.centerX, y: m.centerY });
      var rScreen = Math.abs(m.radius) * scale;
      return Math.hypot(screenPt.x - c.x, screenPt.y - c.y) <= rScreen + tolPx;
    }
    if (m && m.originalType === "rect" && typeof m.width === "number" && typeof m.height === "number") {
      var hw = m.width / 2, hh = m.height / 2;
      var angle = typeof m.angle === "number" ? m.angle : 0;
      var cos = Math.cos(angle), sin = Math.sin(angle);
      var corners = [
        imageToScreen({ x: m.centerX - hw * cos + hh * sin, y: m.centerY - hw * sin - hh * cos }),
        imageToScreen({ x: m.centerX + hw * cos + hh * sin, y: m.centerY + hw * sin - hh * cos }),
        imageToScreen({ x: m.centerX + hw * cos - hh * sin, y: m.centerY + hw * sin + hh * cos }),
        imageToScreen({ x: m.centerX - hw * cos - hh * sin, y: m.centerY - hw * sin + hh * cos }),
      ];
      return pointInPolygonObstacle(screenPt, corners);
    }
    return false;
  }

  function hitTestObstacles(screenPt, obstacles, imageToScreen, tolPx, scale) {
    if (scale === undefined) scale = 1;
    var list = obstacles || [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (hitTestOneObstacle(screenPt, list[i], imageToScreen, tolPx, scale)) {
        return { index: i, obstacle: list[i] };
      }
    }
    return null;
  }

  global.CalpinageCanvas = {
    CanvasEngine: CanvasEngine,
    Viewport: Viewport,
    drawPoint: drawPoint,
    drawPolygon: drawPolygon,
    dist: dist,
    hitPoint: hitPoint,
    hitPolygon: hitPolygon,
    InteractionManager: InteractionManager,
    drawObstacles: drawObstacles,
    hitTestObstacles: hitTestObstacles,
    hitTestObstacleHandles: hitTestObstacleHandles,
    drawShadowVolumeHandles: drawShadowVolumeHandles,
    hitTestShadowVolumeHandles: hitTestShadowVolumeHandles,
    rotatePoint: rotatePoint,
    screenToLocal: screenToLocal,
    getObstacleCenter: getObstacleCenter,
  };
})(typeof window !== "undefined" ? window : this);
