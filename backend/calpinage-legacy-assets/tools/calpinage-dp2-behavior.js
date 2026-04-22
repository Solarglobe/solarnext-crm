/**
 * Calpinage — Comportement DP2 (PV_LAYOUT).
 * UX 100 % basée sur le moteur (pvPlacementEngine). Aucune logique géométrique.
 * - Hit-test : panel.projection.points uniquement (point-in-polygon).
 * - Overlay : sélection visuelle du bloc actif + bouton rotation déporté au-dessus du bloc (style Solteo).
 * - Manipulation : déplacement/rotation du BLOC ACTIF uniquement via adapter.setManipulationTransform / commitManipulation.
 * - Pose de panneaux : uniquement sur ghosts moteur (gérée dans calpinage.html).
 *
 * API : init(canvas, adapter, toolbar, options)
 * - adapter : getActiveBlock, getBlockById, getBlockCenter, setManipulationTransform, commitManipulation, requestRender, listPanelRefs, getPanel, getBlockRotationDeg
 */

(function (global) {
  "use strict";

  function computeBlockProjectionBBox(block) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    if (!block || !block.panels) return null;

    for (var i = 0; i < block.panels.length; i++) {
      var p = block.panels[i];
      if (!p.projection || !p.projection.points) continue;

      for (var j = 0; j < p.projection.points.length; j++) {
        var pt = p.projection.points[j];
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }

    if (!isFinite(minX)) return null;

    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function getRotationHandlePosition(adapter, block, imageToScreen) {
    var bbox = computeBlockProjectionBBox(block);
    if (!bbox) return null;

    var centerX = (bbox.minX + bbox.maxX) / 2;
    var topY = bbox.minY;

    var screenTop = imageToScreen({ x: centerX, y: topY });

    return {
      x: screenTop.x,
      y: screenTop.y - 40
    };
  }

  function hitTestRotationHandle(adapter, block, screenX, screenY, options) {
    if (!block || !options.imageToScreen) return false;

    var handle = getRotationHandlePosition(adapter, block, options.imageToScreen);
    if (!handle) return false;

    var dx = screenX - handle.x;
    var dy = screenY - handle.y;

    return (dx * dx + dy * dy) <= (12 * 12);
  }

  function refToId(ref) {
    return ref && typeof ref.blockId === "string" && typeof ref.panelIndex === "number"
      ? ref.blockId + "_" + ref.panelIndex
      : "";
  }

  function idToRef(id) {
    if (typeof id !== "string") return null;
    var i = id.lastIndexOf("_");
    if (i < 0) return null;
    var blockId = id.slice(0, i);
    var panelIndex = parseInt(id.slice(i + 1), 10);
    if (!Number.isFinite(panelIndex)) return null;
    return { blockId: blockId, panelIndex: panelIndex };
  }

  function pointInPolygon(pt, points) {
    if (!points || points.length < 3) return false;
    var x = pt.x, y = pt.y;
    var n = points.length;
    var inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = points[i].x, yi = points[i].y;
      var xj = points[j].x, yj = points[j].y;
      if (yi === yj) continue;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Forme du panneau pour hit-test : projection.points uniquement (aucune géométrie maison). */
  function getPanelProjection(adapter, ref) {
    if (!adapter || !ref) return null;
    var panel = adapter.getPanel(ref);
    if (!panel || !panel.center) return null;
    var proj = panel.projection;
    if (!proj || !proj.points || proj.points.length < 3) return null;
    return { center: { x: panel.center.x, y: panel.center.y }, points: proj.points };
  }

  /** Centre du bloc : délégation exclusive à l'adapter (ENG.getBlockCenter). */
  function getBlockCenter(adapter, blockId) {
    if (!adapter || !blockId) return null;
    var block = adapter.getBlockById && adapter.getBlockById(blockId);
    if (!block || typeof adapter.getBlockCenter !== "function") return null;
    return adapter.getBlockCenter(block);
  }

  function getEffectiveSelectedRefs(state) {
    var refs = Array.isArray(state.selectedRefs) ? state.selectedRefs : [];
    if (refs.length) return refs;
    var id = state.selectedPanelId || (state.selectedPanelIds && state.selectedPanelIds[0]);
    if (id) {
      var r = idToRef(id);
      if (r) return [r];
    }
    return [];
  }

  function setSelectedRefs(state, refs) {
    state.selectedRefs = Array.isArray(refs) ? refs : [];
    state.selectedPanelIds = state.selectedRefs.map(refToId);
    state.selectedPanelId = state.selectedRefs.length === 1 ? refToId(state.selectedRefs[0]) : null;
  }

  function clearSelectedRefs(state) {
    state.selectedRefs = [];
    state.selectedPanelIds = [];
    state.selectedPanelId = null;
  }

  /** Hit-test panneau : point-in-polygon sur projection.points uniquement. Retourne { ref, part: "body" }. */
  function hitTestPanel(adapter, state, x, y) {
    if (!adapter) return null;
    var refs = adapter.listPanelRefs();
    for (var i = refs.length - 1; i >= 0; i--) {
      var ref = refs[i];
      var proj = getPanelProjection(adapter, ref);
      if (!proj || !proj.points) continue;
      if (pointInPolygon({ x: x, y: y }, proj.points)) return { ref: ref, part: "body" };
    }
    return null;
  }

  function defaultGetCanvasCoords(canvas, clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / (rect.width || 1);
    var scaleY = canvas.height / (rect.height || 1);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function toScreen(pt, imageToScreenFn) {
    if (pt == null || typeof pt.x !== "number" || typeof pt.y !== "number") return pt;
    return typeof imageToScreenFn === "function" ? imageToScreenFn(pt) : pt;
  }

  /** Overlay : sélection du bloc actif (un seul bloc), poignée rotation au centre du bloc. */
  function render(state, adapter, canvas, options) {
    if (!state || !canvas) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    options = options || {};
    var imageToScreenFn = options.imageToScreen || null;

    var refs = getEffectiveSelectedRefs(state);
    var activeBlock = adapter.getActiveBlock && adapter.getActiveBlock();
    if (refs.length >= 1 && adapter && activeBlock) {
      var blockId = refs[0].blockId;
      if (blockId === activeBlock.id) {
        renderBlockSelection(ctx, adapter, blockId, imageToScreenFn);
      }
    }
  }

  function renderBlockSelection(ctx, adapter, blockId, imageToScreenFn) {
    var refs = adapter.listPanelRefs();
    var blockRefs = [];
    for (var i = 0; i < refs.length; i++) {
      if (refs[i].blockId === blockId) blockRefs.push(refs[i]);
    }
    if (blockRefs.length === 0) return;

    for (var j = 0; j < blockRefs.length; j++) {
      var proj = getPanelProjection(adapter, blockRefs[j]);
      if (!proj || !proj.points.length) continue;
      var pts = [];
      for (var k = 0; k < proj.points.length; k++) pts.push(toScreen(proj.points[k], imageToScreenFn));
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var m = 1; m < pts.length; m++) ctx.lineTo(pts[m].x, pts[m].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    var block = adapter.getBlockById && adapter.getBlockById(blockId);
    if (block && imageToScreenFn) {
      var handle = getRotationHandlePosition(adapter, block, imageToScreenFn);
      if (handle) {
        ctx.save();

        // Trait
        ctx.strokeStyle = "#C39847";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(handle.x, handle.y + 10);
        ctx.lineTo(handle.x, handle.y + 30);
        ctx.stroke();

        // Cercle
        ctx.fillStyle = "#111";
        ctx.strokeStyle = "#C39847";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Flèche arrondie
        ctx.strokeStyle = "#C39847";
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 6, Math.PI * 0.3, Math.PI * 1.8);
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  function triggerRender(state, adapter, canvas, options) {
    if (adapter && typeof adapter.requestRender === "function") adapter.requestRender();
    else if (options && typeof options.onRender === "function") options.onRender();
    else render(state, adapter, canvas, options);
  }

  function init(canvas, adapter, toolbar, options) {
    if (!canvas || !adapter) return;

    options = options || {};
    var state = options.state || {};
    if (!Array.isArray(state.selectedRefs)) state.selectedRefs = [];
    if (!state.selectedPanelIds) state.selectedPanelIds = [];
    if (state.selectedPanelId == null) state.selectedPanelId = null;
    if (!state.currentTool) state.currentTool = "panels";
    if (state.blockRotation === undefined) state.blockRotation = null;

    var getCanvasCoords = (options.getCanvasCoords && typeof options.getCanvasCoords === "function")
      ? options.getCanvasCoords
      : defaultGetCanvasCoords;

    if (toolbar && toolbar.nodeType === 1) {
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "calpinage-tool-btn";
      addBtn.setAttribute("data-tool", "panels");
      addBtn.setAttribute("aria-pressed", "false");
      addBtn.title = "Ajouter panneaux";
      addBtn.innerHTML = "<span class=\"calpinage-tool-icon\" aria-hidden=\"true\">▣</span><span class=\"calpinage-tool-label\">Ajouter panneaux</span>";
      var selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "calpinage-tool-btn";
      selectBtn.setAttribute("data-tool", "select");
      selectBtn.setAttribute("aria-pressed", "false");
      selectBtn.title = "Sélectionner";
      selectBtn.innerHTML = "<span class=\"calpinage-tool-icon\" aria-hidden=\"true\">↖</span><span class=\"calpinage-tool-label\">Sélectionner</span>";
      var isPanels = state.currentTool === "panels";
      addBtn.classList.toggle("calpinage-tool-active", isPanels);
      addBtn.setAttribute("aria-pressed", isPanels ? "true" : "false");
      selectBtn.classList.toggle("calpinage-tool-active", !isPanels);
      selectBtn.setAttribute("aria-pressed", !isPanels ? "true" : "false");
      function setActiveTool(tool) {
        state.currentTool = tool;
        toolbar.querySelectorAll(".calpinage-tool-btn[data-tool]").forEach(function (btn) {
          var isActive = (btn.getAttribute("data-tool") === tool);
          btn.classList.toggle("calpinage-tool-active", isActive);
          btn.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
        triggerRender(state, adapter, canvas, options);
      }
      addBtn.addEventListener("click", function () { setActiveTool("panels"); });
      selectBtn.addEventListener("click", function () { setActiveTool("select"); });
      toolbar.appendChild(selectBtn);
      toolbar.appendChild(addBtn);
    }

    if (canvas.dataset.calpinageDp2Bound === "1") return;
    canvas.dataset.calpinageDp2Bound = "1";

    /** API explicite de capture du clic rotation : test uniquement, pas d’état ni rotation. */
    window.__CALPINAGE_ROTATE_HITTEST = function (canvas, x, y) {
      if (window.CALPINAGE_STATE && window.CALPINAGE_STATE.currentPhase === "PV_LAYOUT") return false;
      var activeBlock = adapter.getActiveBlock && adapter.getActiveBlock();
      if (!activeBlock) return false;
      return hitTestRotationHandle(adapter, activeBlock, x, y, options);
    };

    canvas.addEventListener("pointerdown", function (e) {
      if (window.CALPINAGE_STATE && window.CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
        console.log("[PH3] tools disabled (PV_LAYOUT)");
        return;
      }
      if (typeof window !== "undefined" && window.__CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__) {
        return;
      }
      if (state.blockRotation || state.blockManipulation) return;
      var tool = state.currentTool || "select";
      if (tool !== "select" && tool !== "panels") return;
      var coords = getCanvasCoords(canvas, e.clientX, e.clientY);
      var activeBlock = adapter.getActiveBlock && adapter.getActiveBlock();
      var rect = canvas.getBoundingClientRect();
      var screenX = e.clientX - rect.left;
      var screenY = e.clientY - rect.top;

      if (activeBlock && hitTestRotationHandle(adapter, activeBlock, screenX, screenY, options)) {
        var center = adapter.getBlockCenter(activeBlock);
        if (!center) return;

        state.blockRotation = {
          blockId: activeBlock.id,
          center: center,
          startAngle: Math.atan2(coords.y - center.y, coords.x - center.x),
          startRotation: adapter.getBlockRotationDeg(activeBlock),
          pointerId: e.pointerId
        };

        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (tool === "select" && activeBlock) {
        var hit = hitTestPanel(adapter, state, coords.x, coords.y);
        if (hit && hit.ref && hit.ref.blockId === activeBlock.id) {
          var pivot = adapter.getBlockCenter(activeBlock);
          if (pivot) {
            state.blockManipulation = {
              blockId: activeBlock.id,
              pivot: { x: pivot.x, y: pivot.y },
              startX: coords.x,
              startY: coords.y,
              startAngle: 0,
              mode: "move",
              pointerId: e.pointerId,
            };
            setSelectedRefs(state, [hit.ref]);
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            triggerRender(state, adapter, canvas, options);
            return;
          }
        }
      }

      var hitPanel = hitTestPanel(adapter, state, coords.x, coords.y);
      if (hitPanel && hitPanel.ref) {
        setSelectedRefs(state, [hitPanel.ref]);
        triggerRender(state, adapter, canvas, options);
        return;
      }

      if (tool === "select") {
        clearSelectedRefs(state);
        triggerRender(state, adapter, canvas, options);
      }
    });

    canvas.addEventListener("pointermove", function (e) {
      if (window.CALPINAGE_STATE && window.CALPINAGE_STATE.currentPhase === "PV_LAYOUT") return;
      if (typeof window !== "undefined" && window.__CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__) return;
      if (state.blockRotation) {
        var coords = getCanvasCoords(canvas, e.clientX, e.clientY);
        var center = state.blockRotation.center;
        var angle = Math.atan2(coords.y - center.y, coords.x - center.x);
        var delta = angle - state.blockRotation.startAngle;
        var deltaDeg = delta * 180 / Math.PI;
        if (adapter.setManipulationTransform) adapter.setManipulationTransform(0, 0, deltaDeg);
        if (adapter.requestRender) adapter.requestRender();
        return;
      }
      var blockManip = state.blockManipulation || null;
      if (blockManip && typeof blockManip.pointerId === "number" && adapter.setManipulationTransform) {
        var coords = getCanvasCoords(canvas, e.clientX, e.clientY);
        var dx = coords.x - (blockManip.startX || 0);
        var dy = coords.y - (blockManip.startY || 0);
        adapter.setManipulationTransform(dx, dy, 0);
        adapter.requestRender();
        return;
      }
    });

    canvas.addEventListener("pointerup", function (e) {
      if (window.CALPINAGE_STATE && window.CALPINAGE_STATE.currentPhase === "PV_LAYOUT") return;
      if (typeof window !== "undefined" && window.__CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__) return;
      if (state.blockRotation) {
        if (adapter.commitManipulation && typeof adapter.commitManipulation === "function") adapter.commitManipulation();
        state.blockRotation = null;
        if (typeof window.recomputeAllPlacementBlocksFromRules === "function") window.recomputeAllPlacementBlocksFromRules(true);
        if (adapter.requestRender) adapter.requestRender();
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      if (state.blockManipulation && typeof state.blockManipulation.pointerId === "number") {
        if (adapter.commitManipulation && typeof adapter.commitManipulation === "function") adapter.commitManipulation();
        state.blockManipulation = null;
        if (typeof window.recomputeAllPlacementBlocksFromRules === "function") window.recomputeAllPlacementBlocksFromRules(true);
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        if (adapter.requestRender) adapter.requestRender();
        return;
      }
    });
  }

  var api = {
    init: init,
    render: render,
    refToId: refToId,
    idToRef: idToRef,
    getEffectiveSelectedRefs: getEffectiveSelectedRefs,
    setSelectedRefs: setSelectedRefs,
    clearSelectedRefs: clearSelectedRefs,
    getPanelProjection: getPanelProjection,
    getBlockCenter: getBlockCenter,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CalpinageDP2Behavior = api;
  }
})(typeof window !== "undefined" ? window : this);
