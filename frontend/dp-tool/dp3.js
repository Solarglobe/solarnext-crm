// Extracted from dp-app.js. Loaded after dp-app.js in legacy script order.
// ======================================================
// DP3 — PLAN DE COUPE (FRONTEND)
// ======================================================
(function () {
  function DP3_getLsKey() {
    return __solarnextScopedStorageKey("DP3_STATE_V1");
  }

  // non persisté (mémoire uniquement)
  let DP3_SELECTED_ID = null;
  let DP3_EDITOR_OPEN = false;
  let DP3_EDITOR_KEY_HANDLER = null;

  /** Aligné produit : SOL | INTEGRATION | SURIMPOSITION | TOIT_PLAT */
  const DP3_TYPE_KEY_TO_POSE = {
    sol: "SOL",
    integration: "INTEGRATION",
    surimposition: "SURIMPOSITION",
    toit_terrasse: "TOIT_PLAT",
  };

  function DP3_poseTypeFromTypeKey(typeKey) {
    return typeKey && DP3_TYPE_KEY_TO_POSE[typeKey] ? DP3_TYPE_KEY_TO_POSE[typeKey] : null;
  }

  function DP3_defaultState() {
    return {
      hasDP3: false,
      typeKey: null, // "surimposition"|"integration"|"toit_terrasse"|"sol"
      /** @type {"SOL"|"INTEGRATION"|"SURIMPOSITION"|"TOIT_PLAT"|null} */
      poseType: null,
      baseImage: null, // URL résolue ou "photos/xxx.png"
      // "portrait" | "paysage" (utilisé plus tard dans le PDF DP3)
      installationOrientation: "portrait",
      module: null, // module PV (même forme que DP2_STATE.panelModel, API pv_panels) ou null
      manualImageName: null,
      textBoxes: [
        // { id, x, y, w, h, text, fontSize }
      ],
      validatedAt: null,
    };
  }

  function DP3_loadState() {
    try {
      const raw = localStorage.getItem(DP3_getLsKey());
      if (!raw) return DP3_defaultState();
      const parsed = JSON.parse(raw);
      const s = { ...DP3_defaultState(), ...(parsed || {}) };
      // compat champs potentiellement manquants
      if (!Array.isArray(s.textBoxes)) s.textBoxes = [];
      if (s.poseType == null && s.typeKey) {
        const p = DP3_poseTypeFromTypeKey(s.typeKey);
        if (p) s.poseType = p;
      }
      // compat/validation
      if (s.installationOrientation !== "portrait" && s.installationOrientation !== "paysage") {
        s.installationOrientation = "portrait";
      }
      return s;
    } catch (e) {
      return DP3_defaultState();
    }
  }

  function DP3_saveState(state) {
    try {
      localStorage.setItem(DP3_getLsKey(), JSON.stringify(state));
    } catch (e) {}
    try {
      if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
    } catch (_) {}
  }

  /** Source initiale : mémoire (hydratation serveur) ; localStorage uniquement sans brouillon CRM. */
  function DP3_ensureState() {
    if (window.DP3_STATE) return window.DP3_STATE;
    if (!window.__SN_DP_SERVER_DRAFT_ACTIVE) return DP3_loadState();
    return DP3_defaultState();
  }

  function DP3_clamp01(v) {
    if (typeof v !== "number" || Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function DP3_findBoxIndexById(state, id) {
    return (state.textBoxes || []).findIndex((b) => b && b.id === id);
  }

  function DP3_getTypeMap() {
    return {
      surimposition: "photos/Toiture inclinée - surimposition.png",
      integration: "photos/Toit incliné - intégration.png",
      toit_terrasse: "photos/Toiture plate - toit terrasse.png",
      sol: "photos/pose au sol.png",
    };
  }

  function DP3_resolveImageSrc(relativePath) {
    if (!relativePath || typeof relativePath !== "string") return "";
    return typeof __solarnextDpResolveAssetUrl === "function"
      ? __solarnextDpResolveAssetUrl(relativePath)
      : relativePath;
  }

  function DP3_ensureModalNotDuplicated(modalId) {
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();
  }

  function DP3_buildModalShell(modalId, titleHtml) {
    DP3_ensureModalNotDuplicated(modalId);
    const modal = document.createElement("div");
    modal.className = "dp-modal";
    modal.id = modalId;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="dp-modal-backdrop"></div>
      <div class="dp-modal-panel">
        <div class="dp-modal-header">
          <h2 class="dp-modal-title-solarglobe">${titleHtml}</h2>
          <button class="dp-modal-close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div class="dp-modal-body"></div>
        <div class="dp-modal-footer"></div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function DP3_showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.setAttribute("aria-hidden", "false");
  }

  function DP3_hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
  }

  function DP3_bindModalCloseHandlers(modalId, onClose) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";

    modal.addEventListener("click", (e) => {
      if (
        e.target.closest(".dp-modal-close") ||
        e.target.classList?.contains?.("dp-modal-backdrop")
      ) {
        e.preventDefault();
        try {
          onClose && onClose();
        } catch (_) {}
      }
    });
  }

  function DP3_renderHome() {
    const root = document.getElementById("dp3-root");
    if (!root) return;

    const state = window.DP3_STATE;
    const uploadSub = document.getElementById("dp3-upload-sub");
    const previewInner = document.getElementById("dp3-preview-inner");
    const btnDownload = document.getElementById("dp3-download-btn");

    if (uploadSub) {
      const baseText = "Fallback manuel si l’auto-génération n’est pas possible.";
      if (state && state.manualImageName) {
        uploadSub.innerHTML = `${baseText}<br>Image importée : <strong>${state.manualImageName}</strong>`;
      } else {
        uploadSub.textContent = baseText;
      }
    }

    if (previewInner) {
      if (!state || !state.hasDP3) {
        previewInner.classList.add("dp-placeholder");
        previewInner.innerHTML = `
          <div class="dp-placeholder-title">Aucune DP3 créée pour le moment.</div>
          <div class="dp-placeholder-sub">Cliquez sur “Créer nouvelle DP3”.</div>
        `;
      } else {
        const safeSrc = state.baseImage || "";
        previewInner.classList.remove("dp-placeholder");
        previewInner.innerHTML = `
          <div class="dp3-preview">
            <img class="dp3-preview-img" alt="Aperçu DP3" src="${safeSrc}">
            <div class="dp3-preview-badge">DP3 prête</div>
          </div>
        `;
      }
    }

    if (btnDownload) {
      btnDownload.style.display = state && state.hasDP3 ? "" : "none";
    }
  }

  function DP3_imageSrcToDataUrl(src) {
    if (!src || typeof src !== "string") return Promise.resolve(null);
    if (src.startsWith("data:image")) return Promise.resolve(src);

    return new Promise((resolve) => {
      const img = new Image();
      try { img.crossOrigin = "anonymous"; } catch (_) {}
      img.onload = () => {
        try {
          const w = img.naturalWidth || 1;
          const h = img.naturalHeight || 1;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(src);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        } catch (_) {
          // fallback : conserver la source si conversion impossible
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }

  async function DP3_downloadPDF() {
    const state = DP3_ensureState();
    window.DP3_STATE = state;

    if (!state || !state.hasDP3) {
      window.__snDpAlert("DP3 non validée");
      return;
    }
    if (!state.baseImage) {
      window.__snDpAlert("Image DP3 manquante");
      return;
    }

    const baseImage = await DP3_imageSrcToDataUrl(state.baseImage);
    if (!baseImage) {
      window.__snDpAlert("Image DP3 manquante");
      return;
    }

    if (!state.module || !state.module.panel_id) {
      window.__snDpAlert("Veuillez sélectionner le module photovoltaïque (marque et modèle) avant de générer la DP3.");
      return;
    }

    const dp3Data = {
      client: buildPdfClientFromDP1Context(),
      typeKey: state.typeKey ?? null,
      poseType: state.poseType ?? null,
      installationOrientation: state.installationOrientation === "paysage" ? "paysage" : "portrait",
      module: state.module ?? null,
      baseImage,
      textBoxes: Array.isArray(state.textBoxes) ? state.textBoxes : [],
    };

    await __solarnextDpFetchPdfWithReplace(
      "/pdf/render/dp3/pdf",
      function () {
        return { dp3Data: dp3Data };
      },
      "dp3"
    );
  }

  function DP3_openTypeModal() {
    console.log("DP3_OVERLAY_OPEN");
    const state = DP3_ensureState();
    window.DP3_STATE = state;

    const typeMap = DP3_getTypeMap();
    const modalId = "dp3-type-modal";
    const modal = DP3_buildModalShell(
      modalId,
      `DP3 — Plan de coupe <span class="dp3-modal-subtitle">Choisir un type d’installation</span>`
    );

    modal.classList.add("dp3-type-modal");
    const body = modal.querySelector(".dp-modal-body");
    const footer = modal.querySelector(".dp-modal-footer");

    let DP3_TEMP = { typeKey: null, baseImage: null, poseType: null };

    const typeRows = [
      { key: "sol", label: "Pose au sol", rel: typeMap.sol },
      { key: "integration", label: "Intégration", rel: typeMap.integration },
      { key: "surimposition", label: "Surimposition", rel: typeMap.surimposition },
      { key: "toit_terrasse", label: "Toit terrasse", rel: typeMap.toit_terrasse },
    ];

    if (body) {
      body.classList.add("dp3-type-body");
      body.innerHTML = `
        <div class="dp3-type-grid" role="list">
          ${typeRows
            .map((t) => {
              const src = DP3_resolveImageSrc(t.rel);
              const pose = DP3_poseTypeFromTypeKey(t.key);
              return `
            <button type="button" class="dp3-type-card" data-type="${t.key}" data-pose="${pose || ""}" role="listitem">
              <img class="dp3-type-card-img" alt="${t.label}" src="${src.replace(/"/g, "&quot;")}">
              <div class="dp3-type-card-label">${t.label}</div>
            </button>
          `;
            })
            .join("")}
        </div>
      `;
    }

    if (footer) {
      footer.classList.add("dp3-type-footer");
      footer.innerHTML = `
        <button class="dp-btn dp-btn-outline" type="button" id="dp3-type-cancel">Annuler</button>
        <button class="dp-btn dp-btn-primary" type="button" id="dp3-type-validate" disabled>Valider</button>
      `;
    }

    function refreshSelectionUI() {
      const cards = modal.querySelectorAll(".dp3-type-card");
      cards.forEach((c) => {
        const isSel = c.dataset.type === DP3_TEMP.typeKey;
        c.classList.toggle("selected", !!isSel);
      });
      const btnVal = modal.querySelector("#dp3-type-validate");
      if (btnVal) btnVal.disabled = !DP3_TEMP.typeKey;
    }

    modal.addEventListener("click", (e) => {
      const card = e.target.closest(".dp3-type-card");
      if (!card) return;
      const typeKey = card.dataset.type;
      if (!typeKey || !typeMap[typeKey]) return;
      DP3_TEMP.typeKey = typeKey;
      DP3_TEMP.baseImage = DP3_resolveImageSrc(typeMap[typeKey]);
      DP3_TEMP.poseType = DP3_poseTypeFromTypeKey(typeKey);
      console.log("DP3_SELECTION", { typeKey, poseType: DP3_TEMP.poseType });
      refreshSelectionUI();
    });

    const btnCancel = modal.querySelector("#dp3-type-cancel");
    const btnValidate = modal.querySelector("#dp3-type-validate");
    if (btnCancel) {
      btnCancel.addEventListener("click", () => DP3_closeTypeModal());
    }
    if (btnValidate) {
      btnValidate.addEventListener("click", () => {
        if (!DP3_TEMP.typeKey || !DP3_TEMP.baseImage) return;

        window.DP3_STATE.typeKey = DP3_TEMP.typeKey;
        window.DP3_STATE.baseImage = DP3_TEMP.baseImage;
        window.DP3_STATE.poseType = DP3_TEMP.poseType;
        window.DP3_STATE.hasDP3 = true;
        window.DP3_STATE.validatedAt = Date.now();
        window.DP3_STATE.installationOrientation = "portrait";
        window.DP3_STATE.module = null;
        window.DP3_STATE.textBoxes = [];
        DP3_saveState(window.DP3_STATE);

        console.log("DP3_VALIDATED", {
          poseType: window.DP3_STATE.poseType,
          typeKey: window.DP3_STATE.typeKey,
        });
        if (typeof window.__snDpAfterDp3Validated === "function") {
          try {
            window.__snDpAfterDp3Validated();
          } catch (err) {
            console.warn("[DP3] draft hook", err);
          }
        }

        DP3_closeTypeModal();
        DP3_renderHome();
      });
    }

    DP3_bindModalCloseHandlers(modalId, () => DP3_closeTypeModal());
    refreshSelectionUI();
    DP3_showModal(modalId);
  }

  function DP3_closeTypeModal() {
    const modalId = "dp3-type-modal";
    const modal = document.getElementById(modalId);
    if (!modal) return;
    DP3_hideModal(modalId);
    modal.remove();
  }

  function DP3_openEditor() {
    const state = DP3_ensureState();
    window.DP3_STATE = state;

    if (!state.typeKey || !state.baseImage) {
      console.log("[DP3] baseImage manquante, éditeur non ouvert.", state);
      return;
    }

    const modalId = "dp3-editor-modal";
    const modal = DP3_buildModalShell(modalId, `DP3 — Éditeur (Plan de coupe)`);
    modal.classList.add("dp3-editor-modal");
    const body = modal.querySelector(".dp-modal-body");
    const footer = modal.querySelector(".dp-modal-footer");

    if (body) {
      body.classList.add("dp3-editor-body");
      body.innerHTML = `
        <aside class="dp-map-help dp3-editor-left">
          <h3>Paramètres</h3>

          <div class="dp3-field">
            <label class="dp3-label">Type d’installation</label>
            <select id="dp3-installation-orientation" class="dp3-select">
              <option value="portrait">Portrait</option>
              <option value="paysage">Paysage</option>
            </select>
          </div>

          <hr />

          <!-- Modules PV (identique DP2 : choix + lecture seule) -->
          <div class="dp2-field">
            <label class="dp2-label">Module photovoltaïque</label>
            <select id="dp3-panel-select" class="dp2-select">
              <option value="">— Sélectionner un module —</option>
            </select>
          </div>

          <div class="dp2-panel-readonly">
            <div><strong>Fabricant :</strong> <span id="dp3-panel-manufacturer">—</span></div>
            <div><strong>Référence :</strong> <span id="dp3-panel-reference">—</span></div>
            <div><strong>Puissance :</strong> <span id="dp3-panel-power">—</span></div>
            <div><strong>Dimensions :</strong> <span id="dp3-panel-dimensions">—</span></div>
          </div>

          <hr />

          <h3>Zones texte</h3>
          <div class="dp3-field">
            <button class="dp-btn dp-btn-primary" type="button" id="dp3-add-textbox">+ Ajouter une zone texte</button>
          </div>

          <div class="dp3-field">
            <label class="dp3-label">Taille de police</label>
            <select id="dp3-fontsize" class="dp3-select">
              <option value="12">12</option>
              <option value="14" selected>14</option>
              <option value="16">16</option>
              <option value="18">18</option>
            </select>
          </div>

          <div class="dp3-field">
            <button class="dp-btn dp-btn-outline" type="button" id="dp3-delete-textbox" disabled>Supprimer la zone</button>
          </div>
        </aside>

        <div class="dp3-editor-canvas">
          <div class="dp3-page">
            <div class="dp3-stage-wrap">
              <div class="dp3-stage" id="dp3-stage">
                <img id="dp3-stage-img" alt="Plan de coupe (base)" src="${state.baseImage}">
                <div class="dp3-overlay" id="dp3-overlay" aria-label="Zones texte"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (footer) {
      footer.classList.add("dp3-editor-footer");
      footer.innerHTML = `
        <button class="dp-btn dp-btn-outline" type="button" id="dp3-editor-cancel">Annuler</button>
        <button class="dp-btn dp-btn-primary" type="button" id="dp3-editor-validate">Valider</button>
      `;
    }

    function getFontSizeFromUI() {
      const sel = modal.querySelector("#dp3-fontsize");
      const v = sel ? parseInt(sel.value, 10) : 14;
      return Number.isFinite(v) ? v : 14;
    }

    function setDeleteBtnEnabled(enabled) {
      const btn = modal.querySelector("#dp3-delete-textbox");
      if (btn) btn.disabled = !enabled;
    }

    function renderOverlay() {
      const overlay = modal.querySelector("#dp3-overlay");
      if (!overlay) return;
      overlay.innerHTML = "";

      const boxes = window.DP3_STATE.textBoxes || [];
      boxes.forEach((b) => {
        if (!b) return;
        const el = document.createElement("div");
        el.className = "dp3-textbox";
        if (b.id === DP3_SELECTED_ID) el.classList.add("selected");
        el.dataset.id = b.id;
        el.style.left = `${DP3_clamp01(b.x) * 100}%`;
        el.style.top = `${DP3_clamp01(b.y) * 100}%`;
        el.style.width = `${DP3_clamp01(b.w) * 100}%`;
        el.style.height = `${DP3_clamp01(b.h) * 100}%`;
        el.style.fontSize = `${b.fontSize || 14}px`;
        el.tabIndex = 0;

        el.innerHTML = `
          <div class="dp3-textbox-content">${(b.text || "").replace(/</g, "&lt;") || "<span class='dp3-textbox-placeholder'>Texte…</span>"}</div>
          <div class="dp3-resize-handle" title="Redimensionner"></div>
        `;
        overlay.appendChild(el);
      });

      setDeleteBtnEnabled(!!DP3_SELECTED_ID);
    }

    function saveAndRerender() {
      DP3_saveState(window.DP3_STATE);
      renderOverlay();
    }

    function selectBox(id) {
      DP3_SELECTED_ID = id;
      renderOverlay();
    }

    function clearSelection() {
      DP3_SELECTED_ID = null;
      renderOverlay();
    }

    function isEditingElement(el) {
      return !!el?.closest?.(".dp3-textbox")?.querySelector?.(".dp3-textbox-editor");
    }

    function openEditorForBox(boxEl) {
      const id = boxEl.dataset.id;
      const idx = DP3_findBoxIndexById(window.DP3_STATE, id);
      if (idx < 0) return;
      const b = window.DP3_STATE.textBoxes[idx];
      if (!b) return;
      const content = boxEl.querySelector(".dp3-textbox-content");
      if (!content) return;
      if (boxEl.querySelector(".dp3-textbox-editor")) return;

      const ta = document.createElement("textarea");
      ta.className = "dp3-textbox-editor";
      ta.value = b.text || "";
      ta.spellcheck = false;
      ta.style.fontSize = `${b.fontSize || 14}px`;

      content.innerHTML = "";
      content.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      const commit = () => {
        const newText = ta.value || "";
        window.DP3_STATE.textBoxes[idx].text = newText;
        DP3_saveState(window.DP3_STATE);
        renderOverlay();
      };

      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          ta.blur();
        }
        e.stopPropagation();
      });
      ta.addEventListener("blur", () => commit());
    }

    function deleteSelectedBox() {
      if (!DP3_SELECTED_ID) return;
      const idx = DP3_findBoxIndexById(window.DP3_STATE, DP3_SELECTED_ID);
      if (idx < 0) return;
      window.DP3_STATE.textBoxes.splice(idx, 1);
      DP3_SELECTED_ID = null;
      saveAndRerender();
    }

    function bindDragAndResize() {
      const overlay = modal.querySelector("#dp3-overlay");
      if (!overlay) return;

      let active = null; // { mode, id, startX, startY, startBox, overlayW, overlayH }

      function getOverlayMetrics() {
        const w = overlay.clientWidth || 1;
        const h = overlay.clientHeight || 1;
        return { w, h };
      }

      function onPointerMove(e) {
        if (!active) return;
        const state = window.DP3_STATE;
        const idx = DP3_findBoxIndexById(state, active.id);
        if (idx < 0) return;
        const b = state.textBoxes[idx];

        const dx = (e.clientX - active.startX) / active.overlayW;
        const dy = (e.clientY - active.startY) / active.overlayH;

        if (active.mode === "drag") {
          const newX = DP3_clamp01(active.startBox.x + dx);
          const newY = DP3_clamp01(active.startBox.y + dy);
          // clamp max pour éviter dépassement de la boîte
          b.x = DP3_clamp01(Math.min(newX, 1 - b.w));
          b.y = DP3_clamp01(Math.min(newY, 1 - b.h));
        } else if (active.mode === "resize") {
          const minW = 0.12;
          const minH = 0.06;
          const newW = Math.max(minW, DP3_clamp01(active.startBox.w + dx));
          const newH = Math.max(minH, DP3_clamp01(active.startBox.h + dy));
          b.w = Math.min(newW, 1 - b.x);
          b.h = Math.min(newH, 1 - b.y);
        }
        DP3_saveState(state);
        renderOverlay();
      }

      function onPointerUp() {
        if (!active) return;
        active = null;
        try {
          window.removeEventListener("pointermove", onPointerMove, true);
          window.removeEventListener("pointerup", onPointerUp, true);
        } catch (_) {}
      }

      overlay.addEventListener("pointerdown", (e) => {
        const tb = e.target.closest(".dp3-textbox");
        if (!tb) {
          clearSelection();
          return;
        }
        if (isEditingElement(tb)) return;

        const id = tb.dataset.id;
        if (!id) return;
        selectBox(id);

        const isResize = e.target.classList?.contains?.("dp3-resize-handle");
        const mode = isResize ? "resize" : "drag";

        const state = window.DP3_STATE;
        const idx = DP3_findBoxIndexById(state, id);
        if (idx < 0) return;

        const { w: overlayW, h: overlayH } = getOverlayMetrics();
        active = {
          mode,
          id,
          startX: e.clientX,
          startY: e.clientY,
          overlayW,
          overlayH,
          startBox: {
            x: state.textBoxes[idx].x,
            y: state.textBoxes[idx].y,
            w: state.textBoxes[idx].w,
            h: state.textBoxes[idx].h,
          },
        };

        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        e.preventDefault();
      });

      overlay.addEventListener("dblclick", (e) => {
        const tb = e.target.closest(".dp3-textbox");
        if (!tb) return;
        if (isEditingElement(tb)) return;
        selectBox(tb.dataset.id);
        openEditorForBox(tb);
        e.preventDefault();
      });

      overlay.addEventListener("click", (e) => {
        const tb = e.target.closest(".dp3-textbox");
        if (!tb) return;
        if (isEditingElement(tb)) return;
        selectBox(tb.dataset.id);
      });
    }

    function bindUI() {
      // init champs
      const selOrientation = modal.querySelector("#dp3-installation-orientation");
      const panelSelect = modal.querySelector("#dp3-panel-select");

      if (selOrientation) {
        const current = window.DP3_STATE.installationOrientation;
        selOrientation.value = current === "paysage" ? "paysage" : "portrait";
        selOrientation.addEventListener("change", () => {
          const v = selOrientation.value;
          window.DP3_STATE.installationOrientation = v === "paysage" ? "paysage" : "portrait";
          DP3_saveState(window.DP3_STATE);
        });
      }

      function syncDP3PanelMetadataUI() {
        const manufacturerEl = modal.querySelector("#dp3-panel-manufacturer");
        const referenceEl = modal.querySelector("#dp3-panel-reference");
        const powerEl = modal.querySelector("#dp3-panel-power");
        const dimensionsEl = modal.querySelector("#dp3-panel-dimensions");
        if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

        const model = window.DP3_STATE?.module || null;
        if (!model) {
          manufacturerEl.textContent = "—";
          referenceEl.textContent = "—";
          powerEl.textContent = "—";
          dimensionsEl.textContent = "—";
          return;
        }

        manufacturerEl.textContent = model.manufacturer || "—";
        referenceEl.textContent = model.reference || "—";
        powerEl.textContent = typeof model.power_w === "number" ? `${model.power_w} Wc` : "—";
        const h = typeof model.height_m === "number" ? model.height_m.toFixed(2) : null;
        const w = typeof model.width_m === "number" ? model.width_m.toFixed(2) : null;
        dimensionsEl.textContent = h && w ? `${h} × ${w} m` : "—";
      }

      // Modules PV (DP3) — catalogue API (identique DP2), stockage DP3_STATE.module
      if (panelSelect) {
        dpEnsurePvPanelsLoaded()
          .then((cache) => {
            window.DP3_STATE.module = dpReconcilePanelModel(window.DP3_STATE.module, cache);
            DP3_saveState(window.DP3_STATE);
            const selId = window.DP3_STATE.module?.panel_id || null;
            dpPopulatePvPanelSelectOptions(panelSelect, selId);
            syncDP3PanelMetadataUI();

            if (panelSelect.dataset.dpPvPanelBound !== "1") {
              panelSelect.dataset.dpPvPanelBound = "1";
              panelSelect.addEventListener("change", (e) => {
                const value = e.target?.value || "";
                window.DP3_STATE.module = dpModelFromPanelSelectValue(value);
                DP3_saveState(window.DP3_STATE);
                syncDP3PanelMetadataUI();
              });
            }
          })
          .catch(() => {
            dpPopulatePvPanelSelectOptions(panelSelect, null);
            syncDP3PanelMetadataUI();
          });
      }

      const btnAdd = modal.querySelector("#dp3-add-textbox");
      if (btnAdd) {
        btnAdd.addEventListener("click", () => {
          const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
          const fontSize = getFontSizeFromUI();
          const newBox = {
            id,
            x: 0.35,
            y: 0.35,
            w: 0.3,
            h: 0.12,
            text: "",
            fontSize,
          };
          window.DP3_STATE.textBoxes = window.DP3_STATE.textBoxes || [];
          window.DP3_STATE.textBoxes.push(newBox);
          DP3_SELECTED_ID = id;
          saveAndRerender();
        });
      }

      const selFont = modal.querySelector("#dp3-fontsize");
      if (selFont) {
        selFont.addEventListener("change", () => {
          const fs = getFontSizeFromUI();
          if (!DP3_SELECTED_ID) return;
          const idx = DP3_findBoxIndexById(window.DP3_STATE, DP3_SELECTED_ID);
          if (idx < 0) return;
          window.DP3_STATE.textBoxes[idx].fontSize = fs;
          saveAndRerender();
        });
      }

      if (modal.dataset.dp3DeleteCaptureBound !== "1") {
        modal.dataset.dp3DeleteCaptureBound = "1";
        modal.addEventListener(
          "click",
          function dp3DeleteBtnCapture(e) {
            const raw = e.target;
            const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
            const del = el && el.closest("#dp3-delete-textbox");
            if (!del || del.disabled) return;
            e.preventDefault();
            deleteSelectedBox();
          },
          true
        );
      }

      const btnCancel = modal.querySelector("#dp3-editor-cancel");
      const btnValidate = modal.querySelector("#dp3-editor-validate");
      if (btnCancel) btnCancel.addEventListener("click", () => DP3_closeEditor());
      if (btnValidate) {
        btnValidate.addEventListener("click", () => {
          window.DP3_STATE.hasDP3 = true;
          window.DP3_STATE.validatedAt = Date.now();
          DP3_saveState(window.DP3_STATE);
          if (typeof window.__snDpAfterDp3Validated === "function") {
            try {
              window.__snDpAfterDp3Validated();
            } catch (errDp) {
              console.warn("[DP3] draft hook", errDp);
            }
          }
          DP3_closeEditor(true);
        });
      }
    }

    function bindDeleteKey() {
      if (DP3_EDITOR_KEY_HANDLER) return;
      DP3_EDITOR_KEY_HANDLER = (e) => {
        if (!DP3_EDITOR_OPEN) return;
        if (!DP3_SELECTED_ID) return;
        const editor = modal.querySelector(".dp3-textbox-editor");
        if (editor) return; // pas de suppression quand on édite
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          deleteSelectedBox();
        }
      };
      window.addEventListener("keydown", DP3_EDITOR_KEY_HANDLER, true);
    }

    DP3_bindModalCloseHandlers(modalId, () => DP3_closeEditor());

    // init editor state
    DP3_SELECTED_ID = null;
    DP3_EDITOR_OPEN = true;
    bindUI();
    bindDragAndResize();
    bindDeleteKey();
    renderOverlay();

    DP3_showModal(modalId);
  }

  function DP3_closeEditor(wasValidated) {
    const modalId = "dp3-editor-modal";
    const modal = document.getElementById(modalId);
    if (!modal) return;

    DP3_EDITOR_OPEN = false;
    if (DP3_EDITOR_KEY_HANDLER) {
      try {
        window.removeEventListener("keydown", DP3_EDITOR_KEY_HANDLER, true);
      } catch (_) {}
      DP3_EDITOR_KEY_HANDLER = null;
    }
    DP3_hideModal(modalId);
    modal.remove();

    if (wasValidated) {
      DP3_renderHome();
    }
  }

  window.initDP3 = function initDP3() {
    const root = document.getElementById("dp3-root");
    if (!root) return;

    window.DP3_STATE = DP3_ensureState();

    try {
      if (window.snDpV && typeof window.snDpV.migrateKind === "function") {
        window.snDpV.migrateKind("dp3");
      }
      if (typeof window.snDpVSetupPageUi === "function") {
        window.snDpVSetupPageUi("dp3", {
          onAfter: function () {
            try {
              if (typeof window.DP3_renderHome === "function") window.DP3_renderHome();
            } catch (_) {}
          },
        });
      }
    } catch (_) {}

    // Bind boutons
    const btnCreate = document.getElementById("dp3-create-btn");
    const btnImport = document.getElementById("dp3-import-btn");
    const btnDownload = document.getElementById("dp3-download-btn");

    if (btnCreate) {
      btnCreate.addEventListener("click", () => {
        console.log("DP3_CLICK");
        DP3_openTypeModal();
      });
    }
    if (btnImport) {
      btnImport.addEventListener("click", () => console.log("DP3 import stub"));
    }
    if (btnDownload) {
      btnDownload.addEventListener("click", () => DP3_downloadPDF());
    }

    // Bind carte add
    const cardAdd = document.getElementById("dp3-card-add");
    const fileInput = document.getElementById("dp3-file-input");
    if (cardAdd && fileInput) {
      const trigger = () => fileInput.click();
      cardAdd.addEventListener("click", trigger);
      const box = cardAdd.querySelector(".dp-upload-box");
      if (box) {
        box.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") trigger();
        });
      }

      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        window.DP3_STATE.manualImageName = file.name;
        DP3_saveState(window.DP3_STATE);
        DP3_renderHome();
      });
    }

    // Preview click => si DP3 déjà configurée, ouvrir éditeur pour ajustements
    const cardPreview = document.getElementById("dp3-card-preview");
    if (cardPreview) {
      cardPreview.addEventListener("click", () => {
        if (window.DP3_STATE && window.DP3_STATE.baseImage) DP3_openEditor();
      });
    }

    DP3_renderHome();
  };

  window.DP3_renderHome = DP3_renderHome;
})();
