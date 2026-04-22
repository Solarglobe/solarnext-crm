// ==================================================
// DP7 — Implantation des panneaux (schématique)
// - Uniquement des flèches rouges dessinées manuellement
// - Aucune logique panneau / calepinage / dimension / métrique
// ==================================================

(function () {
  // État global DP7 (forme imposée)
  window.DP7_STATE = window.DP7_STATE || {
    mode: "EDITION",
    backgroundImage: null,
    finalImage: null,
    arrows: [],
  };

  const DP7_ARROW_COLOR = "#D72626";
  const DP7_ARROW_LINE_WIDTH = 4; // 3–5 px, visible en impression
  const DP7_ARROW_ALPHA = 1;
  const DP7_ARROW_HEAD_LEN = 14;
  const DP7_HIT_TOL = 10;
  const DP7_HANDLE_R = 8;
  const DP7_MIN_ARROW_LEN = 10;

  function dp7CoerceDataUrl(v) {
    const s = typeof v === "string" ? v : v == null ? "" : String(v);
    return s.startsWith("data:image") ? s : "";
  }

  function dp7HasBackground() {
    const src = dp7CoerceDataUrl(window.DP7_STATE?.backgroundImage);
    return !!src;
  }

  function dp7CategoryToLabel(category) {
    return category === "BEFORE" ? "Avant" : category === "AFTER" ? "Après" : "—";
  }

  function dp7Dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function dp7DistPointToSegment(pt, a, b) {
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

  function dp7Clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function dp7ClampPoint(p, bounds) {
    return {
      x: dp7Clamp(p.x, 0, bounds.w),
      y: dp7Clamp(p.y, 0, bounds.h),
    };
  }

  function dp7GenId() {
    return `dp7_arrow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function dp7NormalizeArrowsArray() {
    try {
      if (!Array.isArray(window.DP7_STATE.arrows)) window.DP7_STATE.arrows = [];
    } catch (_) {}
    return Array.isArray(window.DP7_STATE?.arrows) ? window.DP7_STATE.arrows : [];
  }

  function dp7MakeArrow(a, b) {
    return {
      id: dp7GenId(),
      x1: +Number(a.x || 0).toFixed(2),
      y1: +Number(a.y || 0).toFixed(2),
      x2: +Number(b.x || 0).toFixed(2),
      y2: +Number(b.y || 0).toFixed(2),
    };
  }

  function dp7ArrowLen(ar) {
    return Math.sqrt((ar.x2 - ar.x1) * (ar.x2 - ar.x1) + (ar.y2 - ar.y1) * (ar.y2 - ar.y1));
  }

  // --------------------------------------------------
  // Init DP7
  // --------------------------------------------------
  window.initDP7 =
    window.initDP7 ||
    function initDP7() {
      const page = document.getElementById("dp7-page");
      if (!page) return;

      const btnBefore = document.getElementById("dp7-create-before");
      const btnAfter = document.getElementById("dp7-create-after");
      const modal = document.getElementById("dp7-photo-modal");
      const streetBtn = document.getElementById("dp7-use-street");
      const uploadBtn = document.getElementById("dp7-use-upload");
      const workspace = document.getElementById("dp7-photo-workspace");
      const zoomInBtn = document.getElementById("dp7-zoom-in");
      const zoomOutBtn = document.getElementById("dp7-zoom-out");
      const zoomResetBtn = document.getElementById("dp7-zoom-reset");
      const zoomLabel = document.getElementById("dp7-zoom-label");
      const validateBtn = document.getElementById("dp7-validate");
      const categoryLabelEl = document.getElementById("dp7-photo-category-label");
      const arrowToolBtn = document.getElementById("dp7-tool-arrow");
      const useCurrentViewBtn = document.getElementById("dp7-use-current-view");

      if (!modal || (!btnBefore && !btnAfter) || !workspace) return;

      dp7NormalizeArrowsArray();

      // ==============================
      // Vue (zoom/pan) — visuel uniquement
      // ==============================
      const DP7_VIEW_MIN_SCALE = 1;
      const DP7_VIEW_MAX_SCALE = 4;
      const dp7View = { scale: 1, tx: 0, ty: 0 };

      function dp7GetStageEl() {
        return workspace.querySelector("#dp7-photo-stage");
      }

      function dp7UpdateZoomLabel() {
        if (!zoomLabel) return;
        const pct = Math.round((dp7View.scale || 1) * 100);
        zoomLabel.textContent = `${pct}%`;
      }

      function dp7ClampPanToBounds(next) {
        const s = typeof next?.scale === "number" ? next.scale : dp7View.scale;
        const tx = typeof next?.tx === "number" ? next.tx : dp7View.tx;
        const ty = typeof next?.ty === "number" ? next.ty : dp7View.ty;

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

      function dp7ApplyViewTransform() {
        const stage = dp7GetStageEl();
        if (!stage) return;
        const { scale, tx, ty } = dp7ClampPanToBounds(dp7View);
        dp7View.scale = scale;
        dp7View.tx = tx;
        dp7View.ty = ty;
        stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
        dp7UpdateZoomLabel();
      }

      function dp7ResetView() {
        dp7View.scale = 1;
        dp7View.tx = 0;
        dp7View.ty = 0;
        dp7ApplyViewTransform();
      }

      function dp7SetScaleAtClientPoint(nextScale, clientX, clientY) {
        const r = workspace.getBoundingClientRect();
        const cx = clientX - r.left;
        const cy = clientY - r.top;

        const prevScale = dp7View.scale;
        const clampedScale = Math.max(DP7_VIEW_MIN_SCALE, Math.min(DP7_VIEW_MAX_SCALE, nextScale));
        if (Math.abs(clampedScale - prevScale) < 0.0001) return;

        const x = (cx - dp7View.tx) / prevScale;
        const y = (cy - dp7View.ty) / prevScale;

        dp7View.scale = clampedScale;
        dp7View.tx = cx - x * clampedScale;
        dp7View.ty = cy - y * clampedScale;
        dp7ApplyViewTransform();
      }

      function dp7NudgeScale(delta) {
        const r = workspace.getBoundingClientRect();
        dp7SetScaleAtClientPoint(dp7View.scale + delta, r.left + r.width / 2, r.top + r.height / 2);
      }

      // ==============================
      // Structure workspace
      // ==============================
      function dp7EnsureWorkspaceStructure() {
        if (workspace.style.position !== "relative") workspace.style.position = "relative";
        if (workspace.style.overflow !== "hidden") workspace.style.overflow = "hidden";

        let stage = workspace.querySelector("#dp7-photo-stage");
        if (!stage) {
          stage = document.createElement("div");
          stage.id = "dp7-photo-stage";
          workspace.appendChild(stage);
        }
        stage.style.position = "absolute";
        stage.style.inset = "0";
        stage.style.transformOrigin = "0 0";
        stage.style.willChange = "transform";
        stage.style.userSelect = "none";

        let content = stage.querySelector("#dp7-photo-content") || workspace.querySelector("#dp7-photo-content");
        if (!content) {
          content = document.createElement("div");
          content.id = "dp7-photo-content";
          stage.appendChild(content);
        } else if (content.parentNode !== stage) {
          try {
            stage.appendChild(content);
          } catch (_) {}
        }
        content.style.position = "absolute";
        content.style.inset = "0";

        let layer = stage.querySelector("#dp7-overlay-layer") || workspace.querySelector("#dp7-overlay-layer");
        if (!layer) {
          layer = document.createElement("div");
          layer.id = "dp7-overlay-layer";
          stage.appendChild(layer);
        } else if (layer.parentNode !== stage) {
          try {
            stage.appendChild(layer);
          } catch (_) {}
        }
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.zIndex = "60";
        // DP7 : l'overlay DOM est conservé, mais on capte les interactions sur le canvas
        // pour éviter que l'overlay recouvre la toolbar flottante.
        layer.style.pointerEvents = "none";
        layer.style.userSelect = "none";
        layer.style.touchAction = "none";
        layer.style.cursor = "default";

        try {
          dp7ApplyViewTransform();
        } catch (_) {}

        return { stage, content, layer };
      }

      function dp7EnsureWorkspaceCanvas(struct) {
        if (!struct?.content) return null;
        let canvas = struct.content.querySelector("#dp7-canvas");
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.id = "dp7-canvas";
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
      let dp7ImageEl = null;
      let dp7ImageSrc = "";
      let dp7ImageLoadPromise = null;

      function dp7EnsureLoadedImage(src) {
        const s = dp7CoerceDataUrl(src);
        if (!s) return Promise.resolve(null);

        if (dp7ImageEl && dp7ImageSrc === s && dp7ImageEl.complete && dp7ImageEl.naturalWidth > 0) {
          return Promise.resolve(dp7ImageEl);
        }
        if (dp7ImageLoadPromise && dp7ImageSrc === s) return dp7ImageLoadPromise;

        dp7ImageSrc = s;
        dp7ImageEl = new Image();
        dp7ImageEl.decoding = "async";
        dp7ImageLoadPromise = new Promise((resolve) => {
          dp7ImageEl.onload = () => resolve(dp7ImageEl);
          dp7ImageEl.onerror = () => resolve(null);
          dp7ImageEl.src = s;
        });
        return dp7ImageLoadPromise;
      }

      // ==============================
      // Rendu (canvas)
      // ==============================
      let selectedArrowId = null;
      let active = null; // interaction en cours
      let draftArrow = null; // prévisualisation pendant le drag de création

      function dp7GetWorkspaceBoundsCss() {
        const r = workspace.getBoundingClientRect();
        return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      }

      function dp7DrawArrow(ctx, ar) {
        const x1 = ar.x1, y1 = ar.y1, x2 = ar.x2, y2 = ar.y2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const angle = Math.atan2(dy, dx);

        ctx.save();
        ctx.globalAlpha = DP7_ARROW_ALPHA;
        ctx.strokeStyle = DP7_ARROW_COLOR;
        ctx.fillStyle = DP7_ARROW_COLOR;
        ctx.lineWidth = DP7_ARROW_LINE_WIDTH;
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
        ctx.lineTo(x2 - DP7_ARROW_HEAD_LEN * Math.cos(angle - Math.PI / 6), y2 - DP7_ARROW_HEAD_LEN * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - DP7_ARROW_HEAD_LEN * Math.cos(angle + Math.PI / 6), y2 - DP7_ARROW_HEAD_LEN * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      function dp7DrawHandles(ctx, ar) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#111827";
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(ar.x1, ar.y1, DP7_HANDLE_R, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ar.x2, ar.y2, DP7_HANDLE_R, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      async function renderDP7Canvas() {
        const struct = dp7EnsureWorkspaceStructure();
        if (!struct) return;
        const canvas = dp7EnsureWorkspaceCanvas(struct);
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

        const src = dp7CoerceDataUrl(window.DP7_STATE?.backgroundImage);
        const img = await dp7EnsureLoadedImage(src);
        if (img) {
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.shadowColor = "transparent";
          ctx.drawImage(img, 0, 0, cssW, cssH);
          ctx.restore();
        }

        const arrows = dp7NormalizeArrowsArray();
        for (let i = 0; i < arrows.length; i++) {
          const ar = arrows[i];
          dp7DrawArrow(ctx, ar);
        }

        if (draftArrow) {
          dp7DrawArrow(ctx, draftArrow);
        }

        const sel = selectedArrowId ? arrows.find((a) => a && a.id === selectedArrowId) : null;
        if (sel) dp7DrawHandles(ctx, sel);

        // UX : curseur uniquement quand un fond est présent
        try {
          canvas.style.cursor = dp7HasBackground() ? "crosshair" : "default";
        } catch (_) {}
      }

      function dp7SyncValidateButtonUI() {
        const okImage = dp7HasBackground();
        const arrows = dp7NormalizeArrowsArray();
        const okArrows = Array.isArray(arrows) && arrows.length > 0;
        if (validateBtn) validateBtn.disabled = !(okImage && okArrows);
      }

      // ==============================
      // Miniatures (page DP7)
      // ==============================
      function dp7RenderEntryMiniatures(previewAfterDataUrl) {
        const beforeCard = document.getElementById("dp7-card-before");
        const afterCard = document.getElementById("dp7-card-after");
        const beforeImg = document.getElementById("dp7-thumb-before");
        const afterImg = document.getElementById("dp7-thumb-after");
        if (!beforeCard || !afterCard || !beforeImg || !afterImg) return;

        const before = dp7CoerceDataUrl(window.DP7_STATE?.backgroundImage);
        const after = dp7CoerceDataUrl(previewAfterDataUrl);

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
      let dp7Category = null;
      function dp7SyncCategoryUI() {
        if (!categoryLabelEl) return;
        categoryLabelEl.textContent = dp7CategoryToLabel(dp7Category);
      }
      function dp7SetCategory(category) {
        dp7Category = category === "BEFORE" || category === "AFTER" ? category : null;
        dp7SyncCategoryUI();
      }

      // ==============================
      // Source image (import / Street View)
      // ==============================
      function dp7DisplayImportedImage(dataURL) {
        const s = dp7CoerceDataUrl(dataURL);
        if (!s) return;

        // Nettoyage strict Street View si actif
        try {
          dp7DestroyGoogleView();
        } catch (_) {}

        try {
          window.DP7_STATE = window.DP7_STATE || {};
          window.DP7_STATE.backgroundImage = s;
          window.DP7_STATE.arrows = [];
        } catch (_) {}

        selectedArrowId = null;
        draftArrow = null;
        active = null;

        try {
          dp7ResetView();
        } catch (_) {}

        dp7SyncValidateButtonUI();
        dp7RenderEntryMiniatures("");
        renderDP7Canvas();
      }

      // Google Street View (DP7) : panorama interactif ; image figée via Street View Static API (aligné DP6)
      let dp7Panorama = null;
      let dp7StreetHost = null;

      /** Même formule que DP6 : zoom panorama → champ de vision Static API */
      function dp7StreetViewZoomToFov(zoom) {
        const z = Number(zoom);
        const zz = Number.isFinite(z) ? z : 1;
        const f = 126 * Math.pow(0.62, zz);
        return Math.round(Math.min(120, Math.max(10, f)));
      }

      /** Clé Static API — alignée sur DP6 (dp-app.js), sans dépendre de ce fichier */
      const DP7_GOOGLE_MAPS_API_KEY_STATIC = "AIzaSyDQMAe4zNsipMna3Ph1ANhJLMpZcdAWC1M";

      async function dp7UseCurrentStreetViewAsImage() {
        if (!dp7Panorama || !window.google?.maps) {
          alert("Street View n’est pas prêt. Patientez quelques secondes puis réessayez.");
          return;
        }
        const pano = dp7Panorama;
        const pos = pano.getPosition && pano.getPosition();
        const pov = pano.getPov && pano.getPov();
        const panoId = pano.getPano && pano.getPano();
        const zoom = pano.getZoom && pano.getZoom();
        if (!pos || !pov) {
          alert("Impossible de lire la vue Street View actuelle.");
          return;
        }
        const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
        const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
        const fov = dp7StreetViewZoomToFov(zoom);
        const params = new URLSearchParams();
        params.set("size", "640x640");
        params.set("key", DP7_GOOGLE_MAPS_API_KEY_STATIC);
        params.set("heading", String(pov.heading ?? 0));
        params.set("pitch", String(pov.pitch ?? 0));
        params.set("fov", String(fov));
        if (panoId) {
          params.set("pano", String(panoId));
        } else {
          params.set("location", `${lat},${lng}`);
        }
        const url = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
        try {
          if (useCurrentViewBtn) {
            useCurrentViewBtn.disabled = true;
            useCurrentViewBtn.textContent = "Chargement…";
          }
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Street View Static HTTP ${res.status}`);
          }
          const blob = await res.blob();
          if (!blob || blob.size < 64) {
            throw new Error("Image Street View vide ou indisponible");
          }
          const dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
          dp7DisplayImportedImage(String(dataUrl));
        } catch (e) {
          console.error("[DP7] Street View Static", e);
          alert(
            "Impossible de récupérer l’image Street View (couverture, quota ou clé API). Réessayez ou importez une photo."
          );
        } finally {
          if (useCurrentViewBtn) {
            useCurrentViewBtn.disabled = false;
            useCurrentViewBtn.textContent = "Utiliser cette vue";
          }
        }
      }

      function dp7DestroyGoogleView() {
        const ev = window.google?.maps?.event;
        if (ev?.clearInstanceListeners) {
          try {
            if (dp7Panorama) ev.clearInstanceListeners(dp7Panorama);
          } catch (_) {}
        }
        try {
          if (dp7Panorama?.setVisible) dp7Panorama.setVisible(false);
        } catch (_) {}
        dp7Panorama = null;
        try {
          if (dp7StreetHost && dp7StreetHost.parentNode) dp7StreetHost.parentNode.removeChild(dp7StreetHost);
        } catch (_) {}
        dp7StreetHost = null;
        if (useCurrentViewBtn) {
          useCurrentViewBtn.hidden = true;
          useCurrentViewBtn.disabled = true;
          useCurrentViewBtn.textContent = "Utiliser cette vue";
        }
        // Restaurer le canvas si présent
        try {
          const c = workspace.querySelector("#dp7-canvas");
          if (c) c.style.display = "block";
        } catch (_) {}
      }

      async function openDP7StreetView() {
        if (useCurrentViewBtn) {
          useCurrentViewBtn.hidden = true;
          useCurrentViewBtn.disabled = true;
          useCurrentViewBtn.textContent = "Utiliser cette vue";
        }

        // StreetView : éviter un stage déjà zoomé (UX stable)
        try {
          dp7ResetView();
        } catch (_) {}

        const struct = dp7EnsureWorkspaceStructure();
        if (!struct) return;

        const canvas = dp7EnsureWorkspaceCanvas(struct);
        if (canvas) canvas.style.display = "none";

        try {
          Array.from(struct.content.children || []).forEach((ch) => {
            // Ne jamais supprimer le canvas, ni la toolbar
            if (ch !== canvas && ch.id !== "dp7-toolbar") {
              try {
                ch.parentNode && ch.parentNode.removeChild(ch);
              } catch (_) {}
            }
          });
        } catch (_) {}

        const host = document.createElement("div");
        host.id = "dp7-streetview";
        host.style.width = "100%";
        host.style.height = "100%";
        host.style.flex = "1";
        host.style.position = "relative";
        dp7StreetHost = host;
        struct.content.appendChild(host);

        if (typeof window.dpLoadGoogleMapsJsOnce !== "function" || typeof window.dpGetProjectCenterForGoogleMaps !== "function") {
          return;
        }

        const google = await window.dpLoadGoogleMapsJsOnce();
        if (!google || !google.maps) return;
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
          dp7Panorama = panorama;
          if (useCurrentViewBtn) {
            useCurrentViewBtn.hidden = false;
            useCurrentViewBtn.disabled = false;
            useCurrentViewBtn.textContent = "Utiliser cette vue";
          }
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
      let fileInput = document.getElementById("dp7-file-input");
      if (!fileInput) {
        fileInput = document.createElement("input");
        fileInput.id = "dp7-file-input";
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
          reader.onload = () => dp7DisplayImportedImage(reader.result);
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
          await openDP7StreetView();
        });
      }

      if (useCurrentViewBtn) {
        useCurrentViewBtn.addEventListener("click", (e) => {
          e.preventDefault();
          void dp7UseCurrentStreetViewAsImage();
        });
      }

      try {
        window.dp7UseCurrentStreetViewAsImage = dp7UseCurrentStreetViewAsImage;
      } catch (_) {}

      // ==============================
      // Toolbar : outil unique "flèche"
      // ==============================
      // Outil toujours actif (DP7 interdit tout autre dessin)
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
      const struct = dp7EnsureWorkspaceStructure();
      const layer = struct?.layer; // conservé (non interactif)
      const canvasForEvents = dp7EnsureWorkspaceCanvas(struct);

      function dp7GetLayerPointFromEvent(e) {
        const c = canvasForEvents || workspace.querySelector("#dp7-canvas");
        if (!c) return { x: 0, y: 0 };
        const r = c.getBoundingClientRect();
        const s = dp7View && typeof dp7View.scale === "number" ? dp7View.scale : 1;
        return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
      }

      function dp7HitTest(p) {
        const arrows = dp7NormalizeArrowsArray();
        // top-most : on parcourt à l'envers
        for (let i = arrows.length - 1; i >= 0; i--) {
          const ar = arrows[i];
          if (!ar) continue;
          const a = { x: ar.x1, y: ar.y1 };
          const b = { x: ar.x2, y: ar.y2 };
          const d1 = dp7Dist(p, a);
          const d2 = dp7Dist(p, b);
          if (d1 <= DP7_HIT_TOL) return { id: ar.id, handle: "start" };
          if (d2 <= DP7_HIT_TOL) return { id: ar.id, handle: "end" };
          const ds = dp7DistPointToSegment(p, a, b);
          if (ds <= DP7_HIT_TOL) return { id: ar.id, handle: "body" };
        }
        return null;
      }

      function dp7GetArrowById(id) {
        const arrows = dp7NormalizeArrowsArray();
        return arrows.find((a) => a && a.id === id) || null;
      }

      function dp7RemoveSelectedArrow() {
        if (!selectedArrowId) return;
        const arrows = dp7NormalizeArrowsArray();
        const next = arrows.filter((a) => a && a.id !== selectedArrowId);
        try {
          window.DP7_STATE.arrows = next;
        } catch (_) {}
        selectedArrowId = null;
        dp7SyncValidateButtonUI();
        renderDP7Canvas();
      }

      function dp7GetBoundsForClamp() {
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
        if (!dp7HasBackground()) return; // pas de dessin sans fond

        e.preventDefault();
        e.stopPropagation();
        beginInteraction(e);

        const p = dp7GetLayerPointFromEvent(e);
        const hit = dp7HitTest(p);
        const bounds = dp7GetBoundsForClamp();

        if (hit) {
          selectedArrowId = hit.id;
          const ar = dp7GetArrowById(hit.id);
          if (!ar) return;
          active = {
            type: hit.handle === "body" ? "move" : hit.handle === "start" ? "resize_start" : "resize_end",
            id: hit.id,
            startMouse: p,
            startArrow: { x1: ar.x1, y1: ar.y1, x2: ar.x2, y2: ar.y2 },
            bounds,
          };
          renderDP7Canvas();
          return;
        }

        // Création : clic + drag + release
        selectedArrowId = null;
        active = { type: "draw", startMouse: p, bounds };
        draftArrow = dp7MakeArrow(dp7ClampPoint(p, bounds), dp7ClampPoint(p, bounds));
        renderDP7Canvas();
      }

      function onPointerMove(e) {
        if (!active) return;
        if (!modal || modal.getAttribute("aria-hidden") === "true") return;

        const p = dp7GetLayerPointFromEvent(e);
        const bounds = active.bounds || dp7GetBoundsForClamp();
        const cp = dp7ClampPoint(p, bounds);

        if (active.type === "draw") {
          if (!draftArrow) return;
          draftArrow.x2 = +Number(cp.x).toFixed(2);
          draftArrow.y2 = +Number(cp.y).toFixed(2);
          renderDP7Canvas();
          return;
        }

        const ar = dp7GetArrowById(active.id);
        if (!ar) return;

        if (active.type === "move") {
          const dx = cp.x - active.startMouse.x;
          const dy = cp.y - active.startMouse.y;
          ar.x1 = +Number(active.startArrow.x1 + dx).toFixed(2);
          ar.y1 = +Number(active.startArrow.y1 + dy).toFixed(2);
          ar.x2 = +Number(active.startArrow.x2 + dx).toFixed(2);
          ar.y2 = +Number(active.startArrow.y2 + dy).toFixed(2);

          // clamp global (évite de sortir complètement)
          const a = dp7ClampPoint({ x: ar.x1, y: ar.y1 }, bounds);
          const b = dp7ClampPoint({ x: ar.x2, y: ar.y2 }, bounds);
          ar.x1 = +Number(a.x).toFixed(2);
          ar.y1 = +Number(a.y).toFixed(2);
          ar.x2 = +Number(b.x).toFixed(2);
          ar.y2 = +Number(b.y).toFixed(2);

          renderDP7Canvas();
          return;
        }

        if (active.type === "resize_start") {
          ar.x1 = +Number(cp.x).toFixed(2);
          ar.y1 = +Number(cp.y).toFixed(2);
          renderDP7Canvas();
          return;
        }

        if (active.type === "resize_end") {
          ar.x2 = +Number(cp.x).toFixed(2);
          ar.y2 = +Number(cp.y).toFixed(2);
          renderDP7Canvas();
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
          if (dp7ArrowLen(ar) < DP7_MIN_ARROW_LEN) {
            renderDP7Canvas();
            return;
          }
          const arrows = dp7NormalizeArrowsArray();
          arrows.push(ar);
          selectedArrowId = ar.id;
          dp7SyncValidateButtonUI();
          renderDP7Canvas();
          return;
        }
        draftArrow = null;
        active = null;
        dp7SyncValidateButtonUI();
        renderDP7Canvas();
      }

      if (canvasForEvents && canvasForEvents.dataset.dp7Bound !== "1") {
        canvasForEvents.dataset.dp7Bound = "1";
        canvasForEvents.addEventListener("pointerdown", onPointerDown);
        canvasForEvents.addEventListener("pointermove", onPointerMove);
        canvasForEvents.addEventListener("pointerup", onPointerUp);
        canvasForEvents.addEventListener("pointercancel", onPointerUp);
      }

      // Suppression clavier (individuelle)
      if (!window.__DP7_KEY_BOUND) {
        window.__DP7_KEY_BOUND = true;
        window.addEventListener("keydown", (e) => {
          const isOpen = modal && modal.getAttribute("aria-hidden") === "false";
          if (!isOpen) return;
          if (e.key === "Delete" || e.key === "Backspace") {
            if (!selectedArrowId) return;
            e.preventDefault();
            dp7RemoveSelectedArrow();
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
          dp7NudgeScale(+0.2);
        });
      }
      if (zoomOutBtn && zoomOutBtn.dataset.bound !== "1") {
        zoomOutBtn.dataset.bound = "1";
        zoomOutBtn.addEventListener("click", (e) => {
          e.preventDefault();
          dp7NudgeScale(-0.2);
        });
      }
      if (zoomResetBtn && zoomResetBtn.dataset.bound !== "1") {
        zoomResetBtn.dataset.bound = "1";
        zoomResetBtn.addEventListener("click", (e) => {
          e.preventDefault();
          dp7ResetView();
        });
      }
      try {
        dp7UpdateZoomLabel();
      } catch (_) {}

      if (workspace && workspace.dataset.dp7WheelBound !== "1") {
        workspace.dataset.dp7WheelBound = "1";
        workspace.addEventListener(
          "wheel",
          (e) => {
            if (!modal || modal.getAttribute("aria-hidden") === "true") return;
            if (!dp7HasBackground()) return;
            try {
              e.preventDefault();
            } catch (_) {}
            const dy = typeof e.deltaY === "number" ? e.deltaY : 0;
            const factor = dy < 0 ? 1.12 : 1 / 1.12;
            dp7SetScaleAtClientPoint(dp7View.scale * factor, e.clientX, e.clientY);
          },
          { passive: false }
        );
      }

      try {
        if (window.snDpV && typeof window.snDpV.migrateKind === "function") {
          window.snDpV.migrateKind("dp7");
        }
        if (typeof window.snDpVSetupPageUi === "function") {
          window.snDpVSetupPageUi("dp7", {
            onAfter: function () {
              try {
                dp7RenderEntryMiniatures("");
              } catch (_) {}
              try {
                renderDP7Canvas();
              } catch (_) {}
              try {
                dp7SyncValidateButtonUI();
              } catch (_) {}
            },
          });
        }
      } catch (_) {}

      // ==============================
      // Modal open / close + validation
      // ==============================
      const bindHost = btnBefore || btnAfter;
      if (bindHost.dataset.bound === "1") return;
      bindHost.dataset.bound = "1";

      function openDP7Modal() {
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("dp-lock-scroll");
        try {
          dp7ResetView();
        } catch (_) {}
        try {
          requestAnimationFrame(() => {
            renderDP7Canvas();
          });
        } catch (_) {}
        dp7SyncValidateButtonUI();
      }

      function closeDP7Modal() {
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("dp-lock-scroll");
        try {
          dp7DestroyGoogleView();
        } catch (_) {}
      }

      if (validateBtn && validateBtn.dataset.bound !== "1") {
        validateBtn.dataset.bound = "1";
        validateBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          if (!dp7HasBackground()) return;
          const arrows = dp7NormalizeArrowsArray();
          if (!arrows.length) return;

          // Snapshot FINAL (photo + flèches) — sans UI/poignées
          selectedArrowId = null;
          draftArrow = null;
          active = null;
          await renderDP7Canvas();
          const canvas = workspace.querySelector("#dp7-canvas");
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
            window.DP7_STATE = window.DP7_STATE || {};
            window.DP7_STATE.finalImage = out;
            // ✅ Source de vérité après validation :
            // - l'accueil (miniature visible) lit `backgroundImage`
            // - le PDF lit `finalImage` (inchangé)
            // On force donc `backgroundImage` = image finale validée, et on vide les flèches
            // pour éviter une double superposition (flèches baked + flèches redessinées).
            window.DP7_STATE.backgroundImage = out;
            window.DP7_STATE.arrows = [];
          } catch (_) {}

          dp7RenderEntryMiniatures(out);
          dp7SyncValidateButtonUI();
          closeDP7Modal();
        });
      }

      if (btnBefore) {
        btnBefore.addEventListener("click", (e) => {
          e.preventDefault();
          dp7SetCategory("BEFORE");
          openDP7Modal();
        });
      }

      if (btnAfter) {
        btnAfter.addEventListener("click", (e) => {
          e.preventDefault();
          dp7SetCategory("AFTER");
          openDP7Modal();
        });
      }

      modal.addEventListener("click", (e) => {
        if (e.target.closest(".dp-modal-close") || e.target.closest("#dp7-cancel") || e.target.closest(".dp-modal-backdrop")) {
          e.preventDefault();
          closeDP7Modal();
        }
      });

      // Init UI initial
      dp7SyncCategoryUI();
      dp7SyncValidateButtonUI();
      dp7RenderEntryMiniatures("");
      renderDP7Canvas();
      console.log("[DP7] init ok");
    };
})();

