/**
 * Bundle exécutable pour l’outil Pans de toiture (étape 6.1).
 * Équivalent runtime de panState.ts + drawPolygon.ts.
 */
(function (global) {
  "use strict";

  var MIN_POINTS = 3;
  var SNAP_TOLERANCE_PX = 6;
  var VERTEX_HIT_RADIUS_PX = 8;
  var CLICK_DRAG_THRESHOLD_PX = 4;

  var panState = {
    pans: [],
    activePanId: null,
    activePoint: null,
  };

  function distImage(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function hitPointImage(p, mouseImage, tolPx) {
    return distImage(p, mouseImage) <= tolPx;
  }

  function pointInPolygonImage(poly, pt) {
    var inside = false;
    var n = poly.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[i].x, yi = poly[i].y;
      var xj = poly[j].x, yj = poly[j].y;
      if (yj === yi) continue;
      var intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function snapToVertex(target, allPans, excludePanId, excludeIndex) {
    var best = null;
    var bestDist = SNAP_TOLERANCE_PX;
    for (var pi = 0; pi < allPans.length; pi++) {
      var pan = allPans[pi];
      for (var i = 0; i < pan.points.length; i++) {
        if (pan.id === excludePanId && i === excludeIndex) continue;
        var d = distImage(target, pan.points[i]);
        if (d < bestDist) {
          bestDist = d;
          best = { x: pan.points[i].x, y: pan.points[i].y };
        }
      }
    }
    return best ? best : { x: target.x, y: target.y };
  }

  function generatePanId() {
    return "pan-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  function getDefaultPanPhysical() {
    return {
      slope: { mode: "auto", computedDeg: null, valueDeg: null },
      orientation: { azimuthDeg: null, label: null },
    };
  }

  function ensurePanPhysical(pan) {
    if (!pan.physical) {
      pan.physical = getDefaultPanPhysical();
      return;
    }
    if (!pan.physical.slope) {
      pan.physical.slope = { mode: "auto", computedDeg: null, valueDeg: null };
    }
    if (pan.physical.slope.mode === undefined) pan.physical.slope.mode = "auto";
    if (pan.physical.slope.computedDeg === undefined) pan.physical.slope.computedDeg = null;
    if (pan.physical.slope.valueDeg === undefined) pan.physical.slope.valueDeg = null;
    if (!pan.physical.orientation) {
      pan.physical.orientation = { azimuthDeg: null, label: null };
    }
    if (pan.physical.orientation.azimuthDeg === undefined) pan.physical.orientation.azimuthDeg = null;
    if (pan.physical.orientation.label === undefined) pan.physical.orientation.label = null;
    if (pan.physical.slopeDirectionLabel === undefined) pan.physical.slopeDirectionLabel = null;
  }

  function createDrawPolygonTool(config) {
    var imgW = config.imgW;
    var imgH = config.imgH;
    var screenToImage = config.screenToImage;
    var imageToScreen = config.imageToScreen;
    var state = config.panState;
    var onRedraw = config.onRedraw;
    var setCursor = config.setCursor;

    var drawingPoints = null;
    var addPointTimeoutId = null;
    var dragging = null;
    var dragStartImage = null;
    var hoverVertex = null;
    var lastMouseImage = null;

    function clampToImage(pt) {
      return {
        x: Math.max(0, Math.min(imgW, pt.x)),
        y: Math.max(0, Math.min(imgH, pt.y)),
      };
    }

    function allVertices() {
      var out = [];
      for (var pi = 0; pi < state.pans.length; pi++) {
        var pan = state.pans[pi];
        for (var i = 0; i < pan.points.length; i++) {
          out.push({ pan: pan, index: i, pt: pan.points[i] });
        }
      }
      return out;
    }

    function hitVertex(mouseImage) {
      var verts = allVertices();
      for (var v = 0; v < verts.length; v++) {
        var item = verts[v];
        if (hitPointImage(item.pt, mouseImage, VERTEX_HIT_RADIUS_PX)) {
          return { panId: item.pan.id, index: item.index };
        }
      }
      return null;
    }

    function hitPan(mouseImage) {
      for (var i = state.pans.length - 1; i >= 0; i--) {
        var pan = state.pans[i];
        if (pointInPolygonImage(pan.points, mouseImage)) return pan;
      }
      return null;
    }

    function commitDrawing() {
      if (!drawingPoints || drawingPoints.length < MIN_POINTS) return;
      var raw = drawingPoints.slice();
      drawingPoints = null;
      var points = raw.map(function (p) { return { x: p.x, y: p.y, h: 0 }; });
      var pan = { id: generatePanId(), points: points, azimuthDeg: null, tiltDeg: null };
      ensurePanPhysical(pan);
      state.pans.push(pan);
      state.activePanId = pan.id;
      onRedraw();
    }

    function cancelAddPointTimeout() {
      if (addPointTimeoutId !== null) {
        clearTimeout(addPointTimeoutId);
        addPointTimeoutId = null;
      }
    }

    function getCursor() {
      if (hoverVertex) return "pointer";
      if (drawingPoints !== null) return "crosshair";
      return "default";
    }

    return {
      onMouseDown: function (screen) {
        var mouseImage = clampToImage(screenToImage(screen));
        if (dragging) return;

        var vertex = hitVertex(mouseImage);
        if (vertex) {
          dragging = { kind: "vertex", panId: vertex.panId, index: vertex.index };
          for (var p = 0; p < state.pans.length; p++) {
            if (state.pans[p].id === vertex.panId) {
              dragStartImage = { x: state.pans[p].points[vertex.index].x, y: state.pans[p].points[vertex.index].y };
              break;
            }
          }
          return;
        }

        if (drawingPoints !== null) {
          cancelAddPointTimeout();
          addPointTimeoutId = setTimeout(function () {
            addPointTimeoutId = null;
            drawingPoints.push({ x: mouseImage.x, y: mouseImage.y });
            onRedraw();
          }, 200);
          return;
        }

        var hit = hitPan(mouseImage);
        if (hit) {
          state.activePanId = hit.id;
          state.activePoint = null;
          onRedraw();
          return;
        }

        state.activePanId = null;
        state.activePoint = null;
        onRedraw();
      },

      onMouseMove: function (screen) {
        var mouseImage = clampToImage(screenToImage(screen));
        lastMouseImage = mouseImage;

        if (dragging) {
          for (var p = 0; p < state.pans.length; p++) {
            if (state.pans[p].id === dragging.panId) {
              var pan = state.pans[p];
              var snapped = snapToVertex(mouseImage, state.pans, pan.id, dragging.index);
              pan.points[dragging.index].x = snapped.x;
              pan.points[dragging.index].y = snapped.y;
              break;
            }
          }
          onRedraw();
          return;
        }

        if (drawingPoints !== null) {
          setCursor("crosshair");
          onRedraw();
          return;
        }

        var v = hitVertex(mouseImage);
        hoverVertex = v;
        setCursor(v ? "pointer" : "default");
        onRedraw();
      },

      onMouseUp: function () {
        if (dragging) {
          if (dragging.kind === "vertex" && dragStartImage) {
            for (var p = 0; p < state.pans.length; p++) {
              if (state.pans[p].id === dragging.panId) {
                var pan = state.pans[p];
                var pt = pan.points[dragging.index];
                var moved = distImage(dragStartImage, { x: pt.x, y: pt.y });
                if (moved < CLICK_DRAG_THRESHOLD_PX) {
                  state.activePanId = dragging.panId;
                  state.activePoint = { panId: dragging.panId, index: dragging.index };
                }
                break;
              }
            }
          }
          dragging = null;
          dragStartImage = null;
          onRedraw();
        }
      },

      onDoubleClick: function (screen) {
        cancelAddPointTimeout();
        if (drawingPoints !== null) {
          if (drawingPoints.length >= MIN_POINTS) commitDrawing();
          drawingPoints = null;
          setCursor("default");
          onRedraw();
        }
      },

      render: function (ctx, imageToScreen) {
        function drawPolygonScreen(points, fillStyle, strokeStyle, lineWidth) {
          if (points.length < 2) return;
          ctx.save();
          ctx.fillStyle = fillStyle;
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          var first = imageToScreen(points[0]);
          ctx.moveTo(first.x, first.y);
          for (var i = 1; i < points.length; i++) {
            var p = imageToScreen(points[i]);
            ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }

        function drawVertex(pt, radius) {
          var s = imageToScreen(pt);
          ctx.beginPath();
          ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        for (var pi = 0; pi < state.pans.length; pi++) {
          var pan = state.pans[pi];
          var isActive = pan.id === state.activePanId;
          drawPolygonScreen(
            pan.points,
            isActive ? "rgba(201, 164, 73, 0.25)" : "rgba(201, 164, 73, 0.15)",
            isActive ? "rgba(161, 124, 33, 0.9)" : "rgba(161, 124, 33, 0.6)",
            2
          );
          if (isActive) {
            ctx.save();
            var ap = state.activePoint;
            var isActivePanPoint = ap && ap.panId === pan.id;
            for (var vi = 0; vi < pan.points.length; vi++) {
              var pt = pan.points[vi];
              var isSelected = isActivePanPoint && ap.index === vi;
              ctx.fillStyle = isSelected ? "#1a1a1a" : "#c9a449";
              ctx.strokeStyle = isSelected ? "#c9a449" : "#1a1a1a";
              ctx.lineWidth = isSelected ? 2 : 1.5;
              drawVertex(pt, isSelected ? 7 : 5);
            }
            ctx.restore();
          }
        }

        if (drawingPoints !== null && drawingPoints.length > 0) {
          drawPolygonScreen(
            drawingPoints,
            "rgba(201, 164, 73, 0.2)",
            "rgba(161, 124, 33, 0.8)",
            2
          );
          ctx.save();
          ctx.fillStyle = "#c9a449";
          ctx.strokeStyle = "#1a1a1a";
          ctx.lineWidth = 1.5;
          for (var i = 0; i < drawingPoints.length; i++) drawVertex(drawingPoints[i], 5);
          ctx.restore();

          if (lastMouseImage && drawingPoints.length >= 1) {
            var last = drawingPoints[drawingPoints.length - 1];
            var cur = imageToScreen(last);
            var mouse = imageToScreen(lastMouseImage);
            ctx.save();
            ctx.strokeStyle = "rgba(161, 124, 33, 0.7)";
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cur.x, cur.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
            ctx.restore();
          }
        }
      },

      getCursor: getCursor,
    };
  }

  var AZIMUTH_MIN = 0;
  var AZIMUTH_MAX = 360;
  var TILT_MIN = 0;
  var TILT_MAX = 90;
  var TILT_SLIDER_MAX = 60;
  var HEIGHT_STEP_M = 0.1;
  var HEIGHT_DEFAULT = 0;

  function clampAzimuth(v) {
    return Math.max(AZIMUTH_MIN, Math.min(AZIMUTH_MAX, Math.round(v)));
  }
  function clampTilt(v) {
    return Math.max(TILT_MIN, Math.min(TILT_MAX, Math.round(v)));
  }

  function renderPanPropertiesPanel(options) {
    var container = options.container;
    var state = options.panState;
    var onRedraw = options.onRedraw;
    var onHeightsChanged = options.onHeightsChanged;
    var onApplyManualSlope = options.onApplyManualSlope;

    var wrap = document.createElement("div");
    wrap.className = "pan-properties-panel";
    wrap.style.marginTop = "8px";

    var placeholderEl = null;
    var controlsWrap = null;
    var vertexWrap = null;
    var azimuthSlider = null;
    var azimuthInput = null;
    var tiltSlider = null;
    var tiltInput = null;
    var heightInput = null;
    var heightMin;
    var heightMax;

    function getActivePan() {
      if (!state.activePanId) return null;
      for (var i = 0; i < state.pans.length; i++) {
        if (state.pans[i].id === state.activePanId) return state.pans[i];
      }
      return null;
    }

    function syncAzimuthFromPan(pan) {
      var raw = (pan.physical && pan.physical.orientation && pan.physical.orientation.azimuthDeg != null)
        ? pan.physical.orientation.azimuthDeg
        : (pan.azimuthDeg != null ? pan.azimuthDeg : null);
      if (raw != null && Number.isFinite(Number(raw))) {
        var v = clampAzimuth(Number(raw));
        if (azimuthSlider) {
          azimuthSlider.disabled = false;
          azimuthSlider.value = String(v);
        }
        if (azimuthInput) {
          azimuthInput.value = String(v);
          azimuthInput.placeholder = "";
        }
      } else {
        if (azimuthSlider) {
          azimuthSlider.disabled = true;
          azimuthSlider.value = String(AZIMUTH_MIN);
        }
        if (azimuthInput) {
          azimuthInput.value = "";
          azimuthInput.placeholder = "\u2014";
        }
      }
    }
    function syncTiltFromPan(pan) {
      var slope = pan.physical && pan.physical.slope;
      var raw = null;
      if (slope && slope.valueDeg != null && Number.isFinite(Number(slope.valueDeg))) raw = slope.valueDeg;
      else if (slope && slope.mode !== "manual" && slope.computedDeg != null && Number.isFinite(Number(slope.computedDeg))) raw = slope.computedDeg;
      else if (pan.tiltDeg != null && Number.isFinite(Number(pan.tiltDeg))) raw = pan.tiltDeg;
      if (raw != null && Number.isFinite(Number(raw))) {
        var v = clampTilt(Number(raw));
        if (tiltSlider) {
          tiltSlider.disabled = false;
          tiltSlider.value = String(v);
        }
        if (tiltInput) {
          tiltInput.value = String(v);
          tiltInput.placeholder = "";
        }
      } else {
        if (tiltSlider) {
          tiltSlider.disabled = true;
          tiltSlider.value = String(TILT_MIN);
        }
        if (tiltInput) {
          tiltInput.value = "";
          tiltInput.placeholder = "\u2014";
        }
      }
    }

    function getActivePoint() {
      var ap = state.activePoint;
      if (!ap) return null;
      var pan = null;
      for (var i = 0; i < state.pans.length; i++) {
        if (state.pans[i].id === ap.panId) { pan = state.pans[i]; break; }
      }
      if (!pan || ap.index < 0 || ap.index >= pan.points.length) return null;
      return { pan: pan, point: pan.points[ap.index], index: ap.index };
    }

    function clampHeight(v) {
      if (heightMin !== undefined) v = Math.max(heightMin, v);
      if (heightMax !== undefined) v = Math.min(heightMax, v);
      return v;
    }

    function setPointHeight(pan, point, value) {
      var clamped = clampHeight(value);
      point.h = clamped;
      if (heightInput) heightInput.value = String(clamped);
      if (typeof onHeightsChanged === "function") onHeightsChanged(pan);
      onRedraw();
    }

    function buildVertexSection() {
      if (vertexWrap) return vertexWrap;
      vertexWrap = document.createElement("div");
      vertexWrap.className = "pan-properties-vertex";
      vertexWrap.style.marginTop = "16px";
      vertexWrap.style.paddingTop = "16px";
      vertexWrap.style.borderTop = "1px solid var(--line, #e4ddcc)";

      var title = document.createElement("p");
      title.style.fontSize = "13px";
      title.style.fontWeight = "600";
      title.style.marginBottom = "6px";
      title.className = "vertex-section-title";
      title.textContent = "Sommet";
      vertexWrap.appendChild(title);

      var idLine = document.createElement("p");
      idLine.style.fontSize = "12px";
      idLine.style.color = "var(--muted, #6b7280)";
      idLine.style.marginBottom = "8px";
      idLine.className = "vertex-point-id";
      vertexWrap.appendChild(idLine);

      var heightLabel = document.createElement("label");
      heightLabel.style.display = "block";
      heightLabel.style.fontSize = "12px";
      heightLabel.style.marginBottom = "4px";
      heightLabel.textContent = "Hauteur (m)";
      vertexWrap.appendChild(heightLabel);

      var row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.marginBottom = "8px";

      var minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.className = "btn-measure calibration-panel vertex-height-minus";
      minusBtn.style.padding = "6px 12px";
      minusBtn.style.fontSize = "14px";
      minusBtn.textContent = "−";
      minusBtn.title = "Diminuer la hauteur";

      heightInput = document.createElement("input");
      heightInput.type = "number";
      heightInput.step = String(HEIGHT_STEP_M);
      heightInput.style.width = "72px";
      heightInput.style.padding = "6px";

      var plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.className = "btn-measure calibration-panel vertex-height-plus";
      plusBtn.style.padding = "6px 12px";
      plusBtn.style.fontSize = "14px";
      plusBtn.textContent = "+";
      plusBtn.title = "Augmenter la hauteur";

      minusBtn.addEventListener("click", function () {
        var data = getActivePoint();
        if (!data || (data.point.constraints && data.point.constraints.lock)) return;
        setPointHeight(data.pan, data.point, (data.point.h != null ? data.point.h : HEIGHT_DEFAULT) - HEIGHT_STEP_M);
      });
      plusBtn.addEventListener("click", function () {
        var data = getActivePoint();
        if (!data || (data.point.constraints && data.point.constraints.lock)) return;
        setPointHeight(data.pan, data.point, (data.point.h != null ? data.point.h : HEIGHT_DEFAULT) + HEIGHT_STEP_M);
      });
      heightInput.addEventListener("change", function () {
        var data = getActivePoint();
        if (!data || (data.point.constraints && data.point.constraints.lock)) return;
        var v = Number(heightInput.value);
        if (!Number.isFinite(v)) return;
        setPointHeight(data.pan, data.point, v);
      });
      heightInput.addEventListener("input", function () {
        var data = getActivePoint();
        if (!data || (data.point.constraints && data.point.constraints.lock)) return;
        var v = Number(heightInput.value);
        if (!Number.isFinite(v)) return;
        var clamped = clampHeight(v);
        data.point.h = clamped;
        if (typeof onHeightsChanged === "function") onHeightsChanged(data.pan);
        onRedraw();
      });

      row.appendChild(minusBtn);
      row.appendChild(heightInput);
      row.appendChild(plusBtn);
      vertexWrap.appendChild(row);

      var lockNote = document.createElement("p");
      lockNote.style.fontSize = "11px";
      lockNote.style.color = "var(--muted, #6b7280)";
      lockNote.className = "vertex-lock-note";
      vertexWrap.appendChild(lockNote);

      return vertexWrap;
    }

    function syncVertexSection() {
      var data = getActivePoint();
      if (!vertexWrap) return;
      if (!data) {
        vertexWrap.style.display = "none";
        return;
      }
      vertexWrap.style.display = "block";
      var idEl = vertexWrap.querySelector(".vertex-point-id");
      if (idEl) idEl.textContent = "Id : " + (data.point.id != null ? data.point.id : data.pan.id + "-" + data.index);

      var lock = data.point.constraints && data.point.constraints.lock;
      heightMin = data.point.constraints && data.point.constraints.minH;
      heightMax = data.point.constraints && data.point.constraints.maxH;
      if (heightInput) {
        heightInput.disabled = lock;
        heightInput.readOnly = lock;
        if (heightMin !== undefined) heightInput.min = String(heightMin);
        else heightInput.removeAttribute("min");
        if (heightMax !== undefined) heightInput.max = String(heightMax);
        else heightInput.removeAttribute("max");
        heightInput.value = String(data.point.h != null ? data.point.h : HEIGHT_DEFAULT);
      }
      var minusBtn = vertexWrap.querySelector(".vertex-height-minus");
      var plusBtn = vertexWrap.querySelector(".vertex-height-plus");
      if (minusBtn) minusBtn.disabled = lock;
      if (plusBtn) plusBtn.disabled = lock;
      var lockNote = vertexWrap.querySelector(".vertex-lock-note");
      if (lockNote) lockNote.textContent = lock ? "Sommet verrouillé (lecture seule)" : "";
    }

    function buildControls() {
      if (controlsWrap) return;
      controlsWrap = document.createElement("div");
      controlsWrap.className = "pan-properties-controls";

      var azimuthLabel = document.createElement("p");
      azimuthLabel.style.fontSize = "13px";
      azimuthLabel.style.fontWeight = "600";
      azimuthLabel.style.marginBottom = "6px";
      azimuthLabel.style.marginTop = "12px";
      azimuthLabel.textContent = "Orientation (azimut)";
      controlsWrap.appendChild(azimuthLabel);
      var azimuthNote = document.createElement("p");
      azimuthNote.style.fontSize = "11px";
      azimuthNote.style.color = "var(--muted, #6b7280)";
      azimuthNote.style.marginBottom = "8px";
      azimuthNote.textContent = "0° Nord, 90° Est, 180° Sud, 270° Ouest";
      controlsWrap.appendChild(azimuthNote);

      var presetsWrap = document.createElement("div");
      presetsWrap.style.display = "flex";
      presetsWrap.style.flexWrap = "wrap";
      presetsWrap.style.gap = "6px";
      presetsWrap.style.marginBottom = "8px";
      [0, 90, 180, 270].forEach(function (deg) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-measure calibration-panel";
        btn.style.padding = "6px 12px";
        btn.style.fontSize = "12px";
        btn.textContent = deg + "°";
        btn.title = deg === 0 ? "Nord" : deg === 90 ? "Est" : deg === 180 ? "Sud" : "Ouest";
        btn.addEventListener("click", function () {
          var pan = getActivePan();
          if (!pan) return;
          pan.azimuthDeg = deg;
          syncAzimuthFromPan(pan);
          onRedraw();
        });
        presetsWrap.appendChild(btn);
      });
      controlsWrap.appendChild(presetsWrap);

      var azimuthRow = document.createElement("div");
      azimuthRow.style.display = "flex";
      azimuthRow.style.alignItems = "center";
      azimuthRow.style.gap = "10px";
      azimuthRow.style.marginBottom = "8px";
      azimuthSlider = document.createElement("input");
      azimuthSlider.type = "range";
      azimuthSlider.min = String(AZIMUTH_MIN);
      azimuthSlider.max = String(AZIMUTH_MAX);
      azimuthSlider.step = "1";
      azimuthSlider.style.flex = "1";
      azimuthSlider.style.minWidth = "80px";
      azimuthInput = document.createElement("input");
      azimuthInput.type = "number";
      azimuthInput.min = String(AZIMUTH_MIN);
      azimuthInput.max = String(AZIMUTH_MAX);
      azimuthInput.step = "1";
      azimuthInput.style.width = "56px";
      azimuthInput.style.padding = "6px";
      azimuthRow.appendChild(azimuthSlider);
      azimuthRow.appendChild(azimuthInput);
      controlsWrap.appendChild(azimuthRow);

      azimuthSlider.addEventListener("input", function () {
        var pan = getActivePan();
        if (!pan) return;
        var v = clampAzimuth(Number(azimuthSlider.value));
        pan.azimuthDeg = v;
        if (azimuthInput) azimuthInput.value = String(v);
        if (azimuthSlider) azimuthSlider.disabled = false;
        onRedraw();
      });
      azimuthInput.addEventListener("input", function () {
        var pan = getActivePan();
        if (!pan) return;
        var rawAz = (azimuthInput.value || "").trim();
        if (rawAz === "") return;
        var v = clampAzimuth(Number(rawAz));
        if (!Number.isFinite(v)) return;
        pan.azimuthDeg = v;
        if (azimuthSlider) {
          azimuthSlider.disabled = false;
          azimuthSlider.value = String(v);
        }
        onRedraw();
      });
      azimuthInput.addEventListener("change", function () {
        var pan = getActivePan();
        if (!pan) return;
        var rawAz = (azimuthInput.value || "").trim();
        if (rawAz === "") {
          pan.azimuthDeg = null;
          syncAzimuthFromPan(pan);
          onRedraw();
          return;
        }
        var v = clampAzimuth(Number(rawAz));
        if (!Number.isFinite(v)) {
          syncAzimuthFromPan(pan);
          onRedraw();
          return;
        }
        pan.azimuthDeg = v;
        if (azimuthSlider) {
          azimuthSlider.disabled = false;
          azimuthSlider.value = String(v);
        }
        if (azimuthInput) azimuthInput.value = String(v);
        onRedraw();
      });

      var tiltLabel = document.createElement("p");
      tiltLabel.style.fontSize = "13px";
      tiltLabel.style.fontWeight = "600";
      tiltLabel.style.marginBottom = "6px";
      tiltLabel.style.marginTop = "16px";
      tiltLabel.textContent = "Inclinaison";
      controlsWrap.appendChild(tiltLabel);
      var tiltNote = document.createElement("p");
      tiltNote.style.fontSize = "11px";
      tiltNote.style.color = "var(--muted, #6b7280)";
      tiltNote.style.marginBottom = "8px";
      tiltNote.textContent = "0° = plat. Laisser vide tant que la pente n\u2019est pas calcul\u00E9e ou saisie.";
      controlsWrap.appendChild(tiltNote);

      var tiltRow = document.createElement("div");
      tiltRow.style.display = "flex";
      tiltRow.style.alignItems = "center";
      tiltRow.style.gap = "10px";
      tiltRow.style.marginBottom = "8px";
      tiltSlider = document.createElement("input");
      tiltSlider.type = "range";
      tiltSlider.min = String(TILT_MIN);
      tiltSlider.max = String(TILT_SLIDER_MAX);
      tiltSlider.step = "1";
      tiltSlider.style.flex = "1";
      tiltSlider.style.minWidth = "80px";
      tiltInput = document.createElement("input");
      tiltInput.type = "number";
      tiltInput.min = String(TILT_MIN);
      tiltInput.max = String(TILT_MAX);
      tiltInput.step = "1";
      tiltInput.style.width = "56px";
      tiltInput.style.padding = "6px";
      tiltRow.appendChild(tiltSlider);
      tiltRow.appendChild(tiltInput);
      controlsWrap.appendChild(tiltRow);

      tiltSlider.addEventListener("input", function () {
        var pan = getActivePan();
        if (!pan) return;
        if (tiltSlider) tiltSlider.disabled = false;
        var v = clampTilt(Number(tiltSlider.value));
        if (typeof onApplyManualSlope === "function") {
          onApplyManualSlope(pan, v);
        } else {
          pan.tiltDeg = v;
          if (pan.physical && pan.physical.slope) {
            pan.physical.slope.mode = "manual";
            pan.physical.slope.valueDeg = v;
          }
        }
        if (tiltInput) tiltInput.value = String(v);
        onRedraw();
      });
      tiltInput.addEventListener("input", function () {
        var pan = getActivePan();
        if (!pan) return;
        var rawT = (tiltInput.value || "").trim();
        if (rawT === "") return;
        var v = clampTilt(Number(rawT));
        if (!Number.isFinite(v)) return;
        if (typeof onApplyManualSlope === "function") {
          onApplyManualSlope(pan, v);
        } else {
          pan.tiltDeg = v;
          if (pan.physical && pan.physical.slope) {
            pan.physical.slope.mode = "manual";
            pan.physical.slope.valueDeg = v;
          }
        }
        if (tiltSlider) {
          tiltSlider.disabled = false;
          tiltSlider.value = String(Math.min(v, TILT_SLIDER_MAX));
        }
        onRedraw();
      });
      tiltInput.addEventListener("change", function () {
        var pan = getActivePan();
        if (!pan) return;
        var rawT = (tiltInput.value || "").trim();
        if (rawT === "") {
          pan.tiltDeg = null;
          if (pan.physical && pan.physical.slope) {
            pan.physical.slope.mode = "auto";
            pan.physical.slope.valueDeg = null;
          }
          if (typeof onHeightsChanged === "function") onHeightsChanged(pan);
          syncTiltFromPan(pan);
          onRedraw();
          return;
        }
        var v = clampTilt(Number(rawT));
        if (!Number.isFinite(v)) {
          syncTiltFromPan(pan);
          onRedraw();
          return;
        }
        if (typeof onApplyManualSlope === "function") {
          onApplyManualSlope(pan, v);
        } else {
          pan.tiltDeg = v;
          if (pan.physical && pan.physical.slope) {
            pan.physical.slope.mode = "manual";
            pan.physical.slope.valueDeg = v;
          }
        }
        if (tiltSlider) {
          tiltSlider.disabled = false;
          tiltSlider.value = String(Math.min(v, TILT_SLIDER_MAX));
        }
        if (tiltInput) tiltInput.value = String(v);
        onRedraw();
      });
    }

    function update() {
      var pan = getActivePan();
      if (!pan) {
        if (controlsWrap) {
          controlsWrap.remove();
          controlsWrap = null;
          azimuthSlider = null;
          azimuthInput = null;
          tiltSlider = null;
          tiltInput = null;
        }
        if (vertexWrap) vertexWrap.style.display = "none";
        if (!placeholderEl) {
          placeholderEl = document.createElement("p");
          placeholderEl.className = "pan-properties-placeholder";
          placeholderEl.style.fontSize = "13px";
          placeholderEl.style.color = "var(--muted, #6b7280)";
          placeholderEl.textContent = "Sélectionnez un pan pour éditer ses propriétés";
          wrap.appendChild(placeholderEl);
        }
        return;
      }
      if (placeholderEl) {
        placeholderEl.remove();
        placeholderEl = null;
      }
      buildControls();
      if (controlsWrap && !wrap.contains(controlsWrap)) wrap.appendChild(controlsWrap);
      syncAzimuthFromPan(pan);
      syncTiltFromPan(pan);
      buildVertexSection();
      if (vertexWrap && !wrap.contains(vertexWrap)) wrap.appendChild(vertexWrap);
      syncVertexSection();
    }

    update();
    container.appendChild(wrap);

    return { update: update, destroy: function () { wrap.remove(); } };
  }

  /** Assure azimuthDeg, tiltDeg, physical ; ne force plus h=0 sur les sommets (Z absent ≠ 0 m pour la physique). */
  function ensurePanPhysicalProps(pans) {
    if (!Array.isArray(pans)) return;
    for (var i = 0; i < pans.length; i++) {
      var p = pans[i];
      if (!p) continue;
      if (p.azimuthDeg === undefined) p.azimuthDeg = null;
      if (p.tiltDeg === undefined) p.tiltDeg = null;
      ensurePanPhysical(p);
    }
  }

  var TOL = 1e-10;
  var TOL_PX = 1e-6;
  var DEG_PER_RAD = 180 / Math.PI;

  function getH(pt) {
    return typeof pt.h === "number" && Number.isFinite(pt.h) ? pt.h : 0;
  }

  /** Hauteur au sommet : state.getVertexH(imgPt) si fourni, sinon pt.h. */
  function getVertexH(pt, state) {
    if (state && typeof state.getVertexH === "function") return state.getVertexH(pt);
    return getH(pt);
  }

  /**
   * Hauteur pour physique : state.getVertexH (lecture stricte contour / faîtage / trait),
   * sinon Z explicite sur le sommet pt.h — jamais d’imputation 0 implicite.
   */
  function getVertexHForPhysics(pt, state) {
    if (!pt) return null;
    if (state && typeof state.getVertexH === "function") {
      var v = state.getVertexH(pt);
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof pt.h === "number" && Number.isFinite(pt.h)) return pt.h;
      return null;
    }
    if (typeof pt.h === "number" && Number.isFinite(pt.h)) return pt.h;
    return null;
  }

  /**
   * SYNC : `canonical3d/builder/worldMapping.ts` — imagePxToWorldHorizontalM (ENU, Z↑).
   */
  function imagePxToWorldHorizontalM(xPx, yPx, metersPerPixel, northAngleDeg) {
    var x0 = xPx * metersPerPixel;
    var y0 = -yPx * metersPerPixel;
    var rad = (northAngleDeg * Math.PI) / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    return { x: x0 * cos - y0 * sin, y: x0 * sin + y0 * cos };
  }

  /** SYNC : `canonical3d/builder/worldMapping.ts` — segmentHorizontalLengthMFromImagePx */
  function segmentHorizontalLengthMFromImagePx(ax, ay, bx, by, metersPerPixel, northAngleDeg) {
    var aw = imagePxToWorldHorizontalM(ax, ay, metersPerPixel, northAngleDeg);
    var bw = imagePxToWorldHorizontalM(bx, by, metersPerPixel, northAngleDeg);
    return Math.hypot(bw.x - aw.x, bw.y - aw.y);
  }

  function vecLen3(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  function normalize3enu(v) {
    var L = vecLen3(v);
    if (L < TOL) return null;
    return { x: v.x / L, y: v.y / L, z: v.z / L };
  }

  function dot3enu(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function newellNormalUnnormalized3d(corners) {
    var nx = 0, ny = 0, nz = 0;
    var n = corners.length;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var a = corners[i], b = corners[j];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    return { x: nx, y: ny, z: nz };
  }

  function orientExteriorNormalTowardSky3d(n, up) {
    var nu = normalize3enu(n);
    if (!nu) return { x: 0, y: 0, z: 1 };
    var uu = normalize3enu(up);
    if (!uu) return nu;
    if (dot3enu(nu, uu) < 0) return { x: -nu.x, y: -nu.y, z: -nu.z };
    return nu;
  }

  function tiltDegFromNormalAndUp3d(n, up) {
    var nu = normalize3enu(n);
    var uu = normalize3enu(up);
    if (!nu || !uu) return 0;
    var along = Math.abs(dot3enu(nu, uu));
    var horiz = Math.sqrt(Math.max(0, 1 - along * along));
    return Math.atan2(horiz, along) * DEG_PER_RAD;
  }

  function azimuthDegEnuHorizontalNormal3d(n) {
    var d = Math.hypot(n.x, n.y);
    if (d < TOL) return 0;
    return ((Math.atan2(n.x, n.y) * DEG_PER_RAD) + 360) % 360;
  }

  function buildCornersWorldENUFromPanPoints(pts, mpp, northDeg, state) {
    var corners = [];
    for (var i = 0; i < pts.length; i++) {
      var h = getVertexHForPhysics(pts[i], state);
      if (h == null) return null;
      var w = imagePxToWorldHorizontalM(pts[i].x, pts[i].y, mpp, northDeg);
      corners.push({ x: w.x, y: w.y, z: h });
    }
    if (corners.length < 3) return null;
    return corners;
  }

  /** Plan z = a·x + b·y + c en coordonnées monde ENU (m), ≥3 sommets à h finie. */
  function fitPlaneWorldENU(pts, metersPerPixel, northDeg, state) {
    if (!pts || !pts.length || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
    var sumX = 0, sumY = 0, sumH = 0, sumXX = 0, sumYY = 0, sumXY = 0, sumXH = 0, sumYH = 0;
    var m = 0;
    for (var i = 0; i < pts.length; i++) {
      var h = getVertexHForPhysics(pts[i], state);
      if (h == null) continue;
      var w = imagePxToWorldHorizontalM(pts[i].x, pts[i].y, metersPerPixel, northDeg);
      var xW = w.x, yW = w.y;
      sumX += xW; sumY += yW; sumH += h;
      sumXX += xW * xW; sumYY += yW * yW; sumXY += xW * yW;
      sumXH += xW * h; sumYH += yW * h;
      m++;
    }
    if (m < 3) return null;
    var det = m * (sumXX * sumYY - sumXY * sumXY) - sumX * (sumX * sumYY - sumXY * sumY) + sumY * (sumX * sumXY - sumXX * sumY);
    if (Math.abs(det) < TOL) return null;
    var a = (m * (sumXH * sumYY - sumYH * sumXY) - sumX * (sumH * sumYY - sumYH * sumY) + sumY * (sumH * sumXY - sumXH * sumY)) / det;
    var b = (m * (sumXX * sumYH - sumXH * sumXY) - sumX * (sumXX * sumH - sumXH * sumX) + sumY * (sumXY * sumX - sumXX * sumY)) / det;
    var c = (sumH - a * sumX - b * sumY) / m;
    return { a: a, b: b, c: c };
  }

  /**
   * Physique pan ENU : Newell sur sommets monde (aligné canonical) ; repli LSQ monde ; repli pente bas/haut sans azimut.
   */
  function resolvePanPhysicsWorldENU(pan, state) {
    var pts = getPanPoints(pan);
    if (!pts || pts.length < 2) return null;
    var mpp = (state.roof && state.roof.scale && state.roof.scale.metersPerPixel) != null ? state.roof.scale.metersPerPixel : 1;
    if (!Number.isFinite(mpp) || mpp <= 0) mpp = 1;
    var northDeg = getNorthAngleDeg(state);
    var up = { x: 0, y: 0, z: 1 };
    var corners = buildCornersWorldENUFromPanPoints(pts, mpp, northDeg, state);
    if (corners && corners.length >= 3) {
      var nRaw = newellNormalUnnormalized3d(corners);
      if (vecLen3(nRaw) >= TOL) {
        var ext = orientExteriorNormalTowardSky3d(nRaw, up);
        var nu = normalize3enu(ext);
        if (nu) {
          return {
            kind: "newell",
            slopeDeg: tiltDegFromNormalAndUp3d(nu, up),
            azimuthDeg: azimuthDegEnuHorizontalNormal3d(nu),
            normal: nu,
            planeWorld: null
          };
        }
      }
    }
    var planeW = fitPlaneWorldENU(pts, mpp, northDeg, state);
    if (planeW) {
      var nPlane = { x: -planeW.a, y: -planeW.b, z: 1 };
      var ext2 = orientExteriorNormalTowardSky3d(nPlane, up);
      var nu2 = normalize3enu(ext2);
      if (nu2) {
        return {
          kind: "lsq",
          slopeDeg: tiltDegFromNormalAndUp3d(nu2, up),
          azimuthDeg: azimuthDegEnuHorizontalNormal3d(nu2),
          normal: nu2,
          planeWorld: planeW
        };
      }
    }
    var sets = pickLowHighSets(pts, state);
    if (!sets.lowPts.length || !sets.highPts.length) return null;
    var deltaH = sets.maxH - sets.minH;
    var lowC = avgPoint(sets.lowPts);
    var highC = avgPoint(sets.highPts);
    var lw = imagePxToWorldHorizontalM(lowC.x, lowC.y, mpp, northDeg);
    var hw = imagePxToWorldHorizontalM(highC.x, highC.y, mpp, northDeg);
    var runM = Math.hypot(lw.x - hw.x, lw.y - hw.y);
    var RUN_EPS_M = 1e-4;
    if (runM < RUN_EPS_M) {
      if (Math.abs(deltaH) <= 1e-6) {
        return { kind: "centroid", slopeDeg: 0, azimuthDeg: null, normal: null, planeWorld: null };
      }
      return null;
    }
    return {
      kind: "centroid",
      slopeDeg: Math.atan2(deltaH, runM) * DEG_PER_RAD,
      azimuthDeg: null,
      normal: null,
      planeWorld: null
    };
  }

  /** Centroïde 2D d’une liste de points. */
  function avgPoint(points) {
    if (!points || points.length === 0) return { x: 0, y: 0 };
    var sx = 0, sy = 0;
    for (var i = 0; i < points.length; i++) {
      sx += points[i].x;
      sy += points[i].y;
    }
    return { x: sx / points.length, y: sy / points.length };
  }

  /** Angle Nord du toit en degrés : state.roof.north.angleDeg ou state.roof.roof.north.angleDeg, sinon 0. */
  function getNorthAngleDeg(state) {
    if (!state || !state.roof) return 0;
    if (state.roof.north != null && typeof state.roof.north.angleDeg === "number") return state.roof.north.angleDeg;
    if (state.roof.roof && state.roof.roof.north != null && typeof state.roof.roof.north.angleDeg === "number") return state.roof.roof.north.angleDeg;
    return 0;
  }

  /** EPS_H = 0.10 m pour regrouper points bas/haut (gouttière / faîtage). */
  var EPS_H_M = 0.10;

  /** Bas / haut uniquement sur sommets à h finie (évite min=max=0 quand Z est inconnue). */
  function pickLowHighSets(pts, state) {
    if (!pts || pts.length === 0) return { minH: 0, maxH: 0, lowPts: [], highPts: [] };
    var withH = [];
    for (var i = 0; i < pts.length; i++) {
      var hf = getVertexHForPhysics(pts[i], state);
      if (hf != null) withH.push({ p: pts[i], h: hf });
    }
    if (withH.length === 0) return { minH: 0, maxH: 0, lowPts: [], highPts: [] };
    var minH = withH[0].h, maxH = minH;
    for (var j = 1; j < withH.length; j++) {
      var hv = withH[j].h;
      if (hv < minH) minH = hv;
      if (hv > maxH) maxH = hv;
    }
    var lowPts = [], highPts = [];
    for (var k = 0; k < withH.length; k++) {
      var it = withH[k];
      if (it.h <= minH + EPS_H_M) lowPts.push(it.p);
      if (it.h >= maxH - EPS_H_M) highPts.push(it.p);
    }
    if (lowPts.length === 0) {
      for (var L = 0; L < withH.length; L++) {
        if (withH[L].h === minH) lowPts.push(withH[L].p);
      }
      if (lowPts.length === 0) lowPts = [withH[0].p];
    }
    if (highPts.length === 0) {
      for (var H = 0; H < withH.length; H++) {
        if (withH[H].h === maxH) highPts.push(withH[H].p);
      }
      if (highPts.length === 0) highPts = [withH[0].p];
    }
    return { minH: minH, maxH: maxH, lowPts: lowPts, highPts: highPts };
  }

  function horizontalDistanceM(a, b, metersPerPixel, northAngleDeg) {
    var nd = typeof northAngleDeg === "number" && Number.isFinite(northAngleDeg) ? northAngleDeg : 0;
    return segmentHorizontalLengthMFromImagePx(a.x, a.y, b.x, b.y, metersPerPixel, nd);
  }

  /**
   * Pente depuis `resolvePanPhysicsWorldENU` (Newell / LSQ monde ENU — aligné canonical, Prompt 4B).
   */
  function computePanSlopeComputedDeg(pan, state) {
    var r = resolvePanPhysicsWorldENU(pan, state || null);
    if (!r || r.slopeDeg == null) return null;
    return {
      deg: r.slopeDeg,
      runM: null,
      deltaH: null,
      lowC: null,
      highC: null,
      _fromPlane: r.kind === "newell" || r.kind === "lsq",
      _physicsKind: r.kind
    };
  }

  /** Descente horizontale ENU (Est, Nord) unitaire, depuis la normale sortante. */
  function getDescentVector(pan, state) {
    var r = resolvePanPhysicsWorldENU(pan, state || null);
    if (!r || !r.normal) return null;
    var nx = r.normal.x, ny = r.normal.y;
    var h = Math.hypot(nx, ny);
    if (h < TOL) return null;
    return { vx: -nx / h, vy: -ny / h };
  }

  var CARDINAL_LABELS = [
    { min: 348.75, max: 360, label: "N" }, { min: 0, max: 11.25, label: "N" },
    { min: 11.25, max: 33.75, label: "NNE" }, { min: 33.75, max: 56.25, label: "NE" },
    { min: 56.25, max: 78.75, label: "ENE" }, { min: 78.75, max: 101.25, label: "E" },
    { min: 101.25, max: 123.75, label: "ESE" }, { min: 123.75, max: 146.25, label: "SE" },
    { min: 146.25, max: 168.75, label: "SSE" }, { min: 168.75, max: 191.25, label: "S" },
    { min: 191.25, max: 213.75, label: "SSO" }, { min: 213.75, max: 236.25, label: "SO" },
    { min: 236.25, max: 258.75, label: "OSO" }, { min: 258.75, max: 281.25, label: "O" },
    { min: 281.25, max: 303.75, label: "ONO" }, { min: 303.75, max: 326.25, label: "NO" },
    { min: 326.25, max: 348.75, label: "NNO" },
  ];
  function azimuthToCardinalLabel(azimuthDeg) {
    for (var k = 0; k < CARDINAL_LABELS.length; k++) {
      var o = CARDINAL_LABELS[k];
      if (azimuthDeg >= o.min && azimuthDeg < o.max) return o.label;
    }
    return "N";
  }

  /**
   * Azimut ENU de la normale horizontale (0=N, 90=E), même définition que le canonical — plus d’azimut « image + north ».
   */
  function computePanOrientation(pan, state) {
    var r = resolvePanPhysicsWorldENU(pan, state || null);
    if (!r || r.azimuthDeg == null) return null;
    var azTrue = r.azimuthDeg;
    var label = azimuthToCardinalLabel(azTrue);
    return { azimuthDeg: azTrue, label: label, slopeDirectionLabel: label };
  }

  function isFiniteNum(n) { return typeof n === "number" && Number.isFinite(n); }
  function recomputePanPhysicalProps(pan, state) {
    ensurePanPhysical(pan);
    var slopeResult = computePanSlopeComputedDeg(pan, state);
    var computedDeg = slopeResult != null ? slopeResult.deg : null;

    if (computedDeg != null && isFiniteNum(computedDeg)) {
      pan.physical.slope.computedDeg = computedDeg;
    } else {
      pan.physical.slope.computedDeg = null;
    }
    if (slopeResult && slopeResult.runM != null) pan.physical.slope._runM = slopeResult.runM;
    else delete pan.physical.slope._runM;
    if (slopeResult && slopeResult.deltaH != null) pan.physical.slope._deltaH = slopeResult.deltaH;
    else delete pan.physical.slope._deltaH;

    var modeAuto = pan.physical.slope.mode !== "manual";
    if (modeAuto) {
      if (computedDeg != null && isFiniteNum(computedDeg)) {
        pan.physical.slope.valueDeg = computedDeg;
        pan.tiltDeg = computedDeg;
      } else {
        pan.physical.slope.valueDeg = null;
        pan.tiltDeg = null;
      }
    }

    var orient = computePanOrientation(pan, state);
    if (orient && isFiniteNum(orient.azimuthDeg)) {
      pan.physical.orientation.azimuthDeg = orient.azimuthDeg;
      pan.physical.orientation.label = orient.label != null ? orient.label : null;
      pan.physical.slopeDirectionLabel = orient.slopeDirectionLabel != null ? orient.slopeDirectionLabel : null;
      pan.azimuthDeg = orient.azimuthDeg;
    } else {
      pan.physical.orientation.azimuthDeg = null;
      pan.physical.orientation.label = null;
      pan.physical.slopeDirectionLabel = null;
      pan.azimuthDeg = null;
    }
  }

  function recomputeAllPanPhysicalProps(pans, state) {
    var fullState = { pans: pans, roof: (state && state.roof) ? state.roof : null, getVertexH: (state && state.getVertexH) ? state.getVertexH : undefined };
    for (var i = 0; i < pans.length; i++) {
      recomputePanPhysicalProps(pans[i], fullState);
    }
  }

  var VERTEX_TOL_PX = 0.5;
  /**
   * SYNC panVertexContract.ts — ordre : points → polygonPx → polygon.
   */
  function mapRingToPanPoints(pan, ring) {
    var pid = pan.id != null ? String(pan.id) : "pan";
    return ring.map(function (p, i) {
      var o = { x: p.x, y: p.y, id: p.id != null ? p.id : pid + "-" + i };
      if (typeof p.h === "number" && Number.isFinite(p.h)) o.h = p.h;
      else if (typeof p.heightM === "number" && Number.isFinite(p.heightM)) o.h = p.heightM;
      return o;
    });
  }
  function getPanPoints(pan) {
    if (!pan) return [];
    if (pan.points && pan.points.length >= 2) return pan.points;
    if (pan.polygonPx && pan.polygonPx.length >= 2) return mapRingToPanPoints(pan, pan.polygonPx);
    if (pan.polygon && pan.polygon.length >= 2) return mapRingToPanPoints(pan, pan.polygon);
    return [];
  }
  function sameVertex(a, b, tol) {
    tol = tol != null ? tol : VERTEX_TOL_PX;
    return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  }
  function sameEdge(a, b, c, d, tol) {
    tol = tol != null ? tol : VERTEX_TOL_PX;
    return (sameVertex(a, c, tol) && sameVertex(b, d, tol)) || (sameVertex(a, d, tol) && sameVertex(b, c, tol));
  }

  function getAdjacentPans(pan, state) {
    var seen = {};
    var result = [];
    var pts = getPanPoints(pan);
    if (pts.length < 2) return result;
    function addIfNew(other) {
      if (other.id !== pan.id && !seen[other.id]) { seen[other.id] = true; result.push(other); }
    }
    var panTraitIds = pan.traitIds || [];
    if (panTraitIds.length > 0) {
      for (var o = 0; o < state.pans.length; o++) {
        var other = state.pans[o];
        var otherTraitIds = other.traitIds || [];
        if (other.id === pan.id) continue;
        for (var ti = 0; ti < panTraitIds.length; ti++) {
          if (otherTraitIds.indexOf(panTraitIds[ti]) >= 0) { addIfNew(other); break; }
        }
      }
    }
    var panRidgeIds = pan.ridgeIds || [];
    if (panRidgeIds.length > 0) {
      for (var o2 = 0; o2 < state.pans.length; o2++) {
        var other2 = state.pans[o2];
        var otherRidgeIds = other2.ridgeIds || [];
        if (other2.id === pan.id) continue;
        for (var ri = 0; ri < panRidgeIds.length; ri++) {
          if (otherRidgeIds.indexOf(panRidgeIds[ri]) >= 0) { addIfNew(other2); break; }
        }
      }
    }
    for (var o3 = 0; o3 < state.pans.length; o3++) {
      var other3 = state.pans[o3];
      if (other3.id === pan.id) continue;
      var op = getPanPoints(other3);
      if (op.length < 2) continue;
      for (var i = 0, ni = pts.length; i < ni; i++) {
        var i1 = (i + 1) % ni;
        for (var j = 0, nj = op.length; j < nj; j++) {
          var j1 = (j + 1) % nj;
          if (sameEdge(pts[i], pts[i1], op[j], op[j1])) { addIfNew(other3); break; }
        }
      }
    }
    for (var o4 = 0; o4 < state.pans.length; o4++) {
      var other4 = state.pans[o4];
      if (other4.id === pan.id) continue;
      var op4 = getPanPoints(other4);
      for (var pi = 0; pi < pts.length; pi++) {
        for (var pj = 0; pj < op4.length; pj++) {
          if (sameVertex(pts[pi], op4[pj])) { addIfNew(other4); break; }
        }
      }
    }
    return result;
  }

  function syncCommonHeights(source, target) {
    var srcPts = getPanPoints(source);
    if (!target.points || target.points.length === 0) return;
    for (var si = 0; si < srcPts.length; si++) {
      var sp = srcPts[si];
      for (var ti = 0; ti < target.points.length; ti++) {
        var tp = target.points[ti];
        if (sameVertex(sp, tp) && typeof sp.h === "number" && Number.isFinite(sp.h)) tp.h = sp.h;
      }
    }
  }

  function applyManualSlopeToPan(pan, desiredSlopeDeg, state) {
    ensurePanPhysical(pan);
    var pts = getPanPoints(pan);
    if (pts.length < 2) return;
    if (!pan.points || pan.points.length === 0) {
      pan.points = pts.map(function (p, i) { return { x: p.x, y: p.y, h: getVertexH(p, state), id: p.id != null ? p.id : pan.id + "-" + i }; });
    }
    var mpp = (state.roof && state.roof.scale && state.roof.scale.metersPerPixel) != null ? state.roof.scale.metersPerPixel : 1;
    if (!Number.isFinite(mpp) || mpp <= 0) return;
    var northDeg = getNorthAngleDeg(state);
    var workPts = pan.points;
    var minH = getVertexH(workPts[0], state), maxH = minH, atMin = [], atMax = [];
    for (var i = 0; i < workPts.length; i++) {
      var h = getVertexH(workPts[i], state);
      if (h < minH) { minH = h; atMin = [i]; } else if (h === minH) atMin.push(i);
      if (h > maxH) { maxH = h; atMax = [i]; } else if (h === maxH) atMax.push(i);
    }
    var maxRun = 0;
    for (var i = 0; i < workPts.length; i++) {
      var hi = getVertexH(workPts[i], state);
      for (var j = 0; j < workPts.length; j++) {
        if (i === j) continue;
        var hj = getVertexH(workPts[j], state);
        var isLowHigh = (hi <= minH + TOL_PX && hj >= maxH - TOL_PX) || (hj <= minH + TOL_PX && hi >= maxH - TOL_PX);
        if (!isLowHigh) continue;
        var run = horizontalDistanceM(workPts[i], workPts[j], mpp, northDeg);
        if (run > maxRun) maxRun = run;
      }
    }
    if (maxRun < TOL_PX) return;
    var deltaH = Math.tan(desiredSlopeDeg * Math.PI / 180) * maxRun;
    var newRidgeH = minH + deltaH;
    var oldSpan = maxH - minH;
    for (var idx = 0; idx < atMax.length; idx++) workPts[atMax[idx]].h = newRidgeH;
    for (var i = 0; i < workPts.length; i++) {
      if (atMax.indexOf(i) >= 0) continue;
      if (atMin.indexOf(i) >= 0) continue;
      var h = getH(workPts[i]);
      var t = oldSpan > TOL_PX ? (h - minH) / oldSpan : 0;
      workPts[i].h = minH + t * (newRidgeH - minH);
    }
    pan.physical.slope.mode = "manual";
    pan.physical.slope.valueDeg = desiredSlopeDeg;
    var sr = computePanSlopeComputedDeg(pan, state);
    pan.physical.slope.computedDeg = sr != null ? sr.deg : pan.physical.slope.computedDeg;
    pan.tiltDeg = desiredSlopeDeg;
    var fullState = { pans: state.pans, roof: state.roof };
    var adjacent = getAdjacentPans(pan, fullState);
    for (var a = 0; a < adjacent.length; a++) {
      if (adjacent[a].physical && adjacent[a].physical.slope && adjacent[a].physical.slope.mode === "manual") continue;
      syncCommonHeights(pan, adjacent[a]);
      recomputePanPhysicalProps(adjacent[a], fullState);
    }
  }

  /**
   * API officielle : hauteur Z (m) sur le pan — plan moindres carrés en coordonnées monde ENU (fitPlaneWorldENU).
   */
  function getHeightAtXY(panId, xPx, yPx, state) {
    if (!state || !state.pans || !Array.isArray(state.pans)) return null;
    var pan = state.pans.filter(function (p) { return p && p.id === panId; })[0];
    if (!pan) return null;
    var pts = getPanPoints(pan);
    if (!pts || pts.length < 2) return null;
    var mpp = (state.roof && state.roof.scale && state.roof.scale.metersPerPixel) != null ? state.roof.scale.metersPerPixel : 1;
    if (!Number.isFinite(mpp) || mpp <= 0) return null;
    var northDeg = getNorthAngleDeg(state);
    var plane = fitPlaneWorldENU(pts, mpp, northDeg, state || null);
    if (!plane) return null;
    var w = imagePxToWorldHorizontalM(xPx, yPx, mpp, northDeg);
    var h = plane.a * w.x + plane.b * w.y + plane.c;
    if (!Number.isFinite(h)) return null;
    return h;
  }

  global.CalpinagePans = {
    panState: panState,
    createDrawPolygonTool: createDrawPolygonTool,
    renderPanPropertiesPanel: renderPanPropertiesPanel,
    ensurePanPhysicalProps: ensurePanPhysicalProps,
    recomputePanPhysicalProps: recomputePanPhysicalProps,
    recomputeAllPanPhysicalProps: recomputeAllPanPhysicalProps,
    applyManualSlopeToPan: applyManualSlopeToPan,
    getAdjacentPans: getAdjacentPans,
    getHeightAtXY: getHeightAtXY,
  };
})(typeof window !== "undefined" ? window : this);
