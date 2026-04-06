// ==================================================
// DP8 — Implantation des panneaux (schématique)
// - Uniquement des flèches rouges dessinées manuellement
// - Aucune logique panneau / calepinage / dimension / métrique
// ==================================================

(function () {
  // Nom d’export (préparation uniquement — NE PAS générer de PDF ici)
  window.DP8_EXPORT_FILENAME = "DP8 - Environnement lointain.pdf";

  // État global DP8 (forme imposée)
  window.DP8_STATE = window.DP8_STATE || {
    mode: "EDITION",
    backgroundImage: null,
    finalImage: null,
    arrows: [],
  };

  const DP8_ARROW_COLOR = "#D72626";
  const DP8_ARROW_LINE_WIDTH = 4; // 3–5 px, visible en impression
  const DP8_ARROW_ALPHA = 1;
  const DP8_ARROW_HEAD_LEN = 14;
  const DP8_HIT_TOL = 10;
  const DP8_HANDLE_R = 8;
  const DP8_MIN_ARROW_LEN = 10;

  function dp8CoerceDataUrl(v) {
    const s = typeof v === "string" ? v : v == null ? "" : String(v);
    return s.startsWith("data:image") ? s : "";
  }

  function dp8HasBackground() {
    const src = dp8CoerceDataUrl(window.DP8_STATE?.backgroundImage);
    return !!src;
  }

  function dp8CategoryToLabel(category) {
    return category === "BEFORE" ? "Avant" : category === "AFTER" ? "Après" : "—";
  }

  function dp8Dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dp8DistPointToSegment(pt, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = pt.x - a.x;
    const wy = pt.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.sqrt(wx * wx + wy * wy);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.sqrt((pt.x - b.x) * (pt.x - b.x) + (pt.y - b.y) * (pt.y - b.y));
    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    const dx = pt.x - px;
    const dy = pt.y - py;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dp8Clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function dp8ClampPoint(p, bounds) {
    return {
      x: dp8Clamp(p.x, 0, bounds.w),
      y: dp8Clamp(p.y, 0, bounds.h),
    };
  }

  function dp8GenId() {
    return `dp8_arrow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function dp8NormalizeArrowsArray() {
    try {
      if (!Array.isArray(window.DP8_STATE.arrows)) window.DP8_STATE.arrows = [];
    } catch (_) {}
    return Array.isArray(window.DP8_STATE?.arrows) ? window.DP8_STATE.arrows : [];
  }

  function dp8MakeArrow(a, b) {
    return {
      id: dp8GenId(),
      x1: +Number(a.x || 0).toFixed(2),
      y1: +Number(a.y || 0).toFixed(2),
      x2: +Number(b.x || 0).toFixed(2),
      y2: +Number(b.y || 0).toFixed(2),
    };
  }

  function dp8ArrowLen(ar) {
    return Math.sqrt((ar.x2 - ar.x1) * (ar.x2 - ar.x1) + (ar.y2 - ar.y1) * (ar.y2 - ar.y1));
  }

  // --------------------------------------------------
  // Init DP8
  // --------------------------------------------------
  window.initDP8 =
    window.initDP8 ||
    function initDP8() {
      const page = document.getElementById("dp8-page");
      if (!page) return;

      const btnBefore = document.getElementById("dp8-create-before");
      const btnAfter = document.getElementById("dp8-create-after");
      const modal = document.getElementById("dp8-photo-modal");
      const streetBtn = document.getElementById("dp8-use-street");
      const uploadBtn = document.getElementById("dp8-use-upload");
      const workspace = document.getElementById("dp8-photo-workspace");
      const zoomInBtn = document.getElementById("dp8-zoom-in");
      const zoomOutBtn = document.getElementById("dp8-zoom-out");
      const zoomResetBtn = document.getElementById("dp8-zoom-reset");
      const zoomLabel = document.getElementById("dp8-zoom-label");
      const validateBtn = document.getElementById("dp8-validate");
      const categoryLabelEl = document.getElementById("dp8-photo-category-label");
      const arrowToolBtn = document.getElementById("dp8-tool-arrow");

      if (!modal || (!btnBefore && !btnAfter) || !workspace) return;

      dp8NormalizeArrowsArray();

      // ==============================
      // Vue (zoom/pan) — visuel uniquement
      // ==============================
      const DP8_VIEW_MIN_SCALE = 1;
      const DP8_VIEW_MAX_SCALE = 4;
      const dp8View = { scale: 1, tx: 0, ty: 0 };

      function dp8GetStageEl() {
        return workspace.querySelector("#dp8-photo-stage");
      }

      function dp8UpdateZoomLabel() {
        if (!zoomLabel) return;
        const pct = Math.round((dp8View.scale || 1) * 100);
        zoomLabel.textContent = `${pct}%`;
      }

      function dp8ClampPanToBounds(next) {
        const s = typeof next?.scale === "number" ? next.scale : dp8View.scale;
        const tx = typeof next?.tx === "number" ? next.tx : dp8View.tx;
        const ty = typeof next?.ty === "number" ? next.ty : dp8View.ty;

        const r = workspace.getBoundingClientRect();
        const vw = Math.max(1, r.width);
        const vh = Math.max(1, r.height);

        if (s <= 1.000001) return { scale: 1, tx: 0, ty: 0 };

        const minTx = vw - vw * s;
        const minTy = vh - vh * s;
        const maxTx = 0;
        const maxTy = 0;

        return {
          scale: s,
          tx: Math.max(minTx, Math.min(maxTx, tx)),
          ty: Math.max(minTy, Math.min(maxTy, ty)),
        };
      }

      function dp8ApplyViewTransform() {
        const stage = dp8GetStageEl();
        if (!stage) return;
        const { scale, tx, ty } = dp8ClampPanToBounds(dp8View);
        dp8View.scale = scale;
        dp8View.tx = tx;
        dp8View.ty = ty;
        stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        dp8UpdateZoomLabel();
      }

      function dp8ResetView() {
        dp8View.scale = 1;
        dp8View.tx = 0;
        dp8View.ty = 0;
        dp8ApplyViewTransform();
      }

      function dp8SetScaleAtClientPoint(nextScale, clientX, clientY) {
        const r = workspace.getBoundingClientRect();
        const cx = clientX - r.left;
        const cy = clientY - r.top;

        const prevScale = dp8View.scale;
        const clampedScale = Math.max(DP8_VIEW_MIN_SCALE, Math.min(DP8_VIEW_MAX_SCALE, nextScale));
        if (Math.abs(clampedScale - prevScale) < 0.0001) return;

        const x = (cx - dp8View.tx) / prevScale;
        const y = (cy - dp8View.ty) / prevScale;

        dp8View.scale = clampedScale;
        dp8View.tx = cx - x * clampedScale;
        dp8View.ty = cy - y * clampedScale;
        dp8ApplyViewTransform();
      }

      function dp8NudgeScale(delta) {
        const r = workspace.getBoundingClientRect();
        dp8SetScaleAtClientPoint(dp8View.scale + delta, r.left + r.width / 2, r.top + r.height / 2);
      }

      // ==============================
      // Structure workspace
      // ==============================
      function dp8EnsureWorkspaceStructure() {
        if (workspace.style.position !== "relative") workspace.style.position = "relative";
        if (workspace.style.overflow !== "hidden") workspace.style.overflow = "hidden";

        let stage = workspace.querySelector("#dp8-photo-stage");
        if (!stage) {
          stage = document.createElement("div");
          stage.id = "dp8-photo-stage";
          workspace.appendChild(stage);
        }
        stage.style.position = "absolute";
        stage.style.inset = "0";
        stage.style.transformOrigin = "0 0";
        stage.style.willChange = "transform";
        stage.style.userSelect = "none";

        let content = stage.querySelector("#dp8-photo-content") || workspace.querySelector("#dp8-photo-content");
        if (!content) {
          content = document.createElement("div");
          content.id = "dp8-photo-content";
          stage.appendChild(content);
        } else if (content.parentNode !== stage) {
          try {
            stage.appendChild(content);
          } catch (_) {}
        }
        content.style.position = "absolute";
        content.style.inset = "0";

        let layer = stage.querySelector("#dp8-overlay-layer") || workspace.querySelector("#dp8-overlay-layer");
        if (!layer) {
          layer = document.createElement("div");
          layer.id = "dp8-overlay-layer";
          stage.appendChild(layer);
        } else if (layer.parentNode !== stage) {
          try {
            stage.appendChild(layer);
          } catch (_) {}
        }
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.zIndex = "60";
        // DP8 : l'overlay DOM est conservé, mais on capte les interactions sur le canvas
        // pour éviter que l'overlay recouvre la toolbar flottante.
        layer.style.pointerEvents = "none";
        layer.style.userSelect = "none";
        layer.style.touchAction = "none";
        layer.style.cursor = "default";

        try {
          dp8ApplyViewTransform();
        } catch (_) {}

        return { stage, content, layer };
      }

      function dp8EnsureWorkspaceCanvas(struct) {
        if (!struct?.content) return null;
        let canvas = struct.content.querySelector("#dp8-canvas");
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.id = "dp8-canvas";
          struct.content.appendChild(canvas);
        }
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        canvas.style.zIndex = "10";
        return canvas;
      }

      // ==============================
      // Image loader
      // ==============================
      let dp8ImageEl = null;
      let dp8ImageSrc = "";
      let dp8ImageLoadPromise = null;

      function dp8EnsureLoadedImage(src) {
        const s = dp8CoerceDataUrl(src);
        if (!s) return Promise.resolve(null);

        if (dp8ImageEl && dp8ImageSrc === s && dp8ImageEl.complete && dp8ImageEl.naturalWidth > 0) {
          return Promise.resolve(dp8ImageEl);
        }
        if (dp8ImageLoadPromise && dp8ImageSrc === s) return dp8ImageLoadPromise;

        dp8ImageSrc = s;
        dp8ImageEl = new Image();
        dp8ImageEl.decoding = "async";
        dp8ImageLoadPromise = new Promise((resolve) => {
          dp8ImageEl.onload = () => resolve(dp8ImageEl);
          dp8ImageEl.onerror = () => resolve(null);
          dp8ImageEl.src = s;
        });
        return dp8ImageLoadPromise;
      }

      // ==============================
      // Rendu (canvas)
      // ==============================
      let selectedArrowId = null;
      let active = null; // interaction en cours
      let draftArrow = null; // prévisualisation pendant le drag de création

      function dp8GetWorkspaceBoundsCss() {
        const r = workspace.getBoundingClientRect();
        return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      }

      function dp8DrawArrow(ctx, ar) {
        const x1 = ar.x1,
          y1 = ar.y1,
          x2 = ar.x2,
          y2 = ar.y2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const angle = Math.atan2(dy, dx);

        ctx.save();
        ctx.globalAlpha = DP8_ARROW_ALPHA;
        ctx.strokeStyle = DP8_ARROW_COLOR;
        ctx.fillStyle = DP8_ARROW_COLOR;
        ctx.lineWidth = DP8_ARROW_LINE_WIDTH;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // ligne
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // pointe
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - DP8_ARROW_HEAD_LEN * Math.cos(angle - Math.PI / 6), y2 - DP8_ARROW_HEAD_LEN * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - DP8_ARROW_HEAD_LEN * Math.cos(angle + Math.PI / 6), y2 - DP8_ARROW_HEAD_LEN * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      function dp8DrawHandles(ctx, ar) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#111827";
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(ar.x1, ar.y1, DP8_HANDLE_R, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ar.x2, ar.y2, DP8_HANDLE_R, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      async function renderDP8Canvas() {
        const struct = dp8EnsureWorkspaceStructure();
        if (!struct) return;
        const canvas = dp8EnsureWorkspaceCanvas(struct);
        if (!canvas) return;

        const wRect = workspace.getBoundingClientRect();
        const cssW = Math.max(1, Math.round(wRect.width || 0));
        const cssH = Math.max(1, Math.round(wRect.height || 0));
        if (cssW < 2 || cssH < 2) return;

        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const pxW = Math.max(1, Math.round(cssW * dpr));
        const pxH = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pxW) canvas.width = pxW;
        if (canvas.height !== pxH) canvas.height = pxH;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        const src = dp8CoerceDataUrl(window.DP8_STATE?.backgroundImage);
        const img = await dp8EnsureLoadedImage(src);
        if (img) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.shadowColor = "transparent";
          ctx.drawImage(img, 0, 0, cssW, cssH);
          ctx.restore();
        }

        const arrows = dp8NormalizeArrowsArray();
        for (let i = 0; i < arrows.length; i++) {
          const ar = arrows[i];
          dp8DrawArrow(ctx, ar);
        }

        if (draftArrow) {
          dp8DrawArrow(ctx, draftArrow);
        }

        const sel = selectedArrowId ? arrows.find((a) => a && a.id === selectedArrowId) : null;
        if (sel) dp8DrawHandles(ctx, sel);

        // UX : curseur uniquement quand un fond est présent
        try {
          canvas.style.cursor = dp8HasBackground() ? "crosshair" : "default";
        } catch (_) {}
      }

      function dp8SyncValidateButtonUI() {
        const okImage = dp8HasBackground();
        const arrows = dp8NormalizeArrowsArray();
        const okArrows = Array.isArray(arrows) && arrows.length > 0;
        if (validateBtn) validateBtn.disabled = !(okImage && okArrows);
      }

      // ==============================
      // Miniatures (page DP8)
      // ==============================
      function dp8RenderEntryMiniatures(previewAfterDataUrl) {
        const beforeCard = document.getElementById("dp8-card-before");
        const afterCard = document.getElementById("dp8-card-after");
        const beforeImg = document.getElementById("dp8-thumb-before");
        const afterImg = document.getElementById("dp8-thumb-after");
        if (!beforeCard || !afterCard || !beforeImg || !afterImg) return;

        const before = dp8CoerceDataUrl(window.DP8_STATE?.backgroundImage);
        const after = dp8CoerceDataUrl(previewAfterDataUrl);

        if (before) {
          beforeImg.src = before;
          beforeCard.classList.add("has-thumb");
        } else {
          try {
            beforeImg.removeAttribute("src");
          } catch (_) {}
          beforeCard.classList.remove("has-thumb");
        }

        if (after) {
          afterImg.src = after;
          afterCard.classList.add("has-thumb");
        } else {
          try {
            afterImg.removeAttribute("src");
          } catch (_) {}
          afterCard.classList.remove("has-thumb");
        }
      }

      // ==============================
      // Catégorie (info)
      // ==============================
      let dp8Category = null;
      function dp8SyncCategoryUI() {
        if (!categoryLabelEl) return;
        categoryLabelEl.textContent = dp8CategoryToLabel(dp8Category);
      }
      function dp8SetCategory(category) {
        dp8Category = category === "BEFORE" || category === "AFTER" ? category : null;
        dp8SyncCategoryUI();
      }

      // ==============================
      // Source image (import / Street View)
      // ==============================
      function dp8DisplayImportedImage(dataURL) {
        const s = dp8CoerceDataUrl(dataURL);
        if (!s) return;

        // Nettoyage strict Street View si actif
        try {
          dp8DestroyGoogleView();
        } catch (_) {}

        try {
          window.DP8_STATE = window.DP8_STATE || {};
          window.DP8_STATE.backgroundImage = s;
          window.DP8_STATE.arrows = [];
        } catch (_) {}

        selectedArrowId = null;
        draftArrow = null;
        active = null;

        try {
          dp8ResetView();
        } catch (_) {}

        dp8SyncValidateButtonUI();
        dp8RenderEntryMiniatures("");
        renderDP8Canvas();
      }

      // Google Street View (DP8) : instance temporaire (aucune persistance)
      let dp8Panorama = null;
      let dp8StreetHost = null;

      function dp8DestroyGoogleView() {
        const ev = window.google?.maps?.event;
        if (ev?.clearInstanceListeners) {
          try {
            if (dp8Panorama) ev.clearInstanceListeners(dp8Panorama);
          } catch (_) {}
        }
        try {
          if (dp8Panorama?.setVisible) dp8Panorama.setVisible(false);
        } catch (_) {}
        dp8Panorama = null;
        try {
          if (dp8StreetHost && dp8StreetHost.parentNode) dp8StreetHost.parentNode.removeChild(dp8StreetHost);
        } catch (_) {}
        dp8StreetHost = null;
        // Restaurer le canvas si présent
        try {
          const c = workspace.querySelector("#dp8-canvas");
          if (c) c.style.display = "block";
        } catch (_) {}
      }

      async function openDP8StreetView() {
        // StreetView : éviter un stage déjà zoomé (UX stable)
        try {
          dp8ResetView();
        } catch (_) {}

        const struct = dp8EnsureWorkspaceStructure();
        if (!struct) return;

        const canvas = dp8EnsureWorkspaceCanvas(struct);
        if (canvas) canvas.style.display = "none";

        try {
          Array.from(struct.content.children || []).forEach((ch) => {
            // Ne jamais supprimer le canvas, ni la toolbar
            if (ch !== canvas && ch.id !== "dp8-toolbar") {
              try {
                ch.parentNode && ch.parentNode.removeChild(ch);
              } catch (_) {}
            }
          });
        } catch (_) {}

        const host = document.createElement("div");
        host.id = "dp8-streetview";
        host.style.width = "100%";
        host.style.height = "100%";
        host.style.flex = "1";
        host.style.position = "relative";
        dp8StreetHost = host;
        struct.content.appendChild(host);

        if (typeof window.dpLoadGoogleMapsJsOnce !== "function" || typeof window.dpGetProjectCenterForGoogleMaps !== "function") {
          return;
        }

        await window.dpLoadGoogleMapsJsOnce();
        const { center } = window.dpGetProjectCenterForGoogleMaps();

        requestAnimationFrame(() => {
          const panorama = new google.maps.StreetViewPanorama(host, {
            position: center,
            pov: { heading: 0, pitch: 0 },
            zoom: 1,
            addressControl: false,
            linksControl: true,
            panControl: true,
            enableCloseButton: false,
            fullscreenControl: false,
          });
          dp8Panorama = panorama;
          try {
            google.maps.event.trigger(panorama, "resize");
          } catch (_) {}
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try {
                google.maps.event.trigger(panorama, "resize");
              } catch (_) {}
            });
          });
        });
      }

      // Input file créé une seule fois (invisible)
      let fileInput = document.getElementById("dp8-file-input");
      if (!fileInput) {
        fileInput = document.createElement("input");
        fileInput.id = "dp8-file-input";
        fileInput.type = "file";
        fileInput.accept = "image/jpeg,image/png";
        fileInput.style.display = "none";
        document.body.appendChild(fileInput);
      }

      if (fileInput.dataset.bound !== "1") {
        fileInput.dataset.bound = "1";
        fileInput.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.type !== "image/jpeg" && file.type !== "image/png") return;
          const reader = new FileReader();
          reader.onload = () => dp8DisplayImportedImage(reader.result);
          reader.readAsDataURL(file);
        });
      }

      if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
          fileInput.value = "";
          fileInput.click();
        });
      }

      if (streetBtn) {
        streetBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          await openDP8StreetView();
        });
      }

      // ==============================
      // Toolbar : outil unique "flèche"
      // ==============================
      // Outil toujours actif (DP8 interdit tout autre dessin)
      if (arrowToolBtn && arrowToolBtn.dataset.bound !== "1") {
        arrowToolBtn.dataset.bound = "1";
        arrowToolBtn.addEventListener("click", (e) => {
          e.preventDefault();
          // rien à basculer : outil unique
        });
      }

      // ==============================
      // Interactions flèches
      // ==============================
      const struct = dp8EnsureWorkspaceStructure();
      const layer = struct?.layer; // conservé (non interactif)
      const canvasForEvents = dp8EnsureWorkspaceCanvas(struct);

      function dp8GetLayerPointFromEvent(e) {
        const c = canvasForEvents || workspace.querySelector("#dp8-canvas");
        if (!c) return { x: 0, y: 0 };
        const r = c.getBoundingClientRect();
        const s = dp8View && typeof dp8View.scale === "number" ? dp8View.scale : 1;
        return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
      }

      function dp8HitTest(p) {
        const arrows = dp8NormalizeArrowsArray();
        // top-most : on parcourt à l'envers
        for (let i = arrows.length - 1; i >= 0; i--) {
          const ar = arrows[i];
          if (!ar) continue;
          const a = { x: ar.x1, y: ar.y1 };
          const b = { x: ar.x2, y: ar.y2 };
          const d1 = dp8Dist(p, a);
          const d2 = dp8Dist(p, b);
          if (d1 <= DP8_HIT_TOL) return { id: ar.id, handle: "start" };
          if (d2 <= DP8_HIT_TOL) return { id: ar.id, handle: "end" };
          const ds = dp8DistPointToSegment(p, a, b);
          if (ds <= DP8_HIT_TOL) return { id: ar.id, handle: "body" };
        }
        return null;
      }

      function dp8GetArrowById(id) {
        const arrows = dp8NormalizeArrowsArray();
        return arrows.find((a) => a && a.id === id) || null;
      }

      function dp8RemoveSelectedArrow() {
        if (!selectedArrowId) return;
        const arrows = dp8NormalizeArrowsArray();
        const next = arrows.filter((a) => a && a.id !== selectedArrowId);
        try {
          window.DP8_STATE.arrows = next;
        } catch (_) {}
        selectedArrowId = null;
        dp8SyncValidateButtonUI();
        renderDP8Canvas();
      }

      function dp8GetBoundsForClamp() {
        const r = workspace.getBoundingClientRect();
        // espace "logique" = CSS (non transformé)
        return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      }

      function beginInteraction(e) {
        try {
          e.target && e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
        } catch (_) {}
      }

      function onPointerDown(e) {
        if (!modal || modal.getAttribute("aria-hidden") === "true") return;
        if (!dp8HasBackground()) return; // pas de dessin sans fond

        e.preventDefault();
        e.stopPropagation();
        beginInteraction(e);

        const p = dp8GetLayerPointFromEvent(e);
        const hit = dp8HitTest(p);
        const bounds = dp8GetBoundsForClamp();

        if (hit) {
          selectedArrowId = hit.id;
          const ar = dp8GetArrowById(hit.id);
          if (!ar) return;
          active = {
            type: hit.handle === "body" ? "move" : hit.handle === "start" ? "resize_start" : "resize_end",
            id: hit.id,
            startMouse: p,
            startArrow: { x1: ar.x1, y1: ar.y1, x2: ar.x2, y2: ar.y2 },
            bounds,
          };
          renderDP8Canvas();
          return;
        }

        // Création : clic + drag + release
        selectedArrowId = null;
        active = { type: "draw", startMouse: p, bounds };
        draftArrow = dp8MakeArrow(dp8ClampPoint(p, bounds), dp8ClampPoint(p, bounds));
        renderDP8Canvas();
      }

      function onPointerMove(e) {
        if (!active) return;
        if (!modal || modal.getAttribute("aria-hidden") === "true") return;

        const p = dp8GetLayerPointFromEvent(e);
        const bounds = active.bounds || dp8GetBoundsForClamp();
        const cp = dp8ClampPoint(p, bounds);

        if (active.type === "draw") {
          if (!draftArrow) return;
          draftArrow.x2 = +Number(cp.x).toFixed(2);
          draftArrow.y2 = +Number(cp.y).toFixed(2);
          renderDP8Canvas();
          return;
        }

        const ar = dp8GetArrowById(active.id);
        if (!ar) return;

        if (active.type === "move") {
          const dx = cp.x - active.startMouse.x;
          const dy = cp.y - active.startMouse.y;
          ar.x1 = +Number(active.startArrow.x1 + dx).toFixed(2);
          ar.y1 = +Number(active.startArrow.y1 + dy).toFixed(2);
          ar.x2 = +Number(active.startArrow.x2 + dx).toFixed(2);
          ar.y2 = +Number(active.startArrow.y2 + dy).toFixed(2);

          // clamp global (évite de sortir complètement)
          const a = dp8ClampPoint({ x: ar.x1, y: ar.y1 }, bounds);
          const b = dp8ClampPoint({ x: ar.x2, y: ar.y2 }, bounds);
          ar.x1 = +Number(a.x).toFixed(2);
          ar.y1 = +Number(a.y).toFixed(2);
          ar.x2 = +Number(b.x).toFixed(2);
          ar.y2 = +Number(b.y).toFixed(2);

          renderDP8Canvas();
          return;
        }

        if (active.type === "resize_start") {
          ar.x1 = +Number(cp.x).toFixed(2);
          ar.y1 = +Number(cp.y).toFixed(2);
          renderDP8Canvas();
          return;
        }

        if (active.type === "resize_end") {
          ar.x2 = +Number(cp.x).toFixed(2);
          ar.y2 = +Number(cp.y).toFixed(2);
          renderDP8Canvas();
          return;
        }
      }

      function onPointerUp() {
        if (!active) return;
        if (active.type === "draw") {
          const ar = draftArrow;
          draftArrow = null;
          active = null;
          if (!ar) return;
          if (dp8ArrowLen(ar) < DP8_MIN_ARROW_LEN) {
            renderDP8Canvas();
            return;
          }
          const arrows = dp8NormalizeArrowsArray();
          arrows.push(ar);
          selectedArrowId = ar.id;
          dp8SyncValidateButtonUI();
          renderDP8Canvas();
          return;
        }
        draftArrow = null;
        active = null;
        dp8SyncValidateButtonUI();
        renderDP8Canvas();
      }

      if (canvasForEvents && canvasForEvents.dataset.dp8Bound !== "1") {
        canvasForEvents.dataset.dp8Bound = "1";
        canvasForEvents.addEventListener("pointerdown", onPointerDown);
        canvasForEvents.addEventListener("pointermove", onPointerMove);
        canvasForEvents.addEventListener("pointerup", onPointerUp);
        canvasForEvents.addEventListener("pointercancel", onPointerUp);
      }

      // Suppression clavier (individuelle)
      if (!window.__DP8_KEY_BOUND) {
        window.__DP8_KEY_BOUND = true;
        window.addEventListener("keydown", (e) => {
          const isOpen = modal && modal.getAttribute("aria-hidden") === "false";
          if (!isOpen) return;
          if (e.key === "Delete" || e.key === "Backspace") {
            if (!selectedArrowId) return;
            e.preventDefault();
            dp8RemoveSelectedArrow();
          }
        });
      }

      // ==============================
      // Zoom UI + molette
      // ==============================
      if (zoomInBtn && zoomInBtn.dataset.bound !== "1") {
        zoomInBtn.dataset.bound = "1";
        zoomInBtn.addEventListener("click", (e) => {
          e.preventDefault();
          dp8NudgeScale(+0.2);
        });
      }
      if (zoomOutBtn && zoomOutBtn.dataset.bound !== "1") {
        zoomOutBtn.dataset.bound = "1";
        zoomOutBtn.addEventListener("click", (e) => {
          e.preventDefault();
          dp8NudgeScale(-0.2);
        });
      }
      if (zoomResetBtn && zoomResetBtn.dataset.bound !== "1") {
        zoomResetBtn.dataset.bound = "1";
        zoomResetBtn.addEventListener("click", (e) => {
          e.preventDefault();
          dp8ResetView();
        });
      }
      try {
        dp8UpdateZoomLabel();
      } catch (_) {}

      if (workspace && workspace.dataset.dp8WheelBound !== "1") {
        workspace.dataset.dp8WheelBound = "1";
        workspace.addEventListener(
          "wheel",
          (e) => {
            if (!modal || modal.getAttribute("aria-hidden") === "true") return;
            if (!dp8HasBackground()) return;
            try {
              e.preventDefault();
            } catch (_) {}
            const dy = typeof e.deltaY === "number" ? e.deltaY : 0;
            const factor = dy < 0 ? 1.12 : 1 / 1.12;
            dp8SetScaleAtClientPoint(dp8View.scale * factor, e.clientX, e.clientY);
          },
          { passive: false }
        );
      }

      // ==============================
      // Modal open / close + validation
      // ==============================
      const bindHost = btnBefore || btnAfter;
      if (bindHost.dataset.bound === "1") return;
      bindHost.dataset.bound = "1";

      function openDP8Modal() {
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("dp-lock-scroll");
        try {
          dp8ResetView();
        } catch (_) {}
        try {
          requestAnimationFrame(() => {
            renderDP8Canvas();
          });
        } catch (_) {}
        dp8SyncValidateButtonUI();
      }

      function closeDP8Modal() {
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("dp-lock-scroll");
        try {
          dp8DestroyGoogleView();
        } catch (_) {}
      }

      if (validateBtn && validateBtn.dataset.bound !== "1") {
        validateBtn.dataset.bound = "1";
        validateBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          if (!dp8HasBackground()) return;
          const arrows = dp8NormalizeArrowsArray();
          if (!arrows.length) return;

          // Snapshot FINAL (photo + flèches) — sans UI/poignées
          selectedArrowId = null;
          draftArrow = null;
          active = null;
          await renderDP8Canvas();
          const canvas = workspace.querySelector("#dp8-canvas");
          if (!canvas) return;
          let out = "";
          try {
            out = canvas.toDataURL("image/png");
          } catch (_) {
            out = "";
          }
          if (!out || !out.startsWith("data:image")) return;

          // Stockage de la sortie finale (align DP6 : un champ final prêt pour PDF)
          try {
            window.DP8_STATE = window.DP8_STATE || {};
            window.DP8_STATE.finalImage = out;
            // ✅ Source de vérité après validation :
            // - l'accueil (miniature visible) lit `backgroundImage`
            // - le PDF lit `finalImage` (inchangé)
            // On force donc `backgroundImage` = image finale validée, et on vide les flèches
            // pour éviter une double superposition (flèches baked + flèches redessinées).
            window.DP8_STATE.backgroundImage = out;
            window.DP8_STATE.arrows = [];
          } catch (_) {}

          dp8RenderEntryMiniatures(out);
          dp8SyncValidateButtonUI();
          closeDP8Modal();
        });
      }

      if (btnBefore) {
        btnBefore.addEventListener("click", (e) => {
          e.preventDefault();
          dp8SetCategory("BEFORE");
          openDP8Modal();
        });
      }

      if (btnAfter) {
        btnAfter.addEventListener("click", (e) => {
          e.preventDefault();
          dp8SetCategory("AFTER");
          openDP8Modal();
        });
      }

      modal.addEventListener("click", (e) => {
        if (e.target.closest(".dp-modal-close") || e.target.closest("#dp8-cancel") || e.target.closest(".dp-modal-backdrop")) {
          e.preventDefault();
          closeDP8Modal();
        }
      });

      // Init UI initial
      dp8SyncCategoryUI();
      dp8SyncValidateButtonUI();
      dp8RenderEntryMiniatures("");
      renderDP8Canvas();
      console.log("[DP8] init ok");
    };
})();

