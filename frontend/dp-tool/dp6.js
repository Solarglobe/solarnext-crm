// Extracted from dp-app.js. Loaded after dp-app.js in legacy script order.
// ======================================================
function initDP4() {
  const btnBefore = document.getElementById("dp4-create-before");
  const btnAfter = document.getElementById("dp4-create-after");
  const legacyBtn = document.getElementById("dp4-create");
  const modal = document.getElementById("dp4-map-modal");
  if ((!btnBefore && !btnAfter && !legacyBtn) || !modal) return;

  // Charger l'état DP4 (2 plans) au montage de la page
  dp4EnsureStateLoadedOnce();
  try {
    if (window.snDpV && typeof window.snDpV.migrateKind === "function") {
      window.snDpV.migrateKind("dp4");
    }
    if (typeof window.snDpVSetupPageUi === "function") {
      window.snDpVSetupPageUi("dp4", {
        onAfter: function () {
          try {
            dp4RenderEntryMiniatures();
          } catch (_) {}
        },
      });
    }
  } catch (_) {}
  dp4RenderEntryMiniatures();
  try { initDP4_UIStates(); } catch (_) {}

  // Anti double-binding (lié au DOM injecté)
  const bindKeyHost = btnBefore || btnAfter || legacyBtn;
  if (bindKeyHost && bindKeyHost.dataset.bound === "1") return;
  if (bindKeyHost) bindKeyHost.dataset.bound = "1";

  // Références DOM (overlay DP4)
  const titleEl = modal.querySelector(".dp-modal-title-solarglobe");
  const bodyEl = modal.querySelector(".dp-modal-body");
  const validateBtn = document.getElementById("dp4-map-validate");

  // Sauvegarde du "template" de l'étape carte (pour pouvoir la restaurer si besoin)
  const DP4_MODAL_TITLE_INITIAL = titleEl ? titleEl.textContent : "DP4 — Plan des toitures / implantation photovoltaïque";
  const DP4_MODAL_BODY_INITIAL_HTML = bodyEl ? bodyEl.innerHTML : "";

  function dp4SetValidateVisible(visible) {
    // Visible uniquement quand la carte est chargée (idle), sinon caché.
    if (!validateBtn) return;
    validateBtn.style.display = visible ? "" : "none";
  }

  function dp4SetValidateEnabled(enabled) {
    if (!validateBtn) return;
    validateBtn.disabled = !enabled;
  }

  function dp4GetProjectCenter() {
    return dpGetProjectCenterForGoogleMaps();
  }

  function dp4ResetMapContainer() {
    const el = document.getElementById("dp4-ign-map");
    if (!el) return null;
    const parent = el.parentNode;
    if (!parent) return el;
    const fresh = document.createElement("div");
    fresh.id = "dp4-ign-map";
    fresh.className = "dp-map";
    parent.replaceChild(fresh, el);
    return fresh;
  }

  function dp4DestroyMap() {
    dp4RemoveScreenOverlayCanvas();
    if (window.DP4_OL_MAP) {
      try {
        window.DP4_OL_MAP.setTarget(null);
      } catch (_) {}
      window.DP4_OL_MAP = null;
    }
    dp4ResetMapContainer();
  }

  function dp4RenderMapStep() {
    // Restaure l'étape "carte" (OpenLayers IGN ORTHO) si on a déjà basculé sur une autre vue.
    dp4RestoreMovedDP2Ui();
    if (titleEl) titleEl.textContent = DP4_MODAL_TITLE_INITIAL;
    if (bodyEl && !bodyEl.querySelector("#dp4-ign-map")) {
      bodyEl.innerHTML = DP4_MODAL_BODY_INITIAL_HTML;
    }
    dp4SetValidateVisible(false);
    dp4SetValidateEnabled(true);
    const importBtn = document.getElementById("dp4-import-dp2-btn");
    if (importBtn) {
      importBtn.style.display = window.DP4_STATE?.photoCategory === "before" ? "" : "none";
    }
    // Menu gauche DP4 (copie DP2) : binds + affichages passifs
    try { initDP4MetadataUI(); } catch (_) {}
    try { syncDP4LegendOverlayUI(); } catch (_) {}
  }

  // -----
  // DP4 (toiture) : réutiliser la toolbar DP2 SANS la dupliquer.
  // Stratégie :
  // - si une toolbar DP2 existe déjà ailleurs dans le DOM, on la "déplace" temporairement dans l'overlay DP4,
  //   puis on la restaure à la fermeture (évite doublons d'IDs).
  // - sinon, on extrait le HTML source depuis pages/dp2.html (source de vérité), puis on appelle initDP2Toolbar().
  // -----
  let dp4MovedDP2Ui = null;

  function dp4RestoreMovedDP2Ui() {
    if (!dp4MovedDP2Ui) return;
    const { toolbarEl, toolbarParent, toolbarNext, actionsEl, actionsParent, actionsNext } = dp4MovedDP2Ui;
    try {
      if (toolbarEl && toolbarParent) {
        toolbarParent.insertBefore(toolbarEl, toolbarNext || null);
      }
    } catch (_) {}
    try {
      if (actionsEl && actionsParent) {
        actionsParent.insertBefore(actionsEl, actionsNext || null);
      }
    } catch (_) {}
    dp4MovedDP2Ui = null;
  }

  async function dp4EnsureDP2ToolbarAndActionsMounted() {
    if (!bodyEl) return { createdToolbar: false, createdActions: false };
    const wrap = bodyEl.querySelector("#dp2-captured-image-wrap");
    if (!wrap) return { createdToolbar: false, createdActions: false };

    const zoom = wrap.querySelector("#dp2-zoom-container");
    const insertBeforeEl = zoom || null;

    // Déjà monté dans l'overlay
    if (wrap.querySelector("#dp2-toolbar") && wrap.querySelector("#dp2-draw-actions")) {
      return { createdToolbar: false, createdActions: false };
    }

    // 1) Si DP2 toolbar existe déjà ailleurs, on la déplace temporairement (évite doublons d'IDs).
    const existingToolbar = document.getElementById("dp2-toolbar");
    const existingActions = document.getElementById("dp2-draw-actions");

    const moved = { toolbarEl: null, toolbarParent: null, toolbarNext: null, actionsEl: null, actionsParent: null, actionsNext: null };
    let didMove = false;

    if (existingToolbar && !wrap.contains(existingToolbar)) {
      moved.toolbarEl = existingToolbar;
      moved.toolbarParent = existingToolbar.parentNode;
      moved.toolbarNext = existingToolbar.nextSibling;
      try {
        wrap.insertBefore(existingToolbar, insertBeforeEl);
        didMove = true;
      } catch (_) {}
    }
    if (existingActions && !wrap.contains(existingActions)) {
      moved.actionsEl = existingActions;
      moved.actionsParent = existingActions.parentNode;
      moved.actionsNext = existingActions.nextSibling;
      try {
        wrap.insertBefore(existingActions, insertBeforeEl);
        didMove = true;
      } catch (_) {}
    }

    if (didMove) {
      dp4MovedDP2Ui = moved;
      return { createdToolbar: false, createdActions: false };
    }

    // 2) Sinon : extraire depuis pages/dp2.html (source unique du HTML toolbar).
    let createdToolbar = false;
    let createdActions = false;
    try {
      const res = await fetch(__solarnextDpResolveAssetUrl("pages/dp2.html"), { cache: "no-store" });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const toolbarTpl = doc.getElementById("dp2-toolbar");
      const actionsTpl = doc.getElementById("dp2-draw-actions");

      if (toolbarTpl && !wrap.querySelector("#dp2-toolbar")) {
        const toolbarNode = document.importNode(toolbarTpl, true);
        wrap.insertBefore(toolbarNode, insertBeforeEl);
        createdToolbar = true;
      }
      if (actionsTpl && !wrap.querySelector("#dp2-draw-actions")) {
        const actionsNode = document.importNode(actionsTpl, true);
        wrap.insertBefore(actionsNode, insertBeforeEl);
        createdActions = true;
      }
    } catch (e) {
      console.warn("[DP4] Impossible de monter la toolbar DP2 depuis pages/dp2.html", e);
    }

    return { createdToolbar, createdActions };
  }

  function dp4RenderRoofDrawingStep() {
    // Nouvelle étape DP4 (même overlay) : "DP4 — Dessin de toiture"
    if (titleEl) titleEl.textContent = "DP4 — Dessin de toiture";
    dp4SetValidateVisible(false);
    dp4SetValidateEnabled(true);
    const importBtn = document.getElementById("dp4-import-dp2-btn");
    if (importBtn) importBtn.style.display = "none";

    if (!bodyEl) return;

    // Même structure visuelle que la carte (colonne aide + zone canvas).
    // IMPORTANT : on réutilise le moteur DP2 (canvas) avec un profil DP4_ROOF.
    bodyEl.innerHTML = `
      <aside class="dp-map-help dp2-settings-rail" id="dp4-settings-panel">
        <section class="card dp2-settings-card" aria-labelledby="dp4-roof-heading-plan">
          <h3 class="dp2-card-heading" id="dp4-roof-heading-plan">Paramètres du plan</h3>
          <span id="dp4-scale" hidden></span>
          <div class="dp2-field">
            <div class="dp2-label">Hauteur de vue</div>
            <div class="dp2-panel-readonly">
              <span id="dp4-view-height">Hauteur de vue : —</span>
            </div>
          </div>
          <div class="dp2-field">
            <label class="dp2-label" for="dp4-photo-category">Catégorie</label>
            <select id="dp4-photo-category" class="dp2-select">
              <option value="">— Sélectionner —</option>
              <option value="before">Avant travaux</option>
              <option value="after">Après travaux</option>
            </select>
          </div>
        </section>

        <section class="card dp2-settings-card" aria-labelledby="dp4-roof-heading-pv">
          <h3 class="dp2-card-heading" id="dp4-roof-heading-pv">Module photovoltaïque</h3>
          <div class="dp2-field">
            <label class="dp2-label" for="dp4-panel-select">Module</label>
            <select id="dp4-panel-select" class="dp2-select">
              <option value="">— Sélectionner un module —</option>
            </select>
          </div>
        </section>

        <section class="card dp2-settings-card" aria-labelledby="dp4-roof-heading-roof">
          <h3 class="dp2-card-heading" id="dp4-roof-heading-roof">Type de toit</h3>
          <div class="dp2-field">
            <label class="dp2-label" for="dp4-roof-type">Type</label>
            <select id="dp4-roof-type" class="dp2-select">
              <option value="">— Sélectionner —</option>
              <option value="tuile">tuile</option>
              <option value="ardoise">ardoise</option>
              <option value="bac_acier">Bac acier</option>
              <option value="autre">autre</option>
            </select>
          </div>
        </section>

        <section class="card dp2-settings-card" aria-labelledby="dp4-roof-heading-legend">
          <h3 class="dp2-card-heading" id="dp4-roof-heading-legend">Légende</h3>
          <div class="dp2-field dp2-legend-field">
            <div id="dp4-legend-empty" class="dp2-legend-empty" hidden>
              Aucun objet métier sur le plan.
            </div>
            <div id="dp4-legend-list" class="dp2-legend-list" aria-label="Légende du plan"></div>
          </div>
        </section>

        <section class="card dp2-settings-card" aria-labelledby="dp4-roof-heading-final">
          <h3 class="dp2-card-heading" id="dp4-roof-heading-final">Finalisation</h3>
          <div class="dp2-field">
            <button class="dp-btn dp-btn-primary" type="button" id="dp4-finalize-plan">
              Valider le plan
            </button>
            <div class="dp-hint" style="margin-top: 8px;">
              Le rendu final supprime le fond satellite et normalise les traits (gris/noir).
            </div>
          </div>
        </section>
      </aside>

      <div class="dp-map-canvas" style="position: relative;">
          <!-- DP2 engine mount (IDs DP2, dédiés à cette page DP4) -->
          <div id="dp2-captured-image-wrap" style="display:block; position:absolute; inset:0;">
            <!-- DP2 toolbar + draw actions (HTML réutilisé depuis pages/dp2.html) -->
            <div id="dp2-zoom-container" style="position:relative; transform-origin:50% 50%;">
              <img id="dp2-captured-image" alt="Toiture capturée" style="pointer-events:none;" />
              <canvas id="dp2-draw-canvas" style="pointer-events:auto; z-index:2;"></canvas>
            </div>
          </div>
        </div>
    `;

    // Monter la toolbar DP2 (DOM) puis initialiser la logique DP2 standard.
    // Remarque : initDP2Toolbar() suppose que le DOM existe déjà.
    dp4EnsureDP2ToolbarAndActionsMounted().then(({ createdToolbar }) => {
      try {
        if (createdToolbar) initDP2Toolbar();
        else if (typeof dp2SyncDp4RoofMeasuresMenuVisibility === "function") dp2SyncDp4RoofMeasuresMenuVisibility();
      } catch (_) {}
      try {
        initDP2DrawActions();
      } catch (_) {}
    });

    // Ortho toiture : DP4_STATE uniquement (capture_ortho). Ne pas recopier sur DP2_STATE.capture (plan masse).
    window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
    window.DP4_STATE.capture = window.DP4_STATE.capture || { imageBase64: null };
    window.DP4_STATE.capture_ortho = window.DP4_STATE.capture_ortho || { imageBase64: null };
    if (window.DP4_CAPTURE_IMAGE) {
      window.DP4_STATE.capture_ortho.imageBase64 = window.DP4_CAPTURE_IMAGE;
      window.DP4_STATE.capture.imageBase64 = window.DP4_CAPTURE_IMAGE;
    }

    window.DP2_STATE = dp4BeginEditorSession(window.DP4_STATE?.photoCategory ?? null);
    window.DP2_STATE.mode = "EDITION";
    const orthoRoof = typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : window.DP4_STATE.capture;
    window.DP2_STATE.scale_m_per_px =
      typeof orthoRoof?.scale_m_per_px === "number" && orthoRoof.scale_m_per_px > 0 ? orthoRoof.scale_m_per_px : null;
    window.DP2_STATE.photoCategory = window.DP4_STATE?.photoCategory ?? null;
    window.DP2_STATE.panelModel = window.DP4_STATE?.panelModel ?? null;

    const cat = window.DP4_STATE?.photoCategory ?? null;
    const stateCat = window.DP4_STATE?.[cat] || null;
    if ((cat === "before" || cat === "after") && stateCat) {
      dp4ApplyDp4CategoryGeometryToDp2Editor(cat);
    } else {
      window.DP2_STATE.features = [];
      window.DP2_STATE.objects = [];
      try {
        dp2RebuildContourDisplayCacheFromFeatures();
      } catch (_) {}
    }

    // Conserver le flow DP4 existant comme défaut
    window.DP2_STATE.currentTool = window.DP2_STATE.currentTool || "building_outline";
    window.DP2_STATE.selectedObjectId = null;
    window.DP2_STATE.selectedBusinessObjectId = null;
    window.DP2_STATE.selectedPanelId = null;
    window.DP2_STATE.selectedPanelIds = [];
    window.DP2_STATE.selectedTextId = null;
    window.DP2_STATE.selectedTextIds = [];
    window.DP2_STATE.drawingPreview = null;
    window.DP2_STATE.measureLineStart = null;
    window.DP2_STATE.ridgeLineStart = null;
    window.DP2_STATE.gutterHeightDrag = null;
    window.DP2_STATE.gutterHeightVisualScaleDrag = null;

    // Bind UI paramètres DP4 (menu gauche)
    try { initDP4MetadataUI(); } catch (_) {}
    try { syncDP4LegendOverlayUI(); } catch (_) {}

    const imgEl = document.getElementById("dp2-captured-image");
    if (imgEl) {
      imgEl.onload = function () {
        try { initDP2Editor(); } catch (_) {}
        // UI seulement : reflète la hauteur réelle (px) et l'échelle figée (m/px)
        try { syncDP4ScaleUI(); } catch (_) {}
        try { syncDP4ViewHeightUI(); } catch (_) {}
        try { syncDP4MetricMarkerOverlayUI(); } catch (_) {}
      };
      imgEl.src = (typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : window.DP4_STATE?.capture)?.imageBase64 || "";
    }

    // Bind "Valider le plan" (sans modal, sans confirmation)
    try {
      const finalizeBtn = document.getElementById("dp4-finalize-plan");
      if (finalizeBtn && finalizeBtn.dataset.bound !== "1") {
        finalizeBtn.dataset.bound = "1";
        finalizeBtn.addEventListener("click", async (e) => {
          e.preventDefault();

          const cat = window.DP4_STATE?.photoCategory ?? window.DP2_STATE?.photoCategory ?? null;
          if (cat !== "before" && cat !== "after") return;
          if (dp4IsFinalized(cat)) {
            // déjà finalisé => fermeture immédiate (retour écran parent)
            try { await dp4CloseModal(); } catch (_) {}
            return;
          }

          finalizeBtn.disabled = true;
          try {
            try { dp4SyncRoofGeometryFromDP2State(); } catch (_) {}
            // ✅ DP4 : persister le plan complet (géométrie + panneaux + objets + historique)
            // Nécessaire pour permettre "Importer Avant Travaux"
            try {
              if (typeof dp4SaveActivePlanToSelectedCategory === "function") {
                await dp4SaveActivePlanToSelectedCategory();
              }
            } catch (_) {}
            try {
              console.log("[DP4] plan saved:", cat, "plans.before?", !!window.DP4_STATE?.plans?.before, "plans.after?", !!window.DP4_STATE?.plans?.after);
            } catch (_) {}
            const finalImg = await dp4BuildFinalRenderImageBase64FromCurrentDom();
            if (typeof finalImg === "string" && finalImg.startsWith("data:image")) {
              dp4SetFinalRenderFor(cat, finalImg);
              try {
                if (window.DP4_STATE?.plans?.[cat]) {
                  window.DP4_STATE.plans[cat].thumbnailBase64 = finalImg;
                  window.DP4_STATE.plans[cat].savedAt = Date.now();
                  if (typeof dp4SaveState === "function") dp4SaveState(window.DP4_STATE);
                }
              } catch (_) {}
              // Rafraîchir les miniatures (la page derrière le modal peut se mettre à jour)
              try { dp4RenderEntryMiniatures(); } catch (_) {}
              // Fermer automatiquement l'overlay DP4 (retour écran parent)
              try { await dp4CloseModal(); } catch (_) {}
            }
          } finally {
            try { finalizeBtn.disabled = false; } catch (_) {}
          }
        });
      }
    } catch (_) {}
  }

  function dp4RenderFinalPreviewStep(imageBase64, category) {
    // Étape "rendu final" : lecture seule (plus modifiable visuellement)
    if (titleEl) titleEl.textContent = "DP4 — Rendu final";
    dp4SetValidateVisible(false);
    dp4SetValidateEnabled(true);
    const importBtn = document.getElementById("dp4-import-dp2-btn");
    if (importBtn) importBtn.style.display = "none";
    if (!bodyEl) return;

    const catLabel =
      category === "before" ? "Avant travaux" : category === "after" ? "Après travaux" : "—";

    bodyEl.innerHTML = `
      <aside class="dp-map-help dp2-settings-rail" id="dp4-final-panel">
        <section class="card dp2-settings-card" aria-labelledby="dp4-final-heading">
          <h3 class="dp2-card-heading" id="dp4-final-heading">Plan finalisé</h3>
          <div class="dp2-field">
            <div class="dp2-panel-readonly">
              <div>Catégorie : <strong>${catLabel}</strong></div>
              <div>Fond blanc, traits normalisés (gris/noir).</div>
            </div>
          </div>
        </section>
      </aside>
      <div class="dp-map-canvas" style="position: relative;">
        <div style="position:absolute; inset:0; background:#fff; display:flex; align-items:center; justify-content:center;">
          <img
            alt="DP4 — rendu final"
            src="${imageBase64}"
            style="max-width:100%; max-height:100%; object-fit:contain; background:#fff;"
          />
        </div>
      </div>
    `;
  }

  async function dp4CloseModal() {
    // Ne plus auto-sauvegarder à la fermeture : la sauvegarde DP4 est explicite (bouton "Valider le plan" uniquement).

    try {
      dp4HideMapCursorHint();
    } catch (_) {}
    dp4RestoreMovedDP2Ui();
    modal.setAttribute("aria-hidden", "true");
    dp4SetValidateVisible(false);
    dp4DestroyMap();
    if (document.activeElement) {
      document.activeElement.blur();
    }
    // 🔒 Nettoyage complet runtime
    window.DP4_CAPTURE_IMAGE = null;

    dp4RestoreRealDp2StateAfterEditorSession();

  }

  async function dp4CaptureMapContainer() {
    // Capture OpenLayers puis transformation une seule fois (repère pixels = image capturée).
    // Tant que la capture n’est pas valide : ne pas détruire la carte ni passer à l’étape toiture.
    if (!window.DP4_OL_MAP) return;

    dp4SetValidateEnabled(false);
    let helperLayers = null;

    try {
      const map = window.DP4_OL_MAP;
      const mapEl = map.getTargetElement();
      if (!mapEl) {
        console.error("[DP4] capture: mapEl absent");
        window.__snDpAlert("Capture DP4 impossible : carte non affichée.");
        return;
      }

      const size = map.getSize();
      if (!size || size[0] <= 0 || size[1] <= 0) {
        console.error("[DP4] capture: taille carte invalide", size);
        window.__snDpAlert("Capture DP4 impossible : taille de la carte invalide.");
        return;
      }

      helperLayers = dp4SetMapHelperLayersVisibleForCapture(map, false);
      await dp4WaitOrthoTilesIdle(map, 5200);
      await new Promise((r) => setTimeout(r, 120));
      try {
        map.renderSync();
      } catch (_) {}

      const canvas = document.createElement("canvas");
      canvas.width = size[0];
      canvas.height = size[1];
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        dp4RestoreMapHelperLayersAfterCapture(helperLayers);
        console.error("[DP4] capture: contexte 2D absent");
        window.__snDpAlert("Capture DP4 impossible.");
        return;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size[0], size[1]);
      ctx.restore();

      const canvases = mapEl.querySelectorAll(".ol-layer canvas");
      canvases.forEach((c) => {
        if (c.width > 0 && c.height > 0) {
          ctx.save();
          const opacity = c.parentNode && c.parentNode.style ? c.parentNode.style.opacity : "";
          ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
          const transform = c.style.transform;
          if (transform) {
            const m = transform.match(/^matrix\(([^)]*)\)$/);
            if (m) {
              const matrix = m[1].split(",").map(Number);
              if (matrix.length >= 6 && matrix.every(Number.isFinite)) {
                ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
              }
            }
          }
          ctx.drawImage(c, 0, 0);
          ctx.restore();
        }
      });

      if (dp4RasterCompositeProbablyBlank(ctx, size[0], size[1])) {
        dp4RestoreMapHelperLayersAfterCapture(helperLayers);
        console.error("[DP4] capture: image vide ou grise (tuiles non prêtes ?)");
        window.__snDpAlert("La capture est vide ou encore grise. Attendez le chargement des images puis réessayez.");
        return;
      }

      dp4RestoreMapHelperLayersAfterCapture(helperLayers);
      const imageBase64 = canvas.toDataURL("image/png");
      const view = map.getView();
      const scale_m_per_px = ol.proj.getPointResolution(
        view.getProjection(),
        view.getResolution(),
        view.getCenter(),
        "m"
      );

      window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
      const captureOrthoPayload = {
        imageBase64,
        center: view.getCenter(),
        zoom: view.getZoom(),
        rotation: view.getRotation(),
        resolution: view.getResolution(),
        width: size[0],
        height: size[1],
        capturedAt: Date.now(),
        scale_m_per_px
      };
      window.DP4_STATE.capture_ortho = captureOrthoPayload;
      window.DP4_STATE.capture = dp2CloneForHistory(captureOrthoPayload);

      const okGeom = dp4TransformDP2GeometryToMapPixels(null, map);
      if (!okGeom) return;

      window.DP4_CAPTURE_IMAGE = imageBase64;
      try {
        const cat = window.DP4_STATE?.photoCategory ?? null;
        if (cat === "before" || cat === "after") {
          window.DP4_STATE.plans = window.DP4_STATE.plans || { before: null, after: null };
          const stateCat = window.DP4_STATE[cat] || {
            roofGeometry: [],
            panels: [],
            textObjects: [],
            businessObjects: [],
            history: []
          };
          const orthoForPlan =
            (typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : window.DP4_STATE.capture) || captureOrthoPayload;
          window.DP4_STATE.plans[cat] = {
            photoCategory: cat,
            capture: dp2CloneForHistory(orthoForPlan),
            capture_ortho: dp2CloneForHistory(orthoForPlan),
            roofGeometry: dp2CloneForHistory(Array.isArray(stateCat.roofGeometry) ? stateCat.roofGeometry : []),
            roofType: window.DP4_STATE.roofType ?? null,
            scaleGraphicMeters: window.DP4_STATE.scaleGraphicMeters ?? null,
            panelModel: window.DP4_STATE.panelModel ?? null,
            panels: dp2CloneForHistory(Array.isArray(stateCat.panels) ? stateCat.panels : []),
            textObjects: dp2CloneForHistory(Array.isArray(stateCat.textObjects) ? stateCat.textObjects : []),
            businessObjects: dp2CloneForHistory(Array.isArray(stateCat.businessObjects) ? stateCat.businessObjects : []),
            history: dp2CloneForHistory(Array.isArray(stateCat.history) ? stateCat.history : []),
            thumbnailBase64: imageBase64,
            savedAt: Date.now(),
            dp4BaseFeatures: dp2CloneForHistory(Array.isArray(window.DP4_STATE.baseFeatures) ? window.DP4_STATE.baseFeatures : []),
            dp4MapOverlayPanels: dp2CloneForHistory(Array.isArray(window.DP4_STATE.panels) ? window.DP4_STATE.panels : [])
          };
          if (typeof dp4SaveState === "function") dp4SaveState(window.DP4_STATE);
          try { dp4RenderEntryMiniatures(); } catch (_) {}
        }
      } catch (_) {}
      try {
        syncDP4MetricMarkerOverlayUI();
      } catch (_) {}

      dp4DestroyMap();

      dp4RenderRoofDrawingStep();
    } catch (e) {
      dp4RestoreMapHelperLayersAfterCapture(helperLayers);
      console.error("[DP4] Capture impossible", e);
      window.__snDpAlert("Capture DP4 impossible (voir la console).");
    } finally {
      dp4SetValidateEnabled(true);
    }
  }

  function dp4OpenModal() {

    dp4CaptureRealDp2StateForEditorSession();

    modal.setAttribute("aria-hidden", "false");

    // Si le modal a déjà été fermé entre-temps, on stoppe.
    if (modal.getAttribute("aria-hidden") === "true") return;

    // Si un rendu final existe pour la catégorie active => lecture seule (pas d'édition)
    try {
      const cat = window.DP4_STATE?.photoCategory ?? window.DP2_STATE?.photoCategory ?? null;
      if (cat === "before" || cat === "after") {
        const v = dp4GetFinalRenderFor(cat);
        if (v?.imageBase64) {
          dp4RenderFinalPreviewStep(v.imageBase64, cat);
          return;
        }
      }
    } catch (_) {}

    // 🔒 Si aucun plan sauvegardé pour cette catégorie → ignorer toute capture runtime
    try {
      const cat = window.DP4_STATE?.photoCategory ?? null;
      const plan = cat === "before" || cat === "after"
        ? dp4GetStoredPlan(cat)
        : null;

      if (!plan) {
        window.DP4_CAPTURE_IMAGE = null;
      }
    } catch (_) {}

    // Si une capture existe déjà, on ne réutilise JAMAIS Google Maps :
    // l'image devient le fond figé pour l'étape de dessin.
    if (
      window.DP4_CAPTURE_IMAGE &&
      typeof window.DP4_CAPTURE_IMAGE === "string" &&
      window.DP4_CAPTURE_IMAGE.startsWith("data:image")
    ) {
      dp4RenderRoofDrawingStep();
      return;
    }

    // Étape 1 : vue OpenLayers IGN ORTHO (overlay uniquement)
    dp4RenderMapStep();

    if (modal.getAttribute("aria-hidden") === "true") return;

    const host = dp4ResetMapContainer() || document.getElementById("dp4-ign-map");
    if (!host) return;

    // Créer la map uniquement après que le modal soit visible (conteneur avec taille réelle)
    requestAnimationFrame(() => {
      dp4InitIgnOrthoMap(() => {
        if (modal.getAttribute("aria-hidden") === "true") return;
        dp4SetValidateVisible(true);
        try {
          dp4ShowMapCursorHint();
        } catch (_) {}
      });
      if (window.DP4_OL_MAP) {
        window.DP4_OL_MAP.updateSize();
        window.DP4_OL_MAP.renderSync();
      }
    });
  }

  window.dp4OpenModal = dp4OpenModal;

  function dp4OpenForCategory(category) {
    dp4ApplyStoredPlanToActive(category);
    dp4OpenModal();
  }

  if (btnBefore) {
    btnBefore.addEventListener("click", (e) => {
      e.preventDefault();
      dp4OpenForCategory("before");
    });
  }
  if (btnAfter) {
    btnAfter.addEventListener("click", (e) => {
      e.preventDefault();
      dp4OpenForCategory("after");
    });
  }
  document.getElementById("dp4-delete-before")?.addEventListener("click", () => {
    dp4DeletePlan("before");
  });
  document.getElementById("dp4-delete-after")?.addEventListener("click", () => {
    dp4DeletePlan("after");
  });

  const importBtn = document.getElementById("dp4-import-before-into-after");
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = "1";
    importBtn.addEventListener("click", function () {
      dp4ImportBeforeIntoAfter();
    });
  }
  // Compat : si l'ancien bouton existe encore dans le DOM, il ouvre avec la catégorie courante (ou vide)
  if (legacyBtn && legacyBtn !== btnBefore && legacyBtn !== btnAfter) {
    legacyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp4OpenModal();
    });
  }

  const importDp2Btn = document.getElementById("dp4-import-dp2-btn");
  if (importDp2Btn && importDp2Btn.dataset.bound !== "1") {
    importDp2Btn.dataset.bound = "1";
    importDp2Btn.addEventListener("click", function (e) {
      e.preventDefault();
      dp4DrawFrozenDp2BeforeOverlay();
    });
  }

  // Capture (validation vue) : retirer l’aperçu → capture carte (tuiles + anti-gris) → transformation → destroy → toiture
  if (validateBtn && validateBtn.dataset.bound !== "1") {
    validateBtn.dataset.bound = "1";
    validateBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        dp4HideMapCursorHint();
      } catch (_) {}
      console.log("DP4_MAP_VALIDATED");

      await dp4CaptureMapContainer();
    });
  }

  // Fermeture identique DP1 : X / bouton Annuler
  modal.addEventListener("click", (e) => {
    if (e.target.closest(".dp-modal-close") || e.target.closest("#dp4-map-cancel")) {
      e.preventDefault();
      dp4CloseModal();
    }
  });
}

// ==================================================
// DP6 — INSERTION DU PROJET (INITIALISATION UI)
// ==================================================
function initDP6() {
  const page = document.getElementById("dp6-page");
  if (!page) return;

  window.DP6_STATE = window.DP6_STATE || {};
  window.DP6_UNDO_STACK = window.DP6_UNDO_STACK || [];

  const btnBefore = document.getElementById("dp6-create-before");
  const btnAfter = document.getElementById("dp6-create-after");
  const modal = document.getElementById("dp6-photo-modal");
  const streetBtn = document.getElementById("dp6-use-street");
  const uploadBtn = document.getElementById("dp6-use-upload");
  const useCurrentViewBtn = document.getElementById("dp6-use-current-view");
  const workspace = document.getElementById("dp6-photo-workspace");
  /** Alignée sur `dpLoadGoogleMapsJsOnce` (Street View Static + JS). */
  const DP6_GOOGLE_MAPS_API_KEY_STATIC = __snGoogleMapsPublicKey();
  const zoomInBtn = document.getElementById("dp6-zoom-in");
  const zoomOutBtn = document.getElementById("dp6-zoom-out");
  const zoomResetBtn = document.getElementById("dp6-zoom-reset");
  const zoomLabel = document.getElementById("dp6-zoom-label");
  const validateSelectionBtn = document.getElementById("dp6-validate-selection");
  const editSelectionBtn = document.getElementById("dp6-edit-selection");
  const revalidateSelectionBtn = document.getElementById("dp6-revalidate-selection");
  const validateBtn = document.getElementById("dp6-validate");
  const deleteBtn = document.getElementById("dp6-delete");
  const undoBtn = document.getElementById("dp6-undo");
  const panelSelect = document.getElementById("dp6-panel-select");
  const workflowHintEl = document.getElementById("dp6-workflow-hint");
  const orientationPortrait = document.getElementById("dp6-orientation-portrait");
  const orientationPaysage = document.getElementById("dp6-orientation-paysage");
  const categoryLabelEl = document.getElementById("dp6-photo-category-label");

  if (!modal || (!btnBefore && !btnAfter)) return;

  // ==============================
  // DP6 — ZOOM / PAN (VISUEL UNIQUEMENT)
  // - Transform CSS sur un "stage" (photo + overlays synchronisés)
  // - Ne modifie ni les coordonnées stockées, ni l’export PNG/PDF
  // ==============================

  const DP6_VIEW_MIN_SCALE = 1;
  const DP6_VIEW_MAX_SCALE = 4;

  const dp6View = { scale: 1, tx: 0, ty: 0 };

  function dp6GetStageEl() {
    if (!workspace) return null;
    return workspace.querySelector("#dp6-photo-stage");
  }

  function dp6UpdateZoomLabel() {
    if (!zoomLabel) return;
    const pct = Math.round((dp6View.scale || 1) * 100);
    zoomLabel.textContent = `${pct}%`;
  }

  function dp6ClampPanToBounds(next) {
    const s = typeof next?.scale === "number" ? next.scale : dp6View.scale;
    const tx = typeof next?.tx === "number" ? next.tx : dp6View.tx;
    const ty = typeof next?.ty === "number" ? next.ty : dp6View.ty;
    if (!workspace) return { scale: s, tx, ty };

    const r = workspace.getBoundingClientRect();
    const vw = Math.max(1, r.width);
    const vh = Math.max(1, r.height);

    if (s <= 1.000001) return { scale: 1, tx: 0, ty: 0 };

    // Le stage fait vw×vh en base. Après scale, sa taille devient vw*s×vh*s.
    // Clamp pour éviter d’afficher du "vide".
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

  function dp6ApplyViewTransform() {
    const stage = dp6GetStageEl();
    if (!stage) return;
    const { scale, tx, ty } = dp6ClampPanToBounds(dp6View);
    dp6View.scale = scale;
    dp6View.tx = tx;
    dp6View.ty = ty;
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    dp6UpdateZoomLabel();
  }

  function dp6ResetView() {
    dp6View.scale = 1;
    dp6View.tx = 0;
    dp6View.ty = 0;
    dp6ApplyViewTransform();
  }

  function dp6SetScaleAtClientPoint(nextScale, clientX, clientY) {
    if (!workspace) return;
    const r = workspace.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;

    const prevScale = dp6View.scale;
    const clampedScale = Math.max(DP6_VIEW_MIN_SCALE, Math.min(DP6_VIEW_MAX_SCALE, nextScale));

    if (Math.abs(clampedScale - prevScale) < 0.0001) return;

    // Garder le point sous le curseur stable (zoom centré sur curseur)
    const x = (cx - dp6View.tx) / prevScale;
    const y = (cy - dp6View.ty) / prevScale;

    dp6View.scale = clampedScale;
    dp6View.tx = cx - x * clampedScale;
    dp6View.ty = cy - y * clampedScale;
    dp6ApplyViewTransform();
  }

  function dp6NudgeScale(delta) {
    // Zoom centré au milieu de la zone de travail
    if (!workspace) return;
    const r = workspace.getBoundingClientRect();
    dp6SetScaleAtClientPoint(dp6View.scale + delta, r.left + r.width / 2, r.top + r.height / 2);
  }

  // ==============================
  // DP6 — PARAMÈTRES (INFORMATIF UNIQUEMENT)
  // - Stockage : window.DP6_STATE.module + window.DP6_STATE.layout.orientation
  // ==============================

  function dp6CategoryToLabel(category) {
    return category === "BEFORE" ? "Avant travaux" : category === "AFTER" ? "Après travaux" : "—";
  }

  function dp6SyncCategoryUI() {
    if (!categoryLabelEl) return;
    const category = window.DP6_STATE?.category;
    categoryLabelEl.textContent = dp6CategoryToLabel(category);
  }

  function dp6SetCategory(category) {
    const next = category === "BEFORE" || category === "AFTER" ? category : null;
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      if (next) window.DP6_STATE.category = next;
    } catch (_) {}
    dp6SyncCategoryUI();
  }

  function dp6CoerceOrientation(v) {
    const s = String(v || "").toUpperCase();
    return s === "PAYSAGE" ? "PAYSAGE" : "PORTRAIT";
  }

  function dp6HasSourceImage() {
    const src = window.DP6_STATE && typeof window.DP6_STATE.sourceImage === "string" ? window.DP6_STATE.sourceImage : "";
    return !!src;
  }

  // ==============================
  // DP6 — MODE UI (édition des sélections validées)
  // - DRAW : l'utilisateur peut dessiner une nouvelle sélection et la valider (=> patch)
  // - EDIT_SELECTION : l'utilisateur peut cliquer sur un patch existant et le modifier (poignées)
  // ==============================
  const DP6_SELECTION_UI_MODE_DRAW = "DRAW";
  const DP6_SELECTION_UI_MODE_EDIT = "EDIT_SELECTION";

  function dp6GetSelectionUIMode() {
    const m = String(window.DP6_STATE?.selectionUIMode || DP6_SELECTION_UI_MODE_DRAW);
    return m === DP6_SELECTION_UI_MODE_EDIT ? DP6_SELECTION_UI_MODE_EDIT : DP6_SELECTION_UI_MODE_DRAW;
  }

  function dp6SetSelectionUIMode(mode) {
    const next = mode === DP6_SELECTION_UI_MODE_EDIT ? DP6_SELECTION_UI_MODE_EDIT : DP6_SELECTION_UI_MODE_DRAW;
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.selectionUIMode = next;
    } catch (_) {}
  }

  function dp6GetActivePatchIndex() {
    const v = window.DP6_STATE?.activePatchIndex;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function dp6SetActivePatchIndex(idx) {
    const n = typeof idx === "number" ? idx : Number(idx);
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.activePatchIndex = Number.isFinite(n) && n >= 0 ? n : null;
    } catch (_) {}
  }

  function dp6EnterEditSelectionMode() {
    dp6SetSelectionUIMode(DP6_SELECTION_UI_MODE_EDIT);
    dp6SetActivePatchIndex(null);
    try { dp6CropClearSelection(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
    try { dp6EnsureSelectionEditor(); } catch (_) {}
  }

  function dp6ExitEditSelectionMode() {
    dp6SetSelectionUIMode(DP6_SELECTION_UI_MODE_DRAW);
    dp6SetActivePatchIndex(null);
    try { dp6CropClearSelection(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
  }

  // ==============================
  // DP6 — RENDU FINAL (UN SEUL CANVAS)
  // - canvas = image source + PATCHES photovoltaïques (dessinés par-dessus)
  // - overlay SVG = sélection quad + poignées (inchangé)
  // - source de vérité (RENDu VISUEL) :
  //   - window.DP6_STATE.patches = [{ points:[{x,y}x4] }, ...]
  //   - window.DP6_STATE.selection.points (sélection active, non validée)
  //   - window.DP6_STATE.sourceImage
  // ==============================

  const DP6_CANVAS_ID = "dp6-canvas";

  let dp6ImageEl = null;
  let dp6ImageSrc = "";
  let dp6ImageLoadPromise = null;

  function dp6EnsureWorkspaceCanvas() {
    if (!workspace) return null;
    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct?.content) return null;

    let canvas = struct.content.querySelector(`#${DP6_CANVAS_ID}`);
    if (!canvas) {
      // Robustesse : si le canvas a été supprimé du DOM, on le recrée (toujours 1 seul).
      canvas = document.createElement("canvas");
      canvas.id = DP6_CANVAS_ID;
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

  /** Conteneur fixe Street View (id #map) — ne pas supprimer du DOM entre import / Google. */
  function dp6EnsureWorkspaceMapHost() {
    if (!workspace) return null;
    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct?.content) return null;
    let el = struct.content.querySelector("#map");
    if (!el) {
      el = document.createElement("div");
      el.id = "map";
      el.className = "dp6-streetview-host";
      el.setAttribute("aria-hidden", "true");
      struct.content.insertBefore(el, struct.content.firstChild);
    }
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.minHeight = "400px";
    el.style.zIndex = "20";
    el.style.boxSizing = "border-box";
    return el;
  }

  function dp6EnsureLoadedImage(src) {
    const s = String(src || "");
    if (!s) return Promise.resolve(null);

    if (dp6ImageEl && dp6ImageSrc === s && dp6ImageEl.complete && dp6ImageEl.naturalWidth > 0) {
      return Promise.resolve(dp6ImageEl);
    }

    if (dp6ImageLoadPromise && dp6ImageSrc === s) return dp6ImageLoadPromise;

    dp6ImageSrc = s;
    dp6ImageEl = new Image();
    dp6ImageEl.decoding = "async";

    dp6ImageLoadPromise = new Promise((resolve) => {
      dp6ImageEl.onload = () => resolve(dp6ImageEl);
      dp6ImageEl.onerror = () => resolve(null);
      dp6ImageEl.src = s;
    });

    return dp6ImageLoadPromise;
  }

  function dp6BilerpPoint(p00, p10, p11, p01, u, v) {
    const u0 = 1 - u;
    const v0 = 1 - v;
    return {
      x: u0 * v0 * p00.x + u * v0 * p10.x + u * v * p11.x + u0 * v * p01.x,
      y: u0 * v0 * p00.y + u * v0 * p10.y + u * v * p11.y + u0 * v * p01.y,
    };
  }

  function dp6BilerpDerivatives(p00, p10, p11, p01, u, v) {
    const v0 = 1 - v;
    const u0 = 1 - u;
    // dP/du = -(1-v)p00 + (1-v)p10 + v p11 - v p01
    const du = {
      x: -v0 * p00.x + v0 * p10.x + v * p11.x - v * p01.x,
      y: -v0 * p00.y + v0 * p10.y + v * p11.y - v * p01.y,
    };
    // dP/dv = -(1-u)p00 - u p10 + u p11 + (1-u)p01
    const dv = {
      x: -u0 * p00.x - u * p10.x + u * p11.x + u0 * p01.x,
      y: -u0 * p00.y - u * p10.y + u * p11.y + u0 * p01.y,
    };
    return { du, dv };
  }

  function dp6Hypot(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function dp6Dist(a, b) {
    return dp6Hypot(a.x - b.x, a.y - b.y);
  }

  function dp6DrawQuad(ctx, q) {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    ctx.lineTo(q[1].x, q[1].y);
    ctx.lineTo(q[2].x, q[2].y);
    ctx.lineTo(q[3].x, q[3].y);
    ctx.closePath();
    ctx.fill();
  }

  function dp6PathQuad(ctx, q) {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    ctx.lineTo(q[1].x, q[1].y);
    ctx.lineTo(q[2].x, q[2].y);
    ctx.lineTo(q[3].x, q[3].y);
    ctx.closePath();
  }

  function dp6LerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function dp6NormalizeQuadPoints(points) {
    if (!Array.isArray(points) || points.length !== 4) return null;
    const ps = points.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
    if (!ps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;

    const cx = (ps[0].x + ps[1].x + ps[2].x + ps[3].x) / 4;
    const cy = (ps[0].y + ps[1].y + ps[2].y + ps[3].y) / 4;

    // Tri angulaire autour du centroïde : évite les auto-intersections si l'utilisateur croise les poignées.
    ps.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

    // Rotation pour démarrer au point le plus "haut-gauche" (heuristique stable).
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < 4; i++) {
      const s = ps[i].x + ps[i].y;
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return [ps[best], ps[(best + 1) % 4], ps[(best + 2) % 4], ps[(best + 3) % 4]];
  }

  let dp6NoiseCanvas = null;
  function dp6EnsureNoiseCanvas() {
    if (dp6NoiseCanvas) return dp6NoiseCanvas;
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const g = c.getContext("2d");
    if (!g) return null;

    // Noise très léger (stable car canvas caché réutilisé) + micro-diagonales "panneau".
    const img = g.createImageData(c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 12 + Math.random() * 30; // gris sombre
      d[i + 0] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 18 + Math.random() * 22; // alpha faible
    }
    g.putImageData(img, 0, 0);

    g.save();
    g.globalCompositeOperation = "overlay";
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255,255,255,0.05)";
    for (let k = -c.height; k < c.width; k += 12) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + c.height, c.height);
      g.stroke();
    }
    g.restore();

    dp6NoiseCanvas = c;
    return dp6NoiseCanvas;
  }

  function dp6EnsurePatchState() {
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      if (!Array.isArray(window.DP6_STATE.patches)) window.DP6_STATE.patches = [];
      return window.DP6_STATE.patches;
    } catch (_) {
      return [];
    }
  }

  function dp6GetPatchKey(points) {
    if (!Array.isArray(points) || points.length !== 4) return "";
    return points.map((p) => `${Number(p?.x || 0).toFixed(2)},${Number(p?.y || 0).toFixed(2)}`).join(";");
  }

  function dp6DrawSolarPatch(ctx, q, opts) {
    const alpha = typeof opts?.alpha === "number" ? opts.alpha : 0.945;
    const shadow = opts?.shadow !== false;
    const textureAlpha = typeof opts?.textureAlpha === "number" ? opts.textureAlpha : 0.10;
    const outline = opts?.outline === true;
    // DP6 UX : pas de bleu (même en fallback).
    const outlineColor = String(opts?.outlineColor || "#C39847");
    const outlineWidth = typeof opts?.outlineWidth === "number" ? opts.outlineWidth : 2;
    const dash = Array.isArray(opts?.dash) ? opts.dash : null;

    // Base sombre (0.92–0.96) + ombre douce
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    if (shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.fillStyle = `rgba(12, 12, 12, ${Math.max(0, Math.min(1, alpha))})`;
    dp6PathQuad(ctx, q);
    ctx.fill();
    ctx.restore();

    // Texture subtile (noise/pattern) à l'intérieur du quad
    const noiseCanvas = dp6EnsureNoiseCanvas();
    if (noiseCanvas && textureAlpha > 0) {
      ctx.save();
      dp6PathQuad(ctx, q);
      ctx.clip();
      const pattern = ctx.createPattern(noiseCanvas, "repeat");
      if (pattern) {
        const tr = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
        const w = tr && tr.a ? ctx.canvas.width / tr.a : ctx.canvas.width;
        const h = tr && tr.d ? ctx.canvas.height / tr.d : ctx.canvas.height;
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = Math.max(0, Math.min(0.35, textureAlpha));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }

    if (outline) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = "transparent";
      ctx.lineWidth = outlineWidth;
      ctx.strokeStyle = outlineColor;
      if (dash && ctx.setLineDash) ctx.setLineDash(dash);
      dp6PathQuad(ctx, q);
      ctx.stroke();
      if (dash && ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Point d’entrée rendu (central)
  async function renderDP6Canvas() {
    const canvas = dp6EnsureWorkspaceCanvas();
    if (!canvas) return;

    // IMPORTANT: dimensions logiques basées sur le workspace (non transformé),
    // sinon le zoom CSS fausserait la taille export PNG/PDF.
    const wRect = workspace ? workspace.getBoundingClientRect() : null;
    const cssW = Math.max(1, Math.round((wRect && wRect.width) || 0));
    const cssH = Math.max(1, Math.round((wRect && wRect.height) || 0));
    if (cssW < 2 || cssH < 2) return;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Espace de dessin en pixels CSS (transform DPR)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Marquer la source "figée" active (garde-fous de l’éditeur de sélection)
    try {
      const before = window.DP6_STATE && window.DP6_STATE.beforeImage ? String(window.DP6_STATE.beforeImage) : "";
      canvas.dataset.dp6Before = before || "";
    } catch (_) {}

    const src = window.DP6_STATE?.sourceImage || "";
    const img = await dp6EnsureLoadedImage(src);
    if (!img) return;

    // 1) Image source (à taille canvas)
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 1;
    ctx.drawImage(img, 0, 0, cssW, cssH);
    ctx.restore();

    // 2) Tous les patches validés
    const patches = Array.isArray(window.DP6_STATE?.patches) ? window.DP6_STATE.patches : [];
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const q = dp6NormalizeQuadPoints(p?.points);
      if (!q) continue;
      // UX DP6 : rendu "photomontage" uniquement (aucun contour).
      // La sélection active (or + poignées) est rendue UNIQUEMENT via l'overlay SVG.
      dp6DrawSolarPatch(ctx, q, { alpha: 0.945, shadow: true, textureAlpha: 0.10 });
    }

    // 3) IMPORTANT : ne jamais dessiner la sélection sur le canvas
    // (évite toute "pollution graphique" dans le rendu final).
  }

  function dp6PushUndoState() {
    const state = window.DP6_STATE;
    if (!state) return;
    const patches = Array.isArray(state.patches) ? state.patches : [];
    window.DP6_UNDO_STACK.push(JSON.stringify(patches));
    if (window.DP6_UNDO_STACK.length > 50) {
      window.DP6_UNDO_STACK.shift();
    }
  }

  function dp6Undo() {
    const state = window.DP6_STATE;
    if (!state) return;
    const stack = window.DP6_UNDO_STACK;
    if (!stack || !stack.length) return;
    const prev = stack.pop();
    try {
      state.patches = JSON.parse(prev);
      try { dp6SetActivePatchIndex(null); } catch (_) {}
      try { dp6CropClearSelection(); } catch (_) {}
      try { renderDP6Canvas(); } catch (_) {}
      try { dp6EnsureSelectionEditor(); } catch (_) {}
      try { dp6SyncValidateButtonUI(); } catch (_) {}
    } catch (_) {}
  }

  function dp6DeleteActivePatch() {
    const state = window.DP6_STATE;
    if (!state) return;
    const patches = Array.isArray(state.patches) ? state.patches : [];
    const rawIdx = state.activePatchIndex;
    const idx = typeof rawIdx === "number" ? rawIdx : Number(rawIdx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= patches.length) return;
    dp6PushUndoState();
    patches.splice(idx, 1);
    try { dp6SetActivePatchIndex(null); } catch (_) {}
    try { dp6CropClearSelection(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
    try { dp6EnsureSelectionEditor(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
  }

  function dp6SyncValidateButtonUI() {
    const okImage = dp6HasSourceImage();
    const patches = dp6EnsurePatchState();
    const isBefore = window.DP6_STATE?.category === "BEFORE";
    const hasPanels = Array.isArray(patches) && patches.length > 0;
    const activeIdxRaw = window.DP6_STATE?.activePatchIndex;
    const activeIdx = typeof activeIdxRaw === "number" ? activeIdxRaw : Number(activeIdxRaw);
    const hasActivePatch = Number.isFinite(activeIdx) && activeIdx >= 0 && activeIdx < patches.length;

    if (workflowHintEl) {
      if (!okImage) {
        workflowHintEl.textContent = "Étape 1 : chargez une photo Street View ou importée.";
      } else if (isBefore) {
        workflowHintEl.textContent = "Photo avant : vérifiez le cadrage, puis validez l'image avant travaux.";
      } else if (!hasPanels) {
        workflowHintEl.textContent = "Photo après : dessinez une zone sur les panneaux. La zone est créée automatiquement au relâchement.";
      } else if (hasActivePatch) {
        workflowHintEl.textContent = "Zone sélectionnée : déplacez-la, ajustez ses poignées, supprimez-la ou validez le photomontage.";
      } else {
        workflowHintEl.textContent = `${patches.length} zone(s) panneaux validée(s). Cliquez une zone pour la modifier ou validez le photomontage.`;
      }
    }

    // DP6 UX : suppression totale de la validation/manipulation via boutons de sélection.
    // (Les zones sont créées et modifiées directement par interaction.)
    if (validateSelectionBtn) {
      validateSelectionBtn.style.display = "none";
      validateSelectionBtn.disabled = true;
    }
    if (workflowHintEl && okImage && !isBefore && hasActivePatch) {
      workflowHintEl.textContent = "Zone active : ajustez-la, supprimez-la ou validez la zone pour retirer le contour et en dessiner une autre.";
    }

    if (validateSelectionBtn) {
      validateSelectionBtn.style.display = isBefore ? "none" : "";
      validateSelectionBtn.disabled = !(okImage && hasActivePatch);
    }

    if (editSelectionBtn) {
      editSelectionBtn.style.display = "none";
      editSelectionBtn.disabled = true;
    }
    if (revalidateSelectionBtn) {
      revalidateSelectionBtn.style.display = "none";
      revalidateSelectionBtn.disabled = true;
    }

    // Bouton "Valider le photomontage" : BEFORE = image seule OK ; AFTER = au moins un patch
    if (validateBtn) {
      validateBtn.disabled = !(okImage && (isBefore || hasPanels));
    }

    // UX curseur : dessin (crosshair) + clic pour activer une zone existante.
    try {
      const layer = workspace ? workspace.querySelector("#dp6-selection-layer") : null;
      if (layer) layer.style.cursor = okImage ? "crosshair" : "default";
    } catch (_) {}

    try {
      dp6SyncActionButtons();
    } catch (_) {}
  }

  function dp6SyncActionButtons() {
    const state = window.DP6_STATE;
    const delEl = document.getElementById("dp6-delete");
    const undoEl = document.getElementById("dp6-undo");
    if (!state) {
      if (delEl) delEl.disabled = true;
      if (undoEl) undoEl.disabled = true;
      return;
    }

    const patches = Array.isArray(state.patches) ? state.patches : [];
    const rawIdx = state.activePatchIndex;
    const idx = typeof rawIdx === "number" ? rawIdx : Number(rawIdx);
    const hasSelection = Number.isFinite(idx) && idx >= 0 && idx < patches.length;
    const hasUndo = !!(window.DP6_UNDO_STACK && window.DP6_UNDO_STACK.length > 0);

    if (delEl) delEl.disabled = !hasSelection;
    if (undoEl) undoEl.disabled = !hasUndo;
  }

  function dp6RenderEntryMiniatures() {
    const beforeCard = document.getElementById("dp6-card-before");
    const afterCard = document.getElementById("dp6-card-after");
    const beforeImg = document.getElementById("dp6-thumb-before");
    const afterImg = document.getElementById("dp6-thumb-after");
    if (!beforeCard || !afterCard || !beforeImg || !afterImg) return;

    const before = String(window.DP6_STATE?.beforeImage || "");
    const after = String(window.DP6_STATE?.afterImage || "");

    if (before && before.startsWith("data:image")) {
      beforeImg.src = before;
      beforeCard.classList.add("has-thumb");
    } else {
      try { beforeImg.removeAttribute("src"); } catch (_) {}
      beforeCard.classList.remove("has-thumb");
    }

    if (after && after.startsWith("data:image")) {
      afterImg.src = after;
      afterCard.classList.add("has-thumb");
    } else {
      try { afterImg.removeAttribute("src"); } catch (_) {}
      afterCard.classList.remove("has-thumb");
    }
  }

  function dp6ValidateActiveSelectionAsPatch() {
    const pts = window.DP6_STATE?.selection?.points;
    if (!dp6NormalizeQuadPoints(pts)) return false;

    dp6PushUndoState();

    const copy = (pts || []).slice(0, 4).map((p) => ({
      x: +Number(p?.x || 0).toFixed(2),
      y: +Number(p?.y || 0).toFixed(2),
    }));

    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.patches = Array.isArray(window.DP6_STATE.patches) ? window.DP6_STATE.patches : [];
      window.DP6_STATE.patches.push({ points: copy });
    } catch (_) {
      return false;
    }

    // Nouvelle zone : considérée comme "validée" immédiatement.
    // IMPORTANT UX : une zone validée devient INACTIVE (aucun contour). Activation = clic sur la zone.
    try { dp6SetActivePatchIndex(null); } catch (_) {}
    try { dp6CropClearSelection(); } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    return true;
  }

  function dp6CreateActivePatchFromSelection() {
    const pts = window.DP6_STATE?.selection?.points;
    if (!dp6NormalizeQuadPoints(pts)) return false;

    dp6PushUndoState();

    const copy = (pts || []).slice(0, 4).map((p) => ({
      x: +Number(p?.x || 0).toFixed(2),
      y: +Number(p?.y || 0).toFixed(2),
    }));

    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.patches = Array.isArray(window.DP6_STATE.patches) ? window.DP6_STATE.patches : [];
      window.DP6_STATE.patches.push({ points: copy });
      dp6SetActivePatchIndex(window.DP6_STATE.patches.length - 1);
      dp6CropSetSelection(copy);
    } catch (_) {
      return false;
    }

    try { renderDP6Canvas(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    return true;
  }

  function dp6FinalizeActivePatchSelection() {
    const idx = dp6GetActivePatchIndex();
    if (idx != null) {
      try { dp6CommitActivePatchEditFromSelection(); } catch (_) {}
      try { dp6SetActivePatchIndex(null); } catch (_) {}
      try { dp6CropClearSelection(); } catch (_) {}
      try { renderDP6Canvas(); } catch (_) {}
      try { dp6EnsureSelectionEditor(); } catch (_) {}
      try { dp6SyncValidateButtonUI(); } catch (_) {}
      return true;
    }
    return dp6ValidateActiveSelectionAsPatch();
  }

  function dp6CommitActivePatchEditFromSelection() {
    const idx = dp6GetActivePatchIndex();
    if (idx == null) return false;

    const selPts = dp6CropGetSelection();
    const q = dp6NormalizeQuadPoints(selPts);
    if (!q) return false;

    const patches = dp6EnsurePatchState();
    if (!Array.isArray(patches) || idx < 0 || idx >= patches.length) return false;

    const nextPoints = q.slice(0, 4).map((p) => ({
      x: +Number(p?.x || 0).toFixed(2),
      y: +Number(p?.y || 0).toFixed(2),
    }));

    // Mise à jour in-place (sans supprimer, sans reorder)
    const prev = patches[idx] && typeof patches[idx] === "object" ? patches[idx] : {};
    patches[idx] = { ...prev, points: nextPoints };

    try { renderDP6Canvas(); } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
    return true;
  }

  function dp6SyncPanelMetadataUI() {
    const manufacturerEl = document.getElementById("dp6-panel-manufacturer");
    const referenceEl = document.getElementById("dp6-panel-reference");
    const powerEl = document.getElementById("dp6-panel-power");
    const dimensionsEl = document.getElementById("dp6-panel-dimensions");
    if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

    const model = window.DP6_STATE?.module || null;
    if (!model) {
      manufacturerEl.textContent = "—";
      referenceEl.textContent = "—";
      powerEl.textContent = "—";
      dimensionsEl.textContent = "—";
      return;
    }

    manufacturerEl.textContent = model.fabricant || "—";
    referenceEl.textContent = model.reference || "—";
    powerEl.textContent = typeof model.puissance === "number" ? `${model.puissance} Wc` : "—";

    const hmm = typeof model.height_mm === "number" && Number.isFinite(model.height_mm) ? model.height_mm : null;
    const wmm = typeof model.width_mm === "number" && Number.isFinite(model.width_mm) ? model.width_mm : null;
    if (hmm == null || wmm == null) {
      dimensionsEl.textContent = "—";
      return;
    }

    const hm = (hmm / 1000).toFixed(2).replace(".", ",");
    const wm = (wmm / 1000).toFixed(2).replace(".", ",");
    dimensionsEl.textContent = `${hm} m × ${wm} m`;
  }

  function dp6SetModuleFromPanelId(panelId) {
    const k = String(panelId || "");
    try {
      window.DP6_STATE = window.DP6_STATE || {};
    } catch (_) {}

    const byId = (window.DP_PV_PANELS_CACHE && window.DP_PV_PANELS_CACHE.byId) || {};
    const row = k ? byId[k] : null;

    if (!row) {
      try { window.DP6_STATE.module = null; } catch (_) {}
      dp6SyncPanelMetadataUI();
      return;
    }

    const wmm = Number(row.width_mm);
    const hmm = Number(row.height_mm);
    const pw = Number(row.power_wc);
    const width_mm = Number.isFinite(wmm) && wmm > 0 ? wmm : null;
    const height_mm = Number.isFinite(hmm) && hmm > 0 ? hmm : null;
    const puissance = Number.isFinite(pw) ? pw : null;

    window.DP6_STATE.module = {
      id: k,
      panel_id: k,
      width_mm,
      height_mm,
      texture: null,
      fabricant: String(row.brand || "").trim(),
      reference: String(row.model_ref || "").trim(),
      puissance,
    };

    dp6SyncPanelMetadataUI();
  }

  function dp6SyncLayoutInputsUI() {
    const orientation = dp6CoerceOrientation(window.DP6_STATE?.layout?.orientation);
    if (orientationPortrait && orientationPaysage) {
      if (orientationPortrait.checked !== (orientation === "PORTRAIT")) orientationPortrait.checked = orientation === "PORTRAIT";
      if (orientationPaysage.checked !== (orientation === "PAYSAGE")) orientationPaysage.checked = orientation === "PAYSAGE";
    }
  }

  try {
    window.DP6_STATE = window.DP6_STATE || {};
    window.DP6_STATE.layout = window.DP6_STATE.layout || { orientation: "PORTRAIT" };
    // Normaliser (robustesse) : force une valeur autorisée uniquement
    window.DP6_STATE.layout.orientation = dp6CoerceOrientation(window.DP6_STATE.layout.orientation);
    // Patches validés (DP6) : zones PV distinctes (quads sombres)
    if (!Array.isArray(window.DP6_STATE.patches)) window.DP6_STATE.patches = [];
    // Image finale du photomontage (canvas export)
    if (typeof window.DP6_STATE.afterImage !== "string") window.DP6_STATE.afterImage = "";
  } catch (_) {}

  // Sync catégorie -> UI (lecture seule)
  dp6SyncCategoryUI();
  dp6RenderEntryMiniatures();

  // Sync état -> UI / UI -> état (module PV) — catalogue API
  if (panelSelect) {
    dpEnsurePvPanelsLoaded()
      .then((cache) => {
        const mod = window.DP6_STATE?.module || null;
        const asPanel = mod
          ? {
              panel_id: mod.panel_id || mod.id,
              manufacturer: mod.fabricant != null ? mod.fabricant : mod.manufacturer,
              reference: mod.reference,
              power_w: mod.puissance,
              width_m:
                typeof mod.width_mm === "number"
                  ? mod.width_mm / 1000
                  : typeof mod.width_m === "number"
                    ? mod.width_m
                    : null,
              height_m:
                typeof mod.height_mm === "number"
                  ? mod.height_mm / 1000
                  : typeof mod.height_m === "number"
                    ? mod.height_m
                    : null
            }
          : null;
        const reconciled = dpReconcilePanelModel(asPanel, cache);
        const selId = reconciled?.panel_id || null;
        dpPopulatePvPanelSelectOptions(panelSelect, selId);

        if (selId) {
          dp6SetModuleFromPanelId(selId);
        } else if (mod && Number(mod.width_mm) > 0 && Number(mod.height_mm) > 0) {
          dp6SyncPanelMetadataUI();
        } else {
          try { window.DP6_STATE.module = null; } catch (_) {}
          dp6SyncPanelMetadataUI();
        }

        if (panelSelect.dataset.bound !== "1") {
          panelSelect.dataset.bound = "1";
          panelSelect.addEventListener("change", (e) => {
            const value = e.target?.value || "";
            dp6SetModuleFromPanelId(value);
          });
        }
      })
      .catch(() => {
        dpPopulatePvPanelSelectOptions(panelSelect, null);
        dp6SyncPanelMetadataUI();
      });
  } else {
    dp6SyncPanelMetadataUI();
  }

  // Sync état -> UI / UI -> état (implantation)
  dp6SyncLayoutInputsUI();
  dp6SyncValidateButtonUI();

  // Orientation (Portrait / Paysage) — valeur stockée dans DP6_STATE.layout.orientation
  function dp6SetOrientation(next) {
    const orientation = dp6CoerceOrientation(next);
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.layout = { ...(window.DP6_STATE.layout || {}), orientation };
    } catch (_) {}
    dp6SyncLayoutInputsUI();
    dp6SyncValidateButtonUI();
    try { renderDP6Canvas(); } catch (_) {}
  }

  if (orientationPortrait && orientationPortrait.dataset.bound !== "1") {
    orientationPortrait.dataset.bound = "1";
    orientationPortrait.addEventListener("change", (e) => {
      if (e.target && e.target.checked) dp6SetOrientation("PORTRAIT");
    });
  }
  if (orientationPaysage && orientationPaysage.dataset.bound !== "1") {
    orientationPaysage.dataset.bound = "1";
    orientationPaysage.addEventListener("change", (e) => {
      if (e.target && e.target.checked) dp6SetOrientation("PAYSAGE");
    });
  }

  // Redraw automatique : se régénère quand selection.points / sourceImage / showPanelGrid changent
  function dp6ComputeAutoRedrawKey() {
    const src = String(window.DP6_STATE?.sourceImage || "");
    const pts = window.DP6_STATE?.selection?.points;
    const ptsKey = dp6GetPatchKey(pts);
    const patches = Array.isArray(window.DP6_STATE?.patches) ? window.DP6_STATE.patches : [];
    const patchesKey = patches.map((p) => dp6GetPatchKey(p?.points)).join("|");
    return `${src}|patches:${patchesKey}|sel:${ptsKey}`;
  }

  function dp6StartAutoRedraw() {
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      if (window.DP6_STATE._dp6AutoRedrawBound) return;
      window.DP6_STATE._dp6AutoRedrawBound = true;
    } catch (_) { return; }

    let lastKey = "";
    let lastT = 0;

    const tick = (t) => {
      // Throttle ~4Hz pour rester léger et fiable
      if (typeof t !== "number") t = performance.now();
      if (t - lastT >= 250) {
        lastT = t;
        let key = "";
        try { key = dp6ComputeAutoRedrawKey(); } catch (_) { key = ""; }
        if (key !== lastKey) {
          lastKey = key;
          try { dp6SyncValidateButtonUI(); } catch (_) {}
          try { renderDP6Canvas(); } catch (_) {}
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  dp6StartAutoRedraw();

  // ==============================
  // DP6 — ÉDITEUR DE SÉLECTION (zone panneaux)
  // Sélection QUADRILATÈRE libre (comme un outil de capture écran)
  // - Travail UNIQUEMENT sur l'image figée (beforeImage)
  // - 4 coins INDÉPENDANTS (aucune dépendance géométrique)
  // - Drag d'un coin => bouge uniquement CE point
  // - Drag à l'intérieur => translation (bouge tous les points ensemble)
  // - Aucune métrique / grille / snapping / rotation
  // - Source de vérité : window.DP6_STATE.selection = { points:[{x,y},{x,y},{x,y},{x,y}] }
  // ==============================
  try {
    window.DP6_STATE = window.DP6_STATE || {};
  } catch (_) {}

  const DP6_CROP_CLICK_TOL = 3; // clic sans drag => annule

  function dp6PointInPolygon(pt, poly) {
    if (!pt || !Array.isArray(poly) || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 0.0000001) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function dp6DistPointToSegment(pt, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = pt.x - a.x;
    const wy = pt.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return dp6Hypot(pt.x - a.x, pt.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return dp6Hypot(pt.x - b.x, pt.y - b.y);
    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    return dp6Hypot(pt.x - px, pt.y - py);
  }

  function dp6HitTestQuad(pt, quad, tolPx) {
    const tol = typeof tolPx === "number" && tolPx >= 0 ? tolPx : 0;
    if (!pt || !Array.isArray(quad) || quad.length !== 4) return false;
    if (dp6PointInPolygon(pt, quad)) return true;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      if (dp6DistPointToSegment(pt, a, b) <= tol) return true;
    }
    return false;
  }

  function dp6PickPatchIndexAtPoint(pt, tolPx) {
    const patches = dp6EnsurePatchState();
    for (let i = patches.length - 1; i >= 0; i--) {
      const q = dp6NormalizeQuadPoints(patches[i]?.points);
      if (!q) continue;
      if (dp6HitTestQuad(pt, q, tolPx)) return i;
    }
    return null;
  }

  function dp6CropGetSelection() {
    const s = window.DP6_STATE && window.DP6_STATE.selection ? window.DP6_STATE.selection : null;
    if (!s || typeof s !== "object") return null;
    const pts = Array.isArray(s.points) ? s.points : null;
    if (!pts || pts.length !== 4) return null;
    const out = pts.map((p) => ({ x: Number(p?.x), y: Number(p?.y) }));
    if (!out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
    return out;
  }

  function dp6CropSetSelection(points) {
    if (!window.DP6_STATE) window.DP6_STATE = {};
    window.DP6_STATE.selection = {
      points: (points || []).slice(0, 4).map((p) => ({
        x: +Number(p.x).toFixed(2),
        y: +Number(p.y).toFixed(2),
      })),
    };
    try { renderDP6Canvas(); } catch (_) {}
  }

  function dp6CropClearSelection() {
    try {
      if (window.DP6_STATE && window.DP6_STATE.selection) delete window.DP6_STATE.selection;
    } catch (_) {}
    try { renderDP6Canvas(); } catch (_) {}
  }

  function dp6CropEnsureWorkspaceStructure() {
    if (!workspace) return null;
    if (workspace.style.position !== "relative") workspace.style.position = "relative";
    if (workspace.style.overflow !== "hidden") workspace.style.overflow = "hidden";

    // Stage (photo + overlays) : c'est LUI qui est zoomé/panné en CSS transform.
    // Le workspace reste non transformé => les dimensions logiques (canvas export) ne changent pas.
    let stage = workspace.querySelector("#dp6-photo-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "dp6-photo-stage";
      workspace.appendChild(stage);
    }
    stage.style.position = "absolute";
    stage.style.inset = "0";
    stage.style.transformOrigin = "0 0";
    stage.style.willChange = "transform";
    stage.style.userSelect = "none";

    // Contenu (StreetView OU image)
    // (on migre si l'élément existe encore au niveau racine du workspace)
    let content = stage.querySelector("#dp6-photo-content") || workspace.querySelector("#dp6-photo-content");
    if (!content) {
      content = document.createElement("div");
      content.id = "dp6-photo-content";
      stage.appendChild(content);
    } else if (content.parentNode !== stage) {
      try { stage.appendChild(content); } catch (_) {}
    }
    content.style.position = "absolute";
    content.style.inset = "0";

    // Layer sélection (SVG)
    let layer = stage.querySelector("#dp6-selection-layer") || workspace.querySelector("#dp6-selection-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "dp6-selection-layer";
      stage.appendChild(layer);
    } else if (layer.parentNode !== stage) {
      try { stage.appendChild(layer); } catch (_) {}
    }
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.zIndex = "60";
    layer.style.pointerEvents = "auto";
    layer.style.userSelect = "none";
    layer.style.touchAction = "none";
    layer.style.cursor = "crosshair";

    // Appliquer la vue actuelle (au cas où le DOM vient d'être (re)créé)
    try { dp6ApplyViewTransform(); } catch (_) {}

    return { stage, content, layer };
  }

  function dp6CropGetActiveImage() {
    if (!workspace) return null;
    const canvas = workspace.querySelector(`#${DP6_CANVAS_ID}`);
    if (!canvas) return null;
    // Règle absolue: travailler uniquement sur l'image figée (beforeImage)
    const before = window.DP6_STATE && window.DP6_STATE.beforeImage ? String(window.DP6_STATE.beforeImage) : "";
    if (!before) return null;
    const current = String(canvas.dataset?.dp6Before || "");
    if (current !== before) return null;
    return canvas;
  }

  function dp6CropAlignLayerToImage(layer, img) {
    if (!layer || !img || !workspace) return;
    // Canvas DP6 = 100% de la zone de travail => overlay = 100% également.
    // (important : ne pas dépendre des boundingRect transformés par le zoom)
    layer.style.left = "0px";
    layer.style.top = "0px";
    layer.style.width = "100%";
    layer.style.height = "100%";
  }

  function dp6CropGetLayerPointFromEvent(layer, e) {
    const r = layer.getBoundingClientRect();
    const s = dp6View && typeof dp6View.scale === "number" ? dp6View.scale : 1;
    // Si le stage est zoomé, le rect est agrandi : on ramène dans l'espace "logique" (scale=1).
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }

  function dp6Clamp01(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function dp6PointsBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (points || []).forEach((p) => {
      if (!p) return;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    if (![minX, minY, maxX, maxY].every((n) => Number.isFinite(n))) return null;
    return { minX, minY, maxX, maxY };
  }

  function dp6PointsFromDraw(a, b, bounds) {
    const x1 = dp6Clamp01(Math.min(a.x, b.x), 0, bounds.w);
    const y1 = dp6Clamp01(Math.min(a.y, b.y), 0, bounds.h);
    const x2 = dp6Clamp01(Math.max(a.x, b.x), 0, bounds.w);
    const y2 = dp6Clamp01(Math.max(a.y, b.y), 0, bounds.h);
    return [
      { x: x1, y: y1 }, // tl
      { x: x2, y: y1 }, // tr
      { x: x2, y: y2 }, // br
      { x: x1, y: y2 }, // bl
    ];
  }

  function dp6ClampPointToBounds(p, bounds) {
    return {
      x: dp6Clamp01(p.x, 0, bounds.w),
      y: dp6Clamp01(p.y, 0, bounds.h),
    };
  }

  function dp6EnsureSelectionEditor() {
    if (!workspace) return;
    const img = dp6CropGetActiveImage();
    if (!img) return;

    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct) return;
    const layer = struct.layer;

    // Remplacer un ancien overlay (si présent) sans laisser de DOM legacy
    const legacyLayer = document.getElementById("dp6-crop-layer");
    if (legacyLayer && legacyLayer.parentNode) {
      try { legacyLayer.parentNode.removeChild(legacyLayer); } catch (_) {}
    }

    // SVG (créé/assuré)
    let svg = layer.querySelector("svg#dp6-selection-svg");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "dp6-selection-svg";
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.style.display = "block";
      svg.style.overflow = "visible";
      svg.style.pointerEvents = "auto";
      layer.innerHTML = "";
      layer.appendChild(svg);
    }

    let poly = svg.querySelector("#dp6-selection-poly");
    if (!poly) {
      poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.id = "dp6-selection-poly";
      poly.style.cursor = "move";
      poly.style.pointerEvents = "all";
      svg.appendChild(poly);
    }
    // DP6 UX : contour visible UNIQUEMENT quand zone active, couleur premium.
    // Aucun bleu, aucune bordure hors sélection.
    poly.setAttribute("fill", "rgba(0,0,0,0)");
    poly.setAttribute("stroke", "#C39847");
    poly.setAttribute("stroke-width", "2");
    try { poly.removeAttribute("stroke-dasharray"); } catch (_) {}

    const HANDLE_R = 7;
    const handles = [];
    for (let i = 0; i < 4; i++) {
      let c = svg.querySelector(`circle.dp6-handle[data-idx="${i}"]`);
      if (!c) {
        c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.classList.add("dp6-handle");
        c.dataset.idx = String(i);
        c.setAttribute("r", String(HANDLE_R));
        c.style.pointerEvents = "all";
        c.style.cursor = "grab";
        svg.appendChild(c);
      }
      c.setAttribute("r", String(HANDLE_R));
      c.setAttribute("fill", "rgba(255,255,255,0.98)");
      c.setAttribute("stroke", "#C39847");
      c.setAttribute("stroke-width", "2");
      handles.push(c);
    }

    function dp6UpdateActivePatchFromPoints(nextPoints) {
      const idx = dp6GetActivePatchIndex();
      if (idx == null) return false;
      const patches = dp6EnsurePatchState();
      if (!Array.isArray(patches) || idx < 0 || idx >= patches.length) return false;
      const next = (nextPoints || []).slice(0, 4).map((p) => ({
        x: +Number(p?.x || 0).toFixed(2),
        y: +Number(p?.y || 0).toFixed(2),
      }));
      const prev = patches[idx] && typeof patches[idx] === "object" ? patches[idx] : {};
      patches[idx] = { ...prev, points: next };
      return true;
    }

    function getBounds() {
      const br = layer.getBoundingClientRect();
      const s = dp6View && typeof dp6View.scale === "number" ? dp6View.scale : 1;
      return { w: br.width / s, h: br.height / s };
    }

    function render(points) {
      const pts = Array.isArray(points) && points.length === 4 ? points : null;
      if (!pts) {
        poly.style.display = "none";
        handles.forEach((h) => (h.style.display = "none"));
        return;
      }
      poly.style.display = "block";
      const polyStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
      poly.setAttribute("points", polyStr);
      handles.forEach((h, idx) => {
        const p = pts[idx];
        h.style.display = "block";
        h.setAttribute("cx", String(p.x));
        h.setAttribute("cy", String(p.y));
      });
    }

    // Align overlay à l'image + re-render
    const doAlign = () => {
      dp6CropAlignLayerToImage(layer, img);
      const { w, h } = getBounds();
      svg.setAttribute("viewBox", `0 0 ${Math.max(1, w)} ${Math.max(1, h)}`);

      const pts = dp6CropGetSelection();
      if (pts) {
        const clamped = pts.map((p) => dp6ClampPointToBounds(p, { w, h }));
        dp6CropSetSelection(clamped);
        render(clamped);
      } else {
        render(null);
      }
    };

    // Canvas: pas d'évènement "load" fiable -> align immédiat (après layout)
    requestAnimationFrame(doAlign);

    if (!window.DP6_STATE._dp6CropResizeBound) {
      window.DP6_STATE._dp6CropResizeBound = true;
      window.addEventListener("resize", () => {
        const img2 = dp6CropGetActiveImage();
        const struct2 = dp6CropEnsureWorkspaceStructure();
        const layer2 = struct2?.layer;
        const svg2 = layer2 ? layer2.querySelector("svg#dp6-selection-svg") : null;
        if (!img2 || !layer2 || !svg2) return;

        dp6CropAlignLayerToImage(layer2, img2);
        const r2 = layer2.getBoundingClientRect();
        const s2 = dp6View && typeof dp6View.scale === "number" ? dp6View.scale : 1;
        const w2 = r2.width / s2;
        const h2 = r2.height / s2;
        svg2.setAttribute("viewBox", `0 0 ${Math.max(1, w2)} ${Math.max(1, h2)}`);

        const pts2 = dp6CropGetSelection();
        if (pts2) {
          const bounds2 = { w: w2, h: h2 };
          const clamped2 = pts2.map((p) => dp6ClampPointToBounds(p, bounds2));
          dp6CropSetSelection(clamped2);
          render(clamped2);
        } else {
          render(null);
        }
        try { renderDP6Canvas(); } catch (_) {}
      });
    }

    // Bind interactions (sur l'overlay seulement) — une seule fois
    if (layer.dataset.bound === "1") return;
    layer.dataset.bound = "1";

    let active = null;
    let prevUserSelect = "";

    function beginInteraction() {
      prevUserSelect = document.body.style.userSelect || "";
      document.body.style.userSelect = "none";
    }
    function endInteraction() {
      document.body.style.userSelect = prevUserSelect;
      active = null;
    }

    function onDocMove(e) {
      if (!active) return;
      if (active.type === "pan") {
        // PAN visuel : on déplace le stage (ne modifie aucune coordonnée de sélection)
        const dx = e.clientX - active.startClient.x;
        const dy = e.clientY - active.startClient.y;
        dp6View.tx = active.startTx + dx;
        dp6View.ty = active.startTy + dy;
        try { dp6ApplyViewTransform(); } catch (_) {}
        try { e.preventDefault(); } catch (_) {}
        return;
      }
      const p = dp6CropGetLayerPointFromEvent(layer, e);
      const { w, h } = getBounds();
      const bounds = { w, h };

      if (active.type === "draw") {
        const next = dp6PointsFromDraw(active.startMouse, p, bounds);
        dp6CropSetSelection(next); // mise à jour live obligatoire
        render(next);
        return;
      }

      if (active.type === "translate") {
        const startPts = active.startPoints;
        const dx0 = p.x - active.startMouse.x;
        const dy0 = p.y - active.startMouse.y;
        const b = dp6PointsBounds(startPts);
        if (!b) return;

        // Clamp translation (sans déformation): on limite le delta pour garder tous les points dans l'image
        const dx = dp6Clamp01(dx0, -b.minX, bounds.w - b.maxX);
        const dy = dp6Clamp01(dy0, -b.minY, bounds.h - b.maxY);

        const next = startPts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
        // Mise à jour live : panneau bouge en temps réel (patch) + overlay (sélection)
        dp6UpdateActivePatchFromPoints(next);
        dp6CropSetSelection(next);
        render(next);
        return;
      }

      if (active.type === "handle") {
        const startPts = active.startPoints;
        const dx = p.x - active.startMouse.x;
        const dy = p.y - active.startMouse.y;
        const idx = active.idx;
        const next = startPts.map((pt) => ({ x: pt.x, y: pt.y }));
        next[idx] = dp6ClampPointToBounds({ x: startPts[idx].x + dx, y: startPts[idx].y + dy }, bounds);
        // Mise à jour live : panneau bouge en temps réel (patch) + overlay (sélection)
        dp6UpdateActivePatchFromPoints(next);
        dp6CropSetSelection(next);
        render(next);
      }
    }

    function onDocUp(e) {
      if (!active) return;
      if (active.type === "pan") {
        endInteraction();
        document.removeEventListener("mousemove", onDocMove, true);
        document.removeEventListener("mouseup", onDocUp, true);
        return;
      }
      const endP = dp6CropGetLayerPointFromEvent(layer, e);
      const { w, h } = getBounds();

      if (active.type === "draw") {
        const moved = Math.max(Math.abs(endP.x - active.startMouse.x), Math.abs(endP.y - active.startMouse.y));
        if (moved <= DP6_CROP_CLICK_TOL) {
          dp6CropClearSelection();
          render(null);
          try { dp6SetActivePatchIndex(null); } catch (_) {}
        } else {
          // Creation immediate : la zone reste active jusqu'au clic sur "Valider la zone".
          try { dp6CreateActivePatchFromSelection(); } catch (_) {}
          render(dp6CropGetSelection());
        }
      }

      endInteraction();
      document.removeEventListener("mousemove", onDocMove, true);
      document.removeEventListener("mouseup", onDocUp, true);
    }

    layer.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (!dp6CropGetActiveImage()) return; // garde-fou beforeImage

      const t = e.target;
      const p = dp6CropGetLayerPointFromEvent(layer, e);
      const pts = dp6CropGetSelection();

      const isHandle = t && t.classList && t.classList.contains("dp6-handle");
      const isPoly = t && (t.id === "dp6-selection-poly" || t.closest?.("#dp6-selection-poly"));

      // A zoom > 100%, Alt + glisser deplace la photo.
      // Sans Alt, le clic-glisse reste reserve au dessin d'une nouvelle zone PV.
      if ((dp6View?.scale || 1) > 1.000001 && e.altKey && !isHandle && !(isPoly && pts)) {
        // Pan volontaire, sans bloquer le dessin normal.
        if (e.altKey) {
          // Si clic sur un patch existant, on préfère activer la zone plutôt que panner.
          const hitIdx = dp6PickPatchIndexAtPoint(p, 10);
          const patches = dp6EnsurePatchState();
          if (!(hitIdx != null && hitIdx >= 0 && hitIdx < patches.length)) {
            e.preventDefault();
            beginInteraction();
            active = { type: "pan", startClient: { x: e.clientX, y: e.clientY }, startTx: dp6View.tx, startTy: dp6View.ty };
            document.addEventListener("mousemove", onDocMove, true);
            document.addEventListener("mouseup", onDocUp, true);
            return;
          }
          // sinon: laisser le flux normal activer la zone
        }
      }

      // Clic sur une zone existante (activation directe)
      if (!(isHandle && pts) && !(isPoly && pts)) {
        const hitIdx = dp6PickPatchIndexAtPoint(p, 10);
        const patches = dp6EnsurePatchState();
        if (hitIdx != null && hitIdx >= 0 && hitIdx < patches.length) {
          e.preventDefault();
          dp6SetActivePatchIndex(hitIdx);
          const q = dp6NormalizeQuadPoints(patches[hitIdx]?.points);
          if (q) {
            const { w, h } = getBounds();
            const clamped = q.map((pt) => dp6ClampPointToBounds(pt, { w, h }));
            dp6CropSetSelection(clamped);
            render(clamped);
          } else {
            dp6CropClearSelection();
            render(null);
          }
          try { renderDP6Canvas(); } catch (_) {}
          try { dp6SyncValidateButtonUI(); } catch (_) {}
          return;
        }
        // Clic hors zone : on désactive (et un éventuel drag dessinera une nouvelle zone).
        try { dp6SetActivePatchIndex(null); } catch (_) {}
        try { dp6CropClearSelection(); } catch (_) {}
        try { render(null); } catch (_) {}
        try { dp6SyncValidateButtonUI(); } catch (_) {}
      }

      if (isHandle && pts) {
        const idx = Number(t.dataset.idx);
        if (!Number.isFinite(idx) || idx < 0 || idx > 3) return;
        e.preventDefault();
        e.stopPropagation();
        dp6PushUndoState();
        beginInteraction();
        active = { type: "handle", idx, startMouse: p, startPoints: pts };
        document.addEventListener("mousemove", onDocMove, true);
        document.addEventListener("mouseup", onDocUp, true);
        return;
      }

      if (isPoly && pts) {
        e.preventDefault();
        dp6PushUndoState();
        beginInteraction();
        active = { type: "translate", startMouse: p, startPoints: pts };
        document.addEventListener("mousemove", onDocMove, true);
        document.addEventListener("mouseup", onDocUp, true);
        return;
      }

      // Dessin d'une nouvelle sélection (rectangle initial), puis coins indépendants ensuite
      e.preventDefault();
      beginInteraction();
      active = { type: "draw", startMouse: p };
      document.addEventListener("mousemove", onDocMove, true);
      document.addEventListener("mouseup", onDocUp, true);
    });
  }

  // Google Street View (DP6) : instance temporaire (aucune persistance)
  let dp6Panorama = null;
  let dp6StreetHost = null;
  let dp6StreetViewLayoutAttempts = 0;

  function dp6SetSourceMessage(text) {
    // Message UX (simple, robuste) affiché dans la colonne gauche
    // - Street View : « Utiliser cette vue » (Static API) ou import fichier
    const aside = modal ? modal.querySelector(".dp-map-help") : null;
    if (!aside) return;
    let box = aside.querySelector("#dp6-source-message");
    if (!box) {
      box = document.createElement("div");
      box.id = "dp6-source-message";
      box.className = "dp-hint";
      box.style.marginTop = "10px";
      // Insertion après les boutons (avant le <hr>)
      const actions = aside.querySelector(".dp-page-actions");
      if (actions && actions.parentNode) actions.parentNode.insertBefore(box, actions.nextSibling);
      else aside.appendChild(box);
    }
    box.textContent = String(text || "");
  }

  function dp6DisplayImportedImage(dataURL, altText) {
    if (!workspace || !dataURL) return;

    // Si une vue Google est active, la détruire avant affichage image
    try { dp6DestroyGoogleView(); } catch (_) {}

    // Stockage attendu : source importée (photo OU capture manuelle)
    // - sourceImage : image d'origine importée (référence)
    // - beforeImage : image figée sur laquelle on travaille (sélection zone panneaux)
    try {
      window.DP6_STATE = window.DP6_STATE || {};
      window.DP6_STATE.sourceImage = String(dataURL);
      window.DP6_STATE.beforeImage = String(dataURL);
      // Changer la photo invalide forcément les patches + le rendu après
      window.DP6_STATE.patches = [];
      window.DP6_UNDO_STACK = [];
      window.DP6_STATE.afterImage = "";
      window.DP6_STATE.selectionUIMode = DP6_SELECTION_UI_MODE_DRAW;
      window.DP6_STATE.activePatchIndex = null;
      try { dp6CropClearSelection(); } catch (_) {}
    } catch (_) {}

    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct) return;
    // Nouvelle image => repartir sur une vue neutre
    try { dp6ResetView(); } catch (_) {}
    // Rendu strict: image + panneaux sur un SEUL canvas
    dp6EnsureWorkspaceCanvas();
    try {
      const canvas = struct.content.querySelector(`#${DP6_CANVAS_ID}`);
      if (canvas) {
        canvas.style.display = "block";
        canvas.dataset.dp6Before = String(window.DP6_STATE?.beforeImage || "");
        canvas.setAttribute("aria-label", altText || "Image source DP6");
        // Nettoyer la zone (StreetView / legacy) sans supprimer le canvas
        Array.from(struct.content.children || []).forEach((ch) => {
          if (ch !== canvas && ch.id !== "map") {
            try { ch.parentNode && ch.parentNode.removeChild(ch); } catch (_) {}
          }
        });
      }
    } catch (_) {}

    try { renderDP6Canvas(); } catch (_) {}
    try { dp6EnsureSelectionEditor(); } catch (_) {}

    // Après import, la source est considérée comme validée -> suite du workflow activée
    dp6SyncValidateButtonUI();
    dp6RenderEntryMiniatures();
  }

  function dp6StreetViewZoomToFov(zoom) {
    const z = Number(zoom);
    const zz = Number.isFinite(z) ? z : 1;
    const f = 126 * Math.pow(0.62, zz);
    return Math.round(Math.min(120, Math.max(10, f)));
  }

  async function dp6UseCurrentStreetViewAsImage() {
    if (!dp6Panorama || !window.google?.maps) {
      window.__snDpAlert("Street View n’est pas prêt. Patientez quelques secondes puis réessayez.");
      return;
    }
    const pano = dp6Panorama;
    const pos = pano.getPosition && pano.getPosition();
    const pov = pano.getPov && pano.getPov();
    const panoId = pano.getPano && pano.getPano();
    const zoom = pano.getZoom && pano.getZoom();
    if (!pos || !pov) {
      window.__snDpAlert("Impossible de lire la vue Street View actuelle.");
      return;
    }
    const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
    const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
    const fov = dp6StreetViewZoomToFov(zoom);
    const params = new URLSearchParams();
    params.set("size", "640x640");
    params.set("key", DP6_GOOGLE_MAPS_API_KEY_STATIC);
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
      dp6DisplayImportedImage(String(dataUrl), "Vue Street View — DP6");
      dp6SetSourceMessage(
        "Vue sélectionnée : placez les zones panneaux sur l’image, puis validez le photomontage."
      );
    } catch (e) {
      console.error("[DP6] Street View Static", e);
      window.__snDpAlert(
        "Impossible de récupérer l’image Street View (couverture, quota ou clé API). Réessayez ou importez une photo."
      );
    } finally {
      if (useCurrentViewBtn) {
        useCurrentViewBtn.disabled = false;
        useCurrentViewBtn.textContent = "Utiliser cette vue";
      }
    }
  }

  function dp6DestroyGoogleView() {
    const ev = window.google?.maps?.event;
    if (ev?.clearInstanceListeners && dp6Panorama) {
      try {
        ev.clearInstanceListeners(dp6Panorama);
      } catch (_) {}
    }
    try {
      if (dp6Panorama?.setVisible) dp6Panorama.setVisible(false);
    } catch (_) {}
    dp6Panorama = null;
    dp6StreetHost = null;
    if (useCurrentViewBtn) {
      useCurrentViewBtn.hidden = true;
      useCurrentViewBtn.disabled = true;
      useCurrentViewBtn.textContent = "Utiliser cette vue";
    }
    const mapEl = workspace ? workspace.querySelector("#map") : document.getElementById("map");
    if (mapEl) {
      try {
        mapEl.innerHTML = "";
      } catch (_) {}
      mapEl.setAttribute("hidden", "");
      mapEl.setAttribute("aria-hidden", "true");
      mapEl.style.display = "none";
    }
    try {
      const c = workspace ? workspace.querySelector(`#${DP6_CANVAS_ID}`) : null;
      if (c) c.style.display = "block";
    } catch (_) {}
  }

  /**
   * Charge Google puis crée le Street View sur #map.
   * Attend un conteneur dimensionné (modal visible) ; sinon nouvelle tentative.
   */
  async function initDP6Map() {
    console.log("DP6 INIT MAP START");
    try {
      const modalEl = document.getElementById("dp6-photo-modal");
      if (modalEl && modalEl.getAttribute("aria-hidden") === "true") {
        return;
      }

      const el = document.getElementById("map");
      if (!el) {
        console.error("DP6 MAP NOT FOUND");
        return;
      }

      el.removeAttribute("hidden");
      el.setAttribute("aria-hidden", "false");
      if (el.style.display === "none") el.style.display = "block";

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        dp6StreetViewLayoutAttempts += 1;
        if (dp6StreetViewLayoutAttempts > 24) {
          console.warn("DP6 MAP SIZE INVALID — abandon", rect);
          dp6StreetViewLayoutAttempts = 0;
          return;
        }
        console.warn("DP6 MAP SIZE INVALID", rect);
        setTimeout(() => {
          void initDP6Map();
        }, 300);
        return;
      }
      dp6StreetViewLayoutAttempts = 0;

      const google = await dpLoadGoogleMapsJsOnce();
      if (!google || !google.maps) {
        console.error("DP6: Google Maps indisponible après chargement");
        return;
      }
      console.log("GOOGLE READY IN DP6");

      if (dp6Panorama && window.google?.maps?.event) {
        try {
          window.google.maps.event.clearInstanceListeners(dp6Panorama);
        } catch (_) {}
      }
      dp6Panorama = null;

      const br = el.getBoundingClientRect();
      const wr = workspace ? workspace.getBoundingClientRect() : { width: 0, height: 0 };
      console.log(
        "MAP CONTAINER OK",
        "workspace",
        Math.round(wr.width),
        Math.round(wr.height),
        "map",
        Math.round(br.width),
        Math.round(br.height)
      );

      const { center: c0 } = dpGetProjectCenterForGoogleMaps();
      const center = c0 || { lat: 48.8395, lng: 2.5728 };

      const panoBaseOpts = {
        pov: { heading: 0, pitch: 0 },
        zoom: 1,
        visible: true,
        addressControl: false,
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: false,
      };

      function dp6TriggerPanoramaResize(panorama) {
        try {
          google.maps.event.trigger(panorama, "resize");
        } catch (_) {}
      }

      function dp6AttachPanoramaLifecycle(panorama) {
        dp6Panorama = panorama;
        dp6StreetHost = el;
        if (useCurrentViewBtn) {
          useCurrentViewBtn.hidden = false;
          useCurrentViewBtn.disabled = false;
          useCurrentViewBtn.textContent = "Utiliser cette vue";
        }
        google.maps.event.addListenerOnce(panorama, "status_changed", () => {
          try {
            const st = panorama.getStatus && panorama.getStatus();
            if (st === google.maps.StreetViewStatus.OK) {
              console.log("MAP DISPLAY OK");
            }
          } catch (_) {}
          dp6TriggerPanoramaResize(panorama);
        });
        dp6TriggerPanoramaResize(panorama);
        requestAnimationFrame(() => {
          dp6TriggerPanoramaResize(panorama);
          setTimeout(() => dp6TriggerPanoramaResize(panorama), 300);
        });
      }

      const svService = new google.maps.StreetViewService();
      const radiiM = [120, 280, 600];
      let radiusIdx = 0;

      function tryNearestPano() {
        const radius = radiiM[Math.min(radiusIdx, radiiM.length - 1)];
        const req = { location: center, radius };
        if (google.maps.StreetViewPreference && google.maps.StreetViewPreference.NEAREST != null) {
          req.preference = google.maps.StreetViewPreference.NEAREST;
        }
        svService.getPanorama(req, (data, status) => {
          if (status === google.maps.StreetViewStatus.OK && data && data.location && data.location.pano) {
            const panorama = new google.maps.StreetViewPanorama(el, {
              ...panoBaseOpts,
              pano: data.location.pano,
            });
            dp6AttachPanoramaLifecycle(panorama);
            console.log("STREETVIEW CREATED");
            return;
          }
          radiusIdx += 1;
          if (radiusIdx < radiiM.length) {
            tryNearestPano();
            return;
          }
          console.warn("[DP6] Aucune imagery Street View proche — fallback position");
          const panorama = new google.maps.StreetViewPanorama(el, {
            ...panoBaseOpts,
            position: center,
          });
          dp6AttachPanoramaLifecycle(panorama);
          console.log("STREETVIEW CREATED");
        });
      }

      tryNearestPano();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            dpMaybeAttachDp6VerifyMap2D();
          } catch (_) {}
        });
      });
    } catch (e) {
      console.error("initDP6Map", e);
    }
  }

  function openDP6StreetView() {
    if (!workspace) return;
    dp6StreetViewLayoutAttempts = 0;
    try {
      dp6ResetView();
    } catch (_) {}

    const struct = dp6CropEnsureWorkspaceStructure();
    if (!struct) return;

    const canvas = dp6EnsureWorkspaceCanvas();
    const mapHost = dp6EnsureWorkspaceMapHost();
    if (canvas) canvas.style.display = "none";
    if (mapHost) {
      mapHost.removeAttribute("hidden");
      mapHost.setAttribute("aria-hidden", "false");
      mapHost.style.display = "block";
    }

    try {
      Array.from(struct.content.children || []).forEach((ch) => {
        if (ch !== canvas && ch.id !== "map") {
          try {
            ch.parentNode && ch.parentNode.removeChild(ch);
          } catch (_) {}
        }
      });
    } catch (_) {}
    try {
      struct.layer.style.width = "0px";
      struct.layer.style.height = "0px";
    } catch (_) {}

    dp6SetSourceMessage(
      "Cadrez la rue dans Street View, puis cliquez sur « Utiliser cette vue » pour charger l’image."
    );

    if (useCurrentViewBtn) {
      useCurrentViewBtn.hidden = true;
      useCurrentViewBtn.disabled = true;
      useCurrentViewBtn.textContent = "Utiliser cette vue";
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        void initDP6Map();
      }, 300);
    });
  }

  // Input file créé une seule fois (invisible)
  let fileInput = document.getElementById("dp6-file-input");
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.id = "dp6-file-input";
    fileInput.type = "file";
    fileInput.accept = "image/jpeg,image/png";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
  }

  // Binding bouton "Importer une photo"
  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      // Permet de re-sélectionner le même fichier
      fileInput.value = "";
      fileInput.click();
    });
  }

  // Binding bouton "Utiliser Google Street View"
  if (streetBtn) {
    streetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openDP6StreetView();
    });
  }

  if (useCurrentViewBtn) {
    useCurrentViewBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void dp6UseCurrentStreetViewAsImage();
    });
  }

  // Zoom UI
  if (zoomInBtn && zoomInBtn.dataset.bound !== "1") {
    zoomInBtn.dataset.bound = "1";
    zoomInBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6NudgeScale(+0.2);
    });
  }
  if (zoomOutBtn && zoomOutBtn.dataset.bound !== "1") {
    zoomOutBtn.dataset.bound = "1";
    zoomOutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6NudgeScale(-0.2);
    });
  }
  if (zoomResetBtn && zoomResetBtn.dataset.bound !== "1") {
    zoomResetBtn.dataset.bound = "1";
    zoomResetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6ResetView();
    });
  }
  try { dp6UpdateZoomLabel(); } catch (_) {}

  // Zoom molette (sur la zone de travail) — visuel uniquement
  if (workspace && workspace.dataset.dp6WheelBound !== "1") {
    workspace.dataset.dp6WheelBound = "1";
    workspace.addEventListener(
      "wheel",
      (e) => {
        // Actif uniquement lorsque le modal est ouvert + une image est présente
        if (!modal || modal.getAttribute("aria-hidden") === "true") return;
        if (!dp6HasSourceImage()) return;
        try { e.preventDefault(); } catch (_) {}

        const dy = typeof e.deltaY === "number" ? e.deltaY : 0;
        // Zoom fluide : multiplicatif
        const factor = dy < 0 ? 1.12 : 1 / 1.12;
        dp6SetScaleAtClientPoint(dp6View.scale * factor, e.clientX, e.clientY);
      },
      { passive: false }
    );
  }

  // Gestion sélection fichier
  if (fileInput.dataset.bound !== "1") {
    fileInput.dataset.bound = "1";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      // Sécurité: ne traiter que jpeg/png
      if (file.type !== "image/jpeg" && file.type !== "image/png") return;

      const reader = new FileReader();
      reader.onload = () => {
        if (!workspace) return;

        dp6DisplayImportedImage(reader.result, "Photo source DP6");
      };

      reader.readAsDataURL(file);
    });
  }

  window.__snDp6UndoImpl = dp6Undo;
  window.__snDp6DeleteActivePatchImpl = dp6DeleteActivePatch;

  if (deleteBtn && deleteBtn.dataset.dp6Bound !== "1") {
    deleteBtn.dataset.dp6Bound = "1";
    deleteBtn.addEventListener("click", () => {
      if (typeof window.__snDp6DeleteActivePatchImpl === "function") {
        window.__snDp6DeleteActivePatchImpl();
      }
    });
  }
  if (undoBtn && undoBtn.dataset.dp6Bound !== "1") {
    undoBtn.dataset.dp6Bound = "1";
    undoBtn.addEventListener("click", () => {
      if (typeof window.__snDp6UndoImpl === "function") {
        window.__snDp6UndoImpl();
      }
    });
  }

  if (!window.__snDp6UndoKeydownBound) {
    window.__snDp6UndoKeydownBound = true;
    document.addEventListener(
      "keydown",
      (e) => {
        const modalEl = document.getElementById("dp6-photo-modal");
        if (!modalEl || modalEl.getAttribute("aria-hidden") !== "false") return;

        const st = window.DP6_STATE;
        if (!st) return;

        const el = e.target;
        const tag = el && el.nodeType === 1 ? String(el.tagName || "").toUpperCase() : "";
        const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable);
        if (typing) return;

        if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "z") {
          if (e.shiftKey) return;
          const stack = window.DP6_UNDO_STACK;
          if (!stack || !stack.length) return;
          e.preventDefault();
          if (typeof window.__snDp6UndoImpl === "function") window.__snDp6UndoImpl();
          return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
          const rawIdx = st.activePatchIndex;
          const idx = typeof rawIdx === "number" ? rawIdx : Number(rawIdx);
          if (!Number.isFinite(idx) || idx < 0) return;
          e.preventDefault();
          if (typeof window.__snDp6DeleteActivePatchImpl === "function") window.__snDp6DeleteActivePatchImpl();
        }
      },
      true
    );
  }

  const bindHost = btnBefore || btnAfter;
  if (bindHost.dataset.bound === "1") return;
  bindHost.dataset.bound = "1";

  function openDP6Modal() {
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dp-lock-scroll");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ws = document.getElementById("dp6-photo-workspace");
        const mc = modal ? modal.querySelector(".dp-map-canvas") : null;
        const wr = ws ? ws.getBoundingClientRect() : { width: 0, height: 0 };
        const mr = mc ? mc.getBoundingClientRect() : { width: 0, height: 0 };
        console.log(
          "MAP CONTAINER OK",
          "modal workspace",
          Math.round(wr.width),
          Math.round(wr.height),
          "mapCanvas",
          Math.round(mr.width),
          Math.round(mr.height)
        );
      });
    });
    // Par défaut, ré-ouvrir au zoom 100% (évite des surprises)
    try { dp6ResetView(); } catch (_) {}
    // UX : ne jamais ré-ouvrir un modal directement en mode édition
    try {
      const wasEdit = dp6GetSelectionUIMode() === DP6_SELECTION_UI_MODE_EDIT;
      dp6SetSelectionUIMode(DP6_SELECTION_UI_MODE_DRAW);
      dp6SetActivePatchIndex(null);
      if (wasEdit) {
        // Empêche une validation accidentelle (double patch) si l'utilisateur quitte l'édition sans re-valider
        try { dp6CropClearSelection(); } catch (_) {}
      }
    } catch (_) {}
    // Si une image est déjà présente (ré-ouverture), ré-assurer l'overlay.
    try {
      requestAnimationFrame(() => {
        try { renderDP6Canvas(); } catch (_) {}
        try { dp6EnsureSelectionEditor(); } catch (_) {}
      });
    } catch (_) {}
    try { dp6SyncValidateButtonUI(); } catch (_) {}
  }

  function closeDP6Modal() {
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dp-lock-scroll");
    // Nettoyage strict si Street View était ouvert
    try { dp6DestroyGoogleView(); } catch (_) {}
  }

  // Bouton "Valider la sélection" (fige un patch, ne valide pas le projet)
  if (validateSelectionBtn && validateSelectionBtn.dataset.bound !== "1") {
    validateSelectionBtn.dataset.bound = "1";
    validateSelectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6FinalizeActivePatchSelection();
    });
  }

  // Bouton "Modifier la sélection" (entre en mode édition des patches existants)
  if (editSelectionBtn && editSelectionBtn.dataset.bound !== "1") {
    editSelectionBtn.dataset.bound = "1";
    editSelectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp6EnterEditSelectionMode();
    });
  }

  // Bouton "Re-valider la sélection" (commit l'édition sur le patch actif, puis sortie du mode édition)
  if (revalidateSelectionBtn && revalidateSelectionBtn.dataset.bound !== "1") {
    revalidateSelectionBtn.dataset.bound = "1";
    revalidateSelectionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const ok = dp6CommitActivePatchEditFromSelection();
      if (!ok) return;
      dp6ExitEditSelectionMode();
    });
  }

  // Bouton "Valider le photomontage" (export du canvas avec TOUS les patches)
  if (validateBtn && validateBtn.dataset.bound !== "1") {
    validateBtn.dataset.bound = "1";
    validateBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!dp6HasSourceImage()) return;
      const patches = Array.isArray(window.DP6_STATE?.patches) ? window.DP6_STATE.patches : [];
      const isBefore = window.DP6_STATE?.category === "BEFORE";
      const hasPanels = Array.isArray(patches) && patches.length > 0;
      if (!isBefore && !hasPanels) return;

      // Garantir un export "final" : ne pas inclure la sélection active
      try { dp6CropClearSelection(); } catch (_) {}
      try { await renderDP6Canvas(); } catch (_) {}

      const canvas = dp6EnsureWorkspaceCanvas();
      if (!canvas) return;
      let out = "";
      try { out = canvas.toDataURL("image/png"); } catch (_) { out = ""; }
      if (!out || !out.startsWith("data:image")) return;

      try {
        window.DP6_STATE = window.DP6_STATE || {};
        if (isBefore) {
          window.DP6_STATE.beforeImage = out;
        } else {
          window.DP6_STATE.afterImage = out;
        }
      } catch (_) {}

      dp6RenderEntryMiniatures();
      dp6SyncValidateButtonUI();
      closeDP6Modal();
    });
  }

  if (btnBefore) {
    btnBefore.addEventListener("click", (e) => {
      e.preventDefault();
      dp6SetCategory("BEFORE");
      openDP6Modal();
    });
  }

  if (btnAfter) {
    btnAfter.addEventListener("click", (e) => {
      e.preventDefault();
      dp6SetCategory("AFTER");
      openDP6Modal();
    });
  }

  modal.addEventListener("click", (e) => {
    if (
      e.target.closest(".dp-modal-close") ||
      e.target.closest("#dp6-cancel") ||
      e.target.closest(".dp-modal-backdrop")
    ) {
      e.preventDefault();
      closeDP6Modal();
    }
  });

  // Brancher le bouton d’export PDF (présent dans pages/dp6.html)
  try { if (typeof window.bindDP6ExportPdfButton === "function") window.bindDP6ExportPdfButton(); } catch (_) {}

  try {
    if (window.snDpV && typeof window.snDpV.migrateKind === "function") {
      window.snDpV.migrateKind("dp6");
    }
    if (typeof window.snDpVSetupPageUi === "function") {
      window.snDpVSetupPageUi("dp6", {
        onAfter: function () {
          try {
            renderDP6Canvas();
          } catch (_) {}
          try {
            dp6RenderEntryMiniatures();
          } catch (_) {}
        },
      });
    }
  } catch (_) {}

  console.log("[DP6] init ok");
}

// ===============================
// DP6 — EXPORT PDF
// ===============================
window.bindDP6ExportPdfButton = window.bindDP6ExportPdfButton || function bindDP6ExportPdfButton() {
  const btn = document.getElementById("dp6-export-pdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  // Routeur PDF (aligné DP2 / DP4) : un switch/case, pas de logique métier.
  window.generateDPDocumentPDF =
    window.generateDPDocumentPDF ||
    (async function generateDPDocumentPDF({ type, state }) {
      const t = String(type || "");
      if (t === "DP2") return generateDP2PDF();
      if (t === "DP4") return generateDP4PDF();
      if (t === "DP6") return generateDP6PDF(state);
      throw new Error(`Type PDF non supporté: ${t}`);
    });

  async function generateDP6PDF(dp6State) {
    // Enrichir le payload DP6 avec les contextes DP1 + SmartPitch (nécessaires au renderer PDF DP6)
    const st = window.DP6_STATE || {};
    const dp1 = window.DP1_CONTEXT || null;
    const sp = window.SMARTPITCH_CTX || null;
    const cad = window.DP1_STATE?.selectedParcel || null;

    const ref = cad ? [cad.section, cad.numero].filter(Boolean).join(" ").trim() : "";
    const enrichedDP1 = {
      ...(dp1 || {}),
      ref_cadastrale: ref || (dp1?.ref_cadastrale || ""),
      parcelle: cad
        ? { section: cad.section, numero: cad.numero, surface_m2: cad.surface_m2 ?? null }
        : (dp1?.parcelle || null),
    };

    const dp6Data = {
      ...st,
      DP1_CONTEXT: enrichedDP1,
      SMARTPITCH_CTX: sp,
    };

    await __solarnextDpFetchPdfWithReplace(
      "/pdf/render/dp6/pdf",
      function () {
        return { dp6Data: dp6Data };
      },
      "dp6"
    );
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();

    const st = window.DP6_STATE || null;
    const hasBefore = !!(st && typeof st.beforeImage === "string" && st.beforeImage.startsWith("data:image"));
    const hasAfter = !!(st && typeof st.afterImage === "string" && st.afterImage.startsWith("data:image"));
    if (!hasBefore || !hasAfter) {
      window.__snDpAlert("DP6 : images AVANT et APRÈS requises pour l’export PDF");
      return;
    }

    if (st.beforeImage === st.afterImage) {
      window.__snDpAlert("DP6 : l'image AVANT et l'image APRÈS sont identiques. Validez un vrai photomontage après travaux avant l'export PDF.");
      return;
    }
    const patches = Array.isArray(st.patches) ? st.patches : [];
    if (!patches.length) {
      window.__snDpAlert("DP6 : ajoutez au moins une zone de panneaux sur l'image APRÈS avant l'export PDF.");
      return;
    }

    try {
      await window.generateDPDocumentPDF({
        type: "DP6",
        state: st,
      });
    } catch (err) {
      window.__snDpAlert("Erreur lors de la génération du PDF DP6 (backend indisponible ou données invalides).");
    }
  });
};

// ===============================
// DP7 — EXPORT PDF (ALIGNÉ DP2/DP4/DP6)
// ===============================
window.bindDP7ExportPdfButton = window.bindDP7ExportPdfButton || function bindDP7ExportPdfButton() {
  const btn = document.getElementById("dp7-export-pdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  async function generateDP7PDF() {
    const st = window.DP7_STATE || {};
    const cad = window.DP1_STATE?.selectedParcel;

    const finalImg = st.finalImage;
    if (!(typeof finalImg === "string" && finalImg.startsWith("data:image"))) {
      window.__snDpAlert("DP7 : validez d’abord l’implantation (image finale requise) avant l’export PDF.");
      return;
    }

    const dp7Data = {
      client: buildPdfClientFromDP1Context(),
      parcelle: {
        numero: cad ? [cad.section, cad.numero].filter(Boolean).join(" ") : "—",
        surface_m2: cad?.surface_m2 ?? null,
      },
      images: {
        final: finalImg,
      },
    };

    await __solarnextDpFetchPdfWithReplace(
      "/pdf/render/dp7/pdf",
      function () {
        return { dp7Data: dp7Data };
      },
      "dp7"
    );
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await generateDP7PDF();
    } catch (err) {
      window.__snDpAlert("Erreur lors de la génération du PDF DP7 (backend indisponible ou données invalides).");
    }
  });
};

// ===============================
// DP8 — EXPORT PDF (ALIAS STRICT DP7 : même payload / même moteur)
// ===============================
window.bindDP8ExportPdfButton = window.bindDP8ExportPdfButton || function bindDP8ExportPdfButton() {
  const btn = document.getElementById("dp8-export-pdf");
  if (!btn) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  async function generateDP8PDF() {
    const st = window.DP8_STATE || {};
    const cad = window.DP1_STATE?.selectedParcel;

    const finalImg = st.finalImage;
    if (!(typeof finalImg === "string" && finalImg.startsWith("data:image"))) {
      window.__snDpAlert("DP8 : validez d’abord l’implantation (image finale requise) avant l’export PDF.");
      return;
    }

    // Payload STRICTEMENT identique à DP7 (seule la route change)
    const dp8Data = {
      client: buildPdfClientFromDP1Context(),
      parcelle: {
        numero: cad ? [cad.section, cad.numero].filter(Boolean).join(" ") : "—",
        surface_m2: cad?.surface_m2 ?? null,
      },
      images: {
        final: finalImg,
      },
    };

    await __solarnextDpFetchPdfWithReplace(
      "/pdf/render/dp8/pdf",
      function () {
        return { dp8Data: dp8Data };
      },
      "dp8",
      function () {
        return window.DP8_EXPORT_FILENAME || __solarnextDpFallbackPdfName("dp8");
      }
    );
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await generateDP8PDF();
    } catch (err) {
      window.__snDpAlert("Erreur lors de la génération du PDF DP8 (backend indisponible ou données invalides).");
    }
  });
};

try {
  if (window.DpDraftStore && typeof window.DpDraftStore.hydrateFromDraft === "function") {
    window.DpDraftStore.hydrateFromDraft();
  }
} catch (e) {
  console.warn("[DP] hydrateFromDraft", e);
}
