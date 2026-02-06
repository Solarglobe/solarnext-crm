/**
 * Calpinage reset — comportement DP2 (Ajouter panneaux / Sélectionner).
 * Source unique : panels[].
 * Un seul mode actif : add (ghost + pose) ou select (marquee + sélection entièrement dedans + rotation groupe).
 */
(function (global) {
  "use strict";

  var DP2_PANEL_DEFAULT_W = 80;
  var DP2_PANEL_DEFAULT_H = 50;
  var ROTATE_HANDLE_OFFSET = 18;
  var ROTATE_HANDLE_RADIUS = 8;
  var MARQUEE_DRAG_THRESHOLD = 4;

  var panels = [];
  var DP2_TOOL = {
    mode: "select",
    isPointerDown: false,
    pointerDownPos: null,
    pointerPos: null,
    ghost: null,
    marquee: null,
    selection: null,
    rotating: null,
    addModeHasMoved: false
  };

  function getCanvasCoords(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = rect.width ? canvas.width / rect.width : 1;
    var scaleY = rect.height ? canvas.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function panelWorldAABB(g) {
    if (!g) return null;
    var w = g.width || 0;
    var h = g.height || 0;
    if (!(w > 0) || !(h > 0)) return null;
    var rot = g.rotation || 0;
    var cx = (g.x || 0) + w / 2;
    var cy = (g.y || 0) + h / 2;
    var c = Math.cos(rot);
    var s = Math.sin(rot);
    var corners = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 }
    ];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < corners.length; i++) {
      var p = corners[i];
      var wx = cx + (p.x * c - p.y * s);
      var wy = cy + (p.x * s + p.y * c);
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function panelsGroupAABB(panelIds) {
    var idSet = {};
    for (var i = 0; i < panelIds.length; i++) idSet[panelIds[i]] = true;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var count = 0;
    for (var j = 0; j < panels.length; j++) {
      var p = panels[j];
      if (!p || !p.geometry || !idSet[p.id]) continue;
      var aabb = panelWorldAABB(p.geometry);
      if (!aabb) continue;
      count++;
      if (aabb.minX < minX) minX = aabb.minX;
      if (aabb.minY < minY) minY = aabb.minY;
      if (aabb.maxX > maxX) maxX = aabb.maxX;
      if (aabb.maxY > maxY) maxY = aabb.maxY;
    }
    if (count === 0) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function getPanelById(id) {
    for (var i = 0; i < panels.length; i++) {
      if (panels[i] && panels[i].id === id) return panels[i];
    }
    return null;
  }

  function setSelection(panelIds) {
    if (!panelIds || panelIds.length === 0) {
      DP2_TOOL.selection = null;
      return;
    }
    var bbox = panelsGroupAABB(panelIds);
    if (!bbox) {
      DP2_TOOL.selection = { panelIds: panelIds, bbox: null, pivot: null, rotationHandle: null };
      return;
    }
    var pivot = { x: bbox.cx, y: bbox.cy };
    var rotationHandle = { x: bbox.cx, y: bbox.minY - ROTATE_HANDLE_OFFSET, r: ROTATE_HANDLE_RADIUS };
    DP2_TOOL.selection = {
      panelIds: panelIds,
      bbox: bbox,
      pivot: pivot,
      rotationHandle: rotationHandle
    };
  }

  function hitTestRotationHandle(x, y) {
    var sel = DP2_TOOL.selection;
    if (!sel || !sel.rotationHandle) return false;
    var h = sel.rotationHandle;
    return Math.hypot(x - h.x, y - h.y) <= h.r;
  }

  function hitTestPanel(x, y) {
    for (var i = panels.length - 1; i >= 0; i--) {
      var p = panels[i];
      if (!p || !p.geometry) continue;
      var aabb = panelWorldAABB(p.geometry);
      if (!aabb) continue;
      if (x >= aabb.minX && x <= aabb.maxX && y >= aabb.minY && y <= aabb.maxY) return p;
    }
    return null;
  }

  function rotatePointAroundPivot(px, py, pivot, deltaRad) {
    var c = Math.cos(deltaRad);
    var s = Math.sin(deltaRad);
    var rx = px - pivot.x;
    var ry = py - pivot.y;
    return {
      x: pivot.x + (rx * c - ry * s),
      y: pivot.y + (rx * s + ry * c)
    };
  }

  function renderPanelRect(ctx, geom, style) {
    var g = geom || {};
    var w = g.width || 0;
    var h = g.height || 0;
    if (!(w > 0) || !(h > 0)) return;
    var cx = (g.x || 0) + w / 2;
    var cy = (g.y || 0) + h / 2;
    var rot = g.rotation || 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = style.fill || "rgba(17,24,39,0.92)";
    ctx.strokeStyle = style.stroke || "rgba(17,24,39,0.98)";
    ctx.lineWidth = style.lineWidth || 1.5;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  var GHOST_STYLE = { fill: "rgba(200,200,200,0.35)", stroke: "rgba(160,160,160,0.55)", lineWidth: 1 };

  function render(ctx) {
    var rect = ctx.canvas.getBoundingClientRect();
    var scaleX = rect.width ? ctx.canvas.width / rect.width : 1;
    var scaleY = rect.height ? ctx.canvas.height / rect.height : 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (p && p.geometry) renderPanelRect(ctx, p.geometry, { fill: "rgba(17,24,39,0.92)", stroke: "rgba(17,24,39,0.98)", lineWidth: 1.5 });
    }

    if (DP2_TOOL.mode === "add" && DP2_TOOL.ghost) {
      renderPanelRect(ctx, DP2_TOOL.ghost, GHOST_STYLE);
    }

    if (DP2_TOOL.marquee && DP2_TOOL.marquee.active) {
      var x0 = DP2_TOOL.marquee.x0, y0 = DP2_TOOL.marquee.y0, x1 = DP2_TOOL.marquee.x1, y1 = DP2_TOOL.marquee.y1;
      var left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1);
      var rx = left, ry = top, rw = right - left, rh = bottom - top;
      ctx.save();
      ctx.fillStyle = "rgba(59,130,246,0.14)";
      ctx.strokeStyle = "rgba(59,130,246,0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (DP2_TOOL.selection && DP2_TOOL.selection.bbox) {
      var b = DP2_TOOL.selection.bbox;
      var x = b.minX, y = b.minY, w = b.maxX - b.minX, h = b.maxY - b.minY;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      var hx = DP2_TOOL.selection.rotationHandle.x;
      var hy = DP2_TOOL.selection.rotationHandle.y;
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.cx, b.minY);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(hx, hy, ROTATE_HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function setMode(mode) {
    DP2_TOOL.mode = mode;
    if (mode !== "add") DP2_TOOL.ghost = null;
    if (mode !== "select") {
      DP2_TOOL.marquee = null;
      if (DP2_TOOL.marquee) DP2_TOOL.marquee.active = false;
    }
    var addBtn = document.getElementById("dp2-btn-add-panels");
    var selBtn = document.getElementById("dp2-btn-select");
    if (addBtn) addBtn.classList.toggle("active", mode === "add");
    if (selBtn) selBtn.classList.toggle("active", mode === "select");
    var canvas = document.getElementById("calpinage-dp2-canvas");
    if (canvas) canvas.classList.toggle("dp2-mode-add", mode === "add");
  }

  function init(canvas) {
    if (!canvas) return;
    panels = [];
    DP2_TOOL.mode = "select";
    DP2_TOOL.selection = null;
    DP2_TOOL.marquee = null;
    DP2_TOOL.ghost = null;
    DP2_TOOL.rotating = null;

    var addBtn = document.getElementById("dp2-btn-add-panels");
    var selBtn = document.getElementById("dp2-btn-select");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        if (DP2_TOOL.mode === "add") {
          setMode("select");
        } else {
          setMode("add");
        }
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
      });
    }
    if (selBtn) {
      selBtn.addEventListener("click", function () {
        setMode("select");
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
      });
    }

    canvas.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      var coords = getCanvasCoords(canvas, e.clientX, e.clientY);
      DP2_TOOL.isPointerDown = true;
      DP2_TOOL.pointerDownPos = { x: coords.x, y: coords.y };
      DP2_TOOL.pointerPos = { x: coords.x, y: coords.y };
      DP2_TOOL.addModeHasMoved = false;

      if (DP2_TOOL.rotating && DP2_TOOL.rotating.active) {
        return;
      }

      if (DP2_TOOL.mode === "select") {
        if (hitTestRotationHandle(coords.x, coords.y)) {
          var ids = DP2_TOOL.selection.panelIds;
          var startById = {};
          for (var i = 0; i < ids.length; i++) {
            var p = getPanelById(ids[i]);
            if (!p || !p.geometry) continue;
            var g = p.geometry;
            startById[p.id] = {
              x: g.x || 0,
              y: g.y || 0,
              rotation: g.rotation || 0,
              width: g.width || 0,
              height: g.height || 0
            };
          }
          DP2_TOOL.rotating = {
            active: true,
            startAngle: Math.atan2(coords.y - DP2_TOOL.selection.pivot.y, coords.x - DP2_TOOL.selection.pivot.x),
            startById: startById,
            pivot: { x: DP2_TOOL.selection.pivot.x, y: DP2_TOOL.selection.pivot.y }
          };
          if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
          return;
        }
        var hitPanel = hitTestPanel(coords.x, coords.y);
        if (hitPanel) {
          setSelection([hitPanel.id]);
          if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
          return;
        }
        DP2_TOOL.marquee = { x0: coords.x, y0: coords.y, x1: coords.x, y1: coords.y, active: true };
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
        return;
      }

      if (DP2_TOOL.mode === "add") {
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
      }
    });

    canvas.addEventListener("mousemove", function (e) {
      var coords = getCanvasCoords(canvas, e.clientX, e.clientY);
      DP2_TOOL.pointerPos = { x: coords.x, y: coords.y };

      if (DP2_TOOL.rotating && DP2_TOOL.rotating.active) {
        // pivot figé pendant le drag (comportement DP2)
        var pivot = DP2_TOOL.rotating.pivot;
        var angle = Math.atan2(coords.y - pivot.y, coords.x - pivot.x);
        var delta = angle - DP2_TOOL.rotating.startAngle;
        var ids = DP2_TOOL.selection ? DP2_TOOL.selection.panelIds : [];
        var startById = DP2_TOOL.rotating.startById || {};
        for (var i = 0; i < ids.length; i++) {
          var p = getPanelById(ids[i]);
          if (!p || !p.geometry) continue;
          var start = startById[p.id];
          if (!start) continue;
          var w = start.width || p.geometry.width || 0;
          var h = start.height || p.geometry.height || 0;
          var startCx = (start.x || 0) + w / 2;
          var startCy = (start.y || 0) + h / 2;
          var rotated = rotatePointAroundPivot(startCx, startCy, pivot, delta);
          p.geometry.x = rotated.x - w / 2;
          p.geometry.y = rotated.y - h / 2;
          p.geometry.rotation = (start.rotation || 0) + delta;
        }
        setSelection(ids);
        DP2_TOOL.selection.pivot = { x: pivot.x, y: pivot.y };
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
        return;
      }

      if (DP2_TOOL.marquee && DP2_TOOL.marquee.active) {
        DP2_TOOL.marquee.x1 = coords.x;
        DP2_TOOL.marquee.y1 = coords.y;
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
        return;
      }

      if (DP2_TOOL.mode === "add") {
        if (DP2_TOOL.isPointerDown && DP2_TOOL.pointerDownPos) {
          var dx = coords.x - DP2_TOOL.pointerDownPos.x;
          var dy = coords.y - DP2_TOOL.pointerDownPos.y;
          if (Math.hypot(dx, dy) > MARQUEE_DRAG_THRESHOLD) DP2_TOOL.addModeHasMoved = true;
        }
        var w = DP2_PANEL_DEFAULT_W;
        var h = DP2_PANEL_DEFAULT_H;
        DP2_TOOL.ghost = {
          x: coords.x - w / 2,
          y: coords.y - h / 2,
          w: w,
          h: h,
          width: w,
          height: h,
          rotation: 0
        };
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
        return;
      }

      if (DP2_TOOL.mode === "select" && !DP2_TOOL.marquee) {
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
      }
    });

    canvas.addEventListener("mouseup", function (e) {
      if (e.button !== 0) return;
      var coords = getCanvasCoords(canvas, e.clientX, e.clientY);

      if (DP2_TOOL.rotating && DP2_TOOL.rotating.active) {
        DP2_TOOL.rotating.active = false;
        DP2_TOOL.rotating = null;
        DP2_TOOL.isPointerDown = false;
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
        return;
      }

      if (DP2_TOOL.marquee && DP2_TOOL.marquee.active) {
        DP2_TOOL.marquee.active = false;
        var x0 = DP2_TOOL.marquee.x0, y0 = DP2_TOOL.marquee.y0, x1 = DP2_TOOL.marquee.x1, y1 = DP2_TOOL.marquee.y1;
        var left = Math.min(x0, x1);
        var right = Math.max(x0, x1);
        var top = Math.min(y0, y1);
        var bottom = Math.max(y0, y1);
        var selectedIds = [];
        for (var i = 0; i < panels.length; i++) {
          var p = panels[i];
          if (!p || !p.geometry) continue;
          var aabb = panelWorldAABB(p.geometry);
          if (!aabb) continue;
          var entirelyInside = aabb.minX >= left && aabb.maxX <= right && aabb.minY >= top && aabb.maxY <= bottom;
          if (entirelyInside) selectedIds.push(p.id);
        }
        setSelection(selectedIds);
        DP2_TOOL.marquee = null;
        DP2_TOOL.isPointerDown = false;
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
        return;
      }

      if (DP2_TOOL.mode === "add" && DP2_TOOL.isPointerDown && !DP2_TOOL.addModeHasMoved && DP2_TOOL.ghost) {
        var g = DP2_TOOL.ghost;
        var id = "panel_" + Date.now() + "_" + Math.random().toString(16).slice(2);
        panels.push({
          id: id,
          type: "panel",
          geometry: {
            x: g.x,
            y: g.y,
            width: g.width || g.w || DP2_PANEL_DEFAULT_W,
            height: g.height || g.h || DP2_PANEL_DEFAULT_H,
            rotation: g.rotation || 0
          },
          lockedSize: true,
          visible: true
        });
        setSelection([id]);
        if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
      }

      DP2_TOOL.isPointerDown = false;
      if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
    });

    canvas.addEventListener("mouseleave", function () {
      DP2_TOOL.pointerPos = null;
      if (DP2_TOOL.mode === "add") DP2_TOOL.ghost = null;
      if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
    });

    setMode("select");
    if (window.DP2Reset && window.DP2Reset.render) window.DP2Reset.render();
  }

  global.DP2Reset = {
    init: init,
    render: function () {
      var canvas = document.getElementById("calpinage-dp2-canvas");
      if (!canvas) return;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      render(ctx);
    },
    getPanels: function () { return panels; },
    setPanels: function (p) { panels = Array.isArray(p) ? p : []; }
  };
})(typeof window !== "undefined" ? window : this);
