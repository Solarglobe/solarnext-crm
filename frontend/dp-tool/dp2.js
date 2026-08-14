// Extracted from dp-app.js. Loaded after dp-app.js in legacy script order.
// ======================================================
// DP2 — ÉTATS UI (EMPTY / GENERATED) — STRICTEMENT COMME DP1
// ======================================================
function initDP2_UIStates() {
  const dp2Page = document.getElementById("dp2-page");
  if (!dp2Page) return;

  // ⚠️ DP2 contient 2 ".dp-page-actions" (header + bouton "Éditer...")
  // On cible STRICTEMENT l'action header (cohérent avec DP1).
  const actions = dp2Page.querySelector(".dp-page-head .dp-page-actions");
  if (!actions) return;

  window.DP2_UI = window.DP2_UI || {};
  window.DP2_UI.state = "EMPTY";

  window.DP2_UI.setState = function (nextState) {
    window.DP2_UI.state = nextState;

    // Bouton de téléchargement dans le MODAL DP2 (footer) :
    // - visible uniquement après capture
    // - ne ferme jamais le modal
    const modalDl = document.getElementById("dp2-modal-download");
    const modalCaptureBtn = document.getElementById("dp2-capture-btn");
    if (modalDl && modalDl.dataset.bound !== "1") {
      modalDl.dataset.bound = "1";
      modalDl.addEventListener("click", (e) => {
        e.preventDefault();
        generateDP2PDF();
      });
    }

    // ===============================
    // ÉTAT EMPTY
    // ===============================
    if (nextState === "EMPTY") {
      // Règle : bouton visible uniquement quand le plan DP2 est prêt
      actions.innerHTML = ``;
      if (modalDl) modalDl.style.display = "none";
      // Mode CAPTURE (avant plan) : on affiche le bouton "Capturer le plan"
      if (modalCaptureBtn) modalCaptureBtn.style.display = "inline-flex";
      return;
    }

    // ===============================
    // ÉTAT GENERATED
    // ===============================
    if (nextState === "GENERATED") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-primary" type="button" id="dp2-download">
          Télécharger DP2
        </button>
      `;

      const dl = document.getElementById("dp2-download");
      if (dl) {
        dl.addEventListener("click", () => {
          generateDP2PDF();
        });
      }

      if (modalDl) modalDl.style.display = "inline-flex";
      // Mode DESSIN (après capture) : le bouton "Capturer le plan" ne doit plus apparaître
      if (modalCaptureBtn) modalCaptureBtn.style.display = "none";
      return;
    }
  };

  // état initial (si capture plan déjà faite, on affiche le bouton)
  const planUi = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (planUi?.imageBase64) {
    window.DP2_UI.setState("GENERATED");
  } else {
    window.DP2_UI.setState("EMPTY");
  }
}

// ======================================================
// DP4 — ÉTATS UI (DOWNLOAD PDF) — PATTERN DP1/DP2
// Règle : bouton visible uniquement si au moins 1 rendu final existe.
// ======================================================
function initDP4_UIStates() {
  const dp4Page = document.getElementById("dp4-page");
  if (!dp4Page) return;

  const actions = dp4Page.querySelector(".dp-page-head .dp-page-actions");
  if (!actions) return;

  window.DP4_UI = window.DP4_UI || {};
  window.DP4_UI.state = "EMPTY";

  window.DP4_UI.setState = function setState(nextState) {
    window.DP4_UI.state = nextState;

    const beforeFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("before") : null;
    const afterFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("after") : null;
    const ready =
      !!(beforeFinal && typeof beforeFinal.imageBase64 === "string" && beforeFinal.imageBase64.startsWith("data:image")) ||
      !!(afterFinal && typeof afterFinal.imageBase64 === "string" && afterFinal.imageBase64.startsWith("data:image"));

    if (!ready) {
      actions.innerHTML = ``;
      return;
    }

    actions.innerHTML = `
      <button class="dp-btn dp-btn-primary" type="button" id="dp4-download">
        Télécharger DP4
      </button>
    `;

    const dl = document.getElementById("dp4-download");
    if (dl) {
      dl.addEventListener("click", (e) => {
        e.preventDefault();
        generateDP4PDF();
      });
    }
  };

  // état initial
  window.DP4_UI.setState("AUTO");
}

// ======================================================
// DP2 — IMAGE FINALE (fond capture + overlay canvas)
// - 1 seule image base64 envoyée au backend (images.plan)
// ======================================================
function collectDP2FinalPlanImageSync() {
  const imgEl = document.getElementById("dp2-captured-image");
  const overlayCanvas = document.getElementById("dp2-draw-canvas");

  if (!imgEl || !imgEl.src || !imgEl.src.startsWith("data:image")) {
    return null;
  }

  if (!overlayCanvas || overlayCanvas.width <= 0 || overlayCanvas.height <= 0) {
    return null;
  }

  if (typeof window.renderDP2FromState === "function") {
    try { window.renderDP2FromState(); } catch (_) {}
  } else if (typeof renderDP2FromState === "function") {
    try { renderDP2FromState(); } catch (_) {}
  }

  const out = document.createElement("canvas");
  const w = imgEl.naturalWidth || overlayCanvas.width;
  const h = imgEl.naturalHeight || overlayCanvas.height;
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(imgEl, 0, 0, w, h);

  // FIX snapshot : fond = capture cadastrale (imgEl) + calque de dessin (overlayCanvas) UNIQUEMENT.
  // On ne recompose PLUS les couches OpenLayers vivantes ici : cela superposait le fond de carte
  // courant (souvent satellite) par-dessus le plan cadastral capture, et dupliquait le contour
  // (calque OL bleu + contour canvas). Le contour du bati et les cotes sont deja traces sur
  // overlayCanvas par renderDP2FromState (rendu canvas du bati en mode image figee).

  ctx.drawImage(overlayCanvas, 0, 0, w, h);

  return out.toDataURL("image/png");
}

async function collectDP2FinalPlanImage() {
  const r = collectDP2FinalPlanImageSync();
  if (!r) {
    console.warn("[DP2 PDF] composition plan absente ou incomplète");
  }
  return r;
}

// ======================================================
// DP2 — VERSIONS (UX + persistance brouillon, sans toucher au moteur canvas)
// ======================================================
function dp2Uuid() {
  return "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Supprime les doublons (même id), les entrées sans id, et réaligne dp2ActiveVersionId.
 * Appelé à chaque lecture des versions (réhydratation serveur / état corrompu possible).
 */
function dp2SanitizeVersionsInPlace() {
  const s = window.DP2_STATE;
  if (!s || !Array.isArray(s.dp2Versions)) return;
  const seen = new Set();
  const out = [];
  for (let i = 0; i < s.dp2Versions.length; i++) {
    const v = s.dp2Versions[i];
    if (!v || typeof v !== "object" || v.id == null || String(v.id).trim() === "") continue;
    const id = String(v.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(v);
  }
  s.dp2Versions = out;
  if (s.dp2ActiveVersionId != null && String(s.dp2ActiveVersionId).trim() !== "") {
    const aid = String(s.dp2ActiveVersionId);
    if (!seen.has(aid)) {
      s.dp2ActiveVersionId = out.length ? out[out.length - 1].id : null;
    }
  } else if (out.length && (s.dp2ActiveVersionId == null || s.dp2ActiveVersionId === "")) {
    s.dp2ActiveVersionId = out[out.length - 1].id;
  }
}

function dp2EnsureVersionsArray() {
  if (!window.DP2_STATE) return [];
  if (!Array.isArray(window.DP2_STATE.dp2Versions)) window.DP2_STATE.dp2Versions = [];
  try {
    dp2SanitizeVersionsInPlace();
  } catch (_) {}
  return window.DP2_STATE.dp2Versions;
}

function dp2CloneWorkingStateForVersionJson() {
  const s = window.DP2_STATE;
  if (!s) return null;
  try {
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.dp2Versions;
    delete raw.dp2ActiveVersionId;
    Object.keys(raw).forEach((k) => {
      if (k.indexOf("_") === 0) delete raw[k];
    });
    /** Miroirs `dp2drv:` — jamais persistés. */
    if (Array.isArray(raw.objects)) {
      raw.objects = raw.objects.filter(function (o) {
        if (!o) return false;
        if (typeof o.dp2SyncKey === "string" && o.dp2SyncKey.indexOf("dp2drv:") === 0) return false;
        if (o.type === "building_outline") return false;
        return true;
      });
    }
    /** Bâti : source de vérité = `features` (EPSG:3857). `buildingContours` = cache écran uniquement — non persisté. */
    delete raw.buildingContours;
    return raw;
  } catch (e) {
    return null;
  }
}

function dp2WorkingHasPlanContent(sIn) {
  const s = sIn != null && typeof sIn === "object" ? sIn : window.DP2_STATE;
  if (!s) return false;
  if (s.capture_plan && s.capture_plan.imageBase64) return true;
  if (s.capture && s.capture.imageBase64) return true;
  if (Array.isArray(s.panels) && s.panels.length) return true;
  if (Array.isArray(s.businessObjects) && s.businessObjects.length) return true;
  if (Array.isArray(s.features) && s.features.some((f) => f && f.type === "polygon" && Array.isArray(f.coordinates) && f.coordinates.length)) return true;
  /** Anciens state_json : périmètre encore sous `buildingContours` — migré au chargement. */
  if (Array.isArray(s.buildingContours) && s.buildingContours.length) return true;
  if (Array.isArray(s.textObjects) && s.textObjects.length) return true;
  if (Array.isArray(s.objects) && s.objects.length) return true;
  return false;
}

function dp2VersionRowHasPersistableContent(v) {
  if (!v || typeof v !== "object") return false;
  if (typeof v.snapshot_image === "string" && v.snapshot_image.indexOf("data:image") === 0) return true;
  const sj = v.state_json;
  if (sj && typeof sj === "object" && dp2WorkingHasPlanContent(sj)) return true;
  return false;
}

/**
 * Fusionne les versions « fantômes » : plusieurs lignes sans miniature ni plan dans state_json
 * (souvent d’anciens « Nouvelle version » jamais remplis). On garde une seule ligne vide
 * (version active si possible, sinon la plus récente). Les versions avec contenu sont conservées.
 * @returns {boolean} true si dp2Versions a été modifié
 */
function dp2PruneRedundantEmptyVersionsInPlace() {
  const s = window.DP2_STATE;
  if (!s || !Array.isArray(s.dp2Versions)) return false;
  const versions = s.dp2Versions;
  const empties = [];
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    if (!v || v.id == null || String(v.id).trim() === "") continue;
    if (!dp2VersionRowHasPersistableContent(v)) empties.push(v);
  }
  if (empties.length <= 1) return false;

  const activeId =
    s.dp2ActiveVersionId != null && String(s.dp2ActiveVersionId).trim() !== ""
      ? String(s.dp2ActiveVersionId)
      : "";
  let keep = null;
  if (activeId) {
    for (let k = 0; k < empties.length; k++) {
      if (String(empties[k].id) === activeId) {
        keep = empties[k];
        break;
      }
    }
  }
  if (!keep) keep = empties[empties.length - 1];
  const keepId = String(keep.id);

  const out = [];
  for (let m = 0; m < versions.length; m++) {
    const vv = versions[m];
    if (!vv || vv.id == null || String(vv.id).trim() === "") continue;
    if (dp2VersionRowHasPersistableContent(vv)) {
      out.push(vv);
      continue;
    }
    if (String(vv.id) === keepId) out.push(vv);
  }

  if (out.length === versions.length) return false;
  s.dp2Versions = out;
  const seen = new Set(out.map((x) => (x && x.id != null ? String(x.id) : "")));
  if (activeId && !seen.has(activeId)) {
    s.dp2ActiveVersionId = out.length ? out[out.length - 1].id : null;
  }
  return true;
}

function dp2AfterHydrateMigrateVersions() {
  const s = window.DP2_STATE;
  if (!s) return;
  const versions = dp2EnsureVersionsArray();
  if (versions.length) return;
  if (!dp2WorkingHasPlanContent()) return;
  const snap = collectDP2FinalPlanImageSync();
  versions.push({
    id: dp2Uuid(),
    createdAt: new Date().toISOString(),
    snapshot_image: snap || null,
    state_json: dp2CloneWorkingStateForVersionJson()
  });
  s.dp2ActiveVersionId = versions[versions.length - 1].id;
}

/** Si le brouillon n’a pas de capture à la racine mais une version avec state_json, réapplique l’état utile. */
function dp2RehydrateWorkingFromActiveVersionIfNeeded() {
  const s = window.DP2_STATE;
  if (!s) return;
  if (s.capture && s.capture.imageBase64) return;
  const versions = dp2EnsureVersionsArray();
  if (!versions.length) return;
  const id = s.dp2ActiveVersionId;
  const v = id ? versions.find((x) => x && x.id === id) : null;
  const target = v || versions[versions.length - 1];
  const sj = target && target.state_json;
  if (
    sj &&
    typeof sj === "object" &&
    typeof dp2WorkingHasPlanContent === "function" &&
    dp2WorkingHasPlanContent(sj)
  ) {
    dp2ApplyStateJsonToWorking(sj);
  }
}

function dp2FindVersionIndexById(id) {
  const versions = dp2EnsureVersionsArray();
  if (!id) return -1;
  return versions.findIndex((v) => v && v.id === id);
}

function dp2SyncActiveVersionBeforeDraft() {
  if (window.__SN_DP4_EDITOR_ACTIVE === true) return;
  const s = window.DP2_STATE;
  if (!s) return;
  if (s.__dp2SkipNextVersionSync === true) {
    try { delete s.__dp2SkipNextVersionSync; } catch (_) { s.__dp2SkipNextVersionSync = false; }
    return;
  }
  try {
    dp2MigrateFinalGeometryState();
  } catch (_) {}
  try {
    dp2RebuildContourDisplayCacheFromFeatures();
  } catch (_) {}
  dp2EnsureVersionsArray();
  let id = s.dp2ActiveVersionId;
  if (!id && Array.isArray(s.dp2Versions) && s.dp2Versions.length) {
    id = s.dp2Versions[s.dp2Versions.length - 1].id;
    s.dp2ActiveVersionId = id;
  }
  if (!id) return;
  const stateJson = dp2CloneWorkingStateForVersionJson();
  const snap = collectDP2FinalPlanImageSync();
  // FIX stale-array : relire la liste VIVE juste avant d'ecrire. dp2EnsureVersionsArray()
  // (via dp2SanitizeVersionsInPlace) remplace s.dp2Versions par un nouveau tableau ; toute
  // reference capturee plus tot serait perimee et l'ecriture serait perdue (version vide).
  const liveVersions = s.dp2Versions;
  if (!Array.isArray(liveVersions)) return;
  const idx = liveVersions.findIndex((v) => v && v.id === id);
  if (idx < 0) return;
  const prev = liveVersions[idx] || {};
  liveVersions[idx] = {
    id: prev.id || id,
    createdAt: prev.createdAt || new Date().toISOString(),
    snapshot_image: snap != null ? snap : (prev.snapshot_image != null ? prev.snapshot_image : null),
    state_json: stateJson || prev.state_json || null
  };
}

function dp2TeardownMapIfAny() {
  try {
    if (window.__dp2MapResizeObs) {
      window.__dp2MapResizeObs.disconnect();
      window.__dp2MapResizeObs = null;
    }
  } catch (_) {}
  try {
    if (window.DP2_MAP && window.DP2_MAP.map && typeof window.DP2_MAP.map.setTarget === "function") {
      window.DP2_MAP.map.setTarget(null);
    }
  } catch (_) {}
  window.DP2_MAP = null;
  window.__DP2_INIT_DONE = false;
  try {
    dp2RestoreMapNodeToWrapForCapture();
  } catch (_) {}
}

/** Centre la vue DP2 sur lat/lon WGS84 (EPSG:4326) — fallback sans géométrie parcelle. */
function dp2CenterMapViewOnLatLon(view, lat, lon, WMTS_RESOLUTIONS) {
  if (lat == null || lon == null) return false;
  const la = Number(lat);
  const lo = Number(lon);
  if (!isFinite(la) || !isFinite(lo)) return false;
  try {
    view.setCenter(fromLonLat([lo, la]));
    const len = WMTS_RESOLUTIONS && WMTS_RESOLUTIONS.length ? WMTS_RESOLUTIONS.length : 0;
    const idx = len ? Math.min(16, Math.max(8, len - 6)) : 14;
    if (WMTS_RESOLUTIONS && WMTS_RESOLUTIONS[idx] != null) view.setResolution(WMTS_RESOLUTIONS[idx]);
    return true;
  } catch (_) {
    return false;
  }
}

function dp2ResetWorkingEditorFieldsPreservingVersions() {
  const s = window.DP2_STATE;
  if (!s) return;
  const versions = dp2EnsureVersionsArray();
  const activeId = s.dp2ActiveVersionId;
  const fresh = {
    mode: "CAPTURE",
    scale_m_per_px: null,
    orientation: "N",
    backgroundImage: null,
    objects: [],
    buildingContours: [],
    features: [],
    selectedBuildingContourId: null,
    lineVertexInteraction: null,
    disjoncteurScale: 1,
    panels: [],
    textObjects: [],
    history: [],
    currentTool: "select",
    selectedObjectId: null,
    selectedPanelId: null,
    selectedPanelIds: [],
    selectedTextId: null,
    selectedTextIds: [],
    drawingPreview: null,
    businessObjects: [],
    selectedBusinessObjectId: null,
    _businessHoverId: null,
    businessInteraction: null,
    businessDragCandidate: null,
    pvPanelInteraction: null,
    panelInteraction: null,
    panelGroupInteraction: null,
    textInteraction: null,
    selectionRect: null,
    photoCategory: null,
    panelModel: null,
    viewZoom: 1,
    viewPanX: 0,
    viewPanY: 0,
    measureLineStart: null,
    ridgeLineStart: null,
    gutterHeightDrag: null,
    gutterHeightVisualScaleDrag: null,
    capture_plan: null,
    capture_preview: null,
    capture: null,
    editorProfile: null,
    dp2Versions: versions,
    dp2ActiveVersionId: activeId,
    parcelEdgeEdit: null
  };
  Object.keys(s).forEach((k) => {
    delete s[k];
  });
  Object.assign(s, fresh);
}

function dp2PurgeWorkingPlanState(options) {
  const opts = options || {};
  const keepVersions = opts.keepVersions === true;
  const s = window.DP2_STATE;
  if (!s) return;
  if (!keepVersions) {
    s.dp2Versions = [];
    s.dp2ActiveVersionId = null;
  }
  dp2ResetWorkingEditorFieldsPreservingVersions();
  if (!keepVersions) {
    window.DP2_STATE.dp2Versions = [];
    window.DP2_STATE.dp2ActiveVersionId = null;
    window.DP2_STATE.__dp2SkipNextVersionSync = true;
  }
  try {
    dp2TeardownMapIfAny();
  } catch (_) {}
  try {
    const img = document.getElementById("dp2-captured-image");
    if (img) {
      img.removeAttribute("src");
      img.src = "";
    }
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
      canvas.width = 0;
      canvas.height = 0;
    }
    const imgWrap = document.getElementById("dp2-captured-image-wrap");
    if (imgWrap) imgWrap.style.display = "none";
    const mapWrap = document.getElementById("dp2-ign-map");
    if (mapWrap) {
      mapWrap.style.display = "";
      mapWrap.style.pointerEvents = "";
    }
  } catch (_) {}
  try {
    if (typeof dp2RemoveParcelEdgeInlineInput === "function") dp2RemoveParcelEdgeInlineInput();
    if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
  } catch (_) {}
  try {
    if (window.dp2InteractionState) {
      window.dp2InteractionState.hoveredFeatureId = null;
      window.dp2InteractionState.activeFeatureId = null;
      window.dp2InteractionState.editingFeatureId = null;
    }
  } catch (_) {}
  try { setDP2ModeCapture(); } catch (_) {}
}

function dp2ApplyStateJsonToWorking(stateJson) {
  if (!stateJson || typeof stateJson !== "object" || !window.DP2_STATE) return;
  const s = window.DP2_STATE;
  const versions = dp2EnsureVersionsArray();
  const activeId = s.dp2ActiveVersionId;
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(stateJson));
  } catch (_) {
    return;
  }
  Object.keys(s).forEach((k) => delete s[k]);
  Object.assign(s, copy);
  s.dp2Versions = versions;
  s.dp2ActiveVersionId = activeId;
  if (s.parcelEdgeEdit === undefined) s.parcelEdgeEdit = null;
  // Migration : ancien state_json avec `capture` seul → `capture_plan`
  if (s.capture && s.capture.imageBase64 && !(s.capture_plan && s.capture_plan.imageBase64)) {
    try {
      s.capture_plan = dp2CloneForHistory(s.capture);
    } catch (_) {
      s.capture_plan = s.capture;
    }
  }
  try {
    dp2MigrateFinalGeometryState();
  } catch (_) {}
}

function dp2RestoreDomForWorkingState() {
  const mapWrap = document.getElementById("dp2-ign-map");
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  const imgEl = document.getElementById("dp2-captured-image");
  const modal = document.getElementById("dp2-map-modal");
  const arrow = modal ? modal.querySelector(".dp1-north-arrow") : null;
  const planCap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (planCap?.imageBase64) {
    if (mapWrap) {
      mapWrap.style.display = "";
      mapWrap.style.pointerEvents = "none";
    }
    if (imgWrap) imgWrap.style.display = "block";
    if (imgEl) imgEl.src = planCap.imageBase64;
    if (arrow) arrow.style.display = "";
  } else {
    if (mapWrap) {
      mapWrap.style.display = "";
      mapWrap.style.pointerEvents = "";
    }
    if (imgWrap) imgWrap.style.display = "none";
    if (arrow) arrow.style.display = "";
  }
}

function dp2GetPreviewDataUrlForVersion(v) {
  if (!v || typeof v !== "object") return null;
  if (typeof v.snapshot_image === "string" && v.snapshot_image.indexOf("data:image") === 0) {
    return v.snapshot_image;
  }
  const sj = v.state_json;
  if (sj && sj.capture_plan && typeof sj.capture_plan.imageBase64 === "string") {
    return sj.capture_plan.imageBase64;
  }
  if (sj && sj.capture && typeof sj.capture.imageBase64 === "string") {
    return sj.capture.imageBase64;
  }
  return null;
}

function dp2UpdateRepairHintVisibility() {
  const row = document.getElementById("dp2-versions-repair");
  if (!row) return;
  try {
    const versions = typeof dp2EnsureVersionsArray === "function" ? dp2EnsureVersionsArray() : [];
    row.hidden = !Array.isArray(versions) || versions.length <= 5;
  } catch (_) {
    row.hidden = true;
  }
}

/** Re-render the document version dropdown from current DP2_STATE (after delete/new/dup outside menu clicks). */
function dp2RefreshDocVersionMenu() {
  try {
    if (typeof window.snDpVRefreshDocVersionMenu === "function") {
      window.snDpVRefreshDocVersionMenu("dp2");
    }
  } catch (_) {}
  try {
    if (typeof dp2UpdateRepairHintVisibility === "function") dp2UpdateRepairHintVisibility();
  } catch (_) {}
}

function dp2RenderEntryPanel() {
  const panel = document.getElementById("dp2-entry-panel");
  const prevImg = document.getElementById("dp2-entry-preview");
  const rowEmpty = document.getElementById("dp2-entry-actions-empty");
  const rowList = document.getElementById("dp2-entry-actions-has-versions");
  const emptyHint = document.getElementById("dp2-entry-preview-empty");
  if (!panel || !prevImg || !rowEmpty || !rowList) return;

  const versions = dp2EnsureVersionsArray();
  if (!versions.length) {
    panel.hidden = false;
    rowEmpty.hidden = false;
    rowList.hidden = true;
    prevImg.removeAttribute("src");
    prevImg.hidden = true;
    if (emptyHint) {
      emptyHint.textContent = "Créez votre premier plan de masse pour ce dossier.";
      emptyHint.hidden = false;
    }
    return;
  }

  panel.hidden = false;
  rowEmpty.hidden = true;
  rowList.hidden = false;

  let preview = null;
  const activeId = window.DP2_STATE?.dp2ActiveVersionId;
  if (activeId) {
    const v = versions.find((x) => x && x.id === activeId);
    preview = dp2GetPreviewDataUrlForVersion(v);
  }
  if (!preview) {
    for (let i = versions.length - 1; i >= 0; i--) {
      preview = dp2GetPreviewDataUrlForVersion(versions[i]);
      if (preview) break;
    }
  }
  if (preview) {
    prevImg.hidden = false;
    prevImg.src = preview;
    if (emptyHint) emptyHint.hidden = true;
  } else {
    prevImg.hidden = true;
    prevImg.removeAttribute("src");
    if (emptyHint) emptyHint.hidden = false;
  }
  try {
    dp2UpdateRepairHintVisibility();
  } catch (_) {}
}

function dp2EnsureVersionRowBeforeEdit() {
  const s = window.DP2_STATE;
  if (!s) return;
  const versions = dp2EnsureVersionsArray();
  if (!s.dp2ActiveVersionId) {
    if (!versions.length) {
      versions.push({
        id: dp2Uuid(),
        createdAt: new Date().toISOString(),
        snapshot_image: null,
        state_json: null
      });
    }
    s.dp2ActiveVersionId = versions[versions.length - 1].id;
  }
}

function dp2BootstrapEditorDomFromWorking() {
  const planCap =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (!planCap?.imageBase64) return;
  const mapWrapR = document.getElementById("dp2-ign-map");
  if (mapWrapR) {
    mapWrapR.style.display = "";
    mapWrapR.style.pointerEvents = "none";
  }
  const imgWrapR = document.getElementById("dp2-captured-image-wrap");
  const imgElR = document.getElementById("dp2-captured-image");
  if (imgWrapR && imgElR) {
    var __dp2BootOnce = false;
    const runEditor = function () {
      if (__dp2BootOnce) return;
      __dp2BootOnce = true;
      try {
        initDP2Editor();
        if (typeof window.renderDP2FromState === "function") window.renderDP2FromState();
      } catch (err) {
        console.warn("[DP2] restore editor", err);
      }
    };
    imgElR.onload = runEditor;
    imgElR.src = planCap.imageBase64;
    imgWrapR.style.display = "block";
    if (imgElR.complete && imgElR.naturalWidth > 0) {
      requestAnimationFrame(runEditor);
    }
  }
  try {
    dp2EnsureDp2ToolbarMountedInModal();
    initDP2Toolbar();
    initDP2DrawActions();
  } catch (err) {
    console.warn("[DP2] restore toolbar", err);
  }
  try {
    setDP2ModeEdition();
  } catch (_) {}
}

function dp2EnsureDp2ToolbarMountedInModal() {
  const modal = document.getElementById("dp2-map-modal");
  const wrap = modal ? modal.querySelector("#dp2-captured-image-wrap") : document.getElementById("dp2-captured-image-wrap");
  if (!wrap) return;
  const zoom = wrap.querySelector("#dp2-zoom-container");
  const insertBeforeEl = zoom || null;
  const wanted = [
    { id: "dp2-toolbar", marker: "dp2ToolbarBound" },
    { id: "dp2-draw-actions", marker: "dp2DrawActionsDelegate" }
  ];
  wanted.forEach(function (item) {
    if (wrap.querySelector("#" + item.id)) return;
    const el = document.getElementById(item.id);
    if (!el || wrap.contains(el)) return;
    try {
      wrap.insertBefore(el, insertBeforeEl);
      if (el.dataset && item.marker === "dp2ToolbarBound") delete el.dataset[item.marker];
    } catch (_) {}
  });
}

function dp2OnEntryCreateFirstPlan(e) {
  if (e) e.preventDefault();
  const versions = dp2EnsureVersionsArray();
  const id = dp2Uuid();
  versions.push({
    id,
    createdAt: new Date().toISOString(),
    snapshot_image: null,
    state_json: null
  });
  window.DP2_STATE.dp2ActiveVersionId = id;
  dp2TeardownMapIfAny();
  dp2ResetWorkingEditorFieldsPreservingVersions();
  dp2RestoreDomForWorkingState();
  setDP2ModeCapture();
  if (typeof window.dp2OpenMapModal === "function") window.dp2OpenMapModal();
  try {
    dp2RefreshDocVersionMenu();
  } catch (_) {}
}

function dp2OnEntryContinue(e) {
  if (e) e.preventDefault();
  dp2EnsureVersionRowBeforeEdit();
  const planContEarly =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (!planContEarly?.imageBase64) {
    dp2TeardownMapIfAny();
  }
  dp2RestoreDomForWorkingState();
  const planCont =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (window.__SN_DP_DP2_DEBUG__ === true) {
    try {
      var _s = window.DP2_STATE;
      console.log("[DP2 DEBUG] continue DP2_STATE", _s);
      console.log("[DP2 DEBUG] continue capture_plan", _s && _s.capture_plan);
      console.log("[DP2 DEBUG] continue buildingContours", _s && _s.buildingContours);
      console.log("[DP2 DEBUG] continue objects len", _s && _s.objects && _s.objects.length);
      console.log("[DP2 DEBUG] continue dp2Versions", _s && _s.dp2Versions);
      console.log("[DP2 DEBUG] continue dp2ActiveVersionId", _s && _s.dp2ActiveVersionId);
    } catch (_) {}
  }
  if (planCont?.imageBase64) {
    dp2BootstrapEditorDomFromWorking();
  } else {
    try {
      setDP2ModeCapture();
    } catch (_) {}
  }
  if (typeof window.dp2OpenMapModal === "function") window.dp2OpenMapModal();
}

function dp2OnEntryNewVersion(e) {
  if (e) e.preventDefault();
  dp2SyncActiveVersionBeforeDraft();
  const versions = dp2EnsureVersionsArray();
  const id = dp2Uuid();
  versions.push({
    id,
    createdAt: new Date().toISOString(),
    snapshot_image: null,
    state_json: null
  });
  window.DP2_STATE.dp2ActiveVersionId = id;
  dp2TeardownMapIfAny();
  dp2ResetWorkingEditorFieldsPreservingVersions();
  dp2RestoreDomForWorkingState();
  setDP2ModeCapture();
  if (typeof window.dp2OpenMapModal === "function") window.dp2OpenMapModal();
  try {
    dp2RefreshDocVersionMenu();
  } catch (_) {}
}

async function dp2OnEntryDeleteVersion(e) {
  if (e) e.preventDefault();
  if (
    !(await window.__snDpConfirm("Supprimer cette version du plan de masse ?", {
      title: "Supprimer la version DP2",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    }))
  ) return;
  const versions = dp2EnsureVersionsArray();
  const id = window.DP2_STATE.dp2ActiveVersionId;
  const idx = dp2FindVersionIndexById(id);
  if (idx < 0) return;
  versions.splice(idx, 1);
  let purgedAllDp2Versions = false;
  dp2TeardownMapIfAny();
  if (versions.length) {
    const last = versions[versions.length - 1];
    window.DP2_STATE.dp2ActiveVersionId = last.id;
    const sj = last.state_json && typeof last.state_json === "object" ? last.state_json : null;
    if (sj && dp2WorkingHasPlanContent(sj)) {
      dp2ApplyStateJsonToWorking(sj);
    } else if (dp2ApplySnapshotImageToWorkingCapture(last.snapshot_image)) {
      /* miniature seule */
    } else {
      dp2ResetWorkingEditorFieldsPreservingVersions();
    }
  } else {
    dp2PurgeWorkingPlanState();
    purgedAllDp2Versions = true;
  }
  dp2RestoreDomForWorkingState();
  const planCapActive =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (planCapActive?.imageBase64) {
    dp2BootstrapEditorDomFromWorking();
  } else {
    try {
      setDP2ModeCapture();
    } catch (_) {}
    // LOT4: apres suppression de version, revenir sur la carte IGN de capture
    // (comme "nouveau plan") au lieu de laisser un fond fige/vide. Cf. dp2OnEntryNewVersion.
    try {
      if (!purgedAllDp2Versions && typeof window.dp2OpenMapModal === "function") window.dp2OpenMapModal();
    } catch (_) {}
  }
  dp2RenderEntryPanel();
  if (typeof window.DP2_UI?.setState === "function") {
    window.DP2_UI.setState(planCapActive?.imageBase64 ? "GENERATED" : "EMPTY");
  }
  try {
    dp2RefreshDocVersionMenu();
  } catch (_) {}
  try {
    var flushP =
      typeof window.__snDpForceFlush === "function"
        ? Promise.resolve(window.__snDpForceFlush())
        : typeof window.DpDraftStore?.forceSaveDraft === "function"
          ? Promise.resolve(window.DpDraftStore.forceSaveDraft())
          : null;
    if (flushP) {
      flushP.finally(function () {
        try {
          dp2RefreshDocVersionMenu();
        } catch (_) {}
      });
    } else if (typeof window.__snDpPersistDebounced === "function") {
      window.__snDpPersistDebounced("fast");
      try {
        Promise.resolve().then(function () {
          try {
            dp2RefreshDocVersionMenu();
          } catch (_) {}
        });
      } catch (_) {}
    }
  } catch (_) {
    try {
      dp2RefreshDocVersionMenu();
    } catch (_) {}
  }
}

async function dp2DeleteAllVersions(e) {
  if (e) e.preventDefault();
  if (
    !(await window.__snDpConfirm("Supprimer toutes les versions DP2 de ce dossier ?", {
      title: "Réinitialiser les versions DP2",
      confirmLabel: "Tout supprimer",
      cancelLabel: "Annuler",
    }))
  ) return;
  dp2PurgeWorkingPlanState();
  dp2RestoreDomForWorkingState();
  try { dp2RenderEntryPanel(); } catch (_) {}
  if (typeof window.DP2_UI?.setState === "function") {
    window.DP2_UI.setState("EMPTY");
  }
  try { dp2RefreshDocVersionMenu(); } catch (_) {}
  try {
    var flushP =
      typeof window.__snDpForceFlush === "function"
        ? Promise.resolve(window.__snDpForceFlush())
        : typeof window.DpDraftStore?.forceSaveDraft === "function"
          ? Promise.resolve(window.DpDraftStore.forceSaveDraft())
          : null;
    if (flushP) {
      flushP.finally(function () {
        try { dp2RefreshDocVersionMenu(); } catch (_) {}
        try { dp2RenderEntryPanel(); } catch (_) {}
      });
    } else if (typeof window.__snDpPersistDebounced === "function") {
      window.__snDpPersistDebounced("fast");
    }
  } catch (_) {}
}

window.dp2DeleteAllVersions = dp2DeleteAllVersions;

/**
 * Répare un brouillon surchargé : une seule version = l'état actuellement édité (plan affiché).
 * À lancer depuis la console (F12) sur la page DP2 avec le dossier déjà ouvert, puis attendre « enregistré ».
 */
function dp2CollapseVersionsToSingleActive() {
  if (!window.DP2_STATE) return Promise.resolve(null);
  const stateJson = dp2CloneWorkingStateForVersionJson();
  const snap = typeof collectDP2FinalPlanImageSync === "function" ? collectDP2FinalPlanImageSync() : null;
  const id = dp2Uuid();
  const now = new Date().toISOString();
  const s = window.DP2_STATE;
  s.dp2Versions = [
    {
      id,
      createdAt: now,
      snapshot_image: snap != null ? snap : null,
      state_json: stateJson || null,
    },
  ];
  s.dp2ActiveVersionId = id;
  try {
    dp2SanitizeVersionsInPlace();
  } catch (_) {}
  if (stateJson && dp2WorkingHasPlanContent(stateJson)) {
    dp2ApplyStateJsonToWorking(stateJson);
  } else if (typeof snap === "string" && snap.indexOf("data:image") === 0) {
    dp2ApplySnapshotImageToWorkingCapture(snap);
  } else {
    dp2ResetWorkingEditorFieldsPreservingVersions();
  }
  try {
    dp2TeardownMapIfAny();
  } catch (_) {}
  try {
    dp2RestoreDomForWorkingState();
  } catch (_) {}
  if (s.capture?.imageBase64) {
    try {
      dp2BootstrapEditorDomFromWorking();
    } catch (_) {}
  } else {
    try {
      setDP2ModeCapture();
    } catch (_) {}
  }
  try {
    dp2RenderEntryPanel();
  } catch (_) {}
  if (typeof window.DP2_UI?.setState === "function") {
    window.DP2_UI.setState(s.capture?.imageBase64 ? "GENERATED" : "EMPTY");
  }
  try {
    if (typeof window.snDpVSetupPageUi === "function") {
      window.snDpVSetupPageUi("dp2", {
        onAfter: function () {
          try {
            if (typeof dp2RenderEntryPanel === "function") dp2RenderEntryPanel();
          } catch (_) {}
        },
      });
    }
  } catch (_) {}
  try {
    if (typeof window.__snDpForceFlush === "function") {
      return window.__snDpForceFlush();
    }
    if (typeof window.DpDraftStore?.forceSaveDraft === "function") {
      return window.DpDraftStore.forceSaveDraft();
    }
  } catch (_) {}
  return Promise.resolve(null);
}

function dp2VersionStatusForDocMenu(v, activeId) {
  if (!v) return "Brouillon";
  var sj = v.state_json;
  if (sj && sj.capture_plan && sj.capture_plan.imageBase64) return "Validée";
  if (sj && sj.capture && sj.capture.imageBase64) return "Validée";
  if (sj && typeof dp2WorkingHasPlanContent === "function" && dp2WorkingHasPlanContent(sj)) return "Validée";
  if (typeof v.snapshot_image === "string" && v.snapshot_image.indexOf("data:image") === 0) return "Validée";
  if (v.id === activeId) return "En cours";
  return "Brouillon";
}

function dp2ApplySnapshotImageToWorkingCapture(snapshot) {
  if (typeof snapshot !== "string" || snapshot.indexOf("data:image") !== 0) return false;
  dp2ResetWorkingEditorFieldsPreservingVersions();
  window.DP2_STATE.capture_plan = { imageBase64: snapshot, resolution: null };
  return true;
}

function dp2SetActiveVersion(vid) {
  dp2SyncActiveVersionBeforeDraft();
  const versions = dp2EnsureVersionsArray();
  const idx = dp2FindVersionIndexById(vid);
  if (idx < 0) return;
  const v = versions[idx];
  window.DP2_STATE.dp2ActiveVersionId = vid;
  const sj = v && v.state_json && typeof v.state_json === "object" ? v.state_json : null;
  if (sj && dp2WorkingHasPlanContent(sj)) {
    dp2ApplyStateJsonToWorking(sj);
  } else if (v && dp2ApplySnapshotImageToWorkingCapture(v.snapshot_image)) {
    /* state_json absent ou vide : miniature seule (anciennes lignes de version) */
  } else {
    dp2ResetWorkingEditorFieldsPreservingVersions();
  }
  dp2TeardownMapIfAny();
  dp2RestoreDomForWorkingState();
  const planCapVer =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (planCapVer?.imageBase64) {
    dp2BootstrapEditorDomFromWorking();
  } else {
    try {
      setDP2ModeCapture();
    } catch (_) {}
  }
  try {
    dp2RenderEntryPanel();
  } catch (_) {}
  if (typeof window.DP2_UI?.setState === "function") {
    window.DP2_UI.setState(planCapVer?.imageBase64 ? "GENERATED" : "EMPTY");
  }
  try {
    dp2RefreshDocVersionMenu();
  } catch (_) {}
}

function dp2DuplicateActiveVersion() {
  dp2SyncActiveVersionBeforeDraft();
  const s = window.DP2_STATE;
  const versions = dp2EnsureVersionsArray();
  const id = s.dp2ActiveVersionId;
  const src = versions.find((v) => v && v.id === id);
  if (!src) return;
  let copy = {};
  if (src.state_json && typeof src.state_json === "object") {
    try {
      copy = JSON.parse(JSON.stringify(src.state_json));
    } catch (_) {}
  }
  const newId = dp2Uuid();
  versions.push({
    id: newId,
    createdAt: new Date().toISOString(),
    snapshot_image: src.snapshot_image || null,
    state_json: copy && typeof copy === "object" ? copy : null,
  });
  s.dp2ActiveVersionId = newId;
  if (copy && typeof copy === "object") {
    dp2ApplyStateJsonToWorking(copy);
  }
  dp2TeardownMapIfAny();
  dp2RestoreDomForWorkingState();
  const planCapDup =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : s.capture;
  if (planCapDup?.imageBase64) {
    dp2BootstrapEditorDomFromWorking();
  } else {
    try {
      setDP2ModeCapture();
    } catch (_) {}
  }
  try {
    dp2RenderEntryPanel();
  } catch (_) {}
  if (typeof window.DP2_UI?.setState === "function") {
    window.DP2_UI.setState(planCapDup?.imageBase64 ? "GENERATED" : "EMPTY");
  }
  try {
    dp2RefreshDocVersionMenu();
  } catch (_) {}
  try {
    if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
  } catch (_) {}
}

window.dp2SyncActiveVersionBeforeDraft = dp2SyncActiveVersionBeforeDraft;
window.dp2SetActiveVersion = dp2SetActiveVersion;
window.dp2DuplicateActiveVersion = dp2DuplicateActiveVersion;
window.dp2VersionStatusForDocMenu = dp2VersionStatusForDocMenu;
window.dp2CollapseVersionsToSingleActive = dp2CollapseVersionsToSingleActive;

// ======================================================
// PDF — CLIENT (SOURCE UNIQUE = DP1_CONTEXT) — DP2/DP3
// Objectif : DP3 lit EXACTEMENT comme DP2 (data.client.*)
// ======================================================
function buildPdfClientFromDP1Context() {
  const ctx = window.DP1_CONTEXT || null;
  return {
    nom: ctx ? (ctx.nom ?? "—") : "—",
    adresse: ctx ? (ctx.adresse ?? "—") : "—",
    cp: ctx ? (ctx.cp ?? "—") : "—",
    ville: ctx ? (ctx.ville ?? "—") : "—"
  };
}

// ======================================================
// DP2 — GÉNÉRATION PDF (COPIE DP1)
// ======================================================
async function generateDP2PDF() {
  // Mode "plan DP vectoriel propre" (WFS officiel) : uniquement pour le fond du PDF.
  let plan = null;
  let usedWfsBasePlan = false;
  console.log("[DP2 WFS] used only for PDF");
  try {
    if (window.DP2_MAP?.dp2OfficialCadastreWfsLayer) {
      const wfsRes = await loadDp2OfficialCadastreWfsForPlan();
      if (wfsRes?.ok === true && wfsRes.count > 0) {
        const baseDataUrl = await dp2CaptureOfficialWfsBaseImageForPdf();
        if (baseDataUrl) {
          plan = await collectDP2FinalPlanImageWithBaseImageDataUrl(baseDataUrl);
          usedWfsBasePlan = !!plan;
        }
      }
    }
  } catch (e) {
    console.error("[DP2 WFS] export base plan indisponible", e);
  }

  if (!plan) {
    if (!usedWfsBasePlan) {
      console.warn("[DP2 WFS] fallback to existing DP2 capture");
    }
    plan = await collectDP2FinalPlanImage();
  }
  if (!plan) {
    window.__snDpAlert("Image DP2 manquante");
    return;
  }

  const cad = window.DP1_STATE?.selectedParcel;

  const categoryRaw = window.DP2_STATE?.photoCategory ?? null;
  const categoryLabel =
    categoryRaw === "before"
      ? "Avant travaux"
      : categoryRaw === "after"
        ? "Après travaux"
        : "—";

  const scale = window.DP2_STATE?.scale_m_per_px;
  const scaleLabel =
    typeof scale === "number" && scale > 0
      ? `${scale.toFixed(3)} m / px`
      : "—";

  const model = window.DP2_STATE?.panelModel ?? null;
  const panels = window.DP2_STATE?.panels || [];
  let panelCount = 0;
  for (const p of panels) {
    if (p && p.type === "panel" && p.visible === true) panelCount++;
  }

  const modulePv = model
    ? {
      manufacturer: model.manufacturer || "—",
      reference: model.reference || "—",
      power_w: model.power_w != null ? `${model.power_w} W` : "—",
      dimensions:
        model.width_m != null && model.height_m != null
          ? `${model.width_m} m × ${model.height_m} m`
          : "—",
      count: panelCount
    }
    : {
      manufacturer: "—",
      reference: "—",
      power_w: "—",
      dimensions: "—",
      count: panelCount
    };

  const legendRaw =
    typeof window.getDP2GlobalLegendForPdf === "function"
      ? (window.getDP2GlobalLegendForPdf() || [])
      : [];
  const legend =
    typeof enrichLegendItemsWithIconDataUrls === "function"
      ? enrichLegendItemsWithIconDataUrls(legendRaw)
      : legendRaw;

  const dp2Data = {
    client: buildPdfClientFromDP1Context(),
    parcelle: {
      numero: cad
        ? [cad.section, cad.numero].filter(Boolean).join(" ")
        : "—",
      surface_m2: cad?.surface_m2 ?? null
    },
    dp2: {
      category: categoryLabel,
      scale: scaleLabel,
      modulePv,
      legend
    },
    images: {
      plan
    },
  };

  await __solarnextDpFetchPdfWithReplace(
    "/pdf/render/dp2/pdf",
    function () {
      return { dp2Data: dp2Data };
    },
    "dp2"
  );
}

// ======================================================
// DP4 — GÉNÉRATION PDF (PIPELINE IDENTIQUE DP2/DP3)
// - Source image : DP4_FINAL_RENDER_V1 (rendu final stocké)
// - 1 ou 2 pages (before / after)
// ======================================================
async function generateDP4PDF() {
  // A) Charger l’état DP4 complet (DP4_STATE_V1) (2 plans)
  try { dp4EnsureStateLoadedOnce(); } catch (_) {}

  const dp4State = window.DP4_STATE || null;
  const cad = window.DP1_STATE?.selectedParcel;

  // B) Charger DP4_FINAL_RENDER_V1 (rendus finaux)
  const beforeFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("before") : null;
  const afterFinal = typeof dp4GetFinalRenderFor === "function" ? dp4GetFinalRenderFor("after") : null;

  const pages = [];

  function computeBaseLegendFromPlan(plan) {
    // Réutiliser au maximum la logique DP2 :
    // - base via window.getDP2GlobalLegendForPdf() si disponible
    // - sinon fallback local (mêmes clés/règles)
    // Format DP4 demandé : [{ key, count }, ...]

    // 1) Base via getDP2GlobalLegendForPdf() (sans effets de bord)
    const getLegend = window.getDP2GlobalLegendForPdf;
    if (typeof getLegend === "function") {
      const hadDP2State = !!window.DP2_STATE;
      const prevBiz = window.DP2_STATE?.businessObjects;
      const prevPanels = window.DP2_STATE?.panels;
      const prevObjects = hadDP2State ? window.DP2_STATE?.objects : undefined;
      try {
        if (!window.DP2_STATE) window.DP2_STATE = {};
        window.DP2_STATE.businessObjects = Array.isArray(plan?.businessObjects) ? plan.businessObjects : [];
        window.DP2_STATE.panels = Array.isArray(plan?.panels) ? plan.panels : [];
        const rg = Array.isArray(plan?.roofGeometry) ? plan.roofGeometry : [];
        window.DP2_STATE.objects = rg.filter((o) => o && o.type !== "building_outline");

        const base = getLegend() || [];
        const normalized = Array.isArray(base)
          ? base
              .map((it) => ({
                key: it?.legendKey,
                legendKey: it?.legendKey,
                count: typeof it?.count === "number" ? it.count : 0,
              }))
              .filter((it) => !!it.key)
          : [];

        if (normalized.length) return normalized;
      } catch (_) {
        // ignore (fallback ci-dessous)
      } finally {
        try { if (!window.DP2_STATE) window.DP2_STATE = {}; } catch (_) {}
        try { window.DP2_STATE.businessObjects = prevBiz; } catch (_) {}
        try { window.DP2_STATE.panels = prevPanels; } catch (_) {}
        if (hadDP2State) {
          try {
            window.DP2_STATE.objects = prevObjects;
          } catch (_) {}
        }
        if (!hadDP2State) {
          try { delete window.DP2_STATE; } catch (_) { window.DP2_STATE = undefined; }
        }
      }
    }

    // 2) Fallback local
    const counts = {};

    const business = Array.isArray(plan?.businessObjects) ? plan.businessObjects : [];
    for (const obj of business) {
      if (!obj || obj.visible !== true) continue;
      if (!obj.legendKey) continue;
      counts[obj.legendKey] = (counts[obj.legendKey] || 0) + 1;
    }

    const panels = Array.isArray(plan?.panels) ? plan.panels : [];
    let panelCount = 0;
    for (const p of panels) {
      if (p && p.type === "panel" && p.visible === true) panelCount++;
    }
    if (panelCount > 0) counts["PANNEAUX_PV"] = panelCount;

    const roofG = Array.isArray(plan?.roofGeometry) ? plan.roofGeometry : [];
    let hasGutterInRoof = false;
    for (const o of roofG) {
      if (o && o.type === "gutter_height_dimension") {
        hasGutterInRoof = true;
        break;
      }
    }
    if (hasGutterInRoof) counts["HAUTEUR_EGOUT"] = 1;

    const orderedKeys = [];
    try {
      if (Array.isArray(DP2_BUSINESS_OBJECT_TYPES_ORDER) && DP2_BUSINESS_OBJECT_META) {
        for (const t of DP2_BUSINESS_OBJECT_TYPES_ORDER) {
          const k = DP2_BUSINESS_OBJECT_META?.[t]?.legendKey;
          if (k && counts[k]) orderedKeys.push(k);
        }
      }
    } catch (_) {}

    if (panelCount > 0) orderedKeys.push("PANNEAUX_PV");
    if (hasGutterInRoof && !orderedKeys.includes("HAUTEUR_EGOUT")) orderedKeys.push("HAUTEUR_EGOUT");

    for (const k of Object.keys(counts)) {
      if (!orderedKeys.includes(k)) orderedKeys.push(k);
    }

    return orderedKeys.map((key) => ({ key, legendKey: key, count: counts[key] || 0 }));
  }

  function getScaleMPerPx(plan) {
    const s =
      plan?.capture?.scale_m_per_px ??
      dp4State?.plans?.[plan?.photoCategory]?.capture?.scale_m_per_px ??
      dp4State?.capture?.scale_m_per_px ??
      null;
    return (typeof s === "number" && Number.isFinite(s) && s > 0) ? s : null;
  }

  function getImageNaturalHeight(src) {
    return new Promise((resolve) => {
      if (!(typeof src === "string" && src.startsWith("data:image"))) return resolve(0);
      const img = new Image();
      img.onload = () => resolve(img.naturalHeight || 0);
      img.onerror = () => resolve(0);
      img.src = src;
    });
  }

  async function buildPage(category, label, finalObj) {
    const plan = dp4State?.plans?.[category] || null;
    const planImageBase64 = finalObj?.imageBase64 || null;
    if (!plan || !(typeof planImageBase64 === "string" && planImageBase64.startsWith("data:image"))) return null;

    const scale_m_per_px = getScaleMPerPx(plan);
    const imgH = await getImageNaturalHeight(planImageBase64);
    const viewHeightMetersRaw = (typeof imgH === "number" && imgH > 0 && scale_m_per_px) ? imgH * scale_m_per_px : null;
    const viewHeightMeters =
      typeof viewHeightMetersRaw === "number" && Number.isFinite(viewHeightMetersRaw)
        ? Math.round(viewHeightMetersRaw * 10) / 10
        : null;

    const baseLegend = computeBaseLegendFromPlan(plan);
    const legendWithExtras =
      typeof dp4AppendPlanLegendExtras === "function"
        ? dp4AppendPlanLegendExtras(baseLegend, plan)
        : baseLegend;
    const legend =
      typeof enrichLegendItemsWithIconDataUrls === "function"
        ? enrichLegendItemsWithIconDataUrls(legendWithExtras)
        : legendWithExtras;

    return {
      category,
      label,
      planImageBase64,
      roofType: plan.roofType ?? null,
      panelModel: plan.panelModel ?? null,
      viewHeightMeters,
      legend
    };
  }

  // C) Construire pages[] (before/after)
  if (beforeFinal) {
    const p = await buildPage("before", "Avant travaux", beforeFinal);
    if (p) pages.push(p);
  }
  if (afterFinal) {
    const p = await buildPage("after", "Après travaux", afterFinal);
    if (p) pages.push(p);
  }

  if (!pages.length) {
    window.__snDpAlert("DP4 : aucun rendu final trouvé (DP4_FINAL_RENDER_V1). Validez au moins un plan (Avant/Après).");
    return;
  }

  const dp4Data = {
    meta: {
      generatedAt: new Date().toISOString(),
      titleBase: "DP4 – Plan des toitures / implantation photovoltaïque",
    },
    client: buildPdfClientFromDP1Context(),
    parcel: {
      numero: cad ? [cad.section, cad.numero].filter(Boolean).join(" ") : "—",
      surface_m2: cad?.surface_m2 ?? null
    },
    pages
  };

  await __solarnextDpFetchPdfWithReplace(
    "/pdf/render/dp4/pdf",
    function () {
      return { dp4Data: dp4Data };
    },
    "dp4"
  );
}

// --------------------------
// DP2 — STATE GLOBAL (source de vérité unique)
// --------------------------
// Catalogue PV — source unique API (GET /api/pv/panels, repli GET /api/public/pv/panels)
window.DP_PV_PANELS_CACHE = window.DP_PV_PANELS_CACHE || {
  rows: [],
  byId: {},
  loaded: false,
  error: null,
  source: null
};
var _dpPvCatalogPromise = null;

function dpPvFormatSelectLabel(row) {
  if (!row) return "";
  const brand = String(row.brand || "").trim();
  const model = String(row.model_ref || "").trim();
  const pw = Number(row.power_wc);
  const pow = Number.isFinite(pw) ? Math.round(pw) : "—";
  const left = `${brand} ${model}`.trim();
  return left ? `${left} — ${pow}W` : `— ${pow}W`;
}

function dpPvRowToPanelModel(row) {
  if (!row || row.id == null) return null;
  const wmm = Number(row.width_mm);
  const hmm = Number(row.height_mm);
  const pw = Number(row.power_wc);
  if (!Number.isFinite(wmm) || !Number.isFinite(hmm) || wmm <= 0 || hmm <= 0) return null;
  return {
    panel_id: String(row.id),
    manufacturer: String(row.brand || "").trim(),
    reference: String(row.model_ref || "").trim(),
    power_w: Number.isFinite(pw) ? pw : null,
    width_m: wmm / 1000,
    height_m: hmm / 1000
  };
}

function dpPvFilterSelectableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r || r.id == null) return false;
    if (r.active === false) return false;
    const w = Number(r.width_mm);
    const h = Number(r.height_mm);
    const p = Number(r.power_wc);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && Number.isFinite(p);
  });
}

function dpFindPvRowForLegacyModel(model, rows) {
  if (!model || !Array.isArray(rows)) return null;
  const pid = model.panel_id != null ? String(model.panel_id) : "";
  if (pid) {
    for (const r of rows) {
      if (r && String(r.id) === pid) return r;
    }
  }
  const ref = String(model.reference || "").trim();
  if (!ref) return null;
  const man = String(model.manufacturer || "").trim();
  const sameRef = rows.filter((r) => r && String(r.model_ref || "").trim() === ref);
  if (sameRef.length === 1) return sameRef[0];
  if (man && sameRef.length > 1) {
    const m2 = sameRef.filter((r) => String(r.brand || "").trim() === man);
    if (m2.length === 1) return m2[0];
  }
  return null;
}

function dpReconcilePanelModel(model, cache) {
  const c = cache || window.DP_PV_PANELS_CACHE || {};
  const rows = Array.isArray(c.rows) ? c.rows : [];
  const byId = c.byId && typeof c.byId === "object" ? c.byId : {};
  if (!model) return null;
  if (model.panel_id && byId[String(model.panel_id)]) {
    return dpPvRowToPanelModel(byId[String(model.panel_id)]);
  }
  const hit = dpFindPvRowForLegacyModel(model, rows);
  if (hit) return dpPvRowToPanelModel(hit);
  const wm = Number(model.width_m);
  const hm = Number(model.height_m);
  if (Number.isFinite(wm) && Number.isFinite(hm) && wm > 0 && hm > 0) return model;
  return null;
}

/** Texte indexé pour la recherche d'un module (marque, modèle, puissance). */
function dpPvSearchableText(row) {
  if (!row) return "";
  const pw = Number(row.power_wc);
  return `${String(row.brand || "")} ${String(row.model_ref || "")} ${Number.isFinite(pw) ? Math.round(pw) : ""}`
    .toLowerCase();
}

/** Marques distinctes (triées) présentes dans le catalogue chargé. */
function dpPvDistinctBrands() {
  const rows = (window.DP_PV_PANELS_CACHE && window.DP_PV_PANELS_CACHE.rows) || [];
  const set = new Set();
  for (const r of rows) {
    const b = String(r && r.brand ? r.brand : "").trim();
    if (b) set.add(b);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

/** Carte cliquable d'un module : vignette photo + marque/modèle + puissance/dimensions. */
function dpBuildPanelCard(selectEl, row, selected) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "dp-pv-card";
  card.style.cssText =
    "display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:6px 8px;border:1px solid " +
    (selected ? "#2563eb" : "#e5e7eb") +
    ";background:" +
    (selected ? "#eff6ff" : "#fff") +
    ";border-radius:6px;cursor:pointer;";

  const thumb = document.createElement("div");
  thumb.style.cssText =
    "flex:0 0 auto;width:44px;height:44px;border-radius:4px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#9ca3af;font-size:11px;";
  const url = String(row && row.image_url ? row.image_url : "").trim();
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;";
    img.onerror = () => {
      thumb.textContent = "—";
    };
    thumb.appendChild(img);
  } else {
    thumb.textContent = "—";
  }

  const txt = document.createElement("div");
  txt.style.cssText = "min-width:0;flex:1 1 auto;";
  const pw = Number(row.power_wc);
  const title = document.createElement("div");
  title.style.cssText =
    "font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  title.textContent = `${String(row.brand || "").trim()} ${String(row.model_ref || "").trim()}`.trim() || "Module";
  const sub = document.createElement("div");
  sub.style.cssText = "font-size:12px;color:#6b7280;";
  const dims = row.width_mm && row.height_mm ? `  ·  ${row.width_mm}×${row.height_mm} mm` : "";
  sub.textContent = (Number.isFinite(pw) ? Math.round(pw) + " Wc" : "") + dims;
  txt.appendChild(title);
  txt.appendChild(sub);

  card.appendChild(thumb);
  card.appendChild(txt);

  card.addEventListener("click", () => {
    selectEl.__dpPvSelectedId = String(row.id);
    selectEl.value = String(row.id);
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    dpRenderPanelPickerList(selectEl);
  });
  return card;
}

/** (Re)remplit le menu marque + la liste à vignettes selon les filtres et la sélection courante. */
function dpRenderPanelPickerList(selectEl) {
  const pk = selectEl && selectEl.__dpPicker;
  if (!pk) return;
  const rows = (window.DP_PV_PANELS_CACHE && window.DP_PV_PANELS_CACHE.rows) || [];

  const curBrand = pk.brandSel.value || "";
  const brands = dpPvDistinctBrands();
  pk.brandSel.textContent = "";
  const ob = document.createElement("option");
  ob.value = "";
  ob.textContent = "Toutes les marques";
  pk.brandSel.appendChild(ob);
  for (const b of brands) {
    const o = document.createElement("option");
    o.value = b;
    o.textContent = b;
    pk.brandSel.appendChild(o);
  }
  pk.brandSel.value = brands.includes(curBrand) ? curBrand : "";

  const brandFilter = pk.brandSel.value;
  const terms = String(pk.search.value || "").toLowerCase().split(/\s+/).filter(Boolean);
  const selectedId = selectEl.value || selectEl.__dpPvSelectedId || "";

  pk.list.textContent = "";
  let shown = 0;
  for (const row of rows) {
    if (!dpPvRowToPanelModel(row)) continue;
    if (brandFilter && String(row.brand || "").trim() !== brandFilter) continue;
    if (terms.length && !terms.every((t) => dpPvSearchableText(row).includes(t))) continue;
    pk.list.appendChild(dpBuildPanelCard(selectEl, row, String(row.id) === selectedId));
    shown++;
  }
  if (shown === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:10px;color:#6b7280;font-size:13px;";
    empty.textContent = "Aucun module ne correspond.";
    pk.list.appendChild(empty);
  }
}

/** Construit (une seule fois) le picker enrichi (filtre marque + recherche + liste vignettes). Le <select> natif reste caché et sert de source de valeur. */
function dpAttachPanelPicker(selectEl) {
  if (!selectEl) return null;
  if (selectEl.dataset.dpPvPickerBound === "1") return selectEl.__dpPicker || null;
  selectEl.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = "dp-pv-picker";
  wrap.style.cssText = "border:1px solid #cbd2dc;border-radius:8px;padding:8px;background:#fff;";

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;";

  const brandSel = document.createElement("select");
  brandSel.className = "dp-pv-picker-brand";
  brandSel.style.cssText =
    "flex:0 0 auto;min-width:150px;padding:7px 10px;font-size:13px;border:1px solid #cbd2dc;border-radius:6px;";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "dp-pv-picker-search";
  search.placeholder = "Rechercher (modèle, puissance)…";
  search.autocomplete = "off";
  search.style.cssText =
    "flex:1 1 160px;min-width:140px;box-sizing:border-box;padding:7px 10px;font-size:13px;border:1px solid #cbd2dc;border-radius:6px;";

  controls.appendChild(brandSel);
  controls.appendChild(search);

  const list = document.createElement("div");
  list.className = "dp-pv-picker-list";
  list.style.cssText = "max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:6px;";

  wrap.appendChild(controls);
  wrap.appendChild(list);
  if (selectEl.parentNode) selectEl.parentNode.insertBefore(wrap, selectEl);

  selectEl.dataset.dpPvPickerBound = "1";
  selectEl.__dpPicker = { wrap, brandSel, search, list };

  const rerender = () => dpRenderPanelPickerList(selectEl);
  brandSel.addEventListener("change", rerender);
  search.addEventListener("input", rerender);

  return selectEl.__dpPicker;
}

function dpPopulatePvPanelSelectOptions(selectEl, selectedPanelId, _filterTextArg) {
  if (!selectEl) return;
  dpAttachPanelPicker(selectEl);
  const want =
    selectedPanelId != null && String(selectedPanelId) !== ""
      ? String(selectedPanelId)
      : selectEl.__dpPvSelectedId || "";
  selectEl.__dpPvSelectedId = want;
  /** Le <select> natif (caché) conserve TOUTES les options : source de valeur + compatibilité change. */
  const rows = (window.DP_PV_PANELS_CACHE && window.DP_PV_PANELS_CACHE.rows) || [];
  selectEl.textContent = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Sélectionner un module —";
  selectEl.appendChild(opt0);
  for (const row of rows) {
    if (!dpPvRowToPanelModel(row)) continue;
    const o = document.createElement("option");
    o.value = String(row.id);
    o.textContent = dpPvFormatSelectLabel(row);
    selectEl.appendChild(o);
  }
  selectEl.value = want && [...selectEl.options].some((op) => op.value === want) ? want : "";
  dpRenderPanelPickerList(selectEl);
}

function dpModelFromPanelSelectValue(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const byId = (window.DP_PV_PANELS_CACHE && window.DP_PV_PANELS_CACHE.byId) || {};
  const row = byId[v];
  return row ? dpPvRowToPanelModel(row) : null;
}

async function dpFetchPvPanelsCatalog() {
  const authUrl = __solarnextDpAbsApiUrl("pv/panels");
  let rows = null;
  let source = "auth";
  try {
    const res = await fetch(authUrl, {
      credentials: "include",
      cache: "no-store",
      headers: __solarnextDpAuthHeadersBearerOnly(),
    });
    if (res.ok) {
      rows = await res.json();
    }
  } catch (_) {}
  if (!Array.isArray(rows)) {
    source = "public";
    const pubUrl = __solarnextDpAbsApiUrl("public/pv/panels");
    try {
      const res2 = await fetch(pubUrl, { credentials: "same-origin", cache: "no-store" });
      if (res2.ok) rows = await res2.json();
    } catch (_) {}
  }
  rows = dpPvFilterSelectableRows(Array.isArray(rows) ? rows : []);
  const byId = {};
  for (const r of rows) {
    if (r && r.id != null) byId[String(r.id)] = r;
  }
  window.DP_PV_PANELS_CACHE = {
    rows,
    byId,
    loaded: true,
    error: rows.length ? null : "empty",
    source
  };
  return window.DP_PV_PANELS_CACHE;
}

function dpEnsurePvPanelsLoaded() {
  if (_dpPvCatalogPromise) return _dpPvCatalogPromise;
  _dpPvCatalogPromise = dpFetchPvPanelsCatalog().catch((e) => {
    console.warn("[DP] Catalogue PV indisponible :", e);
    window.DP_PV_PANELS_CACHE = { rows: [], byId: {}, loaded: true, error: String(e && e.message ? e.message : e), source: "none" };
    return window.DP_PV_PANELS_CACHE;
  });
  return _dpPvCatalogPromise;
}

// --------------------------
// DP2 — FORMES MÉTIER (ÉTAPE 6)
// Outils contrôlés : pas de dessin libre, objets normalisés pour la légende PDF.
// --------------------------
const DP2_BUSINESS_OBJECT_META = {
  // IMPORTANT : types et legendKey figés (ne pas modifier)
  compteur: { legendKey: "COMPTEUR_ELECTRIQUE", label: "Compteur électrique", icon: "■", defaultW: 34, defaultH: 34 },
  disjoncteur: { legendKey: "DISJONCTEUR", label: "Disjoncteur", icon: "■", defaultW: 26, defaultH: 26 },
  batterie: { legendKey: "BATTERIE_STOCKAGE", label: "Batterie de stockage", icon: "▬", defaultW: 44, defaultH: 28 },
  sens_pente: { legendKey: "SENS_PENTE", label: "Sens de la pente", icon: "↘", defaultW: 68, defaultH: 36 },
  voie_acces: { legendKey: "VOIE_ACCES", label: "Voie d’accès", icon: "🛣", defaultW: 140, defaultH: 40 },
  angle_vue: { legendKey: "ANGLE_PRISE_VUE", label: "Angle de prise de vue", icon: "△", defaultW: 74, defaultH: 54 },
  nord: { legendKey: "NORD", label: "Flèche Nord", icon: "🧭", defaultW: 70, defaultH: 90 },
  rect: { legendKey: "ANNOTATION_RECTANGLE", label: "Rectangle libre", icon: "▭", defaultW: 120, defaultH: 70 },
  circle: { legendKey: "ANNOTATION_CERCLE", label: "Cercle libre", icon: "◯", defaultW: 90, defaultH: 90 },
  triangle: { legendKey: "ANNOTATION_TRIANGLE", label: "Triangle libre", icon: "△", defaultW: 100, defaultH: 90 },
  arrow: { legendKey: "ANNOTATION_FLECHE", label: "Flèche libre", icon: "➤", defaultW: 120, defaultH: 50 }
};

Object.assign(DP2_BUSINESS_OBJECT_META.compteur, { defaultW: 24, defaultH: 24 });
Object.assign(DP2_BUSINESS_OBJECT_META.disjoncteur, { defaultW: 20, defaultH: 20 });
Object.assign(DP2_BUSINESS_OBJECT_META.batterie, { defaultW: 30, defaultH: 20 });

const DP2_BUSINESS_OBJECT_TYPES_ORDER = [
  "compteur",
  "disjoncteur",
  "batterie",
  "sens_pente",
  "voie_acces",
  "angle_vue",
  "nord",
  "rect",
  "circle",
  "triangle",
  "arrow"
];

// Map d'affichage : legendKey -> { type, meta }
// (aucune logique de détection ici ; seulement un mapping pour retrouver le type depuis legendKey)
const DP2_BUSINESS_LEGEND_BY_KEY = (() => {
  const map = {};
  for (const type of Object.keys(DP2_BUSINESS_OBJECT_META || {})) {
    const meta = DP2_BUSINESS_OBJECT_META[type];
    if (meta && meta.legendKey) map[meta.legendKey] = { type, meta };
  }
  return map;
})();

// Registre minimal légende (clés hors meta métier + panneaux / cotes toiture)
// kind: panels | cotes | faitage | gutter_height | business (via DP2_BUSINESS_LEGEND_BY_KEY)
const DP2_LEGEND_ICON_REGISTRY = {
  PANNEAUX_PV: { label: "Panneaux photovoltaïques", kind: "panels" },
  COTES: { label: "Cotes", kind: "cotes" },
  FAITAGE: { label: "Faîtage", kind: "faitage" },
  HAUTEUR_EGOUT: { label: "Hauteur égout", kind: "gutter_height" }
};

const DP2_LEGEND_ICON_CANVAS_W = 104;
const DP2_LEGEND_ICON_CANVAS_H = 68;
/** Taille fixe (px canvas) du symbole ↕ « hauteur égout » — annotation métier, pas cote. */
const DP2_GUTTER_HEIGHT_ICON_PX = 40;
const DP2_GUTTER_HEIGHT_ICON_HALF_PX = DP2_GUTTER_HEIGHT_ICON_PX / 2;
/** Échelle graphique pure (ne modifie jamais heightM). */
const DP2_GUTTER_HEIGHT_VISUAL_SCALE_MIN = 0.5;
const DP2_GUTTER_HEIGHT_VISUAL_SCALE_MAX = 3;
const DP2_GUTTER_HEIGHT_VISUAL_DRAG_SENS = 0.006;

/**
 * Dessine une miniature de légende dans ctx (0,0,cw,ch) — même logique que le plan.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} legendKey
 * @param {number} cw
 * @param {number} ch
 */
function dp2DrawLegendMiniatureToContext(ctx, legendKey, cw, ch) {
  const key = legendKey != null ? String(legendKey) : "";
  if (!ctx || !key || !(cw > 0) || !(ch > 0)) return;

  if (key === "PANNEAUX_PV") {
    const bw = 90;
    const bh = 55;
    const pad = 10;
    const sc = Math.max(0.01, Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh));
    ctx.save();
    ctx.translate((cw - bw * sc) / 2, (ch - bh * sc) / 2);
    ctx.scale(sc, sc);
    if (typeof renderDP2PanelRect === "function") {
      renderDP2PanelRect(ctx, { x: 0, y: 0, width: bw, height: bh, rotation: 0 }, DP2_PANEL_STYLE);
    }
    ctx.restore();
    return;
  }

  if (key === "COTES") {
    const ml = {
      type: "measure_line",
      a: { x: 18, y: Math.round(ch / 2) },
      b: { x: cw - 18, y: Math.round(ch / 2) },
      labelOffset: { x: 0, y: 0 }
    };
    if (typeof renderMeasureLine === "function") renderMeasureLine(ctx, ml, 0);
    return;
  }

  if (key === "FAITAGE") {
    const rl = {
      type: "ridge_line",
      a: { x: 18, y: ch - 16 },
      b: { x: cw - 18, y: 16 },
      labelOffset: { x: 0, y: 0 }
    };
    if (typeof renderRidgeLine === "function") renderRidgeLine(ctx, rl, 0);
    return;
  }

  if (key === "HAUTEUR_EGOUT" || key === "HAUTEUR_GOUTTIERE") {
    const gh = {
      type: "gutter_height_dimension",
      x: cw / 2,
      y: ch / 2,
      heightM: 2.8,
      __gutterMigratedV2: true
    };
    if (typeof renderGutterHeightDimension === "function") renderGutterHeightDimension(ctx, gh, null);
    return;
  }

  const entry = DP2_BUSINESS_LEGEND_BY_KEY[key];
  if (entry && entry.type && entry.meta && typeof renderDP2BusinessObject === "function") {
    const meta = entry.meta;
    const bw = meta.defaultW || 80;
    const bh = meta.defaultH || 50;
    const pad = 10;
    const sc = Math.max(0.01, Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh));
    ctx.save();
    ctx.translate((cw - bw * sc) / 2, (ch - bh * sc) / 2);
    ctx.scale(sc, sc);
    renderDP2BusinessObject(ctx, {
      id: "legend_icon_dummy",
      type: entry.type,
      legendKey: key,
      geometry: { x: 0, y: 0, width: bw, height: bh, rotation: 0 },
      visible: true
    });
    ctx.restore();
  }
}

function dp2GetLegendIconRegistryEntry(legendKey) {
  let k = legendKey != null ? String(legendKey) : "";
  if (!k) return null;
  if (k === "HAUTEUR_GOUTTIERE") k = "HAUTEUR_EGOUT";
  if (DP2_LEGEND_ICON_REGISTRY[k]) return DP2_LEGEND_ICON_REGISTRY[k];
  const biz = DP2_BUSINESS_LEGEND_BY_KEY[k];
  if (biz && biz.type && biz.meta) return { label: biz.meta.label, kind: "business", businessType: biz.type, meta: biz.meta };
  return null;
}

function dp2GetLegendLabelForKey(legendKey) {
  const entry = dp2GetLegendIconRegistryEntry(legendKey);
  if (entry && entry.label) return entry.label;
  return legendKey != null ? String(legendKey) : "";
}

/**
 * PNG data URL pour une entrée de légende PDF — même rendu canvas que le plan (symboles métier, panneaux, cotes DP4).
 * @param {string} legendKey ex. COMPTEUR_ELECTRIQUE, PANNEAUX_PV, COTES
 * @returns {string|null}
 */
function buildDP2LegendIconDataUrl(legendKey) {
  const key = legendKey != null ? String(legendKey) : "";
  if (!key) return null;
  try {
    const c = document.createElement("canvas");
    c.width = DP2_LEGEND_ICON_CANVAS_W;
    c.height = DP2_LEGEND_ICON_CANVAS_H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    if (typeof dp2DrawLegendMiniatureToContext !== "function") return null;
    dp2DrawLegendMiniatureToContext(ctx, key, c.width, c.height);
    const hasDraw =
      DP2_BUSINESS_LEGEND_BY_KEY[key] ||
      key === "PANNEAUX_PV" ||
      key === "COTES" ||
      key === "FAITAGE" ||
      key === "HAUTEUR_EGOUT" ||
      key === "HAUTEUR_GOUTTIERE";
    if (!hasDraw) return null;
    return c.toDataURL("image/png");
  } catch (e) {
    console.warn("[DP2] buildDP2LegendIconDataUrl", key, e);
    return null;
  }
}

window.buildDP2LegendIconDataUrl = buildDP2LegendIconDataUrl;

function enrichLegendItemsWithIconDataUrls(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const legendKey = it && (it.legendKey != null ? String(it.legendKey) : it.key != null ? String(it.key) : "");
    const count = typeof it?.count === "number" ? it.count : 0;
    const iconDataUrl =
      legendKey && typeof buildDP2LegendIconDataUrl === "function" ? buildDP2LegendIconDataUrl(legendKey) : null;
    const out = { ...it, legendKey: legendKey || it.legendKey, count };
    if (it && it.key != null) out.key = it.key;
    else if (legendKey) out.key = legendKey;
    if (iconDataUrl) out.iconDataUrl = iconDataUrl;
    return out;
  });
}

/**
 * Extras légende toiture (DP4) : COTES, FAITAGE, HAUTEUR_EGOUT — aligné PDF / UI.
 * @param {Array<{legendKey?: string, key?: string, count?: number}>} baseLegendItems
 * @param {object|null} plan
 */
function dp4AppendPlanLegendExtras(baseLegendItems, plan) {
  const legend = Array.isArray(baseLegendItems)
    ? baseLegendItems.map((it) => ({
        legendKey: it.legendKey || it.key,
        key: it.key || it.legendKey,
        count: typeof it.count === "number" ? it.count : 0
      }))
    : [];
  const hasKey = (k) => legend.some((it) => it && (it.key === k || it.legendKey === k));

  function hasLineTypeInRoofGeometry(p, type) {
    const arr = Array.isArray(p?.roofGeometry) ? p.roofGeometry : [];
    for (const o of arr) {
      if (o && o.type === type) return true;
    }
    return false;
  }

  if (hasLineTypeInRoofGeometry(plan, "measure_line") && !hasKey("COTES")) {
    legend.push({ key: "COTES", legendKey: "COTES", count: 1 });
  }
  if (hasLineTypeInRoofGeometry(plan, "ridge_line") && !hasKey("FAITAGE")) {
    legend.push({ key: "FAITAGE", legendKey: "FAITAGE", count: 1 });
  }
  if (
    hasLineTypeInRoofGeometry(plan, "gutter_height_dimension") &&
    !hasKey("HAUTEUR_EGOUT") &&
    !hasKey("HAUTEUR_GOUTTIERE")
  ) {
    legend.push({ key: "HAUTEUR_EGOUT", legendKey: "HAUTEUR_EGOUT", count: 1 });
  }
  return legend;
}

/** DP2_STATE vierge (ré-entrée lead / hydrate sans section brouillon). */
function __snDpFreshDp2State() {
  return {
    mode: "CAPTURE",        // "CAPTURE" | "EDITION"
    scale_m_per_px: null,   // valeur figée après capture (utiliser scale_m_per_px)
    orientation: "N",
    backgroundImage: null,  // { src, width, height } - indépendant du canvas
    objects: [],            // mesures / faîtages / annotations (pas le périmètre bâti)
    buildingContours: [],   // cache pixels dérivé de `features` (non persisté dans state_json)
    /** Contours bâti EPSG:3857 — source de vérité persistée. */
    features: [],
    selectedBuildingContourId: null,
    lineVertexInteraction: null,
    disjoncteurScale: 1,
    panels: [],
    textObjects: [],
    history: [],
    currentTool: "select",
    selectedObjectId: null,
    selectedPanelId: null,
    selectedPanelIds: [],
    selectedTextId: null,
    selectedTextIds: [],
    drawingPreview: null,
    businessObjects: [],
    selectedBusinessObjectId: null,
    _businessHoverId: null,
    businessInteraction: null,
    businessDragCandidate: null,
    pvPanelInteraction: null,
    panelInteraction: null,
    panelGroupInteraction: null,
    textInteraction: null,
    selectionRect: null,
    _lastSelectionRectAt: 0,
    _lastPvPanelInteractionAt: 0,
    _lastTextInteractionAt: 0,
    _businessKeyHandlerBound: false,
    photoCategory: null,
    panelModel: null,
    viewZoom: 1,
    viewPanX: 0,
    viewPanY: 0,
    measureLineStart: null,
    ridgeLineStart: null,
    gutterHeightDrag: null,
    gutterHeightVisualScaleDrag: null,
    capture_plan: null,
    capture_preview: null,
    dp2Versions: [],
    dp2ActiveVersionId: null,
    displayMode: "detailed",
    /** Édition cote segment contour (sans measure_line __parcelEdge dans objects[]). */
    parcelEdgeEdit: null
  };
}

window.DP2_STATE = window.DP2_STATE || __snDpFreshDp2State();

function dp2GetDisplayMode() {
  const m = window.DP2_STATE?.displayMode;
  return m === "simple" ? "simple" : "detailed";
}

function syncDP2DisplayModeToolbarUI() {
  const detailedBtn = document.getElementById("dp2-display-mode-detailed");
  const simpleBtn = document.getElementById("dp2-display-mode-simple");
  if (!detailedBtn || !simpleBtn) return;
  const detailed = dp2GetDisplayMode() === "detailed";
  detailedBtn.classList.toggle("dp2-tool-active", detailed);
  detailedBtn.setAttribute("aria-pressed", detailed ? "true" : "false");
  simpleBtn.classList.toggle("dp2-tool-active", !detailed);
  simpleBtn.setAttribute("aria-pressed", detailed ? "false" : "true");
}

/**
 * Alias lecture/écriture demandé produit : tableau de { id, createdAt, snapshot_image, state_json }.
 * Stockage réel : window.DP2_STATE.dp2Versions
 */
try {
  Object.defineProperty(window, "DP2_VERSIONS", {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!window.DP2_STATE) return [];
      if (!Array.isArray(window.DP2_STATE.dp2Versions)) window.DP2_STATE.dp2Versions = [];
      return window.DP2_STATE.dp2Versions;
    },
    set: function (arr) {
      if (!window.DP2_STATE) return;
      window.DP2_STATE.dp2Versions = Array.isArray(arr) ? arr : [];
    }
  });
} catch (_) {}

// État UX centralisé (DP2) — curseurs, hover, édition : ne modifie pas la géométrie métier
window.dp2InteractionState = {
  mode: "idle",
  tool: "select",
  hoveredFeatureId: null,
  activeFeatureId: null,
  editingFeatureId: null
};

function isDP2BusinessTool(tool) {
  return !!(tool && DP2_BUSINESS_OBJECT_META[tool]);
}

function isDP2TextTool(tool) {
  return tool === "text_free" || tool === "text_DP6" || tool === "text_DP7" || tool === "text_DP8";
}

const DP2_TEXT_MIN_W_PX = 40;
const DP2_TEXT_MIN_H_PX = 20;
const DP2_TEXT_DEFAULT_FONT_SIZE = 16;

// --------------------------
// DP2 — UX : RESET OUTIL ACTIF (neutre)
// - Objectif : aucun outil métier ne reste actif hors contexte de création
// - Contraintes : ne pas toucher au moteur canvas / modèle de données (on ne fait que changer l'état courant)
// --------------------------
function dp2ResetActiveToolToNeutral(options) {
  const opts = options || {};
  const preserveSelection = opts.preserveSelection === true;
  const state = window.DP2_STATE;
  if (!state) return;
  // Ne jamais interrompre un contour bâti ouvert (workflow contrôlé)
  if (typeof hasDP2OpenBuildingOutline === "function" && hasDP2OpenBuildingOutline()) return;

  // Cancel propre d'une création métier "au clic" (objet temporaire ajouté au pointerdown)
  const inter = state.businessInteraction || null;
  const pvInter = state.pvPanelInteraction || null;
  const panelInter = state.panelInteraction || null;
  const textInter = state.textInteraction || null;
  // Annuler toute interaction pointer en cours (drag/resize/rotate/create)
  // Important : évite de laisser un "outil armé" via pointer capture.
  if (inter && typeof inter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(inter.pointerId); } catch (_) {}
    }
  }
  if (pvInter && typeof pvInter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(pvInter.pointerId); } catch (_) {}
    }
  }
  if (panelInter && typeof panelInter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(panelInter.pointerId); } catch (_) {}
    }
  }
  if (textInter && typeof textInter.pointerId === "number") {
    const canvas = document.getElementById("dp2-draw-canvas");
    if (canvas && typeof canvas.releasePointerCapture === "function") {
      try { canvas.releasePointerCapture(textInter.pointerId); } catch (_) {}
    }
  }
  if (inter && inter.part === "create" && inter.id) {
    const items = state.businessObjects || [];
    const idx = items.findIndex((o) => o && o.id === inter.id);
    if (idx >= 0 && inter.hasMoved !== true) {
      items.splice(idx, 1);
      if (state.selectedBusinessObjectId === inter.id) state.selectedBusinessObjectId = null;
    }
  }

  // Purge des états d'interaction (ne doit pas survivre à un reset)
  state.businessInteraction = null;
  state.businessDragCandidate = null;
  state.pvPanelInteraction = null;
  state.panelInteraction = null;
  state.panelGroupInteraction = null;
  state.textInteraction = null;
  state.drawingPreview = null;
  state.selectionRect = null;
  state.measureLineStart = null;
  state.ridgeLineStart = null;
  state.gutterHeightDrag = null;
  state.gutterHeightVisualScaleDrag = null;
  state.panelPlacementPreview = null;

  if (state.parcelEdgeEdit != null) {
    state.parcelEdgeEdit = null;
    try {
      if (typeof dp2RemoveParcelEdgeInlineInput === "function") dp2RemoveParcelEdgeInlineInput();
    } catch (_) {}
    try {
      if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
    } catch (_) {}
  }
  const parcelIdx = (state.objects || []).findIndex(o => o && o.__parcelEdge);
  if (parcelIdx >= 0) {
    try {
      if (typeof dp2RemoveParcelEdgeInlineInput === "function") dp2RemoveParcelEdgeInlineInput();
    } catch (_) {}
    state.objects.splice(parcelIdx, 1);
  }

  if (!preserveSelection) {
    state.selectedBusinessObjectId = null;
    state.selectedPanelId = null;
    state.selectedPanelIds = [];
    state.selectedTextId = null;
    state.selectedTextIds = [];
    state.selectedObjectId = null;
    state.selectedBuildingContourId = null;
  }

  // Mode neutre : on force le tool à null, et les handlers canvas retombent sur "select"
  state.currentTool = null;

  // UI : afficher "Sélection" comme mode actif (SIG/CAO-style), fermer les menus dropdown.
  const toolbar = document.getElementById("dp2-toolbar");
  if (toolbar) {
    toolbar.querySelectorAll(".dp2-tool-btn").forEach((btn) => {
      btn.classList.remove("dp2-tool-active");
      btn.setAttribute("aria-pressed", "false");
    });
  }
  const selectBtn = document.getElementById("dp2-tool-select");
  if (selectBtn) {
    selectBtn.classList.add("dp2-tool-active");
    selectBtn.setAttribute("aria-pressed", "true");
  }

  const measuresBtn = document.getElementById("dp2-tool-measures");
  const measuresMenu = document.getElementById("dp2-measures-menu");
  if (measuresBtn) {
    measuresBtn.classList.remove("dp2-dropdown-open");
    measuresBtn.setAttribute("aria-expanded", "false");
  }
  if (measuresMenu) measuresMenu.hidden = true;
  const measuresIconEl = measuresBtn?.querySelector?.(".dp2-tool-icon") || null;
  const measuresLabelEl = measuresBtn?.querySelector?.(".dp2-tool-label") || null;
  if (measuresIconEl) measuresIconEl.textContent = "📐";
  if (measuresLabelEl) measuresLabelEl.textContent = "Mesures";

  const businessBtn = document.getElementById("dp2-tool-business");
  const businessMenu = document.getElementById("dp2-business-menu");
  if (businessBtn) {
    businessBtn.classList.remove("dp2-dropdown-open");
    businessBtn.setAttribute("aria-expanded", "false");
  }
  if (businessMenu) businessMenu.hidden = true;
  const businessIconEl = businessBtn?.querySelector?.(".dp2-tool-icon") || null;
  const businessLabelEl = businessBtn?.querySelector?.(".dp2-tool-label") || null;
  if (businessIconEl) businessIconEl.textContent = "⬚";
  if (businessLabelEl) businessLabelEl.textContent = "Formes métier";

  const textBtn = document.getElementById("dp2-tool-text");
  const textMenu = document.getElementById("dp2-text-menu");
  if (textBtn) {
    textBtn.classList.remove("dp2-dropdown-open");
    textBtn.setAttribute("aria-expanded", "false");
  }
  if (textMenu) textMenu.hidden = true;
  const textIconEl = textBtn?.querySelector?.(".dp2-tool-icon") || null;
  const textLabelEl = textBtn?.querySelector?.(".dp2-tool-label") || null;
  if (textIconEl) textIconEl.textContent = "T";
  if (textLabelEl) textLabelEl.textContent = "Texte";

  // Curseur pan / mode dessin sur le wrap
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  if (imgWrap) imgWrap.classList.remove("dp2-tool-pan");

  try {
    if (window.dp2InteractionState) {
      window.dp2InteractionState.hoveredFeatureId = null;
      window.dp2InteractionState.activeFeatureId = null;
      window.dp2InteractionState.editingFeatureId = null;
      dp2SyncInteractionToolFromDp2State();
      dp2FinalizeInteractionChrome();
    }
  } catch (_) {}

  if (typeof refreshDP2ModeStrip === "function") refreshDP2ModeStrip();

  if (typeof renderDP2FromState === "function") renderDP2FromState();
}

/**
 * Après création d’objet validée (pointerup / clic final) : repasse en mode sélection pour éviter les créations en chaîne.
 * N’appelle pas reset si un flux multi-étapes est encore en cours (mesure/faîtage : premier point seulement, contour bâti ouvert).
 */
function dp2AutoReturnToSelectIfCreationDone(options) {
  const opts = options || {};
  const state = window.DP2_STATE;
  if (!state || state.mode !== "EDITION") return;
  if (typeof hasDP2OpenBuildingOutline === "function" && hasDP2OpenBuildingOutline()) return;
  if (state.currentTool === "measure_line" && state.measureLineStart) return;
  if (state.currentTool === "ridge_line" && state.ridgeLineStart) return;

  dp2ResetActiveToolToNeutral({
    preserveSelection: opts.preserveSelection !== false,
    reason: opts.reason || "dp2_auto_select_after_create"
  });
}

function createDP2BusinessObject(type, geometry) {
  const meta = DP2_BUSINESS_OBJECT_META[type];
  if (!meta) {
    console.warn("[DP2] Type métier inconnu :", type);
    return null;
  }
  const g = geometry || {};
  const id = "biz_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  return {
    id,
    type,
    legendKey: meta.legendKey,
    geometry: {
      x: typeof g.x === "number" ? g.x : 0,
      y: typeof g.y === "number" ? g.y : 0,
      width: typeof g.width === "number" ? g.width : (meta.defaultW || 80),
      height: typeof g.height === "number" ? g.height : (meta.defaultH || 50),
      rotation: typeof g.rotation === "number" ? g.rotation : 0
    },
    visible: true
  };
}

function createDP2TextObject(textKind, content, geometry, fontSize) {
  const g = geometry || {};
  const id = "text_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  return {
    id,
    type: "text",
    textKind: textKind === "DP6" || textKind === "DP7" || textKind === "DP8" ? textKind : "free",
    content: typeof content === "string" ? content : "",
    geometry: {
      x: typeof g.x === "number" ? g.x : 0,
      y: typeof g.y === "number" ? g.y : 0,
      width: typeof g.width === "number" ? g.width : DP2_TEXT_MIN_W_PX,
      height: typeof g.height === "number" ? g.height : DP2_TEXT_MIN_H_PX,
      rotation: typeof g.rotation === "number" ? g.rotation : 0
    },
    fontSize: typeof fontSize === "number" && fontSize > 0 ? fontSize : DP2_TEXT_DEFAULT_FONT_SIZE,
    visible: true
  };
}

// Légende globale (PDF) — format validé : [{ legendKey, count }, ...]
// Scope validé : uniquement les objets "formes métier" (businessObjects).
window.getDP2GlobalLegendForPdf = function getDP2GlobalLegendForPdf() {
  const items = window.DP2_STATE?.businessObjects || [];
  const counts = {};
  for (const obj of items) {
    if (!obj || obj.visible !== true) continue;
    if (!obj.legendKey) continue;
    counts[obj.legendKey] = (counts[obj.legendKey] || 0) + 1;
  }
  // Panneaux PV (DP2_STATE.panels) — clé globale (overlay)
  const panels = window.DP2_STATE?.panels || [];
  let panelCount = 0;
  for (const p of panels) {
    if (p && p.type === "panel" && p.visible === true) panelCount++;
  }
  if (panelCount > 0) {
    counts["PANNEAUX_PV"] = panelCount;
  }
  // Hauteur égout (roofGeometry / objects) — une seule entrée légende si ≥1 annotation
  const roofObjs = window.DP2_STATE?.objects || [];
  let hasGutterHeight = false;
  for (const o of roofObjs) {
    if (o && o.type === "gutter_height_dimension") {
      hasGutterHeight = true;
      break;
    }
  }
  if (hasGutterHeight) counts["HAUTEUR_EGOUT"] = 1;
  // Ordonner de façon stable selon l'ordre officiel des types
  const orderedKeys = [];
  for (const t of DP2_BUSINESS_OBJECT_TYPES_ORDER) {
    const k = DP2_BUSINESS_OBJECT_META[t]?.legendKey;
    if (k && counts[k]) orderedKeys.push(k);
  }
  if (panelCount > 0) orderedKeys.push("PANNEAUX_PV");
  if (hasGutterHeight && !orderedKeys.includes("HAUTEUR_EGOUT")) orderedKeys.push("HAUTEUR_EGOUT");
  // Ajouter d'éventuelles clés restantes (fallback)
  for (const k of Object.keys(counts)) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k);
  }
  return orderedKeys.map((legendKey) => ({ legendKey, count: counts[legendKey] || 0 }));
};

function syncDP2LegendOverlayUI() {
  const listEl = document.getElementById("dp2-legend-list");
  const emptyEl = document.getElementById("dp2-legend-empty");
  if (!listEl) return; // DP2 pas monté

  // DP2 : la légende n'est utile que quand l'overlay d'édition DP2 est ouvert
  const modal = document.getElementById("dp2-map-modal");
  if (modal && modal.getAttribute("aria-hidden") === "true") return;

  // Stocker la signature sur un host stable (modal si possible)
  const host = modal || listEl;

  const getLegend = window.getDP2GlobalLegendForPdf;
  const legendItems = typeof getLegend === "function" ? (getLegend() || []) : [];

  // Signature stable pour éviter de re-rendre sur chaque renderDP2FromState (mousemove, etc.)
  const signature = Array.isArray(legendItems)
    ? legendItems.map((it) => `${it?.legendKey || ""}:${typeof it?.count === "number" ? it.count : 0}`).join("|")
    : "invalid";
  if (host.dataset && host.dataset.dp2LegendSig === signature) return;
  if (host.dataset) host.dataset.dp2LegendSig = signature;

  if (!Array.isArray(legendItems) || legendItems.length === 0) {
    // Reset
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  // Reset
  listEl.innerHTML = "";

  for (const item of legendItems) {
    const legendKey = item?.legendKey;
    const count = typeof item?.count === "number" ? item.count : 0;
    if (!legendKey) continue;

    const label =
      typeof dp2GetLegendLabelForKey === "function"
        ? dp2GetLegendLabelForKey(legendKey)
        : String(legendKey);

    const row = document.createElement("div");
    row.className = "dp2-legend-row";

    // Miniature : rendu EXACT via la même fonction canvas que le plan (1 seule implémentation graphique)
    const miniWrap = document.createElement("div");
    miniWrap.className = "dp2-legend-mini";
    const miniCanvas = document.createElement("canvas");
    miniCanvas.className = "dp2-legend-mini-canvas";
    // Taille interne (buffer) : un peu plus grande que le CSS pour netteté
    miniCanvas.width = DP2_LEGEND_ICON_CANVAS_W;
    miniCanvas.height = DP2_LEGEND_ICON_CANVAS_H;
    miniCanvas.setAttribute("aria-hidden", "true");
    miniWrap.appendChild(miniCanvas);

    const labelEl = document.createElement("span");
    labelEl.className = "dp2-legend-label";
    labelEl.textContent = label;

    const countEl = document.createElement("span");
    countEl.className = "dp2-legend-count";
    countEl.textContent = count > 1 ? `×${count}` : "";

    row.appendChild(miniWrap);
    row.appendChild(labelEl);
    row.appendChild(countEl);
    listEl.appendChild(row);

    try {
      const ctx = miniCanvas.getContext("2d");
      if (!ctx || typeof dp2DrawLegendMiniatureToContext !== "function") continue;
      ctx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
      dp2DrawLegendMiniatureToContext(ctx, legendKey, miniCanvas.width, miniCanvas.height);
    } catch (_) {}
  }
}

function syncDP2BusinessMenuLabels() {
  const labels = {
    compteur: "■ Compteur électrique",
    disjoncteur: "■ Disjoncteur",
    batterie: "▬ Batterie de stockage"
  };
  const menu = document.getElementById("dp2-business-menu");
  if (!menu) return;
  for (const key of Object.keys(labels)) {
    const item = menu.querySelector(`[data-tool="${key}"]`);
    if (item) item.textContent = labels[key];
  }
}

let dp2ToastTimer = null;
function showDP2Toast(message) {
  const toolbar = document.getElementById("dp2-toolbar");
  if (!toolbar) return;

  let el = toolbar.querySelector(".dp2-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "dp2-toast";
    toolbar.appendChild(el);
  }

  el.textContent = message;

  if (dp2ToastTimer) clearTimeout(dp2ToastTimer);
  dp2ToastTimer = setTimeout(() => {
    try { el.remove(); } catch (_) {}
  }, 2600);
}

function syncDP2PanelMetadataUI() {
  const manufacturerEl = document.getElementById("dp2-panel-manufacturer");
  const referenceEl = document.getElementById("dp2-panel-reference");
  const powerEl = document.getElementById("dp2-panel-power");
  const dimensionsEl = document.getElementById("dp2-panel-dimensions");

  if (!manufacturerEl || !referenceEl || !powerEl || !dimensionsEl) return;

  const model = window.DP2_STATE?.panelModel || null;

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

function initDP2MetadataUI() {
  syncDP2BusinessMenuLabels();
  // Catégorie Avant / Après (DP2)
  const photoCategorySelect = document.getElementById("dp2-photo-category");
  if (photoCategorySelect) {
    // sync état -> UI si déjà défini
    if (window.DP2_STATE?.photoCategory != null && photoCategorySelect.value !== window.DP2_STATE.photoCategory) {
      photoCategorySelect.value = window.DP2_STATE.photoCategory;
    }

    photoCategorySelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP2_STATE.photoCategory = value || null;
    });
  }

  // Sélection module PV (DP2) — catalogue central GET /api/pv/panels
  const panelSelect = document.getElementById("dp2-panel-select");
  if (panelSelect) {
    dpEnsurePvPanelsLoaded()
      .then((cache) => {
        window.DP2_STATE.panelModel = dpReconcilePanelModel(window.DP2_STATE.panelModel, cache);
        const selId = window.DP2_STATE.panelModel?.panel_id || null;
        dpPopulatePvPanelSelectOptions(panelSelect, selId);
        syncDP2PanelMetadataUI();

        if (panelSelect.dataset.dpPvPanelBound !== "1") {
          panelSelect.dataset.dpPvPanelBound = "1";
          panelSelect.addEventListener("change", (e) => {
            const value = e.target?.value || "";
            window.DP2_STATE.panelModel = dpModelFromPanelSelectValue(value);
            syncDP2PanelMetadataUI();

            if (window.DP2_STATE?.currentTool === "panels" && !window.DP2_STATE.panelModel) {
              showDP2Toast("Sélectionnez un module PV dans Paramètres.");
              dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "panel_model_unset" });
            }
          });
        }
      })
      .catch(() => {
        dpPopulatePvPanelSelectOptions(panelSelect, null);
        syncDP2PanelMetadataUI();
      });
  }
}

// ======================================================
// DP4 — PARAMÈTRES (COPIE STRICTE DP2 + 1 champ roofType)
// - Graphique uniquement
// - Stockage dans window.DP4_STATE.roofType
// - Synchronisation des paramètres DP4 -> DP2_STATE (moteur DP2 réutilisé en profil DP4_ROOF)
// ======================================================

let dp4ToastTimer = null;
function showDP4Toast(message) {
  // DP4 réutilise la toolbar DP2 dans l'overlay : on accroche la toast au même endroit.
  const toolbar = document.getElementById("dp2-toolbar");
  if (!toolbar) return;

  let el = toolbar.querySelector(".dp4-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "dp2-toast dp4-toast";
    toolbar.appendChild(el);
  }

  el.textContent = message;

  if (dp4ToastTimer) clearTimeout(dp4ToastTimer);
  dp4ToastTimer = setTimeout(() => {
    try { el.remove(); } catch (_) {}
  }, 2600);
}

function syncDP4ScaleUI() {
  const el = document.getElementById("dp4-scale");
  if (!el) return;
  // NETTOYAGE UI (DP4) :
  // - Ne pas afficher de texte "Échelle : ... m/px" (éviter doublons / info technique).
  // - La référence visuelle est le repère métrique (trait fixe + ≈ Xm) sur le plan.
  try { el.hidden = true; } catch (_) {}
  el.textContent = "";
}

// ======================================================
// DP4 — REPÈRE MÉTRIQUE (UI uniquement)
// - Trait de largeur FIXE en px (constante)
// - Valeur en mètres recalculée via DP4_STATE.capture.scale_m_per_px
// - Aucune interaction utilisateur
// - Ne dépend pas du zoom visuel (reste constant en pixels)
// ======================================================
const DP4_METRIC_MARKER_WIDTH_PX = 100; // FIXE (exigence)

function dp4FormatMetersForMarker(distanceM) {
  if (!(typeof distanceM === "number" && Number.isFinite(distanceM) && distanceM > 0)) return "—";
  const rounded = Math.round(distanceM * 10) / 10; // 1 décimale max
  // 1 décimale maximum : si entier, ne pas afficher ".0"
  return rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded.toFixed(1));
}

function dp4EnsureMetricMarkerOverlayMounted() {
  const host = document.getElementById("dp2-captured-image-wrap");
  if (!host) return null;

  let root = document.getElementById("dp4-metric-marker");
  if (root && host.contains(root)) return root;

  // Nettoyage si un node traîne ailleurs
  if (root && root.parentNode) {
    try { root.parentNode.removeChild(root); } catch (_) {}
  }

  root = document.createElement("div");
  root.id = "dp4-metric-marker";
  root.setAttribute("aria-hidden", "true");
  // Important : overlay hors dp2-zoom-container => non affecté par le zoom visuel
  root.style.cssText = [
    "position:absolute",
    "left:12px",
    "bottom:12px",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:6px 8px",
    "background:rgba(255,255,255,0.88)",
    "border:1px solid rgba(0,0,0,0.18)",
    "border-radius:4px",
    "box-shadow:0 1px 3px rgba(0,0,0,0.12)",
    "pointer-events:none",
    "user-select:none",
    "font-size:12px",
    "line-height:1",
    "color:#111"
  ].join(";");

  const line = document.createElement("div");
  line.id = "dp4-metric-marker-line";
  line.style.cssText = [
    `width:${DP4_METRIC_MARKER_WIDTH_PX}px`,
    "height:2px",
    "background:#222"
  ].join(";");

  const label = document.createElement("div");
  label.id = "dp4-metric-marker-label";
  label.textContent = "≈ — m";

  root.appendChild(line);
  root.appendChild(label);
  host.appendChild(root);
  return root;
}

function syncDP4MetricMarkerOverlayUI() {
  const root = dp4EnsureMetricMarkerOverlayMounted();
  if (!root) return;

  const label = root.querySelector("#dp4-metric-marker-label");
  if (!label) return;

  // Source : ortho DP4 (capture_ortho, rétrocompat capture)
  const orthoCap = typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : window.DP4_STATE?.capture;
  const scale_m_per_px = orthoCap?.scale_m_per_px;
  if (!(typeof scale_m_per_px === "number" && Number.isFinite(scale_m_per_px) && scale_m_per_px > 0)) {
    label.textContent = "≈ — m";
    return;
  }

  const distanceM = DP4_METRIC_MARKER_WIDTH_PX * scale_m_per_px;
  const formatted = dp4FormatMetersForMarker(distanceM);
  label.textContent = `≈ ${formatted} m`;
}

function syncDP4ViewHeightUI() {
  const el = document.getElementById("dp4-view-height");
  if (!el) return;

  // Source de vérité existante : scale_m_per_px (déjà calculée/figée à la capture).
  const scale_m_per_px = window.DP2_STATE?.scale_m_per_px;
  const canvas = document.getElementById("dp2-draw-canvas");
  const imageHeightPx = canvas && Number.isFinite(canvas.height) ? canvas.height : null;

  if (!(typeof scale_m_per_px === "number" && scale_m_per_px > 0) || !(typeof imageHeightPx === "number" && imageHeightPx > 0)) {
    el.textContent = "Hauteur de vue : —";
    return;
  }

  const heightM = imageHeightPx * scale_m_per_px;
  const rounded = Math.round(heightM * 10) / 10; // 1 décimale max
  el.textContent = `Hauteur de vue : ${rounded} m`;
}

function initDP4MetadataUI() {
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();

  // Catégorie Avant / Après (DP4)
  const photoCategorySelect = document.getElementById("dp4-photo-category");
  if (photoCategorySelect) {
    if (window.DP4_STATE?.photoCategory != null && photoCategorySelect.value !== window.DP4_STATE.photoCategory) {
      photoCategorySelect.value = window.DP4_STATE.photoCategory;
    }
    photoCategorySelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP4_STATE.photoCategory = value || null;
      if (window.__SN_DP4_EDITOR_ACTIVE === true && window.DP2_STATE) {
        window.DP2_STATE.photoCategory = window.DP4_STATE.photoCategory;
      }
    });
  }

  // Sélection module PV (DP4) — même catalogue API que DP2
  const panelSelect = document.getElementById("dp4-panel-select");
  if (panelSelect) {
    dpEnsurePvPanelsLoaded()
      .then((cache) => {
        window.DP4_STATE.panelModel = dpReconcilePanelModel(window.DP4_STATE.panelModel, cache);
        if (window.__SN_DP4_EDITOR_ACTIVE === true && window.DP2_STATE) {
          window.DP2_STATE.panelModel = window.DP4_STATE.panelModel;
        }
        const selId = window.DP4_STATE.panelModel?.panel_id || null;
        dpPopulatePvPanelSelectOptions(panelSelect, selId);

        if (panelSelect.dataset.dpPvPanelBound !== "1") {
          panelSelect.dataset.dpPvPanelBound = "1";
          panelSelect.addEventListener("change", (e) => {
            const value = e.target?.value || "";
            const next = dpModelFromPanelSelectValue(value);
            window.DP4_STATE.panelModel = next;
            if (window.__SN_DP4_EDITOR_ACTIVE === true && window.DP2_STATE) {
              window.DP2_STATE.panelModel = next;
            }

            if (window.DP2_STATE?.currentTool === "panels" && !window.DP2_STATE.panelModel) {
              showDP4Toast("Sélectionnez un module PV dans Paramètres.");
              dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "dp4_panel_model_unset" });
            }
          });
        }
      })
      .catch(() => {
        dpPopulatePvPanelSelectOptions(panelSelect, null);
      });
  }

  // DP4 UNIQUEMENT : type de toit (graphique uniquement)
  const roofTypeSelect = document.getElementById("dp4-roof-type");
  if (roofTypeSelect) {
    const current = window.DP4_STATE?.roofType ?? null;
    if (current != null && roofTypeSelect.value !== current) {
      roofTypeSelect.value = current;
    }
    roofTypeSelect.addEventListener("change", (e) => {
      const value = e.target?.value || "";
      window.DP4_STATE.roofType = value || null;
    });
  }

  syncDP4ScaleUI();
  syncDP4ViewHeightUI();
  syncDP4MetricMarkerOverlayUI();
}

function syncDP4LegendOverlayUI() {
  const listEl = document.getElementById("dp4-legend-list");
  const emptyEl = document.getElementById("dp4-legend-empty");
  if (!listEl) return; // DP4 pas monté

  const modal = document.getElementById("dp4-map-modal");
  if (modal && modal.getAttribute("aria-hidden") === "true") return;

  const host = modal || listEl;
  const getLegend = window.getDP2GlobalLegendForPdf;
  let legendItems = typeof getLegend === "function" ? (getLegend() || []).slice() : [];
  const cat = window.DP4_STATE?.photoCategory;
  const plan = cat && window.DP4_STATE?.plans ? window.DP4_STATE.plans[cat] : null;
  if (plan && typeof dp4AppendPlanLegendExtras === "function") {
    legendItems = dp4AppendPlanLegendExtras(legendItems, plan);
  }

  const signature = Array.isArray(legendItems)
    ? legendItems
        .map((it) => `${it?.legendKey || it?.key || ""}:${typeof it?.count === "number" ? it.count : 0}`)
        .join("|")
    : "invalid";
  if (host.dataset && host.dataset.dp4LegendSig === signature) return;
  if (host.dataset) host.dataset.dp4LegendSig = signature;

  if (!Array.isArray(legendItems) || legendItems.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  listEl.innerHTML = "";

  for (const item of legendItems) {
    const legendKey = item?.legendKey || item?.key;
    const count = typeof item?.count === "number" ? item.count : 0;
    if (!legendKey) continue;

    const label =
      typeof dp2GetLegendLabelForKey === "function"
        ? dp2GetLegendLabelForKey(legendKey)
        : String(legendKey);

    const row = document.createElement("div");
    row.className = "dp2-legend-row";

    const miniWrap = document.createElement("div");
    miniWrap.className = "dp2-legend-mini";
    const miniCanvas = document.createElement("canvas");
    miniCanvas.className = "dp2-legend-mini-canvas";
    miniCanvas.width = DP2_LEGEND_ICON_CANVAS_W;
    miniCanvas.height = DP2_LEGEND_ICON_CANVAS_H;
    miniCanvas.setAttribute("aria-hidden", "true");
    miniWrap.appendChild(miniCanvas);

    const labelEl = document.createElement("span");
    labelEl.className = "dp2-legend-label";
    labelEl.textContent = label;

    const countEl = document.createElement("span");
    countEl.className = "dp2-legend-count";
    countEl.textContent = count > 1 ? `×${count}` : "";

    row.appendChild(miniWrap);
    row.appendChild(labelEl);
    row.appendChild(countEl);
    listEl.appendChild(row);

    try {
      const ctx = miniCanvas.getContext("2d");
      if (!ctx || typeof dp2DrawLegendMiniatureToContext !== "function") continue;
      ctx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
      dp2DrawLegendMiniatureToContext(ctx, legendKey, miniCanvas.width, miniCanvas.height);
    } catch (_) {}
  }
}

// Préparation des données de légende DP2 (sans génération PDF)
function getDP2PanelLegendData() {
  return {
    category: window.DP2_STATE?.photoCategory ?? null,
    panel: window.DP2_STATE?.panelModel ?? null
  };
}

// Un seul contour bâti autorisé. Retourne l'objet building_outline s'il existe.
function getDP2BuildingOutline() {
  const objects = window.DP2_STATE?.objects || [];
  return objects.find((obj, idx) => obj && obj.type === "building_outline") || null;
}

// Profil éditeur : DP2 (plan de masse) vs DP4 (toiture)
function dp2IsDP4RoofProfile() {
  return window.DP2_STATE?.editorProfile === "DP4_ROOF" || window.__SN_DP4_EDITOR_ACTIVE === true;
}

function dp4IsDp4RoofState(st) {
  return !!(st && typeof st === "object" && st.editorProfile === "DP4_ROOF");
}

function dp4CaptureRealDp2StateForEditorSession() {
  try {
    if (window.__dp2RealPlanBackup && !dp4IsDp4RoofState(window.__dp2RealPlanBackup)) return;
    if (window.DP2_STATE && !dp4IsDp4RoofState(window.DP2_STATE)) {
      window.__dp2RealPlanBackup = dp4ClonePlain(window.DP2_STATE, null);
      return;
    }
    const d =
      window.DpDraftStore && typeof window.DpDraftStore.getDraft === "function"
        ? window.DpDraftStore.getDraft()
        : null;
    if (d && d.dp2 && typeof d.dp2 === "object" && !dp4IsDp4RoofState(d.dp2)) {
      window.__dp2RealPlanBackup = dp4ClonePlain(d.dp2, null);
    }
  } catch (_) {}
}

function dp4EnsureEditorStateForCategory(cat) {
  const category = cat === "before" || cat === "after" ? cat : window.DP4_STATE?.photoCategory ?? null;
  const prevEditor =
    window.DP4_EDITOR_STATE && typeof window.DP4_EDITOR_STATE === "object"
      ? window.DP4_EDITOR_STATE
      : {};
  window.DP4_EDITOR_STATE = prevEditor;
  window.DP4_EDITOR_STATE.editorProfile = "DP4_ROOF";
  window.DP4_EDITOR_STATE.mode = "EDITION";
  window.DP4_EDITOR_STATE.photoCategory = category;
  window.DP4_EDITOR_STATE.panelModel = window.DP4_STATE?.panelModel ?? window.DP4_EDITOR_STATE.panelModel ?? null;
  return window.DP4_EDITOR_STATE;
}

function dp4BeginEditorSession(cat) {
  dp4CaptureRealDp2StateForEditorSession();
  const editorState = dp4EnsureEditorStateForCategory(cat);
  window.__SN_DP4_EDITOR_ACTIVE = true;
  window.DP2_STATE = editorState;
  return editorState;
}

function dp4RestoreRealDp2StateAfterEditorSession() {
  try {
    const real = window.__dp2RealPlanBackup;
    if (real && typeof real === "object" && !dp4IsDp4RoofState(real)) {
      window.DP2_STATE = dp4ClonePlain(real, real);
    } else if (window.DP2_STATE && dp4IsDp4RoofState(window.DP2_STATE)) {
      const d =
        window.DpDraftStore && typeof window.DpDraftStore.getDraft === "function"
          ? window.DpDraftStore.getDraft()
          : null;
      if (d && d.dp2 && typeof d.dp2 === "object" && !dp4IsDp4RoofState(d.dp2)) {
        window.DP2_STATE = dp4ClonePlain(d.dp2, d.dp2);
      }
    }
    window.__SN_DP4_EDITOR_ACTIVE = false;
    try { if (typeof dp2ApplyFeaturesHydrateSync === "function") dp2ApplyFeaturesHydrateSync(); } catch (_) {}
    try { if (typeof dp2RebuildContourDisplayCacheFromFeatures === "function") dp2RebuildContourDisplayCacheFromFeatures(); } catch (_) {}
  } catch (_) {
  } finally {
    window.__SN_DP4_EDITOR_ACTIVE = false;
    window.DP4_EDITOR_STATE = null;
    window.__dp2RealPlanBackup = null;
    try { if (typeof dp2SyncDp4RoofMeasuresMenuVisibility === "function") dp2SyncDp4RoofMeasuresMenuVisibility(); } catch (_) {}
  }
}

/** Affiche l’entrée « Hauteur égout » du menu Mesures uniquement en profil toiture DP4. */
function dp2SyncDp4RoofMeasuresMenuVisibility() {
  const menu = document.getElementById("dp2-measures-menu");
  if (!menu) return;
  const show = typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile();
  menu.querySelectorAll("li[data-dp4-roof-only='1']").forEach((li) => {
    li.hidden = !show;
  });
}

// DP4 : plusieurs polygones possibles. Helpers dédiés (sans casser DP2 historique).
function dp2GetAllBuildingOutlines() {
  const objects = window.DP2_STATE?.objects || [];
  return objects.filter((o) => o && o.type === "building_outline");
}

// DP4 : plusieurs polygones possibles. On cible toujours le DERNIER contour non fermé.
function dp2GetOpenBuildingOutline() {
  const outlines = dp2GetAllBuildingOutlines();
  for (let i = outlines.length - 1; i >= 0; i--) {
    const o = outlines[i];
    if (o && o.closed === false && Array.isArray(o.points) && o.points.length >= 1) return o;
  }
  return null;
}

function dp2GetActiveBuildingOutlineForDrawing() {
  // DP2/DP4 : périmètre bâti = DP2_STATE.features (EPSG:3857) ; buildingContours = cache pixels dérivé
  return dp2GetOpenBuildingContour();
}

// True si un contour bâti est en cours (non fermé) → bloque les autres outils.
function hasDP2OpenBuildingOutline() {
  const outline = dp2GetOpenBuildingContour();
  return !!(outline && outline.closed === false && Array.isArray(outline.points) && outline.points.length >= 2);
}

// --------------------------
// DP2 — BUILDING CONTOURS (DP2 uniquement)
// --------------------------
function dp2EnsureBuildingContoursState() {
  const s = window.DP2_STATE;
  if (!s) return;
  if (!Array.isArray(s.buildingContours)) s.buildingContours = [];
  if (s.selectedBuildingContourId == null) s.selectedBuildingContourId = null;
  if (s.lineVertexInteraction == null) s.lineVertexInteraction = null;
}

function dp2NewBuildingContourId() {
  return "bct_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function dp2GetBuildingContours() {
  dp2EnsureBuildingContoursState();
  return window.DP2_STATE?.buildingContours || [];
}

function dp2GetBuildingContourById(id) {
  if (!id) return null;
  const list = dp2GetBuildingContours();
  for (const c of list) {
    if (c && c.id === id) return c;
  }
  return null;
}

function dp2GetOpenBuildingContour() {
  dp2EnsureBuildingContoursState();
  dp2EnsureFeaturesArray();
  const feats = window.DP2_STATE?.features || [];
  for (let i = feats.length - 1; i >= 0; i--) {
    const f = feats[i];
    if (f && f.type === "polygon" && f.closed === false && Array.isArray(f.coordinates) && f.coordinates.length >= 1) {
      let c = dp2GetBuildingContourById(f.id);
      if (!c || c.closed !== false) {
        try {
          dp2RebuildContourDisplayCacheFromFeatures();
        } catch (_) {}
        c = dp2GetBuildingContourById(f.id);
      }
      if (c && c.closed === false) return c;
    }
  }
  const list = dp2GetBuildingContours();
  for (let j = list.length - 1; j >= 0; j--) {
    const c = list[j];
    if (c && c.closed === false && Array.isArray(c.points) && c.points.length >= 1) return c;
  }
  return null;
}

function dp2SetSelectedBuildingContourId(id) {
  dp2EnsureBuildingContoursState();
  window.DP2_STATE.selectedBuildingContourId = id || null;
  // Sélection contour = désélectionner les autres types (UX cohérente)
  window.DP2_STATE.selectedObjectId = null;
  window.DP2_STATE.selectedBusinessObjectId = null;
  dp2ClearSelectedPanels();
  dp2ClearSelectedTexts();
  try {
    window.__DP2_BUILDING_MODIFY_MODE__ = id ? true : false;
  } catch (_) {}
}

function dp2ClearSelectedBuildingContour() {
  dp2EnsureBuildingContoursState();
  window.DP2_STATE.selectedBuildingContourId = null;
  try {
    window.__DP2_BUILDING_MODIFY_MODE__ = false;
  } catch (_) {}
}

// --------------------------
// DP2 — GÉOMÉTRIE (FAÎTAGE)
// - Ne modifie JAMAIS les points du contour.
// - Ajoute uniquement des "cuts" (cotes structurées) sur les segments intersectés.
// --------------------------
function dp2Round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function dp2Cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

// Intersection de segments [p->p2] et [q->q2]
// Retourne { x, y, t, u } si intersection, sinon null.
function dp2SegmentIntersection(p, p2, q, q2) {
  const rx = p2.x - p.x;
  const ry = p2.y - p.y;
  const sx = q2.x - q.x;
  const sy = q2.y - q.y;
  const denom = dp2Cross(rx, ry, sx, sy);
  const qpX = q.x - p.x;
  const qpY = q.y - p.y;

  const EPS = 1e-9;
  if (Math.abs(denom) < EPS) {
    // Parallèle ou colinéaire : pas de "cut" robuste (on ignore)
    return null;
  }

  const t = dp2Cross(qpX, qpY, sx, sy) / denom;
  const u = dp2Cross(qpX, qpY, rx, ry) / denom;

  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

  return { x: p.x + t * rx, y: p.y + t * ry, t, u };
}

function applyRidgeLineCutsToBuildingOutline(ridgeA, ridgeB) {
  // DP2 / DP4 : contour actif = sélection id ou premier feature polygon dans DP2_STATE.features
  const id = window.DP2_STATE?.selectedBuildingContourId || null;
  const allContours = dp2GetBuildingContours();
  const targetContours = id ? allContours.filter((c) => c && String(c.id) === String(id)) : allContours;
  if (!targetContours.length) return;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return;

  const dx = ridgeB.x - ridgeA.x;
  const dy = ridgeB.y - ridgeA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  const ux = dx / len;
  const uy = dy / len;
  for (const outline of targetContours) {
    if (!outline || !Array.isArray(outline.points) || outline.points.length < 2) continue;
    const points = outline.points;
    const segments = outline.closed ? points.length : points.length - 1;
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  for (let k = 1; k < points.length; k++) {
    const pt = points[k];
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const extend = Math.max(diag * 2, 500);
  const ridgeExtA = { x: ridgeA.x - ux * extend, y: ridgeA.y - uy * extend };
  const ridgeExtB = { x: ridgeB.x + ux * extend, y: ridgeB.y + uy * extend };

  const EPS_T = 0.015;
  const intersections = [];
  for (let i = 0; i < segments; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const inter = dp2SegmentIntersection(p1, p2, ridgeExtA, ridgeExtB);
    if (!inter) continue;
    if (inter.t < EPS_T || inter.t > 1 - EPS_T) continue;
    intersections.push({ inter, i, p1, p2 });
  }

  const DEDUPE_PX = 0.5;
  for (let a = 0; a < intersections.length; a++) {
    for (let b = intersections.length - 1; b > a; b--) {
      const ia = intersections[a].inter, ib = intersections[b].inter;
      if (Math.hypot(ia.x - ib.x, ia.y - ib.y) < DEDUPE_PX) {
        intersections.splice(b, 1);
      }
    }
  }

  if (intersections.length < 2) {
    continue;
  }

  const s = (inter, extA) => (inter.x - extA.x) * ux + (inter.y - extA.y) * uy;
  intersections.sort((a, b) => s(a.inter, ridgeExtA) - s(b.inter, ridgeExtA));
  const first = intersections[0];
  const last = intersections[intersections.length - 1];

  if (!outline.cuts || typeof outline.cuts !== "object") outline.cuts = {};
  for (const entry of [first, last]) {
    const { inter, i, p1, p2 } = entry;
    const I = { x: inter.x, y: inter.y };
    const l1Px = Math.hypot(I.x - p1.x, I.y - p1.y);
    const l2Px = Math.hypot(p2.x - I.x, p2.y - I.y);
    outline.cuts[i] = [
      { a: { x: p1.x, y: p1.y }, b: { x: I.x, y: I.y }, lengthM: dp2Round2(l1Px * scale) },
      { a: { x: I.x, y: I.y }, b: { x: p2.x, y: p2.y }, lengthM: dp2Round2(l2Px * scale) }
    ];
  }
    const feat = dp2FindPolygonFeatureById(outline.id);
    if (feat) {
      if (outline.cuts && Object.keys(outline.cuts).length) feat.cuts = outline.cuts;
      else {
        try { delete feat.cuts; } catch (_) { feat.cuts = undefined; }
      }
    }
  }
}

function dp2RebuildRidgeCutsForAllContours() {
  const contours = dp2GetBuildingContours();
  for (const contour of contours) {
    if (!contour) continue;
    contour.cuts = {};
    const feat = dp2FindPolygonFeatureById(contour.id);
    if (feat) {
      try { delete feat.cuts; } catch (_) { feat.cuts = undefined; }
    }
  }
  const objects = window.DP2_STATE?.objects || [];
  for (const obj of objects) {
    if (obj && obj.type === "ridge_line" && obj.a && obj.b) {
      applyRidgeLineCutsToBuildingOutline(obj.a, obj.b);
    }
  }
}

function setDP2ModeCapture() {
  window.DP2_STATE.mode = "CAPTURE";
  console.log("[DP2] Mode = CAPTURE");
}

function setDP2ModeEdition() {
  window.DP2_STATE.mode = "EDITION";
  console.log("[DP2] Mode = EDITION");
}

// --------------------------
// DP2 — INIT EDITOR (CANVAS)
// --------------------------
function initDP2Editor() {
  const img = document.getElementById("dp2-captured-image");
  const canvas = document.getElementById("dp2-draw-canvas");

  if (!img || !canvas) {
    console.warn("[DP2] Image ou canvas manquant pour l'éditeur");
    return;
  }

  if (!window.DP2_STATE) {
    console.warn("[DP2] Impossible d'initialiser l'éditeur : DP2_STATE absent");
    return;
  }
  if (typeof img.src !== "string" || img.src.indexOf("data:image") !== 0) {
    console.warn("[DP2] Impossible d'initialiser l'éditeur : pas d'image data: sur #dp2-captured-image");
    return;
  }

  // Synchronisation canvas ↔ image
  // ⚠️ CANVAS = CALQUE PUR : ne jamais dessiner directement dessus
  // Tout dessin doit passer par DP2_STATE.objects[] puis renderDP2FromState()
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.pointerEvents = "auto";
  canvas.style.zIndex = "2";

  // Initialisation état global DP2 (éditeur)
  // ⚠️ backgroundImage reste INDÉPENDANTE du canvas (image HTML séparée)
  window.DP2_STATE.backgroundImage = {
    src: img.src,
    width: img.naturalWidth,
    height: img.naturalHeight
  };

  if (!Array.isArray(window.DP2_STATE.objects)) {
    window.DP2_STATE.objects = [];
  }

  if (!Array.isArray(window.DP2_STATE.history)) {
    window.DP2_STATE.history = [];
  }

  if (!Array.isArray(window.DP2_STATE.businessObjects)) {
    window.DP2_STATE.businessObjects = [];
  }

  if (window.DP2_STATE.selectedBusinessObjectId == null) {
    window.DP2_STATE.selectedBusinessObjectId = null;
  }

  // Stockage dédié PANNEAUX PV (calepinage simple)
  if (!Array.isArray(window.DP2_STATE.panels)) {
    window.DP2_STATE.panels = [];
  }
  if (window.DP2_STATE.selectedPanelId == null) {
    window.DP2_STATE.selectedPanelId = null;
  }
  if (!Array.isArray(window.DP2_STATE.selectedPanelIds)) {
    window.DP2_STATE.selectedPanelIds = [];
  }

  // Stockage dédié TEXTES (annotations)
  if (!Array.isArray(window.DP2_STATE.textObjects)) {
    window.DP2_STATE.textObjects = [];
  }
  if (window.DP2_STATE.selectedTextId == null) {
    window.DP2_STATE.selectedTextId = null;
  }
  if (!Array.isArray(window.DP2_STATE.selectedTextIds)) {
    window.DP2_STATE.selectedTextIds = [];
  }

  // Migration douce (compat) : anciens objets {type:"pv_panel"} → DP2_STATE.panels[]
  // - Évite d’avoir 2 sources de vérité pour les panneaux
  // - Ne touche pas aux autres objets du plan
  try {
    const objs = window.DP2_STATE.objects || [];
    const kept = [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o && o.type === "pv_panel") {
        const w = o.width || 0;
        const h = o.height || 0;
        if (w > 0 && h > 0) {
          const id = "panel_" + Date.now() + "_" + Math.random().toString(16).slice(2);
          const geom = {
            x: typeof o.x === "number" ? o.x : 0,
            y: typeof o.y === "number" ? o.y : 0,
            width: w,
            height: h,
            rotation: typeof o.rotation === "number" ? o.rotation : 0
          };
          if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
            geom.displayScaleX = 1;
            geom.displayScaleY = 1;
          }
          window.DP2_STATE.panels.push({
            id,
            type: "panel",
            geometry: geom,
            lockedSize: true,
            visible: true
          });
          if (window.DP2_STATE.selectedObjectId === i) {
            window.DP2_STATE.selectedObjectId = null;
            window.DP2_STATE.selectedPanelId = id;
          }
        }
        continue; // ne pas garder dans objects[]
      }
      kept.push(o);
    }
    if (kept.length !== objs.length) window.DP2_STATE.objects = kept;
  } catch (_) {}

  // Migration douce (compat DP2) : anciens objets {type:"building_outline"} → DP2_STATE.features (+ miroir buildingContours).
  try {
    dp2EnsureBuildingContoursState();
    const objs = window.DP2_STATE.objects || [];
    const kept = [];
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (o && o.type === "building_outline") {
        const pts = Array.isArray(o.points) ? o.points : [];
        const id = (o.id && typeof o.id === "string") ? o.id : dp2NewBuildingContourId();
        // Éviter doublons si déjà migré
        if (!dp2GetBuildingContourById(id) && !dp2FindPolygonFeatureById(id)) {
          dp2EnsureFeaturesArray();
          const canvasPts = pts.map((p) => ({
            x: typeof p?.x === "number" ? p.x : 0,
            y: typeof p?.y === "number" ? p.y : 0
          }));
          const coords = [];
          for (let pi = 0; pi < canvasPts.length; pi++) {
            const mc = dp2PixelToMapCoord(canvasPts[pi].x, canvasPts[pi].y);
            if (mc && mc.length >= 2) coords.push(mc);
          }
          if (coords.length >= 1) {
            const feat = {
              id,
              type: "polygon",
              coordinates: coords,
              closed: o.closed === true
            };
            if (o.cuts && typeof o.cuts === "object") feat.cuts = o.cuts;
            window.DP2_STATE.features.push(feat);
            dp2RebuildContourDisplayCacheFromFeatures();
          }
        }
        // Si cet objet était sélectionné (ancienne sélection), migrer vers selectedBuildingContourId
        if (window.DP2_STATE.selectedObjectId === i) {
          window.DP2_STATE.selectedObjectId = null;
          window.DP2_STATE.selectedBuildingContourId = id;
        }
        continue; // ne pas garder dans objects[]
      }
      kept.push(o);
    }
    if (kept.length !== objs.length) window.DP2_STATE.objects = kept;
  } catch (_) {}

  // Garantir que scale_m_per_px est défini depuis capture_plan.resolution (plan masse)
  const planForScale =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE.capture;
  if (window.DP2_STATE.scale_m_per_px == null && planForScale?.resolution != null) {
    window.DP2_STATE.scale_m_per_px = planForScale.resolution;
  }

  console.log("[DP2] Éditeur initialisé", {
    background: window.DP2_STATE.backgroundImage,
    scale: window.DP2_STATE.scale_m_per_px,
    objects: window.DP2_STATE.objects.length
  });

  try {
    dp2MountOlMapUnderCanvasIfNeeded();
    dp2SyncEditionOlMapLayoutSync();
  } catch (_) {}

  try {
    dp2ApplyFeaturesHydrateSync();
  } catch (_) {}

  // Rendu initial depuis l'état
  renderDP2FromState();

  // Zoom visuel : conteneur image + canvas (sans modifier scale_m_per_px)
  initDP2ViewZoom();

  // Barre d'outils déjà initialisée en amont dans initDP2() (DOM-only). Ici : uniquement canvas + events canvas.
  initDP2CanvasEvents();
}

// --------------------------
// DP2 — ACTIONS DESSIN (Undo / Redo / Supprimer)
// Contraintes : UI-only, ne touche pas au flux de capture ni à l’overlay.
// --------------------------
function dp2EnsureHistoryStacks() {
  const state = window.DP2_STATE;
  if (!state) return { undo: [], redo: [] };
  // On conserve DP2_STATE.history comme un ARRAY (contrainte "pas de nouveaux états globaux")
  // Format: history[0] = undoStack, history[1] = redoStack
  if (!Array.isArray(state.history)) state.history = [];
  if (!Array.isArray(state.history[0])) state.history[0] = [];
  if (!Array.isArray(state.history[1])) state.history[1] = [];
  return { undo: state.history[0], redo: state.history[1] };
}

function dp2CloneForHistory(value) {
  // Deep clone stable pour objets simples (POJO)
  // (DP2_STATE contient uniquement des objets sérialisables côté "dessin")
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch (_) {}
  return JSON.parse(JSON.stringify(value));
}

function dp2SnapshotForHistory() {
  const state = window.DP2_STATE;
  if (!state) return null;
  /** Ne pas stocker les miroirs `dp2drv:` ni les doublons `building_outline`. */
  const objsRaw = state.objects || [];
  const objsForHist = objsRaw.filter(
    (o) =>
      !(o && typeof o.dp2SyncKey === "string" && o.dp2SyncKey.indexOf("dp2drv:") === 0) &&
      !(o && o.type === "building_outline")
  );
  return {
    objects: dp2CloneForHistory(objsForHist),
    features: dp2CloneForHistory(Array.isArray(state.features) ? state.features : []),
    panels: dp2CloneForHistory(state.panels || []),
    textObjects: dp2CloneForHistory(state.textObjects || []),
    businessObjects: dp2CloneForHistory(state.businessObjects || []),
    selectedObjectId: state.selectedObjectId != null ? state.selectedObjectId : null,
    selectedBuildingContourId: state.selectedBuildingContourId || null,
    selectedPanelId: state.selectedPanelId || null,
    selectedPanelIds: dp2CloneForHistory(Array.isArray(state.selectedPanelIds) ? state.selectedPanelIds : []),
    selectedBusinessObjectId: state.selectedBusinessObjectId || null,
    selectedTextId: state.selectedTextId || null,
    selectedTextIds: dp2CloneForHistory(Array.isArray(state.selectedTextIds) ? state.selectedTextIds : [])
  };
}

function dp2ApplyHistorySnapshot(snap) {
  const state = window.DP2_STATE;
  if (!state || !snap) return;
  state.objects = Array.isArray(snap.objects) ? snap.objects : [];
  if (Array.isArray(snap.features)) {
    state.features = dp2CloneForHistory(snap.features);
  } else {
    state.features = [];
    if (Array.isArray(snap.buildingContours) && snap.buildingContours.length) {
      state.buildingContours = dp2CloneForHistory(snap.buildingContours);
      dp2LegacyContoursToFeaturesInPlace(state);
    }
  }
  state.buildingContours = [];
  state.selectedBuildingContourId = snap.selectedBuildingContourId || null;
  state.panels = Array.isArray(snap.panels) ? snap.panels : [];
  state.textObjects = Array.isArray(snap.textObjects) ? snap.textObjects : [];
  state.businessObjects = Array.isArray(snap.businessObjects) ? snap.businessObjects : [];
  state.selectedObjectId = snap.selectedObjectId != null ? snap.selectedObjectId : null;
  // Compat: anciennes entrées history n'ont pas selectedPanelIds
  const snapIds = Array.isArray(snap.selectedPanelIds) ? snap.selectedPanelIds : [];
  state.selectedPanelIds = snapIds.length ? snapIds : (snap.selectedPanelId ? [snap.selectedPanelId] : []);
  state.selectedPanelId = state.selectedPanelIds.length === 1 ? state.selectedPanelIds[0] : null;
  state.selectedBusinessObjectId = snap.selectedBusinessObjectId || null;
  // Compat: anciennes entrées history n'ont pas selectedTextIds
  const snapTextIds = Array.isArray(snap.selectedTextIds) ? snap.selectedTextIds : [];
  state.selectedTextIds = snapTextIds.length ? snapTextIds : (snap.selectedTextId ? [snap.selectedTextId] : []);
  state.selectedTextId = state.selectedTextIds.length === 1 ? state.selectedTextIds[0] : null;
  // Ne jamais restaurer des états d'interaction non sérialisés
  state.businessInteraction = null;
  state.businessDragCandidate = null;
  state.panelInteraction = null;
  state.panelGroupInteraction = null;
  state.textInteraction = null;
  state.selectionRect = null;
  state.lineVertexInteraction = null;
  state._businessHoverId = null;
  state._businessSelectionFlashPhase = false;
  state._businessGripReleaseAt = null;
  state._bizHoverChromeAt = null;
  state._bizSelChromeAt = null;
  state._bizUiPrevSelBizId = undefined;
  try {
    dp2RebuildContourDisplayCacheFromFeatures();
  } catch (_) {}
  renderDP2FromState();
}

/** Court surlignage de la sélection métier après undo/redo (feedback visuel). */
function dp2TriggerBusinessSelectionHistoryFlash() {
  const s = window.DP2_STATE;
  if (!s || !s.selectedBusinessObjectId) return;
  s._businessSelectionFlashPhase = true;
  renderDP2FromState();
  window.setTimeout(() => {
    if (!window.DP2_STATE) return;
    window.DP2_STATE._businessSelectionFlashPhase = false;
    renderDP2FromState();
  }, 170);
}

function dp2CommitHistoryPoint() {
  try {
    dp2RebuildContourDisplayCacheFromFeatures();
  } catch (_) {}
  const snap = dp2SnapshotForHistory();
  if (!snap) return;
  const { undo, redo } = dp2EnsureHistoryStacks();
  undo.push(snap);
  // Toute nouvelle action invalide le redo
  redo.length = 0;
  if (window.DP2_DEBUG_HISTORY) {
    try {
      console.log("[DP2 history] commit → undo:", undo.length, "redo vidé");
    } catch (_) {}
  }
  syncDP2DrawActionsUI();
}

function dp2Undo() {
  const { undo, redo } = dp2EnsureHistoryStacks();
  if (!undo.length) return;
  const current = dp2SnapshotForHistory();
  const prev = undo.pop();
  if (current) redo.push(current);
  if (window.DP2_DEBUG_HISTORY) {
    try {
      console.log("[DP2 history] undo → undo:", undo.length, "redo:", redo.length);
    } catch (_) {}
  }
  dp2ApplyHistorySnapshot(prev);
  syncDP2DrawActionsUI();
  dp2TriggerBusinessSelectionHistoryFlash();
}

function dp2Redo() {
  const { undo, redo } = dp2EnsureHistoryStacks();
  if (!redo.length) return;
  const current = dp2SnapshotForHistory();
  const next = redo.pop();
  if (current) undo.push(current);
  if (window.DP2_DEBUG_HISTORY) {
    try {
      console.log("[DP2 history] redo → undo:", undo.length, "redo:", redo.length);
    } catch (_) {}
  }
  dp2ApplyHistorySnapshot(next);
  syncDP2DrawActionsUI();
  dp2TriggerBusinessSelectionHistoryFlash();
}

function dp2DeleteSelected() {
  const state = window.DP2_STATE;
  if (!state) return;

  const bizId = state.selectedBusinessObjectId || null;
  const panelIds = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
  const textIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  const objIdx = state.selectedObjectId != null ? state.selectedObjectId : null;
  const contourId = state.selectedBuildingContourId || null;

  if (!bizId && (!panelIds || !panelIds.length) && (!textIds || !textIds.length) && objIdx == null && !contourId) return;

  dp2CommitHistoryPoint();

  // Priorité : textes (annotations)
  if (textIds && textIds.length) {
    const idSet = new Set(textIds.filter(Boolean));
    const items = Array.isArray(state.textObjects) ? state.textObjects : [];
    const kept = [];
    for (const t of items) {
      if (!t || !t.id || !idSet.has(t.id)) kept.push(t);
    }
    state.textObjects = kept;
    dp2ClearSelectedTexts();
    state.textInteraction = null;
    renderDP2FromState();
    return;
  }

  // Priorité : objet métier (handles) si présent
  if (bizId) {
    const items = state.businessObjects || [];
    const idx = items.findIndex((o) => o && o.id === bizId);
    if (idx >= 0) items.splice(idx, 1);
    state.selectedBusinessObjectId = null;
    renderDP2FromState();
    return;
  }

  // Ensuite : panneaux PV (DP2_STATE.panels)
  if (panelIds && panelIds.length) {
    const idSet = new Set(panelIds.filter(Boolean));
    const items = Array.isArray(state.panels) ? state.panels : [];
    const kept = [];
    for (const p of items) {
      if (!p || !p.id || !idSet.has(p.id)) kept.push(p);
    }
    state.panels = kept;
    // Après suppression : purge sélection + bbox/interaction groupée
    dp2ClearSelectedPanels();
    state.selectionRect = null;
    state.panelGroupInteraction = null;
    state.panelInteraction = null;
    renderDP2FromState();
    return;
  }

  // Ensuite : contour de bâti (source = features uniquement ; cache contours recalculé)
  if (contourId) {
    dp2EnsureFeaturesArray();
    const feats = state.features || [];
    const fidx = feats.findIndex((f) => f && String(f.id) === String(contourId));
    if (fidx >= 0) feats.splice(fidx, 1);
    try {
      dp2RebuildContourDisplayCacheFromFeatures();
    } catch (_) {}
    state.selectedBuildingContourId = null;
    state.lineVertexInteraction = null;
    renderDP2FromState();
    return;
  }

  // Sinon : objet "classique" (objects[])
  const objs = state.objects || [];
  if (typeof objIdx === "number" && objIdx >= 0 && objIdx < objs.length) {
    const removed = objs[objIdx];
    objs.splice(objIdx, 1);
    if (removed && removed.type === "ridge_line" && typeof dp2RebuildRidgeCutsForAllContours === "function") {
      dp2RebuildRidgeCutsForAllContours();
    }
    state.selectedObjectId = null;
    renderDP2FromState();
  }
}

function syncDP2DrawActionsUI() {
  const delBtns = document.querySelectorAll("[data-dp2-action='delete']");
  const undoBtns = document.querySelectorAll("[data-dp2-action='undo']");
  const redoBtns = document.querySelectorAll("[data-dp2-action='redo']");
  if (!undoBtns.length && !redoBtns.length && !delBtns.length) return; // UI DP2 pas monté

  const state = window.DP2_STATE;
  const hasPanelsSelection =
    !!(state && (
      (typeof dp2GetEffectiveSelectedPanelIds === "function" && dp2GetEffectiveSelectedPanelIds().length >= 1) ||
      state.selectedPanelId ||
      (Array.isArray(state.selectedPanelIds) && state.selectedPanelIds.length >= 1)
    ));
  const hasTextSelection =
    !!(state && (
      (typeof dp2GetEffectiveSelectedTextIds === "function" && dp2GetEffectiveSelectedTextIds().length >= 1) ||
      state.selectedTextId ||
      (Array.isArray(state.selectedTextIds) && state.selectedTextIds.length >= 1)
    ));
  const hasBuildingContourSelection = !!(state && state.selectedBuildingContourId);
  const hasSelection = !!(
    state &&
    (state.selectedBusinessObjectId ||
      hasPanelsSelection ||
      hasTextSelection ||
      hasBuildingContourSelection ||
      state.selectedObjectId != null)
  );

  delBtns.forEach((btn) => {
    btn.disabled = !hasSelection;
  });

  const { undo, redo } = dp2EnsureHistoryStacks();
  const canUndo = !!(undo && undo.length);
  const canRedo = !!(redo && redo.length);
  undoBtns.forEach((btn) => {
    btn.disabled = !canUndo;
    btn.classList.toggle("dp2-history-can", canUndo);
  });
  redoBtns.forEach((btn) => {
    btn.disabled = !canRedo;
    btn.classList.toggle("dp2-history-can", canRedo);
  });
}

function initDP2UndoRedoKeyboard() {
  if (window.__DP2_UNDO_REDO_KB_BOUND === true) return;
  window.__DP2_UNDO_REDO_KB_BOUND = true;
  document.addEventListener(
    "keydown",
    (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (key !== "z" && key !== "y") return;

      const ae = document.activeElement;
      const typing =
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          (typeof ae.isContentEditable === "boolean" && ae.isContentEditable));
      if (typing) return;

      if (!window.DP2_STATE || window.DP2_STATE.mode !== "EDITION") return;
      const wrap = document.getElementById("dp2-captured-image-wrap");
      if (!wrap || wrap.style.display === "none") return;

      if (key === "z" && e.shiftKey) {
        const { redo } = dp2EnsureHistoryStacks();
        if (!redo || !redo.length) return;
        e.preventDefault();
        e.stopPropagation();
        dp2Redo();
        return;
      }
      if (key === "z" && !e.shiftKey) {
        const { undo } = dp2EnsureHistoryStacks();
        if (!undo || !undo.length) return;
        e.preventDefault();
        e.stopPropagation();
        dp2Undo();
        return;
      }
      if (key === "y" && !e.shiftKey) {
        const { redo } = dp2EnsureHistoryStacks();
        if (!redo || !redo.length) return;
        e.preventDefault();
        e.stopPropagation();
        dp2Redo();
      }
    },
    true
  );
}

function initDP2DrawActions() {
  // Plusieurs wraps peuvent coexister (vue DP2 + overlay DP4 réutilisant le moteur) : même id dans le DOM.
  const wraps = document.querySelectorAll("#dp2-captured-image-wrap");
  if (!wraps.length) return;

  function bindOneWrap(wrap) {
    if (!wrap || wrap.dataset.dp2DrawActionsDelegate === "1") return;
    wrap.dataset.dp2DrawActionsDelegate = "1";
    wrap.addEventListener(
      "click",
      function dp2DrawActionsClickCapture(e) {
        const raw = e.target;
        const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
        if (!el) return;
        const undoEl = el.closest("[data-dp2-action='undo']");
        if (undoEl) {
          if (undoEl.disabled) return;
          e.preventDefault();
          dp2Undo();
          return;
        }
        const redoEl = el.closest("[data-dp2-action='redo']");
        if (redoEl) {
          if (redoEl.disabled) return;
          e.preventDefault();
          dp2Redo();
          return;
        }
        const delEl = el.closest("[data-dp2-action='delete']");
        if (delEl) {
          if (delEl.disabled) return;
          e.preventDefault();
          dp2DeleteSelected();
        }
      },
      true
    );
  }

  for (let i = 0; i < wraps.length; i++) bindOneWrap(wraps[i]);

  syncDP2DrawActionsUI();
  initDP2UndoRedoKeyboard();
}

// --------------------------
// DP2 — ZOOM VISUEL (image + canvas synchronisés, facteur d'affichage uniquement)
// Ne modifie PAS scale_m_per_px, ni les mesures, ni les objets stockés.
// Limites : 0.5× → 6×. Zoom centré sur la position de la souris.
// --------------------------
const DP2_VIEW_ZOOM_MIN = 0.5;
const DP2_VIEW_ZOOM_MAX = 6;
const DP2_VIEW_PAN_EDGE_PX = 96;

// Applique la transform visuelle du conteneur zoom : translate(pan) + scale(zoom). Ne touche pas à scale_m_per_px ni aux objets.
function applyDP2ViewTransform() {
  const zoomContainer = document.getElementById("dp2-zoom-container");
  if (!zoomContainer) return;
  dp2ClampViewPan();
  const panX = window.DP2_STATE.viewPanX != null ? window.DP2_STATE.viewPanX : 0;
  const panY = window.DP2_STATE.viewPanY != null ? window.DP2_STATE.viewPanY : 0;
  const zoom = window.DP2_STATE.viewZoom != null ? window.DP2_STATE.viewZoom : 1;
  zoomContainer.style.transformOrigin = "0 0";
  zoomContainer.style.willChange = "transform";
  zoomContainer.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")";
  if (typeof dp2SyncMapAnchoredOverlays === "function") dp2SyncMapAnchoredOverlays();
}

function dp2ClampViewPan() {
  const s = window.DP2_STATE;
  const wrap = document.getElementById("dp2-captured-image-wrap");
  const zoomContainer = document.getElementById("dp2-zoom-container");
  if (!s || !wrap || !zoomContainer) return;
  const zoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, s.viewZoom || 1));
  s.viewZoom = zoom;
  const wrapW = wrap.clientWidth || 0;
  const wrapH = wrap.clientHeight || 0;
  const baseW = zoomContainer.offsetWidth || wrapW;
  const baseH = zoomContainer.offsetHeight || wrapH;
  if (!(wrapW > 0) || !(wrapH > 0) || !(baseW > 0) || !(baseH > 0)) return;
  const scaledW = baseW * zoom;
  const scaledH = baseH * zoom;

  function clampAxis(pan, viewport, scaled) {
    const cur = typeof pan === "number" && Number.isFinite(pan) ? pan : 0;
    if (scaled <= viewport) return (viewport - scaled) / 2;
    const min = viewport - scaled - DP2_VIEW_PAN_EDGE_PX;
    const max = DP2_VIEW_PAN_EDGE_PX;
    return Math.min(max, Math.max(min, cur));
  }

  s.viewPanX = clampAxis(s.viewPanX, wrapW, scaledW);
  s.viewPanY = clampAxis(s.viewPanY, wrapH, scaledH);
}

(function dp2BindInteractionPointerUp() {
  if (window.__DP2_IX_POINTER_UP_BOUND) return;
  window.__DP2_IX_POINTER_UP_BOUND = true;
  window.addEventListener(
    "pointerup",
    () => {
      if (!window.dp2InteractionState) return;
      window.dp2InteractionState.activeFeatureId = null;
      if (typeof dp2FinalizeInteractionChrome === "function") dp2FinalizeInteractionChrome();
    },
    true
  );
})();

function initDP2ViewZoom() {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  const zoomContainer = document.getElementById("dp2-zoom-container");
  if (!wrap || !zoomContainer) return;

  const viewZoom = window.DP2_STATE.viewZoom != null ? window.DP2_STATE.viewZoom : 1;
  window.DP2_STATE.viewZoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, viewZoom));
  if (window.DP2_STATE.viewPanX == null) window.DP2_STATE.viewPanX = 0;
  if (window.DP2_STATE.viewPanY == null) window.DP2_STATE.viewPanY = 0;

  zoomContainer.style.position = "absolute";
  zoomContainer.style.transformOrigin = "0 0";
  applyDP2ViewTransform();

  if (wrap.dataset.dp2ViewZoomBound === "1") return;
  wrap.dataset.dp2ViewZoomBound = "1";

  wrap.addEventListener("wheel", (e) => {
    const zoomContainerEl = document.getElementById("dp2-zoom-container");
    if (!zoomContainerEl) return;
    const wrapRect = wrap.getBoundingClientRect();
    const currentZoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, window.DP2_STATE.viewZoom || 1));
    const panX = typeof window.DP2_STATE.viewPanX === "number" ? window.DP2_STATE.viewPanX : 0;
    const panY = typeof window.DP2_STATE.viewPanY === "number" ? window.DP2_STATE.viewPanY : 0;
    const localX = e.clientX - wrapRect.left;
    const localY = e.clientY - wrapRect.top;
    const worldX = (localX - panX) / currentZoom;
    const worldY = (localY - panY) / currentZoom;
    const factor = Math.exp(-e.deltaY * 0.0016);
    const newZoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, currentZoom * factor));
    if (Math.abs(newZoom - currentZoom) < 0.0001) {
      e.preventDefault();
      return;
    }
    window.DP2_STATE.viewZoom = newZoom;
    window.DP2_STATE.viewPanX = localX - worldX * newZoom;
    window.DP2_STATE.viewPanY = localY - worldY * newZoom;
    applyDP2ViewTransform();
    e.preventDefault();
  }, { passive: false });

  // ——— Pan (déplacement visuel du plan) : mousedown → mousemove → mouseup
  let panStart = null;
  function onPanMove(e) {
    if (!panStart) return;
    const dx = e.clientX - panStart.clientX;
    const dy = e.clientY - panStart.clientY;
    window.DP2_STATE.viewPanX = panStart.viewPanX + dx;
    window.DP2_STATE.viewPanY = panStart.viewPanY + dy;
    applyDP2ViewTransform();
  }
  function onPanUp() {
    if (panStart) {
      wrap.classList.remove("dp2-panning");
      document.body.classList.remove("dp2-panning");
    }
    panStart = null;
    document.removeEventListener("mousemove", onPanMove);
    document.removeEventListener("mouseup", onPanUp);
  }
  wrap.addEventListener("mousedown", (e) => {
    if (window.DP2_STATE?.currentTool !== "pan") return;
    e.preventDefault();
    panStart = {
      clientX: e.clientX,
      clientY: e.clientY,
      viewPanX: window.DP2_STATE.viewPanX != null ? window.DP2_STATE.viewPanX : 0,
      viewPanY: window.DP2_STATE.viewPanY != null ? window.DP2_STATE.viewPanY : 0
    };
    wrap.classList.add("dp2-panning");
    document.body.classList.add("dp2-panning");
    document.addEventListener("mousemove", onPanMove);
    document.addEventListener("mouseup", onPanUp);
  });
}

// --------------------------
// DP2 — COORDONNÉES CANVAS (souris → pixels canvas)
// --------------------------
function getDP2CanvasCoords(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

// Canvas (pixels) → coordonnées client (pour positionner l’overlay choix du point)
function getDP2CanvasToClient(canvas, canvasX, canvasY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  return {
    clientX: rect.left + canvasX / scaleX,
    clientY: rect.top + canvasY / scaleY
  };
}

function dp2ShouldUseCaptureAnalyticTransform(cap) {
  if (!cap || typeof cap !== "object" || !cap.imageBase64) return false;
  const wrap = document.getElementById("dp2-captured-image-wrap");
  const img = document.getElementById("dp2-captured-image");
  const capturedShown =
    !!wrap &&
    wrap.style.display !== "none" &&
    !!img &&
    typeof img.src === "string" &&
    img.src.indexOf("data:image") === 0;
  if (!capturedShown) return false;
  const center = cap.center;
  const cx = Array.isArray(center) ? center[0] : center && center.x;
  const cy = Array.isArray(center) ? center[1] : center && center.y;
  return Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cap.resolution) && cap.resolution > 0;
}

/**
 * Pixel canvas DP2 (repère image naturalWidth×naturalHeight) → coordonnée projetée (EPSG:3857).
 * Utilise la carte OpenLayers si disponible (pixels courants mis à l’échelle depuis la capture) ;
 * sinon retombe sur centre / résolution / rotation de capture_plan.
 */
function dp2PixelToMapCoord(x, y) {
  const cap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : null;
  const wCap =
    (cap && typeof cap.width === "number" && cap.width > 0 ? cap.width : null) ??
    (window.DP2_STATE && window.DP2_STATE.backgroundImage && window.DP2_STATE.backgroundImage.width) ??
    0;
  const hCap =
    (cap && typeof cap.height === "number" && cap.height > 0 ? cap.height : null) ??
    (window.DP2_STATE && window.DP2_STATE.backgroundImage && window.DP2_STATE.backgroundImage.height) ??
    0;

  if (cap && wCap > 0 && hCap > 0 && dp2ShouldUseCaptureAnalyticTransform(cap)) {
    const v0 = dp4ValidateDP2CaptureForImport(cap);
    if (v0.ok) return dp2Dp2ImagePixelTo3857Coord(x, y, cap, wCap, hCap);
  }

  const map = window.DP2_MAP && window.DP2_MAP.map;
  if (map && cap && wCap > 0 && hCap > 0) {
    const v = dp4ValidateDP2CaptureForImport(cap);
    if (v.ok) {
      const size = map.getSize();
      if (size && size[0] > 0 && size[1] > 0) {
        const mx = (x / wCap) * size[0];
        const my = (y / hCap) * size[1];
        try {
          const c = map.getCoordinateFromPixel([mx, my]);
          if (c && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
            return c;
          }
        } catch (_) {}
      }
    }
  }
  if (!cap || !(wCap > 0) || !(hCap > 0)) return null;
  const v2 = dp4ValidateDP2CaptureForImport(cap);
  if (!v2.ok) return null;
  return dp2Dp2ImagePixelTo3857Coord(x, y, cap, wCap, hCap);
}

/**
 * Coordonnée carte (EPSG:3857) → pixel canvas DP2 (repère image).
 * Préfère OpenLayers ; sinon inverse analytique depuis capture_plan.
 */
function dp2MapCoordToCanvasPoint(coord) {
  if (!coord || coord.length < 2 || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
  const cap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : null;
  const wCap =
    (cap && typeof cap.width === "number" && cap.width > 0 ? cap.width : null) ??
    (window.DP2_STATE && window.DP2_STATE.backgroundImage && window.DP2_STATE.backgroundImage.width) ??
    0;
  const hCap =
    (cap && typeof cap.height === "number" && cap.height > 0 ? cap.height : null) ??
    (window.DP2_STATE && window.DP2_STATE.backgroundImage && window.DP2_STATE.backgroundImage.height) ??
    0;

  if (cap && wCap > 0 && hCap > 0 && dp2ShouldUseCaptureAnalyticTransform(cap)) {
    const v0 = dp4ValidateDP2CaptureForImport(cap);
    if (v0.ok) return dp2Dp2Image3857CoordToPixel(coord[0], coord[1], cap, wCap, hCap);
  }

  const map = window.DP2_MAP && window.DP2_MAP.map;
  if (map && cap && wCap > 0 && hCap > 0) {
    const v = dp4ValidateDP2CaptureForImport(cap);
    if (v.ok) {
      try {
        const pix = map.getPixelFromCoordinate(coord);
        const size = map.getSize();
        if (pix && pix.length >= 2 && size && size[0] > 0 && size[1] > 0) {
          return {
            x: (pix[0] / size[0]) * wCap,
            y: (pix[1] / size[1]) * hCap
          };
        }
      } catch (_) {}
    }
  }
  if (!cap || !(wCap > 0) || !(hCap > 0)) return null;
  const v2 = dp4ValidateDP2CaptureForImport(cap);
  if (!v2.ok) return null;
  return dp2Dp2Image3857CoordToPixel(coord[0], coord[1], cap, wCap, hCap);
}

/** @returns {number[]|null} [x,y] canvas ou null */
function dp2MapCoordToPixel(coord) {
  const p = dp2MapCoordToCanvasPoint(coord);
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return [p.x, p.y];
}

function dp2EnsureFeaturesArray() {
  const s = window.DP2_STATE;
  if (!s) return;
  if (!Array.isArray(s.features)) s.features = [];
}

function dp2FindPolygonFeatureById(id) {
  if (id == null) return null;
  const sid = String(id);
  const feats = window.DP2_STATE?.features || [];
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i];
    if (f && f.type === "polygon" && String(f.id) === sid) return f;
  }
  return null;
}

/** Persiste `buildingContours[].labelOffsets` sur le feature polygon (sinon rebuild écrase le cache à chaque frame). */
function dp2SyncContourLabelOffsetsToFeature(contourId) {
  if (contourId == null) return;
  const contour = dp2GetBuildingContourById(contourId);
  const feat = dp2FindPolygonFeatureById(contourId);
  if (!feat) return;
  const raw = contour && contour.labelOffsets && typeof contour.labelOffsets === "object" ? contour.labelOffsets : null;
  if (!raw) {
    try {
      delete feat.labelOffsets;
    } catch (_) {
      feat.labelOffsets = undefined;
    }
    return;
  }
  const next = {};
  for (const k in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    const o = raw[k];
    if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
    next[k] = { x: o.x, y: o.y };
  }
  if (Object.keys(next).length === 0) {
    try {
      delete feat.labelOffsets;
    } catch (_) {
      feat.labelOffsets = undefined;
    }
  } else {
    feat.labelOffsets = next;
  }
}

/** True si le rendu bâti doit lire DP2_STATE.features (polygones) plutôt que buildingContours seuls. */
function dp2BuildingRenderUsesFeatures() {
  const feats = window.DP2_STATE?.features || [];
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i];
    if (!f || f.type !== "polygon" || !Array.isArray(f.coordinates)) continue;
    if (f.coordinates.length >= 2) return true;
    if (f.closed === false && f.coordinates.length >= 1) return true;
  }
  return false;
}

/**
 * Migration one-shot : anciens `buildingContours` / `building_outline` / `dp2drv:` → `features` seuls.
 * `buildingContours` reste un cache d’affichage (pixels) reconstruit depuis `features`, jamais source persistée.
 */
function dp2MigrateFinalGeometryState(opts) {
  const s = window.DP2_STATE;
  if (!s) return false;
  const force = !!(opts && opts.force);
  let changed = false;
  if (s.__dpGeometryMigrationFinalDone !== true || force) {
    dp2EnsureFeaturesArray();
    const feats = s.features || [];
    const hasFeat = feats.some(
      (f) => f && f.type === "polygon" && Array.isArray(f.coordinates) && f.coordinates.length >= 1
    );
    const bc = Array.isArray(s.buildingContours) ? s.buildingContours : [];
    const hasBC = bc.length > 0;
    if (Array.isArray(s.objects)) {
      const n0 = s.objects.length;
      s.objects = s.objects.filter((o) => {
        if (!o) return false;
        if (o.type === "building_outline") return false;
        if (typeof o.dp2SyncKey === "string" && o.dp2SyncKey.indexOf("dp2drv:") === 0) return false;
        return true;
      });
      if (s.objects.length !== n0) changed = true;
    }
    if (!hasFeat && hasBC) {
      dp2LegacyContoursToFeaturesInPlace(s);
      changed = true;
    }
    s.__dpGeometryMigrationFinalDone = true;
    if (changed) {
      if (window.__SN_DP_DP2_AUDIT__ === true) {
        try {
          console.log("[DP MIGRATION FINAL DONE]", { features: (s.features || []).length });
        } catch (_) {}
      }
      try {
        if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
      } catch (_) {}
    }
  }
  dp2RebuildContourDisplayCacheFromFeatures();
  return changed;
}

/** Hydrate / init : migration finale + cache contour écran. */
function dp2ApplyFeaturesHydrateSync() {
  try {
    dp2MigrateFinalGeometryState();
  } catch (e) {
    console.warn("[DP2] migrate geometry", e);
  }
}

/** Ancienne voie contours pixels → polygones carte (migration / historique uniquement). */
function dp2LegacyContoursToFeaturesInPlace(state) {
  const st = state || window.DP2_STATE;
  if (!st) return;
  if (!Array.isArray(st.features)) st.features = [];
  const contours = Array.isArray(st.buildingContours) ? st.buildingContours : [];
  const features = [];
  contours.forEach((c, idx) => {
    if (!c || !Array.isArray(c.points) || c.points.length < 1) return;
    const coords = [];
    for (let pi = 0; pi < c.points.length; pi++) {
      const p = c.points[pi];
      if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
      const coord = dp2PixelToMapCoord(p.x, p.y);
      if (coord && coord.length >= 2) coords.push(coord);
    }
    if (coords.length < 1) return;
    if (c.closed === true && coords.length < 3) return;
    const id = c.id != null ? String(c.id) : "contour_" + idx;
    const feat = {
      id,
      type: "polygon",
      coordinates: coords,
      closed: c.closed === true
    };
    if (c.cuts && typeof c.cuts === "object") feat.cuts = c.cuts;
    if (c.labelOffsets && typeof c.labelOffsets === "object") feat.labelOffsets = c.labelOffsets;
    features.push(feat);
  });
  st.features = features;
}

/** Reconstruit `buildingContours` (pixels canvas) depuis `features` (EPSG:3857) — cache d’affichage uniquement. */
function dp2RebuildContourDisplayCacheFromFeatures() {
  const s = window.DP2_STATE;
  if (!s) return;
  dp2EnsureFeaturesArray();
  const feats = s.features || [];
  const contours = [];
  feats.forEach((f, idx) => {
    if (!f || f.type !== "polygon" || !Array.isArray(f.coordinates)) return;
    const points = [];
    for (let ci = 0; ci < f.coordinates.length; ci++) {
      const px = dp2MapCoordToPixel(f.coordinates[ci]);
      if (!px || px.length < 2) continue;
      points.push({ x: px[0], y: px[1] });
    }
    if (f.closed === true && points.length > 2) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 0.5) {
        points.pop();
      }
    }
    if (points.length < 1) return;
    const c = {
      id: f.id != null ? String(f.id) : "contour_" + idx,
      points,
      closed: f.closed === true
    };
    if (f.cuts && typeof f.cuts === "object") c.cuts = f.cuts;
    if (f.labelOffsets && typeof f.labelOffsets === "object") c.labelOffsets = f.labelOffsets;
    contours.push(c);
  });
  s.buildingContours = contours;
}

function dp2StripClosingCoordinate(coords) {
  if (!Array.isArray(coords)) return [];
  const out = coords
    .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [c[0], c[1]]);
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001) {
      out.pop();
    }
  }
  return out;
}

function dp2ClosePolygonFeatureCoordinatesInPlace(feature) {
  if (!feature || feature.closed !== true || !Array.isArray(feature.coordinates) || feature.coordinates.length < 3) return;
  const first = feature.coordinates[0];
  if (!Array.isArray(first)) return;
  const last = feature.coordinates[feature.coordinates.length - 1];
  if (last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001) {
    feature.coordinates[feature.coordinates.length - 1] = [first[0], first[1]];
  }
}

const DP2_IX_MODE_CLASSES = ["dp2-mode-idle", "dp2-mode-draw", "dp2-mode-hover", "dp2-mode-active", "dp2-mode-editing"];

function dp2EnsureOverlayLayer() {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  if (!wrap) return;
  let layer = document.getElementById("dp2-overlay-layer");
  if (layer) {
    if (layer.parentNode !== wrap) wrap.appendChild(layer);
    return;
  }
  layer = document.createElement("div");
  layer.id = "dp2-overlay-layer";
  layer.className = "dp2-overlay-layer";
  wrap.appendChild(layer);
}

function dp2SyncInteractionToolFromDp2State() {
  const is = window.dp2InteractionState;
  if (!is) return;
  const ct = window.DP2_STATE?.currentTool || "select";
  const map = {
    select: "select",
    pan: "pan",
    building_outline: "contour",
    measure_line: "measure",
    ridge_line: "ridge",
    gutter_height_dimension: "gutter",
    panels: "pv"
  };
  is.tool = map[ct] || "select";
}

function dp2InteractionDragActive() {
  const s = window.DP2_STATE;
  if (!s) return false;
  return !!(
    s.lineVertexInteraction ||
    s.parcelLabelDrag ||
    s.measureLabelDrag ||
    s.measureLabelDragCandidate ||
    s.ridgeLabelDrag ||
    s.gutterHeightDrag ||
    s.gutterHeightVisualScaleDrag ||
    s.panelInteraction ||
    s.panelGroupInteraction ||
    (s.textInteraction && typeof s.textInteraction.pointerId === "number") ||
    (s.businessInteraction && typeof s.businessInteraction.pointerId === "number") ||
    (s.businessDragCandidate && typeof s.businessDragCandidate.pointerId === "number") ||
    s.pvPanelInteraction
  );
}

function dp2PickHoverFeatureId(canvas, x, y) {
  const tool = window.DP2_STATE?.currentTool || "select";

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const groupHit = dp2HitTestPanelGroup(x, y);
    if (groupHit && groupHit.part === "scale") return "pvScale:" + String(groupHit.id || "group");
    const hitPanel = dp2HitTestPanel(x, y);
    if (hitPanel && hitPanel.part === "scale" && hitPanel.id) return "pvScale:" + String(hitPanel.id);
  }

  if (tool === "select") {
    const hitLabel = dp2HitTestMeasureLabel(canvas, x, y);
    if (hitLabel && hitLabel.kind === "measure_label" && typeof hitLabel.index === "number")
      return "measure:" + hitLabel.index;

    const hitParcelLbl = dp2HitTestParcelSegmentLabel(canvas, x, y);
    if (hitParcelLbl && hitParcelLbl.contourId != null && typeof hitParcelLbl.segmentIndex === "number")
      return "parcelSeg:" + hitParcelLbl.contourId + ":" + hitParcelLbl.segmentIndex;

    const hitRidgeLbl = dp2HitTestRidgeLabel(canvas, x, y);
    if (hitRidgeLbl && typeof hitRidgeLbl.index === "number") return "ridge:" + hitRidgeLbl.index;

    const hitGhVs = dp2HitTestGutterHeightVisualHandle(canvas, x, y);
    if (hitGhVs && typeof hitGhVs.index === "number") return "gutterVs:" + hitGhVs.index;

    const hitGutterLbl = dp2HitTestGutterHeightLabel(canvas, x, y);
    if (hitGutterLbl && hitGutterLbl.kind === "gutter_height_label" && typeof hitGutterLbl.index === "number")
      return "gutterLbl:" + hitGutterLbl.index;
  }

  const segNear = dp2HitTestParcelSegmentClosest(canvas, x, y);
  if (segNear && segNear.contourId != null && typeof segNear.segmentIndex === "number")
    return "parcelSeg:" + segNear.contourId + ":" + segNear.segmentIndex;

  if (tool === "select") {
    for (let i = (window.DP2_STATE?.objects || []).length - 1; i >= 0; i--) {
      const obj = window.DP2_STATE.objects[i];
      if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || obj.__parcelEdge) continue;
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dA <= 12 || dB <= 12) return "measure:" + i;
      const dx = obj.b.x - obj.a.x;
      const dy = obj.b.y - obj.a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - obj.a.x) * dx + (y - obj.a.y) * dy) / lenSq));
      const px = obj.a.x + t * dx;
      const py = obj.a.y + t * dy;
      if (Math.hypot(x - px, y - py) <= 12) return "measure:" + i;
    }
    for (let i = (window.DP2_STATE?.objects || []).length - 1; i >= 0; i--) {
      const obj = window.DP2_STATE.objects[i];
      if (!obj || obj.type !== "ridge_line" || !obj.a || !obj.b) continue;
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dA <= 12 || dB <= 12) return "ridge:" + i;
      const dx = obj.b.x - obj.a.x;
      const dy = obj.b.y - obj.a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - obj.a.x) * dx + (y - obj.a.y) * dy) / lenSq));
      const px = obj.a.x + t * dx;
      const py = obj.a.y + t * dy;
      if (Math.hypot(x - px, y - py) <= 12) return "ridge:" + i;
    }
    for (let i = (window.DP2_STATE?.objects || []).length - 1; i >= 0; i--) {
      const obj = window.DP2_STATE.objects[i];
      if (!obj || obj.type !== "gutter_height_dimension") continue;
      dp2MigrateGutterHeightDimensionIfNeeded(obj);
      if (typeof obj.x !== "number" || typeof obj.y !== "number") continue;
      const sc = dp2GutterHeightVisualScale(obj);
      const half = DP2_GUTTER_HEIGHT_ICON_HALF_PX * sc;
      if (Math.hypot(x - obj.x, y - obj.y) <= half + 14 * sc) return "gutter:" + i;
    }
  }

  return null;
}

function dp2FinalizeInteractionChrome() {
  const is = window.dp2InteractionState;
  if (!is) return;
  dp2SyncInteractionToolFromDp2State();

  if (document.getElementById("dp2-parcel-edge-inline-input")) {
    is.mode = "editing";
    if (!is.editingFeatureId && is.hoveredFeatureId && String(is.hoveredFeatureId).startsWith("parcelSeg:"))
      is.editingFeatureId = is.hoveredFeatureId;
    dp2ApplyInteractionChrome();
    return;
  }
  is.editingFeatureId = null;

  if (document.getElementById("dp2-captured-image-wrap")?.classList.contains("dp2-panning")) {
    is.mode = "idle";
    dp2ApplyInteractionChrome();
    return;
  }

  if (dp2InteractionDragActive()) {
    is.mode = "active";
    dp2ApplyInteractionChrome();
    return;
  }

  const drawTools = is.tool === "contour" || is.tool === "measure" || is.tool === "ridge" || is.tool === "pv";
  if (is.hoveredFeatureId) is.mode = "hover";
  else if (drawTools) is.mode = "draw";
  else is.mode = "idle";

  dp2ApplyInteractionChrome();
}

function dp2ApplyInteractionChrome() {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  if (!wrap || !window.dp2InteractionState) return;
  const is = window.dp2InteractionState;
  for (const c of DP2_IX_MODE_CLASSES) wrap.classList.remove(c);
  wrap.classList.add("dp2-mode-" + is.mode);
  wrap.setAttribute("data-dp2-tool", is.tool);
  const fid = String(is.hoveredFeatureId || "");
  wrap.classList.toggle("dp2-cursor-resize", fid.startsWith("pvScale:") || fid.startsWith("gutterVs:"));
}

function dp2UpdateHoverFromPointerMove(canvas, e) {
  if (!window.dp2InteractionState) return;
  if (document.getElementById("dp2-parcel-edge-inline-input")) return;
  if (dp2InteractionDragActive()) return;
  const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
  window.dp2InteractionState.hoveredFeatureId = dp2PickHoverFeatureId(canvas, coords.x, coords.y);
}

function dp2SetActiveFeatureFromPointerDown(canvas, e) {
  if (!window.dp2InteractionState) return;
  const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
  window.dp2InteractionState.activeFeatureId = dp2PickHoverFeatureId(canvas, coords.x, coords.y);
}

/** Positionne l’input sur le libellé ; coords écran via canvas, position relative à #dp2-captured-image-wrap (overlay hors zoom transform). */
function dp2LayoutParcelEdgeInlineInputInLayer(canvas, input) {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  if (!wrap || !canvas || !input) return;
  const is = window.dp2InteractionState;
  const fid = is?.editingFeatureId || "";
  const m = /^parcelSeg:([^:]+):(\d+)$/.exec(fid);
  if (!m) return;
  const contour = dp2GetBuildingContourById(m[1]);
  if (!contour) return;
  const segIdx = parseInt(m[2], 10);
  const pt = dp2ComputeParcelSegmentLabelCanvasPoint(contour, segIdx);
  if (!pt) return;
  const client = getDP2CanvasToClient(canvas, pt.x, pt.y);
  const wrapperRect = wrap.getBoundingClientRect();
  const w = 72;
  const h = 26;
  let left = client.clientX - wrapperRect.left - w / 2;
  let top = client.clientY - wrapperRect.top - h / 2;
  const pad = 8;
  const maxLeft = Math.max(pad, wrapperRect.width - w - pad);
  const maxTop = Math.max(pad, wrapperRect.height - h - pad);
  if (left < pad) left = pad;
  else if (left > maxLeft) left = maxLeft;
  if (top < pad) top = pad;
  else if (top > maxTop) top = maxTop;
  if (!isFinite(left) || !isFinite(top)) {
    left = 200;
    top = 200;
  }
  input.style.left = `${left}px`;
  input.style.top = `${top}px`;
}

function dp2SyncMapAnchoredOverlays() {
  dp2EnsureOverlayLayer();
  const canvas = document.getElementById("dp2-draw-canvas");
  const input = document.getElementById("dp2-parcel-edge-inline-input");
  if (!document.getElementById("dp2-overlay-layer") || !canvas || !input) return;
  dp2LayoutParcelEdgeInlineInputInLayer(canvas, input);
}

function dp2InteractionTierForFeature(featureId) {
  if (!featureId || !window.dp2InteractionState) return null;
  const is = window.dp2InteractionState;
  if (is.editingFeatureId === featureId) return "editing";
  if (is.activeFeatureId === featureId) return "active";
  if (is.hoveredFeatureId === featureId) return "hover";
  return null;
}

/** Surcouche UX sur un segment (cote) — pas de modification géométrique */
function dp2DrawCoteSegmentTier(ctx, p1, p2, tier) {
  if (!tier) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  const guideBlue = "#2563eb";
  if (tier === "hover") {
    ctx.strokeStyle = guideBlue;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.75;
    ctx.shadowColor = "rgba(37, 99, 235, 0.32)";
    ctx.shadowBlur = 8;
  } else if (tier === "active") {
    ctx.strokeStyle = guideBlue;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.75;
  } else if (tier === "editing") {
    ctx.strokeStyle = guideBlue;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3.2;
    ctx.setLineDash([5, 4]);
    ctx.shadowColor = "rgba(37, 99, 235, 0.42)";
    ctx.shadowBlur = 12;
  }
  ctx.stroke();
  ctx.restore();
}

function dp2DrawTransparentPoint(ctx, x, y, strokeColor, radius, lineWidth) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius || 6, 0, Math.PI * 2);
  ctx.strokeStyle = strokeColor || DP2_TECH_BLUE;
  ctx.lineWidth = lineWidth || 1.8;
  ctx.stroke();
  ctx.beginPath();
  const s = Math.max(2.6, (radius || 6) * 0.48);
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x, y + s);
  ctx.lineWidth = Math.max(0.85, (lineWidth || 1.8) * 0.55);
  ctx.stroke();
  ctx.restore();
}

function dp2DrawAnchorChoice(ctx, x, y, label, color) {
  const r = DP2_MEASURE_ANCHOR_CHOICE_VISUAL_PX;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.strokeText(label, x, y);
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
  ctx.restore();
}

function dp2FillCoteLabelWithTier(ctx, text, midX, midY, tier) {
  const sc = tier === "hover" ? 1.05 : tier === "active" ? 1.04 : tier === "editing" ? 1.06 : 1;
  ctx.save();
  if (sc !== 1) {
    ctx.translate(midX, midY);
    ctx.scale(sc, sc);
    ctx.translate(-midX, -midY);
  }
  if (tier === "hover" || tier === "editing") {
    ctx.shadowColor = "rgba(37, 99, 235, 0.35)";
    ctx.shadowBlur = tier === "editing" ? 10 : 6;
  }
  ctx.fillText(text, midX, midY);
  ctx.restore();
}

function dp2SegmentReadableAngle(p1, p2) {
  let angle = Math.atan2((p2?.y || 0) - (p1?.y || 0), (p2?.x || 0) - (p1?.x || 0));
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return angle;
}

function dp2ManualCoteOffset(offset) {
  const off = offset && typeof offset.x === "number" && typeof offset.y === "number" ? offset : { x: 0, y: 0 };
  return { x: off.x || 0, y: off.y || 0 };
}

function dp2ContourCentroidForLabels(contour) {
  const pts = Array.isArray(contour?.points) ? contour.points : [];
  if (!pts.length) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of pts) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

function dp2CoteLabelAutoOffset(p1, p2, options) {
  const opts = options || {};
  const dx = (p2?.x || 0) - (p1?.x || 0);
  const dy = (p2?.y || 0) - (p1?.y || 0);
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: 0, y: 0 };
  const dist = typeof opts.distance === "number" ? opts.distance : 13;
  const n1 = { x: -dy / len, y: dx / len };
  const n2 = { x: dy / len, y: -dx / len };
  const mid = { x: ((p1.x || 0) + (p2.x || 0)) / 2, y: ((p1.y || 0) + (p2.y || 0)) / 2 };
  let n = n1;

  if (opts.exteriorOf) {
    const center = dp2ContourCentroidForLabels(opts.exteriorOf);
    if (center) {
      const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
      n = (n1.x * toCenter.x + n1.y * toCenter.y) <= 0 ? n1 : n2;
    }
  } else {
    n = Math.abs(n1.y) >= 0.15
      ? (n1.y >= 0 ? n1 : n2)
      : (n1.x >= 0 ? n1 : n2);
  }

  return { x: n.x * dist, y: n.y * dist };
}

function dp2ComputeCoteLabelPoint(p1, p2, offset, options) {
  if (!p1 || !p2) return null;
  const off = dp2ManualCoteOffset(offset);
  const auto = dp2CoteLabelAutoOffset(p1, p2, options);
  return {
    x: ((p1.x || 0) + (p2.x || 0)) / 2 + auto.x + off.x,
    y: ((p1.y || 0) + (p2.y || 0)) / 2 + auto.y + off.y
  };
}

function dp2FillAlignedCoteLabel(ctx, text, p1, p2, offset, tier, options) {
  if (!ctx || !p1 || !p2 || !text) return;
  const pt = dp2ComputeCoteLabelPoint(p1, p2, offset, options);
  if (!pt) return;
  const angle = dp2SegmentReadableAngle(p1, p2);
  const fontSize = tier === "editing" ? 9.5 : 8.8;

  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(angle);
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = tier === "editing" ? "#111827" : DP2_COTE_TEXT;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function dp2SnapPointForDrawing(from, to, opts) {
  if (!from || !to) return to;
  const options = opts || {};
  const dx = (to.x || 0) - (from.x || 0);
  const dy = (to.y || 0) - (from.y || 0);
  const len = Math.hypot(dx, dy);
  if (len < 2) return to;
  const snapAngles = Array.isArray(options.angles) && options.angles.length
    ? options.angles
    : [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, (-3 * Math.PI) / 4];
  const threshold = typeof options.threshold === "number" ? options.threshold : (options.force ? Math.PI / 8 : Math.PI / 18);
  const angle = Math.atan2(dy, dx);
  let best = null;
  let bestDelta = Infinity;
  for (const a of snapAngles) {
    const delta = Math.abs(Math.atan2(Math.sin(angle - a), Math.cos(angle - a)));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = a;
    }
  }
  if (best == null || bestDelta > threshold) return { x: to.x, y: to.y, snapped: false };
  return {
    x: from.x + Math.cos(best) * len,
    y: from.y + Math.sin(best) * len,
    snapped: true,
    snapAngle: best
  };
}

function dp2SnapRidgePointForDrawing(from, to, opts) {
  const options = opts || {};
  const contourSnap = dp2NearestPointOnBuildingContours(to.x, to.y, options.contourTolerancePx || 18);
  let target = contourSnap ? { x: contourSnap.x, y: contourSnap.y } : { x: to.x, y: to.y };
  let snapped = !!contourSnap;
  let segmentAngle = contourSnap?.segmentAngle;

  if (from && (options.force || contourSnap)) {
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 2) {
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      if (typeof segmentAngle === "number") {
        angles.push(segmentAngle, segmentAngle + Math.PI / 2, segmentAngle - Math.PI / 2);
      }
      const angular = dp2SnapPointForDrawing(from, target, {
        angles,
        threshold: options.force ? Math.PI / 12 : Math.PI / 30
      });
      if (angular && angular.snapped) {
        target = { x: angular.x, y: angular.y };
        snapped = true;
      }
    }
  }

  return {
    x: target.x,
    y: target.y,
    snapped,
    contourSnap,
    segmentAngle
  };
}

function dp2EnsureModeStrip() {
  const wrap = document.getElementById("dp2-captured-image-wrap");
  if (!wrap || document.getElementById("dp2-mode-strip")) return;
  const strip = document.createElement("div");
  strip.id = "dp2-mode-strip";
  strip.className = "dp2-mode-strip";
  strip.setAttribute("aria-live", "polite");
  const actions = document.getElementById("dp2-draw-actions");
  const toolbar = document.getElementById("dp2-toolbar");
  if (actions && toolbar && actions.parentNode === wrap) wrap.insertBefore(strip, actions);
  else if (toolbar && toolbar.parentNode === wrap) toolbar.insertAdjacentElement("afterend", strip);
  else wrap.insertAdjacentElement("afterbegin", strip);
}

function refreshDP2ModeStrip() {
  dp2EnsureModeStrip();
  const el = document.getElementById("dp2-mode-strip");
  if (!el) return;
  const tool = window.DP2_STATE?.currentTool || "select";
  const openOutline = typeof hasDP2OpenBuildingOutline === "function" && hasDP2OpenBuildingOutline();
  let text = "";
  if (openOutline && tool === "building_outline") {
    text = "Contour bâti ouvert — cliquez pour placer les sommets, double-clic pour fermer le polygone.";
  } else if (tool === "building_outline") {
    text = "Mode contour bâti — dessinez le pourtour du bâtiment (clics successifs).";
  } else if (tool === "measure_line") {
    text = "Trait de mesure — 1er clic : point A, 2e clic : point B. Double-clic sur une cote pour la modifier.";
  } else if (tool === "ridge_line") {
    text = "Faîtage — deux clics pour définir l’arête.";
  } else if (tool === "gutter_height_dimension") {
    text = "Hauteur égout — 1 clic sur le plan, puis saisir la hauteur en mètres (symbole ↕ fixe, pas de mesure au trait).";
  } else if (tool === "pan") {
    text = "Pan — glisser pour déplacer la vue (molette : zoom).";
  } else if (tool === "panels") {
    text = "Pose de panneaux — le fantôme indique où le module sera posé.";
  } else {
    text = "Sélection — double-clic sur une cote jaune pour modifier la longueur ; double-clic sur « Hauteur égout » pour saisir la hauteur en m ; glisser une cote pour la déplacer.";
  }
  el.textContent = text;
}

// --------------------------
// DP2 — BARRE D'OUTILS (ÉTAPE 4)
// Tant que contour bâti non fermé → seul outil actif = contour bâti (sélection bloquée).
// --------------------------
function initDP2Toolbar() {
  const toolbarRoot = document.getElementById("dp2-toolbar");
  if (toolbarRoot && toolbarRoot.dataset.dp2ToolbarBound === "1") {
    try { syncDP2DisplayModeToolbarUI(); } catch (_) {}
    try { if (typeof dp2SyncDp4RoofMeasuresMenuVisibility === "function") dp2SyncDp4RoofMeasuresMenuVisibility(); } catch (_) {}
    return;
  }
  const selectBtn = document.getElementById("dp2-tool-select");
  const panBtn = document.getElementById("dp2-tool-pan");
  const panelsBtn = document.getElementById("dp2-tool-panels");
  const displayModeDetailedBtn = document.getElementById("dp2-display-mode-detailed");
  const displayModeSimpleBtn = document.getElementById("dp2-display-mode-simple");
  const textBtn = document.getElementById("dp2-tool-text");
  const textMenu = document.getElementById("dp2-text-menu");
  const textIconEl = textBtn?.querySelector?.(".dp2-tool-icon") || null;
  const textLabelEl = textBtn?.querySelector?.(".dp2-tool-label") || null;
  const measuresBtn = document.getElementById("dp2-tool-measures");
  const measuresMenu = document.getElementById("dp2-measures-menu");
  const measuresIconEl = measuresBtn?.querySelector?.(".dp2-tool-icon") || null;
  const measuresLabelEl = measuresBtn?.querySelector?.(".dp2-tool-label") || null;
  const businessBtn = document.getElementById("dp2-tool-business");
  const businessMenu = document.getElementById("dp2-business-menu");
  const businessIconEl = businessBtn?.querySelector?.(".dp2-tool-icon") || null;
  const businessLabelEl = businessBtn?.querySelector?.(".dp2-tool-label") || null;
  if (!selectBtn || !panBtn || !measuresBtn || !toolbarRoot) return;
  toolbarRoot.dataset.dp2ToolbarBound = "1";

  const MEASURES_TOOL_META = {
    building_outline: { icon: "⬛", label: "Contour bâti" },
    measure_line: { icon: "↔", label: "Trait de mesure" },
    ridge_line: { icon: "▲", label: "Faîtage" },
    gutter_height_dimension: { icon: "↕", label: "Hauteur égout" }
  };
  const TEXT_TOOL_META = {
    text_free: { icon: "T", label: "Texte libre" },
    text_DP6: { icon: "T", label: "DP6" },
    text_DP7: { icon: "T", label: "DP7" },
    text_DP8: { icon: "T", label: "DP8" }
  };

  function isMeasuresTool(tool) {
    return tool === "building_outline" || tool === "measure_line" || tool === "ridge_line" || tool === "gutter_height_dimension";
  }

  function isBusinessTool(tool) {
    return isDP2BusinessTool(tool);
  }

  function isTextTool(tool) {
    return isDP2TextTool(tool);
  }

  function syncMeasuresButtonDisplay(tool) {
    if (!measuresBtn || !measuresIconEl || !measuresLabelEl) return;
    const meta = MEASURES_TOOL_META[tool];
    if (meta) {
      measuresIconEl.textContent = meta.icon;
      measuresLabelEl.textContent = meta.label;
    } else {
      measuresIconEl.textContent = "📐";
      measuresLabelEl.textContent = "Mesures";
    }
  }

  function syncBusinessButtonDisplay(tool) {
    if (!businessBtn || !businessIconEl || !businessLabelEl) return;
    const meta = DP2_BUSINESS_OBJECT_META[tool];
    if (meta) {
      businessIconEl.textContent = meta.icon || "⬚";
      businessLabelEl.textContent = meta.label || "Formes métier";
    } else {
      businessIconEl.textContent = "⬚";
      businessLabelEl.textContent = "Formes métier";
    }
  }

  function syncTextButtonDisplay(tool) {
    if (!textBtn || !textIconEl || !textLabelEl) return;
    const meta = TEXT_TOOL_META[tool];
    if (meta) {
      textIconEl.textContent = meta.icon;
      textLabelEl.textContent = meta.label;
    } else {
      textIconEl.textContent = "T";
      textLabelEl.textContent = "Texte";
    }
  }

  function closeMeasuresMenu() {
    if (!measuresBtn || !measuresMenu) return;
    measuresBtn.classList.remove("dp2-dropdown-open");
    measuresBtn.setAttribute("aria-expanded", "false");
    measuresMenu.hidden = true;
  }

  function closeBusinessMenu() {
    if (!businessBtn || !businessMenu) return;
    businessBtn.classList.remove("dp2-dropdown-open");
    businessBtn.setAttribute("aria-expanded", "false");
    businessMenu.hidden = true;
  }

  function closeTextMenu() {
    if (!textBtn || !textMenu) return;
    textBtn.classList.remove("dp2-dropdown-open");
    textBtn.setAttribute("aria-expanded", "false");
    textMenu.hidden = true;
  }

  function openMeasuresMenu() {
    if (!measuresBtn || !measuresMenu) return;
    const toolbar = document.getElementById("dp2-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect?.();
    const btnRect = measuresBtn.getBoundingClientRect();
    if (toolbarRect) {
      // Positionner le menu sous le bouton "Mesures" (dans le repère de la toolbar)
      measuresMenu.style.left = `${Math.max(0, btnRect.left - toolbarRect.left)}px`;
      measuresMenu.style.top = `${Math.max(0, btnRect.bottom - toolbarRect.top + 6)}px`;
      measuresMenu.style.minWidth = `${Math.max(220, Math.round(btnRect.width))}px`;
    }
    measuresBtn.classList.add("dp2-dropdown-open");
    measuresBtn.setAttribute("aria-expanded", "true");
    measuresMenu.hidden = false;
  }

  function openBusinessMenu() {
    if (!businessBtn || !businessMenu) return;
    const toolbar = document.getElementById("dp2-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect?.();
    const btnRect = businessBtn.getBoundingClientRect();
    if (toolbarRect) {
      businessMenu.style.left = `${Math.max(0, btnRect.left - toolbarRect.left)}px`;
      businessMenu.style.top = `${Math.max(0, btnRect.bottom - toolbarRect.top + 6)}px`;
      businessMenu.style.minWidth = `${Math.max(260, Math.round(btnRect.width))}px`;
    }
    businessBtn.classList.add("dp2-dropdown-open");
    businessBtn.setAttribute("aria-expanded", "true");
    businessMenu.hidden = false;
  }

  function openTextMenu() {
    if (!textBtn || !textMenu) return;
    const toolbar = document.getElementById("dp2-toolbar");
    const toolbarRect = toolbar?.getBoundingClientRect?.();
    const btnRect = textBtn.getBoundingClientRect();
    if (toolbarRect) {
      textMenu.style.left = `${Math.max(0, btnRect.left - toolbarRect.left)}px`;
      textMenu.style.top = `${Math.max(0, btnRect.bottom - toolbarRect.top + 6)}px`;
      textMenu.style.minWidth = `${Math.max(200, Math.round(btnRect.width))}px`;
    }
    textBtn.classList.add("dp2-dropdown-open");
    textBtn.setAttribute("aria-expanded", "true");
    textMenu.hidden = false;
  }

  function toggleMeasuresMenu() {
    if (!measuresMenu || !measuresBtn) return;
    closeBusinessMenu();
    if (!measuresMenu.hidden) closeMeasuresMenu();
    else openMeasuresMenu();
  }

  function toggleBusinessMenu() {
    if (!businessMenu || !businessBtn) return;
    closeMeasuresMenu();
    closeTextMenu();
    if (!businessMenu.hidden) closeBusinessMenu();
    else openBusinessMenu();
  }

  function toggleTextMenu() {
    if (!textMenu || !textBtn) return;
    closeMeasuresMenu();
    closeBusinessMenu();
    if (!textMenu.hidden) closeTextMenu();
    else openTextMenu();
  }

  function tryActivateBuildingOutline() {
    if (hasDP2OpenBuildingOutline()) return;
    if (window.DP2_STATE?.currentTool === "building_outline") return;
    setActiveTool("building_outline");
  }

  function setActiveTool(tool) {
    window.DP2_STATE.currentTool = tool;
    if (tool !== "select" && tool !== "building_outline") {
      try {
        window.__DP2_BUILDING_MODIFY_MODE__ = false;
      } catch (_) {}
    }
    // Changement d'outil : annuler la sélection groupée temporaire (panneaux uniquement)
    if (Array.isArray(window.DP2_STATE.selectedPanelIds) && window.DP2_STATE.selectedPanelIds.length >= 2) {
      window.DP2_STATE.selectedPanelIds = [];
      window.DP2_STATE.selectedPanelId = null;
    }
    // Changement d’outil : désélectionner textes (règle UX) + annuler interaction texte en cours
    if (Array.isArray(window.DP2_STATE.selectedTextIds) && window.DP2_STATE.selectedTextIds.length >= 1) {
      dp2ClearSelectedTexts();
    }
    window.DP2_STATE.textInteraction = null;
    // Annuler le lasso et toute interaction groupée en cours
    window.DP2_STATE.selectionRect = null;
    window.DP2_STATE.panelGroupInteraction = null;
    if (tool !== "measure_line") {
      window.DP2_STATE.measureLineStart = null;
    }
    if (tool !== "ridge_line") {
      window.DP2_STATE.ridgeLineStart = null;
    }
    window.DP2_STATE.drawingPreview = null;
    if (tool !== "panels") {
      window.DP2_STATE.panelPlacementPreview = null;
      // Changement d’outil = annulation robuste d’une interaction panneau en cours
      const inter = window.DP2_STATE.panelInteraction || null;
      if (inter && typeof inter.pointerId === "number") {
        const canvas = document.getElementById("dp2-draw-canvas");
        if (canvas && typeof canvas.releasePointerCapture === "function") {
          try { canvas.releasePointerCapture(inter.pointerId); } catch (_) {}
        }
      }
      window.DP2_STATE.panelInteraction = null;
    }
    // Enlever .dp2-tool-active de TOUS les boutons de la toolbar
    const toolbar = document.getElementById("dp2-toolbar");
    if (toolbar) {
      toolbar.querySelectorAll(".dp2-tool-btn").forEach((btn) => {
        btn.classList.remove("dp2-tool-active");
        btn.setAttribute("aria-pressed", "false");
      });
    }
    // Ajouter .dp2-tool-active UNIQUEMENT au bouton correspondant
    const activeBtn = tool === "select"
      ? selectBtn
      : tool === "pan"
        ? panBtn
        : tool === "panels"
          ? panelsBtn
        : isTextTool(tool)
          ? textBtn
          : isMeasuresTool(tool)
            ? measuresBtn
            : isBusinessTool(tool)
              ? businessBtn
              : null;
    if (activeBtn) {
      activeBtn.classList.add("dp2-tool-active");
      activeBtn.setAttribute("aria-pressed", "true");
    }
    syncMeasuresButtonDisplay(tool);
    syncBusinessButtonDisplay(tool);
    syncTextButtonDisplay(tool);
    const imgWrap = document.getElementById("dp2-captured-image-wrap");
    if (imgWrap) imgWrap.classList.toggle("dp2-tool-pan", tool === "pan");
    try {
      dp2SyncInteractionToolFromDp2State();
      dp2FinalizeInteractionChrome();
    } catch (_) {}
    refreshDP2ModeStrip();
    renderDP2FromState();
  }

  function updateToolbarState() {
    const open = hasDP2OpenBuildingOutline();
    if (open) {
      window.DP2_STATE.currentTool = "building_outline";
      selectBtn?.classList.remove("dp2-tool-active");
      selectBtn?.setAttribute("aria-pressed", "false");
      panBtn?.classList.remove("dp2-tool-active");
      panBtn?.setAttribute("aria-pressed", "false");
      panelsBtn?.classList.remove("dp2-tool-active");
      panelsBtn?.setAttribute("aria-pressed", "false");
      measuresBtn?.classList.add("dp2-tool-active");
      measuresBtn?.setAttribute("aria-pressed", "true");
      syncMeasuresButtonDisplay("building_outline");
      closeMeasuresMenu();
      const imgWrap = document.getElementById("dp2-captured-image-wrap");
      if (imgWrap) imgWrap.classList.remove("dp2-tool-pan");
    }
    selectBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (selectBtn) selectBtn.disabled = open;
    panBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (panBtn) panBtn.disabled = open;
    panelsBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (panelsBtn) panelsBtn.disabled = open;
    displayModeDetailedBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (displayModeDetailedBtn) displayModeDetailedBtn.disabled = open;
    displayModeSimpleBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (displayModeSimpleBtn) displayModeSimpleBtn.disabled = open;
    textBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (textBtn) textBtn.disabled = open;
    businessBtn?.classList.toggle("dp2-tool-btn-disabled", open);
    if (businessBtn) businessBtn.disabled = open;
    // Le dropdown regroupe les outils métier : on bloque l'ouverture si contour non fermé
    // (via hasDP2OpenBuildingOutline() dans les handlers), sans griser le bouton actif.
    refreshDP2ModeStrip();
  }

  selectBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    // UX : Sélection = mode neutre (aucune création possible, seulement sélection/déplacement)
    dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "select_tool_click" });
    // Exigence: clic sur "Sélection" = reset (annule la sélection groupée)
    if (window.DP2_STATE) {
      window.DP2_STATE.selectedPanelIds = [];
      window.DP2_STATE.selectedPanelId = null;
      window.DP2_STATE.selectedTextIds = [];
      window.DP2_STATE.selectedTextId = null;
      window.DP2_STATE.selectionRect = null;
      window.DP2_STATE.panelGroupInteraction = null;
      renderDP2FromState();
    }
  });

  panBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    setActiveTool("pan");
  });

  panelsBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    const model = window.DP2_STATE?.panelModel || null;
    if (!model) {
      showDP2Toast("Sélectionnez un module PV dans Paramètres.");
      return;
    }
    const scale = window.DP2_STATE?.scale_m_per_px;
    if (typeof scale !== "number" || scale <= 0) {
      showDP2Toast("Capture requise (échelle indisponible).");
      return;
    }
    const dims = dp2GetPanelDimsPx();
    if (!dims) {
      showDP2Toast("Module invalide (dimensions manquantes).");
      return;
    }
    setActiveTool("panels");
  });

  displayModeDetailedBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    if (!window.DP2_STATE) return;
    window.DP2_STATE.displayMode = "detailed";
    renderDP2FromState();
  });

  displayModeSimpleBtn?.addEventListener("click", () => {
    if (hasDP2OpenBuildingOutline()) return;
    if (!window.DP2_STATE) return;
    window.DP2_STATE.displayMode = "simple";
    renderDP2FromState();
  });

  textBtn?.addEventListener("click", (e) => {
    if (hasDP2OpenBuildingOutline()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTextMenu();
  });

  measuresBtn?.addEventListener("click", (e) => {
    if (hasDP2OpenBuildingOutline()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleMeasuresMenu();
  });

  businessBtn?.addEventListener("click", (e) => {
    if (hasDP2OpenBuildingOutline()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleBusinessMenu();
  });

  textMenu?.addEventListener("click", (e) => {
    const li = e.target?.closest?.("li[data-textkind]");
    if (!li) return;
    if (hasDP2OpenBuildingOutline()) return;
    const kind = li.getAttribute("data-textkind");
    const tool =
      kind === "DP6" ? "text_DP6"
      : kind === "DP7" ? "text_DP7"
      : kind === "DP8" ? "text_DP8"
      : "text_free";
    setActiveTool(tool);
    closeTextMenu();
  });

  measuresMenu?.addEventListener("click", (e) => {
    const li = e.target?.closest?.("li[data-tool]");
    if (!li) return;
    if (hasDP2OpenBuildingOutline()) return;
    const tool = li.getAttribute("data-tool");
    if (tool === "building_outline") {
      tryActivateBuildingOutline();
    } else if (tool === "measure_line" || tool === "ridge_line" || tool === "gutter_height_dimension") {
      setActiveTool(tool);
    }
    closeMeasuresMenu();
  });

  businessMenu?.addEventListener("click", (e) => {
    const li = e.target?.closest?.("li[data-tool]");
    if (!li) return;
    if (hasDP2OpenBuildingOutline()) return;
    const tool = li.getAttribute("data-tool");
    if (tool && isBusinessTool(tool)) {
      setActiveTool(tool);
    }
    closeBusinessMenu();
  });

  document.addEventListener("click", (e) => {
    if (!measuresBtn || !measuresMenu) return;
    const clickedMeasures = measuresBtn.contains(e.target) || measuresMenu.contains(e.target);
    const clickedBusiness = businessBtn && businessMenu && (businessBtn.contains(e.target) || businessMenu.contains(e.target));
    const clickedText = textBtn && textMenu && (textBtn.contains(e.target) || textMenu.contains(e.target));
    if (clickedMeasures || clickedBusiness || clickedText) return;
    closeMeasuresMenu();
    closeBusinessMenu();
    closeTextMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      const tag = String(e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      const state = window.DP2_STATE;
      if (
        state &&
        (state.selectedObjectId != null ||
          state.selectedBuildingContourId ||
          state.selectedBusinessObjectId ||
          (Array.isArray(state.selectedPanelIds) && state.selectedPanelIds.length) ||
          (Array.isArray(state.selectedTextIds) && state.selectedTextIds.length))
      ) {
        e.preventDefault();
        dp2DeleteSelected();
        return;
      }
    }
    if (e.key === "Escape") {
      if (window.DP2_STATE?.parcelEdgeEdit != null) {
        if (typeof dp2RemoveParcelEdgeInlineInput === "function") dp2RemoveParcelEdgeInlineInput();
        dp2ClearParcelEdgeEdit();
        if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        const objs = window.DP2_STATE?.objects || [];
        const idx = objs.findIndex((o) => o && o.__parcelEdge);
        if (idx >= 0) objs.splice(idx, 1);
        if (typeof renderDP2FromState === "function") renderDP2FromState();
        e.preventDefault();
        return;
      }
      const objs = window.DP2_STATE?.objects || [];
      const idx = objs.findIndex((o) => o && o.__parcelEdge);
      if (idx >= 0) {
        if (typeof dp2RemoveParcelEdgeInlineInput === "function") dp2RemoveParcelEdgeInlineInput();
        objs.splice(idx, 1);
        if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        if (typeof renderDP2FromState === "function") renderDP2FromState();
        e.preventDefault();
        return;
      }
      closeMeasuresMenu();
      closeBusinessMenu();
      closeTextMenu();
    }
    if (e.key === "Enter") {
      const pe = window.DP2_STATE?.parcelEdgeEdit;
      if (
        pe &&
        typeof pe.requestedLengthM === "number" &&
        (pe.anchor === "A" || pe.anchor === "B")
      ) {
        if (typeof dp2CommitParcelSegmentResize === "function") {
          dp2CommitParcelSegmentResize({
            contourId: pe.contourId,
            segmentIndex: pe.segmentIndex,
            requestedLengthM: pe.requestedLengthM,
            anchor: pe.anchor
          });
        }
        dp2ClearParcelEdgeEdit();
        if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        if (typeof renderDP2FromState === "function") renderDP2FromState();
        e.preventDefault();
        return;
      }
      const objs = window.DP2_STATE?.objects || [];
      const obj = objs.find((o) => o && o.type === "measure_line" && typeof o.resizeAnchor === "string");
      if (obj) {
        if (typeof dp2CommitMeasureResize === "function") dp2CommitMeasureResize(obj);
        if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        if (typeof renderDP2FromState === "function") renderDP2FromState();
        e.preventDefault();
      }
    }
  });

  // UX : clic hors zone de dessin => reset outil métier + désélection
  // (on ignore la toolbar/menus/overlay pour ne pas casser les interactions existantes)
  if (window.__DP2_OUTSIDE_CANVAS_RESET_BOUND !== true) {
    window.__DP2_OUTSIDE_CANVAS_RESET_BOUND = true;
    document.addEventListener("pointerdown", (e) => {
      const canvas = document.getElementById("dp2-draw-canvas");
      const wrap = document.getElementById("dp2-captured-image-wrap");
      if (!canvas || !wrap) return;

      const toolbarEl = document.getElementById("dp2-toolbar");
      const settingsPanelEl = document.getElementById("dp2-settings-panel");
      const dp4SettingsPanelEl = document.getElementById("dp4-settings-panel");

      const target = e.target;
      const inWrap = wrap.contains(target);
      const inToolbar = toolbarEl ? toolbarEl.contains(target) : false;
      const inSettingsPanel = settingsPanelEl ? settingsPanelEl.contains(target) : false;
      const inDp4SettingsPanel = dp4SettingsPanelEl ? dp4SettingsPanelEl.contains(target) : false;
      if (inWrap || inToolbar || inSettingsPanel || inDp4SettingsPanel) return;

      dp2ResetActiveToolToNeutral({ preserveSelection: false, reason: "outside_canvas_click" });
    }, true);
  }

  setActiveTool(window.DP2_STATE.currentTool || "select");
  updateToolbarState();
  try {
    if (typeof dp2SyncDp4RoofMeasuresMenuVisibility === "function") dp2SyncDp4RoofMeasuresMenuVisibility();
  } catch (_) {}
}

// --------------------------
// DP2 — HIT-TEST (sélection : quel objet sous le clic ?)
// Bâti multi-polygone : sélection via OpenLayers (dp2PickDp2BuildingOlFeatureAtCanvasPixel), pas ce hit-test.
// --------------------------
function dp2HitTest(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const threshold = 12;

  // ----- PASS 1 : priorité sommets explicites ridge_line / measure_line (avant contour bâti)
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || !obj.type) continue;
    if (obj.type === "ridge_line" && obj.a && obj.b) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
    }
    if (obj.type === "measure_line" && obj.a && obj.b && !obj.__parcelEdge) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
    }
  }

  // ----- PASS 2 : bâti = OpenLayers uniquement (pas de hit-test canvas sur buildingContours)

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || !obj.type) continue;
    // Panneaux PV (objet métier dédié) : hit-test rotation + poignée rotation
    if (obj.type === "pv_panel") {
      const w = obj.width || 0;
      const h = obj.height || 0;
      if (!(w > 0) || !(h > 0)) continue;
      const cx = (obj.x || 0) + w / 2;
      const cy = (obj.y || 0) + h / 2;
      const rot = obj.rotation || 0;
      const dx = x - cx;
      const dy = y - cy;
      const c = Math.cos(-rot);
      const s = Math.sin(-rot);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      const inside = lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2;
      // Rotation handle : au-dessus du centre haut du bbox (dans repère local)
      const rotateHandleOffset = 18;
      const rhX = 0;
      const rhY = -h / 2 - rotateHandleOffset;
      const onRotateHandle = Math.hypot(lx - rhX, ly - rhY) <= 10;
      if (inside || onRotateHandle) return { kind: "object", index: i };
    }
    // ridge_line : sommets A/B puis segment (même logique que contour de bâti)
    if (obj.type === "ridge_line" && obj.a && obj.b) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
      const ax = obj.a.x || 0;
      const ay = obj.a.y || 0;
      const dx = (obj.b.x || 0) - ax;
      const dy = (obj.b.y || 0) - ay;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "object", index: i };
    }
    // measure_line (hors __parcelEdge) : sommets A/B puis segment (même logique que contour)
    if (obj.type === "measure_line" && obj.a && obj.b && !obj.__parcelEdge) {
      const dA = Math.hypot((obj.a.x || 0) - x, (obj.a.y || 0) - y);
      if (dA <= threshold) return { kind: "object", index: i, vertexAnchor: "A" };
      const dB = Math.hypot((obj.b.x || 0) - x, (obj.b.y || 0) - y);
      if (dB <= threshold) return { kind: "object", index: i, vertexAnchor: "B" };
      const ax = obj.a.x || 0;
      const ay = obj.a.y || 0;
      const dx = (obj.b.x || 0) - ax;
      const dy = (obj.b.y || 0) - ay;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "object", index: i };
    }
    if (obj.type === "gutter_height_dimension") {
      dp2MigrateGutterHeightDimensionIfNeeded(obj);
      if (typeof obj.x === "number" && typeof obj.y === "number") {
        const sc = dp2GutterHeightVisualScale(obj);
        const half = DP2_GUTTER_HEIGHT_ICON_HALF_PX * sc;
        if (Math.abs(x - obj.x) <= 14 * sc && Math.abs(y - obj.y) <= half + 12 * sc) return { kind: "object", index: i };
        const lx = obj.x + 14 * sc;
        const ly = obj.y;
        if (x >= lx - 4 * sc && x <= lx + 72 * sc && y >= ly - 16 * sc && y <= ly + 16 * sc) return { kind: "object", index: i };
      }
    }
    if (obj.type === "building_outline" && obj.points && obj.points.length >= 2) {
      for (let p = 0; p < obj.points.length; p++) {
        const pt = obj.points[p];
        const d = Math.hypot(pt.x - x, pt.y - y);
        if (d <= threshold) return { kind: "object", index: i };
      }
      const pts = obj.points;
      const n = obj.closed ? pts.length : pts.length - 1;
      for (let s = 0; s < n; s++) {
        const p1 = pts[s];
        const p2 = pts[(s + 1) % pts.length];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / (len * len)));
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        if (Math.hypot(x - projX, y - projY) <= threshold) return { kind: "object", index: i };
      }
    }
  }
  return null;
}

// (hit-test measure_line : segment uniquement, voir dp2HitTest)
// l’étiquette, sinon null.
// --------------------------
const DP2_PARCEL_SEGMENT_HIT_THRESHOLD = 18;

function dp2HitTestParcelSegmentClosest(canvas, x, y) {
  const contours = dp2GetBuildingContours();
  let bestDist = Infinity;
  let best = null;
  for (let c = 0; c < contours.length; c++) {
    const contour = contours[c];
    if (!contour || !contour.id || !Array.isArray(contour.points)) continue;
    const pts = contour.points;
    const n = contour.closed ? pts.length : Math.max(0, pts.length - 1);
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if (!p1 || !p2) continue;
      const ax = p1.x || 0;
      const ay = p1.y || 0;
      const bx = p2.x || 0;
      const by = p2.y || 0;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      const d = Math.hypot(x - projX, y - projY);
      if (d <= DP2_PARCEL_SEGMENT_HIT_THRESHOLD && d < bestDist) {
        bestDist = d;
        best = { contourId: contour.id, segmentIndex: i, a: { x: ax, y: ay }, b: { x: bx, y: by } };
      }
    }
  }
  return best;
}

/** Centre canvas (px) du libellé de cote d’un segment — aligné sur renderDP2BuildingContour + hit-test. */
function dp2ComputeParcelSegmentLabelCanvasPoint(contour, segmentIndex) {
  if (!contour || !Array.isArray(contour.points)) return null;
  const pts = contour.points;
  const i = segmentIndex;
  const segments = contour.closed ? pts.length : pts.length - 1;
  if (i < 0 || i >= segments) return null;
  const p1 = pts[i];
  const p2 = pts[(i + 1) % pts.length];
  if (!p1 || !p2) return null;
  const offMap = contour.labelOffsets && typeof contour.labelOffsets === "object" ? contour.labelOffsets : {};
  const segOff = offMap[i] && typeof offMap[i].x === "number" && typeof offMap[i].y === "number" ? offMap[i] : { x: 0, y: 0 };
  const cutParts = contour.cuts && contour.cuts[i];
  let pt = null;
  if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
    const m0x = (cutParts[0].a.x + cutParts[0].b.x) / 2;
    const m0y = (cutParts[0].a.y + cutParts[0].b.y) / 2;
    const m1x = (cutParts[1].a.x + cutParts[1].b.x) / 2;
    const m1y = (cutParts[1].a.y + cutParts[1].b.y) / 2;
    const auto = dp2CoteLabelAutoOffset(p1, p2, { exteriorOf: contour });
    pt = { x: (m0x + m1x) / 2 + auto.x + segOff.x, y: (m0y + m1y) / 2 + auto.y + segOff.y };
  } else {
    pt = dp2ComputeCoteLabelPoint(p1, p2, segOff, { exteriorOf: contour });
  }
  return pt;
}

/** Double-clic édition cote parcelle : hit sur le libellé affiché (pas sur l’arête brute). */
const DP2_PARCEL_LABEL_DBLCLICK_HIT_PX = 25;

function dp2HitTestParcelLabelForDblClick(canvasX, canvasY) {
  const contours = dp2GetBuildingContours();
  let best = null;
  let bestD = Infinity;
  for (let c = 0; c < contours.length; c++) {
    const contour = contours[c];
    if (!contour || !contour.id || !Array.isArray(contour.points) || contour.points.length < 2) continue;
    const pts = contour.points;
    const segments = contour.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segments; i++) {
      if (dp2ParcelEdgeEditBlocksSegment(contour.id, i)) continue;
      const pt = dp2ComputeParcelSegmentLabelCanvasPoint(contour, i);
      if (!pt) continue;
      const d = Math.hypot(canvasX - pt.x, canvasY - pt.y);
      if (d >= DP2_PARCEL_LABEL_DBLCLICK_HIT_PX || d >= bestD) continue;
      bestD = d;
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      best = {
        contourId: contour.id,
        segmentIndex: i,
        a: { x: p1.x, y: p1.y },
        b: { x: p2.x, y: p2.y }
      };
    }
  }
  return best;
}

// DP2 — Hit-test étiquette de cote (texte "X,XX m") sur un segment de contour jaune. Pour drag visuel uniquement.
function dp2HitTestParcelSegmentLabel(canvas, x, y) {
  const contours = dp2GetBuildingContours();
  const halfW = 32;
  const halfH = 12;
  for (let c = contours.length - 1; c >= 0; c--) {
    const contour = contours[c];
    if (!contour || !contour.id || !Array.isArray(contour.points)) continue;
    const pts = contour.points;
    const scale = window.DP2_STATE?.scale_m_per_px;
    if (pts.length < 2 || typeof scale !== "number" || scale <= 0) continue;
    const segments = contour.closed ? pts.length : pts.length - 1;
    for (let i = segments - 1; i >= 0; i--) {
      if (dp2ParcelEdgeEditBlocksSegment(contour.id, i)) continue;
      const pt = dp2ComputeParcelSegmentLabelCanvasPoint(contour, i);
      if (!pt) continue;
      if (x >= pt.x - halfW && x <= pt.x + halfW && y >= pt.y - halfH && y <= pt.y + halfH)
        return { contourId: contour.id, segmentIndex: i };
    }
  }
  return null;
}

function dp2ClearParcelEdgeEdit() {
  if (window.DP2_STATE) window.DP2_STATE.parcelEdgeEdit = null;
}

function dp2ClearParcelEdgeTransientObjects() {
  const s = window.DP2_STATE;
  if (!s) return;
  if (Array.isArray(s.objects)) {
    s.objects = s.objects.filter(function (o) {
      return !(o && o.__parcelEdge);
    });
  }
  s.parcelEdgeEdit = null;
  if (window.dp2InteractionState) window.dp2InteractionState.editingFeatureId = null;
}

function dp2ParcelEdgeEditMatchesSegment(peEdit, contourId, segmentIndex) {
  return !!(
    peEdit &&
    peEdit.contourId != null &&
    typeof peEdit.segmentIndex === "number" &&
    String(peEdit.contourId) === String(contourId) &&
    peEdit.segmentIndex === segmentIndex
  );
}

function dp2ParcelEdgeEditBlocksSegment(contourId, segmentIndex) {
  if (dp2ParcelEdgeEditMatchesSegment(window.DP2_STATE?.parcelEdgeEdit, contourId, segmentIndex)) return true;
  const objects = window.DP2_STATE?.objects || [];
  return !!objects.find(
    (o) =>
      o &&
      o.type === "measure_line" &&
      o.__parcelEdge &&
      String(o.__parcelEdge.contourId) === String(contourId) &&
      o.__parcelEdge.segmentIndex === segmentIndex
  );
}

/** Stub measure_line pour getMeasureLinePreviewPoints — points toujours lus depuis le contour courant. */
function dp2BuildParcelEdgeMeasureStub(peEdit, contour, segmentIndex) {
  if (!peEdit || !contour || !Array.isArray(contour.points)) return null;
  if (!dp2ParcelEdgeEditMatchesSegment(peEdit, contour.id, segmentIndex)) return null;
  const pts = contour.points;
  const n = pts.length;
  const p1 = pts[segmentIndex];
  const p2 = pts[(segmentIndex + 1) % n];
  if (!p1 || !p2) return null;
  const anchor = peEdit.anchor === "A" || peEdit.anchor === "B" ? peEdit.anchor : null;
  return {
    type: "measure_line",
    a: { x: p1.x, y: p1.y },
    b: { x: p2.x, y: p2.y },
    requestedLengthM: typeof peEdit.requestedLengthM === "number" ? peEdit.requestedLengthM : null,
    resizeAnchor: anchor
  };
}

const DP2_MEASURE_ANCHOR_CHOICE_HIT_PX = 30;
const DP2_MEASURE_ANCHOR_CHOICE_VISUAL_PX = 12;
const DP2_TECH_BLUE = "#1e40af";
const DP2_MEASURE_GREEN = "#15803d";
const DP2_RIDGE_GREEN = "#0f766e";
const DP2_COTE_TEXT = "#1f2937";
const DP2_PREVIEW_STROKE = "#2563eb";

// DP2 — Hit-test repères A/B (measure_line avec requestedLengthM, sans resizeAnchor).
function dp2HitTestMeasureLineAnchor(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const R = DP2_MEASURE_ANCHOR_CHOICE_HIT_PX;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || obj.__parcelEdge) continue;
    if (typeof obj.requestedLengthM !== "number" || (obj.resizeAnchor === "A" || obj.resizeAnchor === "B")) continue;
    const dA = Math.hypot(x - obj.a.x, y - obj.a.y);
    const dB = Math.hypot(x - obj.b.x, y - obj.b.y);
    if (dA <= R && dA <= dB) return { objectIndex: i, anchor: "A" };
    if (dB <= R) return { objectIndex: i, anchor: "B" };
  }
  return null;
}

/** Clic sur les pastilles A/B du segment en édition (parcelEdgeEdit, après saisie longueur). */
function dp2HitTestParcelEdgeAnchorChoice(canvas, x, y) {
  const pe = window.DP2_STATE?.parcelEdgeEdit;
  if (!pe || pe.contourId == null || typeof pe.segmentIndex !== "number") return null;
  if (typeof pe.requestedLengthM !== "number") return null;
  if (pe.anchor === "A" || pe.anchor === "B") return null;
  const contour = dp2GetBuildingContourById(pe.contourId);
  if (!contour || !Array.isArray(contour.points)) return null;
  const pts = contour.points;
  const n = pts.length;
  const p1 = pts[pe.segmentIndex];
  const p2 = pts[(pe.segmentIndex + 1) % n];
  if (!p1 || !p2) return null;
  const R = DP2_MEASURE_ANCHOR_CHOICE_HIT_PX;
  const dA = Math.hypot(x - p1.x, y - p1.y);
  const dB = Math.hypot(x - p2.x, y - p2.y);
  if (dA <= R && dA <= dB) return { anchor: "A" };
  if (dB <= R) return { anchor: "B" };
  return null;
}

// DP2 — Hit-test étiquette de mesure (label longueur) : zone cliquable pour déplacement visuel uniquement.
// Ne teste pas le segment, uniquement la zone du texte (centre + labelOffset, box ~64×24 px).
// En mode prévisualisation (resizeAnchor A/B) on ne propose pas le drag d’étiquette.
function dp2HitTestMeasureLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 34;
  const halfH = 14;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || obj.__parcelEdge) continue;
    if (getMeasureLinePreviewPoints(obj)) continue;
    const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
      ? obj.labelOffset
      : { x: 0, y: 0 };
    const pt = dp2ComputeCoteLabelPoint(obj.a, obj.b, offset);
    if (!pt) continue;
    const lx = pt.x;
    const ly = pt.y;
    if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
      return { kind: "measure_label", index: i };
  }
  return null;
}

// DP2 — Hit-test étiquette faîtage (label longueur) : même zone 64×24 que mesure, pour drag.
function dp2HitTestRidgeLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 34;
  const halfH = 14;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "ridge_line" || !obj.a || !obj.b) continue;
    const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
      ? obj.labelOffset
      : { x: 0, y: 0 };
    const pt = dp2ComputeCoteLabelPoint(obj.a, obj.b, offset);
    if (!pt) continue;
    const lx = pt.x;
    const ly = pt.y;
    if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
      return { kind: "ridge_label", index: i };
  }
  return null;
}

// DP2 — Hit-test libellé valeur « x,xx m » (zone texte à droite du symbole).
function dp2HitTestGutterHeightLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "gutter_height_dimension") continue;
    dp2MigrateGutterHeightDimensionIfNeeded(obj);
    if (typeof obj.x !== "number" || typeof obj.y !== "number") continue;
    const sc = dp2GutterHeightVisualScale(obj);
    const halfW = 56 * sc;
    const halfH = 14 * sc;
    const lx = obj.x + 14 * sc;
    const ly = obj.y;
    if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
      return { kind: "gutter_height_label", index: i };
  }
  return null;
}

/** Indice d’objet gutter_height_dimension sous le point (icône ou texte), ou null. */
function dp2HitTestGutterHeightForPointer(canvas, x, y) {
  if (dp2HitTestGutterHeightVisualHandle(canvas, x, y)) return null;
  const hitLbl = dp2HitTestGutterHeightLabel(canvas, x, y);
  if (hitLbl && typeof hitLbl.index === "number") return hitLbl.index;
  const objects = window.DP2_STATE?.objects || [];
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "gutter_height_dimension") continue;
    dp2MigrateGutterHeightDimensionIfNeeded(obj);
    if (typeof obj.x !== "number" || typeof obj.y !== "number") continue;
    const sc = dp2GutterHeightVisualScale(obj);
    const half = DP2_GUTTER_HEIGHT_ICON_HALF_PX * sc;
    if (Math.abs(x - obj.x) <= 14 * sc && Math.abs(y - obj.y) <= half + 12 * sc) return i;
  }
  return null;
}

function dp2IsMeasureLineEditingActive(obj) {
  if (!obj || obj.type !== "measure_line") return false;
  if (typeof obj.requestedLengthM === "number") return true;
  return false;
}
function dp2IsAnyMeasureOverlayOpen() {
  return !!document.getElementById("dp2-measure-anchor-overlay") ||
         !!document.getElementById("dp2-measure-resize-preview-overlay");
}

// --------------------------
// DP2 — PANNEAUX PV (calepinage simple)
// Stockage dédié : DP2_STATE.panels[] (modèle imposé)
// - Taille en px dérivée du module PV sélectionné + scale_m_per_px (aucune saisie manuelle)
// - Non redimensionnable (lockedSize=true)
// - Rotation libre (poignée rotation)
// - Snap intelligent : collage bord à bord droite/gauche/haut/bas (panneau↔panneau)
//   v1 : snap uniquement si rotations identiques (à epsilon près)
// --------------------------
const DP2_PANEL_STYLE = {
  fill: "rgba(15, 23, 42, 0.82)",
  stroke: "rgba(248, 250, 252, 0.92)",
  lineWidth: 1.15
};
const DP2_PANEL_PREVIEW_STYLE = {
  fill: "rgba(15, 23, 42, 0.74)",
  stroke: "rgba(37, 99, 235, 0.95)",
  lineWidth: 1.4
};
const DP2_PANEL_GHOST_STYLE = {
  fill: "rgba(37, 99, 235, 0.13)",
  stroke: "rgba(37, 99, 235, 0.72)",
  lineWidth: 1.2
};
const DP2_PANEL_SNAP_TOL_PX = 12;
const DP2_PANEL_SNAP_ANGLE_EPS_RAD = Math.PI / 90; // ~2°

function dp2NormalizeAngleRad(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function dp2MetersToCanvasPx(meters) {
  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return null;
  if (typeof meters !== "number" || !(meters > 0)) return null;
  return meters / scale;
}

function dp2GetPanelDimsPx() {
  const model = window.DP2_STATE?.panelModel || null;
  if (!model) return null;
  const wPx = dp2MetersToCanvasPx(model.width_m);
  const hPx = dp2MetersToCanvasPx(model.height_m);
  if (!(wPx > 0) || !(hPx > 0)) return null;
  return { wPx, hPx };
}

function dp2GetPanelById(id) {
  const items = window.DP2_STATE?.panels || [];
  for (const p of items) {
    if (p && p.id === id) return p;
  }
  return null;
}

function dp2PanelCenterFromGeometry(g) {
  const w = g?.width || 0;
  const h = g?.height || 0;
  return { x: (g?.x || 0) + w / 2, y: (g?.y || 0) + h / 2 };
}

function dp2GetEffectiveSelectedPanelIds() {
  const state = window.DP2_STATE;
  if (!state) return [];
  const ids = Array.isArray(state.selectedPanelIds) ? state.selectedPanelIds.filter(Boolean) : [];
  if (ids.length) return ids;
  const single = state.selectedPanelId || null;
  return single ? [single] : [];
}

function dp2SetSelectedPanelIds(ids) {
  const state = window.DP2_STATE;
  if (!state) return;
  const uniq = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  state.selectedPanelIds = uniq;
  state.selectedPanelId = uniq.length === 1 ? uniq[0] : null;
  // Multi-sélection = panneaux uniquement : désélectionner les autres types
  state.selectedObjectId = null;
  state.selectedBusinessObjectId = null;
  state.selectedBuildingContourId = null;
  dp2ClearSelectedTexts();
}

function dp2ClearSelectedPanels() {
  const state = window.DP2_STATE;
  if (!state) return;
  state.selectedPanelIds = [];
  state.selectedPanelId = null;
}

function dp2GetTextById(id) {
  const items = window.DP2_STATE?.textObjects || [];
  for (const t of items) {
    if (t && t.id === id) return t;
  }
  return null;
}

function dp2GetEffectiveSelectedTextIds() {
  const state = window.DP2_STATE;
  if (!state) return [];
  const ids = Array.isArray(state.selectedTextIds) ? state.selectedTextIds.filter(Boolean) : [];
  if (ids.length) return ids;
  const single = state.selectedTextId || null;
  return single ? [single] : [];
}

function dp2SetSelectedTextIds(ids) {
  const state = window.DP2_STATE;
  if (!state) return;
  const uniq = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  state.selectedTextIds = uniq;
  state.selectedTextId = uniq.length === 1 ? uniq[0] : null;
  // Multi-sélection = textes uniquement : désélectionner les autres types
  state.selectedObjectId = null;
  state.selectedBusinessObjectId = null;
  state.selectedBuildingContourId = null;
  dp2ClearSelectedPanels();
}

function dp2ClearSelectedTexts() {
  const state = window.DP2_STATE;
  if (!state) return;
  state.selectedTextIds = [];
  state.selectedTextId = null;
}

function dp2SelectionLabelForInspector() {
  const st = window.DP2_STATE;
  if (!st) return { title: "Aucun objet sélectionné.", detail: "" };
  const panelIds = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
  const textIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  if (panelIds.length >= 2) {
    return { title: `${panelIds.length} panneaux sélectionnés`, detail: "Déplacez le groupe, tournez-le ou dupliquez-le." };
  }
  if (panelIds.length === 1) {
    const p = dp2GetPanelById(panelIds[0]);
    const rot = p?.geometry?.rotation;
    const deg = typeof rot === "number" ? Math.round((rot * 180) / Math.PI) : 0;
    return { title: "Panneau photovoltaïque", detail: `Rotation ${deg}°. Taille verrouillée par le module.` };
  }
  if (textIds.length >= 2) {
    return { title: `${textIds.length} textes sélectionnés`, detail: "Déplacez ou supprimez la sélection." };
  }
  if (textIds.length === 1) {
    const t = dp2GetTextById(textIds[0]);
    return { title: t?.textKind === "free" ? "Texte libre" : `Repère ${t?.textKind || "DP"}`, detail: "Double-cliquez le texte libre pour l'éditer." };
  }
  if (st.selectedBusinessObjectId) {
    const obj = getDP2BusinessObjectById(st.selectedBusinessObjectId);
    const meta = obj ? DP2_BUSINESS_OBJECT_META[obj.type] : null;
    return { title: meta?.label || "Forme métier", detail: "Déplacez, tournez ou redimensionnez depuis le plan." };
  }
  if (st.selectedBuildingContourId) {
    return { title: "Contour bâti", detail: "Le bâti se modifie depuis l'outil Contour bâti." };
  }
  if (st.selectedObjectId != null && st.objects?.[st.selectedObjectId]) {
    const obj = st.objects[st.selectedObjectId];
    const labels = {
      measure_line: "Trait de mesure",
      ridge_line: "Faîtage",
      gutter_height_dimension: "Hauteur égout",
      rectangle: "Rectangle",
      circle: "Cercle",
      arrow: "Flèche",
    };
    return { title: labels[obj.type] || "Objet de dessin", detail: "Déplacez les points ou double-cliquez les valeurs si disponible." };
  }
  return { title: "Aucun objet sélectionné.", detail: "Cliquez un panneau, texte, mesure, forme ou contour pour le modifier." };
}

function syncDP2SelectionInspectorUI() {
  const summary = document.getElementById("dp2-selection-summary");
  const actions = document.getElementById("dp2-selection-actions");
  const duplicateBtn = document.getElementById("dp2-selection-duplicate");
  const rotateBtn = document.getElementById("dp2-selection-rotate");
  const deleteBtn = document.getElementById("dp2-selection-delete");
  if (!summary) return;
  const info = dp2SelectionLabelForInspector();
  summary.innerHTML = `<strong>${info.title}</strong>${info.detail ? `<span>${info.detail}</span>` : ""}`;
  const panelIds = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
  const textIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  const hasDeletable = !!(
    panelIds.length ||
    textIds.length ||
    window.DP2_STATE?.selectedBusinessObjectId ||
    window.DP2_STATE?.selectedBuildingContourId ||
    window.DP2_STATE?.selectedObjectId != null
  );
  if (actions) actions.hidden = !hasDeletable;
  if (duplicateBtn) duplicateBtn.disabled = panelIds.length === 0;
  if (rotateBtn) rotateBtn.disabled = panelIds.length === 0;
  if (deleteBtn) deleteBtn.disabled = !hasDeletable;
}

function dp2DuplicateSelectedPanels() {
  const ids = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
  if (!ids.length || !window.DP2_STATE) return;
  const panels = window.DP2_STATE.panels || (window.DP2_STATE.panels = []);
  dp2CommitHistoryPoint();
  const created = [];
  const offset = 18;
  for (const id of ids) {
    const p = dp2GetPanelById(id);
    if (!p || !p.geometry) continue;
    const next = {
      id: "panel_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      type: "panel",
      geometry: {
        ...JSON.parse(JSON.stringify(p.geometry)),
        x: (p.geometry.x || 0) + offset,
        y: (p.geometry.y || 0) + offset,
      },
      lockedSize: true,
      visible: true,
    };
    panels.push(next);
    created.push(next.id);
  }
  if (created.length) dp2SetSelectedPanelIds(created);
  renderDP2FromState();
}

function dp2RotateSelectedPanelsByQuarterTurn() {
  const ids = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
  if (!ids.length || !window.DP2_STATE) return;
  dp2CommitHistoryPoint();
  for (const id of ids) {
    const p = dp2GetPanelById(id);
    if (!p || !p.geometry) continue;
    p.geometry.rotation = (p.geometry.rotation || 0) + Math.PI / 2;
  }
  renderDP2FromState();
}

function bindDP2SelectionInspectorActions() {
  const duplicateBtn = document.getElementById("dp2-selection-duplicate");
  const rotateBtn = document.getElementById("dp2-selection-rotate");
  const deleteBtn = document.getElementById("dp2-selection-delete");
  if (duplicateBtn && duplicateBtn.dataset.dp2Bound !== "1") {
    duplicateBtn.dataset.dp2Bound = "1";
    duplicateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp2DuplicateSelectedPanels();
    });
  }
  if (rotateBtn && rotateBtn.dataset.dp2Bound !== "1") {
    rotateBtn.dataset.dp2Bound = "1";
    rotateBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dp2RotateSelectedPanelsByQuarterTurn();
    });
  }
  if (deleteBtn && deleteBtn.dataset.dp2Bound !== "1") {
    deleteBtn.dataset.dp2Bound = "1";
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof dp2DeleteSelected === "function") dp2DeleteSelected();
    });
  }
}

function dp2PointInAABB(x, y, aabb) {
  if (!aabb) return false;
  return x >= aabb.minX && x <= aabb.maxX && y >= aabb.minY && y <= aabb.maxY;
}

/**
 * Rectangle englobant (AABB monde canvas) de tous les panneaux DP2_STATE.panels — fonction pure.
 * Même convention de transform que renderDP2PanelRect (échelle optionnelle sur la géométrie, puis rotation).
 * @returns {{ x:number, y:number, width:number, height:number } | null}
 */
function computePanelsBoundingBox(panels) {
  const list = Array.isArray(panels) ? panels : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const p of list) {
    if (!p || p.type !== "panel" || p.visible !== true || !p.geometry) continue;
    const g = p.geometry;
    const w = g.width || 0;
    const h = g.height || 0;
    if (!(w > 0) || !(h > 0)) continue;
    const rot = g.rotation || 0;
    const cx = (g.x || 0) + w / 2;
    const cy = (g.y || 0) + h / 2;
    const sx = g.displayScaleX ?? g.displayScale ?? 1;
    const sy = g.displayScaleY ?? g.displayScale ?? 1;
    const hw = (w / 2) * sx;
    const hh = (h / 2) * sy;
    const cornersLocal = [
      { x: -hw, y: -hh },
      { x: +hw, y: -hh },
      { x: +hw, y: +hh },
      { x: -hw, y: +hh }
    ];
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const pt of cornersLocal) {
      const wx = cx + (pt.x * c - pt.y * s);
      const wy = cy + (pt.x * s + pt.y * c);
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    count++;
  }
  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function dp2PanelWorldAABB(g) {
  const w = g?.width || 0;
  const h = g?.height || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const rot = g?.rotation || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const sx = (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) ? (g?.displayScaleX ?? g?.displayScale ?? 1) : 1;
  const sy = (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) ? (g?.displayScaleY ?? g?.displayScale ?? 1) : 1;
  const hw = (w / 2) * sx;
  const hh = (h / 2) * sy;
  const cornersLocal = [
    { x: -hw, y: -hh },
    { x: +hw, y: -hh },
    { x: +hw, y: +hh },
    { x: -hw, y: +hh }
  ];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of cornersLocal) {
    const wx = cx + (p.x * c - p.y * s);
    const wy = cy + (p.x * s + p.y * c);
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
  }
  return { minX, minY, maxX, maxY, cx, cy };
}

function dp2PanelsGroupAABB(ids) {
  const items = window.DP2_STATE?.panels || [];
  const idSet = new Set(Array.isArray(ids) ? ids : []);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const p of items) {
    if (!p || p.type !== "panel" || p.visible !== true || !p.geometry) continue;
    if (!idSet.has(p.id)) continue;
    const aabb = dp2PanelWorldAABB(p.geometry);
    if (!aabb) continue;
    count++;
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }
  if (count < 2) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX, minY, maxX, maxY, cx, cy };
}

function dp2HitTestPanelGroup(x, y) {
  const ids = dp2GetEffectiveSelectedPanelIds();
  if (ids.length < 2) return null;
  const aabb = dp2PanelsGroupAABB(ids);
  if (!aabb) return null;
  const ui = dp2GetPanelSelectionUiScale();
  const rotateHandleOffset = 20 * ui;
  const hr = 12 * ui;
  const hx = aabb.cx;
  const hy = aabb.minY - rotateHandleOffset;
  const onRotate = Math.hypot(x - hx, y - hy) <= hr;
  if (onRotate) return { part: "rotate", aabb };
  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const scaleHx = aabb.maxX + 14;
    const scaleHy = aabb.maxY + 14;
    const half = 4;
    const onScale = Math.abs(x - scaleHx) <= half && Math.abs(y - scaleHy) <= half;
    if (onScale) return { part: "scale", aabb };
  }
  if (dp2PointInAABB(x, y, aabb)) return { part: "body", aabb };
  return null;
}

function dp2GetPanelSelectionUiScale() {
  const z = window.DP2_STATE?.viewZoom;
  if (typeof z !== "number" || z <= 0) return 1;
  return Math.max(0.7, Math.min(1.65, 1 / z));
}

function dp2PanelHitTestPart(panel, x, y) {
  if (!panel || panel.type !== "panel" || panel.visible !== true || !panel.geometry) return null;
  const g = panel.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return null;

  const c0 = dp2PanelCenterFromGeometry(g);
  const rot = g.rotation || 0;
  const dx = x - c0.x;
  const dy = y - c0.y;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const ui = dp2GetPanelSelectionUiScale();
  const bodyPad = 3 * ui;
  const inside = lx >= -w / 2 - bodyPad && lx <= w / 2 + bodyPad && ly >= -h / 2 - bodyPad && ly <= h / 2 + bodyPad;
  const rotateHandleOffset = 20 * ui;
  const rhX = 0;
  const rhY = -h / 2 - rotateHandleOffset;
  const onRotateHandle = Math.hypot(lx - rhX, ly - rhY) <= 12 * ui;
  if (onRotateHandle) return "rotate";
  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const half = 4;
    const sx = g.displayScaleX ?? g.displayScale ?? 1;
    const sy = g.displayScaleY ?? g.displayScale ?? 1;
    const wEff = w * sx;
    const hEff = h * sy;
    const handleX = wEff / 2 + 14;
    const handleY = hEff / 2 + 14;
    const onScale = Math.abs(lx - handleX) <= half && Math.abs(ly - handleY) <= half;
    if (onScale) return "scale";
  }
  if (inside) return "body";
  return null;
}

function dp2HitTestPanel(x, y) {
  const items = window.DP2_STATE?.panels || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const panel = items[i];
    const part = dp2PanelHitTestPart(panel, x, y);
    if (part) return { id: panel.id, part };
  }
  return null;
}

function dp2TrySnapPanel(previewGeom, pointerWorld, excludePanelId) {
  const items = window.DP2_STATE?.panels || [];
  const gA = previewGeom || null;
  if (!gA) return null;
  const wA = gA.width || 0;
  const hA = gA.height || 0;
  if (!(wA > 0) || !(hA > 0)) return null;
  const rotA = gA.rotation || 0;
  const aCenter = dp2PanelCenterFromGeometry(gA);

  const tol = DP2_PANEL_SNAP_TOL_PX;
  const angleTol = DP2_PANEL_SNAP_ANGLE_EPS_RAD;

  let best = null; // { score, targetCenterWorld:{x,y} }

  for (const b of items) {
    if (!b || b.type !== "panel" || b.visible !== true || !b.geometry) continue;
    if (excludePanelId && b.id === excludePanelId) continue;
    const gB = b.geometry;
    const wB = gB.width || 0;
    const hB = gB.height || 0;
    if (!(wB > 0) || !(hB > 0)) continue;

    const rotB = gB.rotation || 0;
    const dRot = Math.abs(dp2NormalizeAngleRad(rotA - rotB));
    if (dRot > angleTol) continue;

    const bCenter = dp2PanelCenterFromGeometry(gB);

    // A center in B-local coordinates
    const relX = aCenter.x - bCenter.x;
    const relY = aCenter.y - bCenter.y;
    const c = Math.cos(-rotB);
    const s = Math.sin(-rotB);
    const ax = relX * c - relY * s;
    const ay = relX * s + relY * c;

    const hxA = wA / 2;
    const hyA = hA / 2;
    const hxB = wB / 2;
    const hyB = hB / 2;

    const cyAlign = [0, hyA - hyB, hyB - hyA]; // centre, haut, bas
    const cxAlign = [0, hxA - hxB, hxB - hxA]; // centre, gauche, droite

    const candidates = [];
    // collé à droite / collé à gauche
    for (const cy of cyAlign) {
      candidates.push({ cx: +hxB + hxA, cy });
      candidates.push({ cx: -hxB - hxA, cy });
    }
    // collé en haut / collé en bas
    for (const cx0 of cxAlign) {
      candidates.push({ cx: cx0, cy: +hyB + hyA });
      candidates.push({ cx: cx0, cy: -hyB - hyA });
    }

    for (const cand of candidates) {
      const dx = Math.abs(ax - cand.cx);
      const dy = Math.abs(ay - cand.cy);
      if (dx > tol || dy > tol) continue;

      // cand center in world coordinates
      const cwX = bCenter.x + (cand.cx * Math.cos(rotB) - cand.cy * Math.sin(rotB));
      const cwY = bCenter.y + (cand.cx * Math.sin(rotB) + cand.cy * Math.cos(rotB));

      const px = pointerWorld?.x != null ? pointerWorld.x : aCenter.x;
      const py = pointerWorld?.y != null ? pointerWorld.y : aCenter.y;
      const score = Math.hypot(px - cwX, py - cwY); // distance au pointeur

      if (best && score >= best.score) continue;
      best = {
        score,
        targetCenterWorld: { x: cwX, y: cwY }
      };
    }
  }

  return best;
}

// --------------------------
// DP2 — HIT-TEST (formes métier) + helpers géométriques (ÉTAPE 6)
// --------------------------
function getDP2BusinessObjectById(id) {
  const items = window.DP2_STATE?.businessObjects || [];
  for (const obj of items) {
    if (obj && obj.id === id) return obj;
  }
  return null;
}

function dp2BusinessWorldToLocal(obj, x, y) {
  const g = obj?.geometry;
  const w = g?.width || 0;
  const h = g?.height || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const rot = g?.rotation || 0;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return {
    x: dx * c - dy * s + cx,
    y: dx * s + dy * c + cy,
    cx,
    cy
  };
}

function dp2BusinessLocalToWorld(obj, x, y) {
  const g = obj?.geometry;
  const w = g?.width || 0;
  const h = g?.height || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const rot = g?.rotation || 0;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    x: dx * c - dy * s + cx,
    y: dx * s + dy * c + cy
  };
}

function dp2TextWorldToLocal(textObj, x, y) {
  const g = textObj?.geometry;
  const w = g?.width || 0;
  const h = g?.height || 0;
  const cx = (g?.x || 0) + w / 2;
  const cy = (g?.y || 0) + h / 2;
  const rot = g?.rotation || 0;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return { x: dx * c - dy * s + cx, y: dx * s + dy * c + cy, cx, cy };
}

function dp2TextsGroupAABB(ids) {
  const items = window.DP2_STATE?.textObjects || [];
  const idSet = new Set(Array.isArray(ids) ? ids : []);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  for (const t of items) {
    if (!t || t.type !== "text" || t.visible !== true || !t.geometry) continue;
    if (!idSet.has(t.id)) continue;
    const aabb = dp2PanelWorldAABB(t.geometry); // même géométrie qu’un panneau (x,y,w,h,rot)
    if (!aabb) continue;
    count++;
    if (aabb.minX < minX) minX = aabb.minX;
    if (aabb.minY < minY) minY = aabb.minY;
    if (aabb.maxX > maxX) maxX = aabb.maxX;
    if (aabb.maxY > maxY) maxY = aabb.maxY;
  }
  if (count < 2) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX, minY, maxX, maxY, cx, cy };
}

function dp2HitTestText(x, y) {
  const state = window.DP2_STATE;
  const items = state?.textObjects || [];
  const handleSize = 10;
  const ui = dp2GetPanelSelectionUiScale();
  const rotateHandleR = 10 * ui;
  const rotateHandleOffset = 20 * ui;
  const selectedIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  const selectedSingleId = selectedIds.length === 1 ? selectedIds[0] : null;

  function isDPKind(kind) {
    return kind === "DP6" || kind === "DP7" || kind === "DP8";
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const obj = items[i];
    if (!obj || obj.type !== "text" || obj.visible !== true || !obj.geometry) continue;
    const g = obj.geometry;
    const w = g.width || 0;
    const h = g.height || 0;
    if (!(w > 0) || !(h > 0)) continue;

    const local = dp2TextWorldToLocal(obj, x, y);
    const lx = local.x;
    const ly = local.y;
    const inside = lx >= g.x && lx <= g.x + w && ly >= g.y && ly <= g.y + h;

    // Handles uniquement sur le texte déjà sélectionné (évite des actions inattendues)
    if (selectedSingleId && obj.id === selectedSingleId) {
      const rhX = g.x + w / 2;
      const rhY = g.y - rotateHandleOffset;
      if (Math.hypot(lx - rhX, ly - rhY) <= rotateHandleR) return { id: obj.id, part: "rotate" };

      const kind = obj.textKind || "free";
      // DP6/DP7/DP8 : une seule poignée resize (coin bas-droit), resize uniforme strict
      if (isDPKind(kind)) {
        const hx = g.x + w;
        const hy = g.y + h;
        if (lx >= hx - handleSize && lx <= hx + handleSize && ly >= hy - handleSize && ly <= hy + handleSize) {
          return { id: obj.id, part: "resize", handle: "br" };
        }
      } else {
        // Texte libre : poignées classiques (coins + côtés), resize libre (W/H indépendants)
        const handles = [
          { handle: "tl", x: g.x, y: g.y },
          { handle: "tr", x: g.x + w, y: g.y },
          { handle: "bl", x: g.x, y: g.y + h },
          { handle: "br", x: g.x + w, y: g.y + h },
          { handle: "tm", x: g.x + w / 2, y: g.y },
          { handle: "bm", x: g.x + w / 2, y: g.y + h },
          { handle: "ml", x: g.x, y: g.y + h / 2 },
          { handle: "mr", x: g.x + w, y: g.y + h / 2 }
        ];
        for (const hh of handles) {
          if (lx >= hh.x - handleSize && lx <= hh.x + handleSize && ly >= hh.y - handleSize && ly <= hh.y + handleSize) {
            return { id: obj.id, part: "resize", handle: hh.handle };
          }
        }
      }
    }

    if (inside) return { id: obj.id, part: "body" };
  }
  return null;
}

function dp2NormalizeRectFromDrag(ax, ay, bx, by, minSize) {
  const min = typeof minSize === "number" ? minSize : 8;
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  const w = Math.max(min, Math.abs(bx - ax));
  const h = Math.max(min, Math.abs(by - ay));
  return { x, y, width: w, height: h };
}

function dp2PointToSegmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (!(len2 > 0)) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const x = ax + vx * t;
  const y = ay + vy * t;
  return Math.hypot(px - x, py - y);
}

function dp2ProjectPointToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (!(len2 > 0)) return { x: ax, y: ay, t: 0, distance: Math.hypot(px - ax, py - ay) };
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const x = ax + vx * t;
  const y = ay + vy * t;
  return { x, y, t, distance: Math.hypot(px - x, py - y), segmentAngle: Math.atan2(vy, vx) };
}

function dp2NearestPointOnBuildingContours(x, y, maxDistancePx) {
  const tol = typeof maxDistancePx === "number" ? maxDistancePx : 18;
  const contours = typeof dp2GetBuildingContours === "function" ? dp2GetBuildingContours() : [];
  let best = null;
  for (const contour of contours) {
    if (!contour || !Array.isArray(contour.points) || contour.points.length < 2) continue;
    const pts = contour.points;
    const segments = contour.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segments; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!a || !b) continue;
      const p = dp2ProjectPointToSegment(x, y, a.x, a.y, b.x, b.y);
      if (!best || p.distance < best.distance) {
        best = {
          x: p.x,
          y: p.y,
          distance: p.distance,
          contourId: contour.id,
          segmentIndex: i,
          segmentAngle: p.segmentAngle
        };
      }
    }
  }
  return best && best.distance <= tol ? best : null;
}

function dp2IsVectorCreateBusinessType(type) {
  return type === "sens_pente" || type === "voie_acces" || type === "arrow" || type === "angle_vue";
}

function dp2IsFramelessBusinessObject(type) {
  return type === "sens_pente" || type === "angle_vue" || type === "voie_acces";
}

function dp2BusinessFramelessActiveLevel(obj) {
  if (!obj || !window.DP2_STATE) return 0;
  const st = window.DP2_STATE;
  if (st.businessInteraction && st.businessInteraction.id === obj.id) return 1;
  if (st.businessDragCandidate && st.businessDragCandidate.id === obj.id) return 0.8;
  if (st.selectedBusinessObjectId === obj.id) return 0.55;
  if (st._businessHoverId === obj.id) return 0.35;
  return 0;
}

// Formes métier — resize + rotation (× viewZoom, ×0.8 visuel) ; déplacement = drag sur le corps
const DP2_BIZ_HANDLE_VIS_GLOBAL = 0.8;
const DP2_BIZ_HANDLE_VISUAL_PX = 11;
const DP2_BIZ_HANDLE_HIT_PAD_PX = 9;
const DP2_BIZ_ROT_LINE_PX = 18;
const DP2_BIZ_ROT_VIS_R_PX = 7;
const DP2_BIZ_ROT_HIT_PAD_PX = 9;
const DP2_BIZ_BODY_HIT_PAD_PX = 5;
/** Seuil canvas (px) : au-delà, le candidat corps → vrai drag métier + commit historique. */
const DP2_BIZ_DRAG_PROMOTE_PX = 4;

function dp2GetBusinessSelectionUiScale() {
  const z = window.DP2_STATE?.viewZoom;
  if (typeof z !== "number" || z <= 0) return 1;
  return Math.max(0.65, Math.min(1.75, 1 / z));
}

function dp2GetBusinessSelectionMetrics() {
  const sc = dp2GetBusinessSelectionUiScale();
  const vg = DP2_BIZ_HANDLE_VIS_GLOBAL;
  const visualHalf = (DP2_BIZ_HANDLE_VISUAL_PX * sc * vg) / 2;
  const hitResizeHalf = visualHalf + DP2_BIZ_HANDLE_HIT_PAD_PX * sc;
  const rotLine = DP2_BIZ_ROT_LINE_PX * sc * vg;
  const rotVisR = DP2_BIZ_ROT_VIS_R_PX * sc * vg;
  const rotHitR = rotVisR + DP2_BIZ_ROT_HIT_PAD_PX * sc;
  const bodyPad = DP2_BIZ_BODY_HIT_PAD_PX * sc;
  return { sc, vg, visualHalf, hitResizeHalf, rotLine, rotVisR, rotHitR, bodyPad };
}

/** Resize unique coin bas-droit (repère local non rotaté, comme avant multi-handles). */
function dp2BusinessMinSizeForType(type) {
  return type === "compteur" || type === "disjoncteur" || type === "batterie" ? 6 : 12;
}

function dp2ApplyBusinessResizeFromLocal(inter, g, lx, ly, type) {
  const sx = inter.startX;
  const sy = inter.startY;
  const minSize = dp2BusinessMinSizeForType(type || inter?.type);
  g.x = sx;
  g.y = sy;
  g.width = Math.max(minSize, lx - sx);
  g.height = Math.max(minSize, ly - sy);
}

function dp2ApplyFramelessBusinessResize(obj, inter, coords) {
  const startObj = {
    geometry: {
      x: inter.startX,
      y: inter.startY,
      width: inter.startW,
      height: inter.startH,
      rotation: inter.startRotation
    }
  };
  const anchor = dp2BusinessLocalToWorld(
    startObj,
    inter.startX,
    inter.startY + (inter.startH || 0) / 2
  );
  const dx = coords.x - anchor.x;
  const dy = coords.y - anchor.y;
  const len = Math.max(16, Math.hypot(dx, dy));
  const rot = Math.atan2(dy, dx);
  const h = Math.max(12, inter.startH || obj.geometry.height || 24);
  obj.geometry.width = len;
  obj.geometry.height = h;
  obj.geometry.rotation = rot;
  obj.geometry.x = anchor.x + dx / 2 - len / 2;
  obj.geometry.y = anchor.y + dy / 2 - h / 2;
}

function dp2HitTestBusiness(x, y) {
  const items = window.DP2_STATE?.businessObjects || [];
  const m = dp2GetBusinessSelectionMetrics();
  const { hitResizeHalf, rotLine, rotHitR, bodyPad } = m;
  const tool = window.DP2_STATE?.currentTool || "select";
  const selectedBizId = window.DP2_STATE?.selectedBusinessObjectId || null;

  for (let i = items.length - 1; i >= 0; i--) {
    const obj = items[i];
    if (!obj || obj.visible !== true || !obj.geometry) continue;
    const g = obj.geometry;
    const w = g.width || 0;
    const h = g.height || 0;
    if (!(w > 0) || !(h > 0)) continue;

    const canHitHandles =
      isDP2BusinessTool(tool) ||
      (tool === "select" && selectedBizId && obj.id === selectedBizId);

    const local = dp2BusinessWorldToLocal(obj, x, y);
    const lx = local.x;
    const ly = local.y;

    const inside =
      lx >= g.x - bodyPad &&
      lx <= g.x + w + bodyPad &&
      ly >= g.y - bodyPad &&
      ly <= g.y + h + bodyPad;

    const strictIn =
      lx >= g.x &&
      lx <= g.x + w &&
      ly >= g.y &&
      ly <= g.y + h;

    if (canHitHandles) {
      const frameless = dp2IsFramelessBusinessObject(obj.type);
      if (!frameless) {
        const rhX = g.x + w / 2;
        const rhY = g.y - rotLine;
        if (Math.hypot(lx - rhX, ly - rhY) <= rotHitR) {
          return { id: obj.id, part: "rotate" };
        }
      }

      const hx = frameless ? g.x + w * 0.88 : g.x + w;
      const hy = frameless ? g.y + h / 2 : g.y + h;
      if (lx >= hx - hitResizeHalf && lx <= hx + hitResizeHalf && ly >= hy - hitResizeHalf && ly <= hy + hitResizeHalf) {
        return { id: obj.id, part: "resize", handle: "br" };
      }

      if (frameless) {
        const ax = g.x + w * 0.12;
        const ay = g.y + h * 0.5;
        const bx = g.x + w * 0.88;
        const by = g.y + h * 0.5;
        const d = dp2PointToSegmentDistance(lx, ly, ax, ay, bx, by);
        if (d <= Math.max(bodyPad + 3, 10 * m.sc)) return { id: obj.id, part: "body" };
      } else if (strictIn) {
        return { id: obj.id, part: "body" };
      }
    }

    if (dp2IsFramelessBusinessObject(obj.type)) {
      const ax = g.x + w * 0.12;
      const ay = g.y + h * 0.5;
      const bx = g.x + w * 0.88;
      const by = g.y + h * 0.5;
      const d = dp2PointToSegmentDistance(lx, ly, ax, ay, bx, by);
      if (d <= Math.max(bodyPad + 3, 10 * m.sc)) return { id: obj.id, part: "body" };
    } else if (inside) {
      return { id: obj.id, part: "body" };
    }
  }
  return null;
}

let _dp2BizDragRenderRaf = null;
function dp2ScheduleBusinessDragRender() {
  if (_dp2BizDragRenderRaf != null) return;
  _dp2BizDragRenderRaf = requestAnimationFrame(() => {
    _dp2BizDragRenderRaf = null;
    renderDP2FromState();
  });
}
function dp2CancelPendingBusinessDragRender() {
  if (_dp2BizDragRenderRaf != null) {
    cancelAnimationFrame(_dp2BizDragRenderRaf);
    _dp2BizDragRenderRaf = null;
  }
}

/** Transitions chrome métier (hover / sélection / fin de drag) — 80–120 ms, sans logique métier. */
function dp2BizUiEaseOutQuad(t) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) * (1 - u);
}
function dp2BizUiBlend01(startAt, durationMs) {
  if (startAt == null || typeof startAt !== "number") return 1;
  const u = (Date.now() - startAt) / durationMs;
  if (u >= 1) return 1;
  return dp2BizUiEaseOutQuad(u);
}
function dp2BizSelectionGripBlend(state, objId) {
  if (!state || !objId) return 0;
  const inter = state.businessInteraction;
  if (inter && inter.id === objId && inter.part !== "create") {
    if (inter.part === "move" || inter.part === "resize" || inter.part === "rotate") return 1;
  }
  const rel = state._businessGripReleaseAt;
  if (rel == null || typeof rel !== "number") return 0;
  const dt = Date.now() - rel;
  if (dt >= 115) return 0;
  return 1 - dt / 115;
}
function dp2BizUiTransitionPending() {
  const st = window.DP2_STATE;
  if (!st) return false;
  const now = Date.now();
  if (st._bizHoverChromeAt != null && now - st._bizHoverChromeAt < 108) return true;
  if (st._bizSelChromeAt != null && now - st._bizSelChromeAt < 108) return true;
  if (st._businessGripReleaseAt != null && now - st._businessGripReleaseAt < 125) return true;
  return false;
}
let _dp2BizUiChromeRaf = null;
function dp2TryScheduleBizUiChromeFrame() {
  if (_dp2BizUiChromeRaf != null || !dp2BizUiTransitionPending()) return;
  _dp2BizUiChromeRaf = requestAnimationFrame(() => {
    _dp2BizUiChromeRaf = null;
    renderDP2FromState();
  });
}

function dp2TryUpdateBusinessHoverCursor(canvas, clientX, clientY) {
  if (!canvas || window.DP2_STATE?.mode !== "EDITION") return;
  const tool = window.DP2_STATE?.currentTool || "select";
  if (tool === "pan" || tool === "panels" || tool === "measure_line" || tool === "ridge_line" || tool === "gutter_height_dimension" || tool === "building_outline") {
    canvas.style.cursor = "";
    return;
  }
  if (isDP2TextTool(tool)) {
    canvas.style.cursor = "";
    return;
  }
  if (
    window.DP2_STATE?.businessInteraction ||
    window.DP2_STATE?.businessDragCandidate ||
    window.DP2_STATE?.panelInteraction ||
    window.DP2_STATE?.panelGroupInteraction ||
    window.DP2_STATE?.textInteraction ||
    window.DP2_STATE?.selectionRect ||
    window.DP2_STATE?.measureLabelDrag ||
    window.DP2_STATE?.measureLabelDragCandidate ||
    window.DP2_STATE?.gutterHeightDrag ||
    window.DP2_STATE?.gutterHeightVisualScaleDrag
  ) {
    return;
  }
  if (!isDP2BusinessTool(tool) && tool !== "select") {
    canvas.style.cursor = "";
    return;
  }
  const coords = getDP2CanvasCoords(canvas, clientX, clientY);
  const hit = dp2HitTestBusiness(coords.x, coords.y);
  const nextHover = hit && hit.id ? hit.id : null;
  const prevHover = window.DP2_STATE._businessHoverId ?? null;
  if (nextHover !== prevHover) {
    window.DP2_STATE._businessHoverId = nextHover;
    window.DP2_STATE._bizHoverChromeAt = Date.now();
    renderDP2FromState();
  }
  if (!hit || !hit.id) {
    canvas.style.cursor = "";
    return;
  }
  if (hit.part === "rotate") {
    canvas.style.cursor = "crosshair";
    return;
  }
  if (hit.part === "body") {
    canvas.style.cursor = "move";
    return;
  }
  if (hit.part === "resize") {
    canvas.style.cursor = "nwse-resize";
    return;
  }
}

// --------------------------
// DP2 — ÉVÉNEMENTS CANVAS (clic / double-clic)
// Contour bâti : ajout de points, fermeture (clic proche premier point ou double-clic).
// --------------------------
const DP2_CLOSE_THRESHOLD_PX = 15;
/** Hit-test sommet → handoff OpenLayers Modify (tolérance alignée sur `pixelTolerance` de l’interaction OL). */
const DP2_BUILDING_VERTEX_OL_HANDOFF_TOL_PX = 10;

function initDP2CanvasEvents() {
  const canvas = document.getElementById("dp2-draw-canvas");
  if (!canvas) return;
  // Anti double-binding (si le DOM est re-monté / réutilisé)
  if (canvas.dataset.dp2Bound === "1") return;
  canvas.dataset.dp2Bound = "1";

  if (!window._dp2TempOlBuildingDragListenersBound) {
    window._dp2TempOlBuildingDragListenersBound = true;
    const onGlobalPointerEnd = () => {
      dp2ClearTempOlBuildingDragIfNeeded();
    };
    window.addEventListener("pointerup", onGlobalPointerEnd, true);
    window.addEventListener("pointercancel", onGlobalPointerEnd, true);
    window.addEventListener("lostpointercapture", onGlobalPointerEnd, true);
  }

  // Bind suppression clavier (une seule fois)
  if (window.DP2_STATE && window.DP2_STATE._businessKeyHandlerBound !== true) {
    window.DP2_STATE._businessKeyHandlerBound = true;
    window.addEventListener("keydown", (e) => {
      const key = e.key;
      if (key !== "Delete" && key !== "Backspace") return;
      const activeEl = document.activeElement;
      const typing =
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable);
      if (typing) return;

      const state = window.DP2_STATE;
      if (!state || state.mode !== "EDITION") return;

      const bizId = state.selectedBusinessObjectId || null;
      const panelIds = typeof dp2GetEffectiveSelectedPanelIds === "function" ? dp2GetEffectiveSelectedPanelIds() : [];
      const textIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
      const objIdx = state.selectedObjectId != null ? state.selectedObjectId : null;
      const contourId = state.selectedBuildingContourId || null;

      if (!bizId && (!panelIds || !panelIds.length) && (!textIds || !textIds.length) && objIdx == null && !contourId) {
        return;
      }

      dp2DeleteSelected();
      e.preventDefault();
    });
  }

  // Interaction pointer (formes métier + panneaux PV) : création / move / resize / rotation
  canvas.addEventListener("pointerdown", (e) => {
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;
    if (tool !== "select" && tool !== "panels" && !isDP2BusinessTool(tool) && !isDP2TextTool(tool)) return;

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    try {
      dp2SetActiveFeatureFromPointerDown(canvas, e);
    } catch (_) {}

    if (tool === "select") {
      const hitParcelAnchor = dp2HitTestParcelEdgeAnchorChoice(canvas, coords.x, coords.y);
      if (hitParcelAnchor && (hitParcelAnchor.anchor === "A" || hitParcelAnchor.anchor === "B")) {
        e.preventDefault();
        e.stopPropagation();
        const pe = window.DP2_STATE?.parcelEdgeEdit;
        if (pe) {
          pe.anchor = hitParcelAnchor.anchor;
          dp2CommitParcelSegmentResize({
            contourId: pe.contourId,
            segmentIndex: pe.segmentIndex,
            requestedLengthM: pe.requestedLengthM,
            anchor: pe.anchor
          });
          dp2ClearParcelEdgeEdit();
          if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
          renderDP2FromState();
          return;
        }
      }

      const hitAnchor = dp2HitTestMeasureLineAnchor(canvas, coords.x, coords.y);
      if (hitAnchor && typeof hitAnchor.objectIndex === "number" && (hitAnchor.anchor === "A" || hitAnchor.anchor === "B")) {
        e.preventDefault();
        e.stopPropagation();
        const objs = window.DP2_STATE?.objects || [];
        const obj = objs[hitAnchor.objectIndex];
        if (obj && obj.type === "measure_line") {
          obj.resizeAnchor = hitAnchor.anchor;
          dp2CommitMeasureResize(obj);
          if (typeof dp2RemoveMeasureAnchorChoiceOverlay === "function") dp2RemoveMeasureAnchorChoiceOverlay();
          if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
          renderDP2FromState();
          return;
        }
      }
    }

    // 0) DP2 — Libellés de cote sur segments du contour (priorité max sur les autres hits Sélection)
    if (tool === "select") {
      const hitParcelLabel = dp2HitTestParcelSegmentLabel(canvas, coords.x, coords.y);
      if (hitParcelLabel && hitParcelLabel.contourId != null && typeof hitParcelLabel.segmentIndex === "number") {
        const contour = dp2GetBuildingContourById(hitParcelLabel.contourId);
        if (contour) {
          dp2CommitHistoryPoint();
          if (!contour.labelOffsets || typeof contour.labelOffsets !== "object") contour.labelOffsets = {};
          const off = contour.labelOffsets[hitParcelLabel.segmentIndex];
          const ox = off && typeof off.x === "number" ? off.x : 0;
          const oy = off && typeof off.y === "number" ? off.y : 0;
          window.DP2_STATE.parcelLabelDrag = {
            contourId: hitParcelLabel.contourId,
            segmentIndex: hitParcelLabel.segmentIndex,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startCanvasX: coords.x,
            startCanvasY: coords.y,
            startOffsetX: ox,
            startOffsetY: oy
          };
          try {
            dp2SyncContourLabelOffsetsToFeature(hitParcelLabel.contourId);
          } catch (_) {}
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // 0bis) Étiquette de mesure (measure_line) : candidat au drag — après libellés segments contour
    if (tool === "select") {
      const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
      if (hitLabel && hitLabel.kind === "measure_label" && typeof hitLabel.index === "number") {
        const obj = window.DP2_STATE?.objects?.[hitLabel.index];
        if (!dp2IsAnyMeasureOverlayOpen() && !dp2IsMeasureLineEditingActive(obj)) {
          const offset = obj?.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
            ? { x: obj.labelOffset.x, y: obj.labelOffset.y }
            : { x: 0, y: 0 };
          window.DP2_STATE.measureLabelDragCandidate = {
            objectIndex: hitLabel.index,
            pointerId: e.pointerId,
            startCanvasX: coords.x,
            startCanvasY: coords.y,
            startOffsetX: offset.x,
            startOffsetY: offset.y
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // DP2 — Drag étiquette faîtage (label longueur) : même logique que étiquette mesure
    if (tool === "select") {
      const hitRidgeLabel = dp2HitTestRidgeLabel(canvas, coords.x, coords.y);
      if (hitRidgeLabel && hitRidgeLabel.kind === "ridge_label" && typeof hitRidgeLabel.index === "number") {
        const obj = window.DP2_STATE?.objects?.[hitRidgeLabel.index];
        if (obj && obj.type === "ridge_line") {
          const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
            ? { x: obj.labelOffset.x, y: obj.labelOffset.y }
            : { x: 0, y: 0 };
          dp2CommitHistoryPoint();
          window.DP2_STATE.ridgeLabelDrag = {
            objectIndex: hitRidgeLabel.index,
            pointerId: e.pointerId,
            startCanvasX: coords.x,
            startCanvasY: coords.y,
            startOffsetX: offset.x,
            startOffsetY: offset.y
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // DP2 — Poignée visualScale (flèche ↕, sans impact heightM)
    if (tool === "select") {
      const ghVs = dp2HitTestGutterHeightVisualHandle(canvas, coords.x, coords.y);
      if (ghVs && typeof ghVs.index === "number") {
        const go = window.DP2_STATE?.objects?.[ghVs.index];
        if (go && go.type === "gutter_height_dimension") {
          dp2MigrateGutterHeightDimensionIfNeeded(go);
          dp2CommitHistoryPoint();
          window.DP2_STATE.gutterHeightVisualScaleDrag = {
            objectIndex: ghVs.index,
            pointerId: e.pointerId,
            startCanvasY: coords.y,
            startVisualScale: dp2ClampGutterHeightVisualScale(
              typeof go.visualScale === "number" && Number.isFinite(go.visualScale) ? go.visualScale : 1
            )
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // DP2 — Drag annotation « Hauteur égout » (icône + texte déplacent x,y)
    if (tool === "select") {
      const ghIdx = dp2HitTestGutterHeightForPointer(canvas, coords.x, coords.y);
      if (typeof ghIdx === "number") {
        const go = window.DP2_STATE?.objects?.[ghIdx];
        if (go && go.type === "gutter_height_dimension") {
          dp2MigrateGutterHeightDimensionIfNeeded(go);
          if (typeof go.x === "number" && typeof go.y === "number") {
            dp2CommitHistoryPoint();
            window.DP2_STATE.gutterHeightDrag = {
              objectIndex: ghIdx,
              pointerId: e.pointerId,
              startCanvasX: coords.x,
              startCanvasY: coords.y,
              startObjX: go.x,
              startObjY: go.y
            };
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
            renderDP2FromState();
            return;
          }
        }
      }
    }

    // DP2 — Drag sommet faitage ou mesure (même logique que contour de bâti) — sans hauteur égout
    if (tool === "select") {
      const hitLine = dp2HitTest(canvas, coords.x, coords.y);
      if (hitLine && hitLine.kind === "object" && (hitLine.vertexAnchor === "A" || hitLine.vertexAnchor === "B")) {
        const obj = window.DP2_STATE?.objects?.[hitLine.index];
        if (obj && (obj.type === "ridge_line" || obj.type === "measure_line") && obj.a && obj.b) {
          const pt = hitLine.vertexAnchor === "A" ? obj.a : obj.b;
          dp2CommitHistoryPoint();
          window.DP2_STATE.lineVertexInteraction = {
            objectIndex: hitLine.index,
            anchor: hitLine.vertexAnchor,
            pointerId: e.pointerId,
            offsetX: coords.x - (pt.x || 0),
            offsetY: coords.y - (pt.y || 0),
            hasMoved: false
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    const hitTextBeforeBuilding = tool === "select" ? dp2HitTestText(coords.x, coords.y) : null;
    const hitPanelBeforeBuilding = tool === "select" ? dp2HitTestPanel(coords.x, coords.y) : null;
    const hitPanelGroupBeforeBuilding = tool === "select" ? dp2HitTestPanelGroup(coords.x, coords.y) : null;
    const hitBizBeforeBuilding = tool === "select" ? dp2HitTestBusiness(coords.x, coords.y) : null;

    // DP2 — Hybrid : sommet contour bâti (`buildingContours.points`) → priorité OL temporaire + pointerdown sur la carte (Modify)
    if (
      tool === "select" &&
      !hitBizBeforeBuilding &&
      !hitTextBeforeBuilding &&
      !hitPanelBeforeBuilding &&
      !hitPanelGroupBeforeBuilding &&
      dp2HitTestBuildingContourVertexForOlHandoff(coords.x, coords.y, DP2_BUILDING_VERTEX_OL_HANDOFF_TOL_PX)
    ) {
      window.__DP2_TEMP_OL_DRAG__ = true;
      try {
        dp2SyncBuildingOlPointerPassThrough();
      } catch (_) {}
      let forwarded = false;
      try {
        forwarded = dp2ForwardPointerDownToBuildingOlMap(e);
      } catch (_) {}
      if (!forwarded) {
        window.__DP2_TEMP_OL_DRAG__ = false;
        try {
          dp2SyncBuildingOlPointerPassThrough();
        } catch (_) {}
      } else {
        return;
      }
    }

    // 0) DP2 — Bâti : pick OpenLayers en dernier (après sommets mesure/faîtage ; pas si hit segment mesure etc. sur le polygone)
    if (
      tool === "select" &&
      typeof dp2PickDp2BuildingOlFeatureAtCanvasPixel === "function" &&
      !hitBizBeforeBuilding &&
      !hitTextBeforeBuilding &&
      !hitPanelBeforeBuilding &&
      !hitPanelGroupBeforeBuilding &&
      !dp2PointerDownDeferBuildingOlPick(canvas, coords.x, coords.y)
    ) {
      const olFeat = dp2PickDp2BuildingOlFeatureAtCanvasPixel(canvas, coords.x, coords.y);
      if (olFeat) {
        const fid = olFeat.getId() != null ? olFeat.getId() : olFeat.get("dp2FeatureId");
        if (fid != null) {
          dp2SetSelectedBuildingContourId(String(fid));
          renderDP2FromState();
          return;
        }
      }
    }

    const hitText = hitTextBeforeBuilding || dp2HitTestText(coords.x, coords.y);

    // 0) Textes (annotations) : sélection + move/resize/rotate
    // FIX priorité : un panneau directement clique l'emporte sur le texte (ne pas voler le clic).
    if (hitText && hitText.id && !hitPanelBeforeBuilding) {
      const obj = dp2GetTextById(hitText.id);
      if (!obj || !obj.geometry) return;
      dp2ClearSelectedPanels();
      window.DP2_STATE.selectedBusinessObjectId = null;
      window.DP2_STATE.selectedObjectId = null;
      dp2SetSelectedTextIds([obj.id]);
      // Éviter qu'un click "outil panneaux" pose un panneau après sélection texte
      window.DP2_STATE._lastTextInteractionAt = Date.now();
      // Interaction uniquement si sélection unique
      if (dp2GetEffectiveSelectedTextIds().length === 1) {
        dp2CommitHistoryPoint();
        const g = obj.geometry;
        const cx = g.x + (g.width || 0) / 2;
        const cy = g.y + (g.height || 0) / 2;
        window.DP2_STATE.textInteraction = {
          id: obj.id,
          part: hitText.part,
          resizeHandle: hitText.part === "resize" ? (hitText.handle || "br") : null,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startX: g.x,
          startY: g.y,
          startW: g.width,
          startH: g.height,
          startRotation: g.rotation || 0,
          startFontSize: typeof obj.fontSize === "number" ? obj.fontSize : DP2_TEXT_DEFAULT_FONT_SIZE,
          cx,
          cy,
          startAngle: Math.atan2(coords.y - cy, coords.x - cx),
          hasMoved: false
        };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      }
      renderDP2FromState();
      return;
    }

    // 0bis) Outil texte actif : rubber-band de création (prioritaire sur le reste)
    if (isDP2TextTool(tool)) {
      dp2ClearSelectedPanels();
      window.DP2_STATE.selectedBusinessObjectId = null;
      window.DP2_STATE.selectedObjectId = null;
      dp2ClearSelectedTexts();
      window.DP2_STATE.textInteraction = {
        part: "create",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        anchorX: coords.x,
        anchorY: coords.y,
        curX: coords.x,
        curY: coords.y,
        tool,
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    const hitBiz = hitBizBeforeBuilding || dp2HitTestBusiness(coords.x, coords.y);

    // 1) Priorité : objets métier (dessinés au-dessus des objets standards)
    // FIX priorité : un panneau directement clique l'emporte sur l'objet metier.
    if (hitBiz && hitBiz.id && !hitPanelBeforeBuilding) {
      const obj = getDP2BusinessObjectById(hitBiz.id);
      if (!obj || !obj.geometry) return;
      // Sélection panneaux (simple ou groupée) => désélectionnée si on touche un objet métier
      dp2ClearSelectedPanels();
      dp2ClearSelectedTexts();
      window.DP2_STATE.selectedBuildingContourId = null;
      try {
        window.__DP2_BUILDING_MODIFY_MODE__ = false;
      } catch (_) {}
      window.DP2_STATE.selectedBusinessObjectId = obj.id;

      const g = obj.geometry;
      const cx = g.x + (g.width || 0) / 2;
      const cy = g.y + (g.height || 0) / 2;

      // Corps : sélection immédiate ; drag réel seulement après seuil (voir businessDragCandidate + pointermove)
      if (hitBiz.part === "body") {
        window.DP2_STATE._businessGripReleaseAt = null;
        window.DP2_STATE.businessDragCandidate = {
          id: obj.id,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startX: g.x,
          startY: g.y,
          startW: g.width,
          startH: g.height,
          startRotation: g.rotation || 0,
          cx,
          cy,
          startAngle: Math.atan2(coords.y - cy, coords.x - cx)
        };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        renderDP2FromState();
        return;
      }

      dp2CommitHistoryPoint();
      window.DP2_STATE.businessDragCandidate = null;
      window.DP2_STATE._businessGripReleaseAt = null;
      window.DP2_STATE.businessInteraction = {
        id: obj.id,
        type: obj.type,
        part: hitBiz.part,
        resizeHandle: hitBiz.part === "resize" ? (hitBiz.handle || "br") : undefined,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: g.x,
        startY: g.y,
        startW: g.width,
        startH: g.height,
        startRotation: g.rotation || 0,
        cx,
        cy,
        startAngle: Math.atan2(coords.y - cy, coords.x - cx),
        hasMoved: false
      };
      if (hitBiz.part === "rotate") canvas.style.cursor = "grabbing";
      else if (hitBiz.part === "resize") canvas.style.cursor = "nwse-resize";
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    // 1bis) Sélection groupée panneaux : si l'utilisateur clique dans la bbox de groupe / poignée rotation
    if (tool === "select") {
      const groupHit = dp2HitTestPanelGroup(coords.x, coords.y);
      if (groupHit && groupHit.part) {
        const ids = dp2GetEffectiveSelectedPanelIds();
        if (ids.length >= 2) {
          const startById = {};
          for (const id of ids) {
            const p = dp2GetPanelById(id);
            if (!p || !p.geometry) continue;
            startById[id] = {
              x: p.geometry.x || 0,
              y: p.geometry.y || 0,
              rotation: p.geometry.rotation || 0,
              width: p.geometry.width || 0,
              height: p.geometry.height || 0,
              displayScaleX: p.geometry.displayScaleX ?? p.geometry.displayScale ?? 1,
              displayScaleY: p.geometry.displayScaleY ?? p.geometry.displayScale ?? 1
            };
          }
          dp2CommitHistoryPoint();
          const firstId = ids[0];
          const firstStart = startById[firstId];
          const firstPanel = firstId ? dp2GetPanelById(firstId) : null;
          const groupScaleInit = groupHit.part === "scale" && typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile() ? {
            basisAngle: (firstPanel?.geometry?.rotation ?? firstStart?.rotation ?? 0),
            startScaleX: firstStart?.displayScaleX ?? 1,
            startScaleY: firstStart?.displayScaleY ?? 1
          } : undefined;
          window.DP2_STATE.panelGroupInteraction = {
            ids,
            part: groupHit.part,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            groupCx: groupHit.aabb?.cx,
            groupCy: groupHit.aabb?.cy,
            startAngle: Math.atan2(coords.y - (groupHit.aabb?.cy || 0), coords.x - (groupHit.aabb?.cx || 0)),
            startById,
            startPointerX: groupHit.part === "scale" ? coords.x : undefined,
            startPointerY: groupHit.part === "scale" ? coords.y : undefined,
            hasMoved: false,
            basisAngle: groupScaleInit?.basisAngle,
            startScaleX: groupScaleInit?.startScaleX,
            startScaleY: groupScaleInit?.startScaleY
          };
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          renderDP2FromState();
          return;
        }
      }
    }

    // 2) Panneaux PV : sélection / move / rotation (sans resize)
    // En outil "Panneaux", le clic vide doit créer (géré dans le handler click) → ici seulement si hit panneau.
    const hitPanel = dp2HitTestPanel(coords.x, coords.y);
    if (hitPanel && hitPanel.id) {
      const panel = dp2GetPanelById(hitPanel.id);
      if (!panel || !panel.geometry) return;
      dp2SetSelectedPanelIds([panel.id]);
      // Démarrer interaction
      dp2CommitHistoryPoint();
      const g = panel.geometry;
      const w = g.width || 0;
      const h = g.height || 0;
      const cx = (g.x || 0) + w / 2;
      const cy = (g.y || 0) + h / 2;
      window.DP2_STATE.panelInteraction = {
        id: panel.id,
        part: hitPanel.part,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: g.x || 0,
        startY: g.y || 0,
        startRotation: g.rotation || 0,
        cx,
        cy,
        startAngle: Math.atan2(coords.y - cy, coords.x - cx),
        startScaleX: hitPanel.part === "scale" ? (g.displayScaleX ?? g.displayScale ?? 1) : undefined,
        startScaleY: hitPanel.part === "scale" ? (g.displayScaleY ?? g.displayScale ?? 1) : undefined,
        startPointerX: hitPanel.part === "scale" ? coords.x : undefined,
        startPointerY: hitPanel.part === "scale" ? coords.y : undefined,
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    // 2bis) En mode Sélection : clic sur zone vide => démarrer un rectangle de sélection (rubber-band)
    if (tool === "select") {
      const hitStdIdx = dp2HitTest(canvas, coords.x, coords.y);
      if (hitStdIdx != null) return; // zone non vide (objet ou contour) : laisser le click handler gérer la sélection
      window.DP2_STATE.selectionRect = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: coords.x,
        startY: coords.y,
        curX: coords.x,
        curY: coords.y,
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
      return;
    }

    // Create new (business tool)
    if (isDP2BusinessTool(tool)) {
      const meta = DP2_BUSINESS_OBJECT_META[tool];
      const vectorCreate = dp2IsVectorCreateBusinessType(tool);
      dp2ClearSelectedTexts();
      dp2CommitHistoryPoint();
      const created = createDP2BusinessObject(tool, {
        x: coords.x,
        y: coords.y,
        width: 1,
        height: 1,
        rotation: 0
      });
      if (!created) return;
      window.DP2_STATE.businessObjects.push(created);
      window.DP2_STATE.selectedBusinessObjectId = created.id;
      window.DP2_STATE.businessInteraction = {
        id: created.id,
        part: "create",
        pointerId: e.pointerId,
        anchorX: coords.x,
        anchorY: coords.y,
        metaDefaultW: meta?.defaultW || 80,
        metaDefaultH: meta?.defaultH || 50,
        createMode: vectorCreate ? "vector" : "box",
        hasMoved: false
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      renderDP2FromState();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    // Candidat drag label : promouvoir en vrai drag après seuil 4px
    const cand = window.DP2_STATE?.measureLabelDragCandidate || null;
    if (cand && typeof cand.pointerId === "number" && cand.pointerId === e.pointerId) {
      const cur = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const dist = Math.hypot(cur.x - (cand.startCanvasX || 0), cur.y - (cand.startCanvasY || 0));
      if (dist < 4) return;
      window.DP2_STATE.measureLabelDrag = {
        objectIndex: cand.objectIndex,
        pointerId: cand.pointerId,
        startCanvasX: cand.startCanvasX,
        startCanvasY: cand.startCanvasY,
        startOffsetX: cand.startOffsetX,
        startOffsetY: cand.startOffsetY
      };
      delete window.DP2_STATE.measureLabelDragCandidate;
    }

    // Formes métier — corps : candidat → vrai move + 1× commit au début du drag réel
    const bdc = window.DP2_STATE?.businessDragCandidate || null;
    if (bdc && typeof bdc.pointerId === "number" && bdc.pointerId === e.pointerId) {
      const cur = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const startCanvas = getDP2CanvasCoords(canvas, bdc.startClientX, bdc.startClientY);
      const dist = Math.hypot(cur.x - startCanvas.x, cur.y - startCanvas.y);
      if (dist < DP2_BIZ_DRAG_PROMOTE_PX) return;
      dp2CommitHistoryPoint();
      const bdcId = bdc.id;
      window.DP2_STATE.businessInteraction = {
        id: bdcId,
        part: "move",
        pointerId: e.pointerId,
        startClientX: bdc.startClientX,
        startClientY: bdc.startClientY,
        startX: bdc.startX,
        startY: bdc.startY,
        startW: bdc.startW,
        startH: bdc.startH,
        startRotation: bdc.startRotation,
        cx: bdc.cx,
        cy: bdc.cy,
        startAngle: bdc.startAngle,
        hasMoved: true,
        historyCommitted: true
      };
      window.DP2_STATE.businessDragCandidate = null;
      const objProm = getDP2BusinessObjectById(bdcId);
      if (objProm && objProm.geometry) {
        const g0 = objProm.geometry;
        g0.x = bdc.startX + (cur.x - startCanvas.x);
        g0.y = bdc.startY + (cur.y - startCanvas.y);
      }
      window.DP2_STATE._businessGripReleaseAt = null;
      dp2ScheduleBusinessDragRender();
      return;
    }

    // DP2 — Drag étiquette de cote (segment jaune) : déplacement visuel uniquement
    const pld = window.DP2_STATE?.parcelLabelDrag || null;
    if (pld && typeof pld.pointerId === "number" && pld.pointerId === e.pointerId) {
      const contour = dp2GetBuildingContourById(pld.contourId);
      if (contour) {
        const cur = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dx = cur.x - (pld.startCanvasX || 0);
        const dy = cur.y - (pld.startCanvasY || 0);
        if (!contour.labelOffsets || typeof contour.labelOffsets !== "object") contour.labelOffsets = {};
        contour.labelOffsets[pld.segmentIndex] = {
          x: (pld.startOffsetX || 0) + dx,
          y: (pld.startOffsetY || 0) + dy
        };
        try {
          dp2SyncContourLabelOffsetsToFeature(pld.contourId);
        } catch (_) {}
        renderDP2FromState();
      }
      return;
    }

    // DP2 — Drag étiquette de mesure (déplacement visuel uniquement) — jamais pour __parcelEdge (édition contour)
    const mld = window.DP2_STATE?.measureLabelDrag || null;
    if (mld && typeof mld.pointerId === "number" && mld.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[mld.objectIndex];
      if (obj && obj.type === "measure_line" && !obj.__parcelEdge) {
        const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dx = coords.x - (mld.startCanvasX || 0);
        const dy = coords.y - (mld.startCanvasY || 0);
        obj.labelOffset = {
          x: (mld.startOffsetX || 0) + dx,
          y: (mld.startOffsetY || 0) + dy
        };
        renderDP2FromState();
      }
      return;
    }

    // DP2 — Drag étiquette faîtage (même logique que mesure)
    const rld = window.DP2_STATE?.ridgeLabelDrag || null;
    if (rld && typeof rld.pointerId === "number" && rld.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[rld.objectIndex];
      if (obj && obj.type === "ridge_line") {
        const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dx = coords.x - (rld.startCanvasX || 0);
        const dy = coords.y - (rld.startCanvasY || 0);
        obj.labelOffset = {
          x: (rld.startOffsetX || 0) + dx,
          y: (rld.startOffsetY || 0) + dy
        };
        renderDP2FromState();
      }
      return;
    }

    const ghd = window.DP2_STATE?.gutterHeightDrag || null;
    if (ghd && typeof ghd.pointerId === "number" && ghd.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[ghd.objectIndex];
      if (obj && obj.type === "gutter_height_dimension") {
        const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        obj.x = (ghd.startObjX || 0) + (coords.x - (ghd.startCanvasX || 0));
        obj.y = (ghd.startObjY || 0) + (coords.y - (ghd.startCanvasY || 0));
        renderDP2FromState();
      }
      return;
    }

    const ghVsDrag = window.DP2_STATE?.gutterHeightVisualScaleDrag || null;
    if (ghVsDrag && typeof ghVsDrag.pointerId === "number" && ghVsDrag.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[ghVsDrag.objectIndex];
      if (obj && obj.type === "gutter_height_dimension") {
        const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
        const dy = coords.y - (ghVsDrag.startCanvasY || 0);
        obj.visualScale = dp2ClampGutterHeightVisualScale(
          (ghVsDrag.startVisualScale || 1) + dy * DP2_GUTTER_HEIGHT_VISUAL_DRAG_SENS
        );
        renderDP2FromState();
      }
      return;
    }

    if (!mld && !pld && !rld && !ghd && !ghVsDrag) {
      try {
        dp2UpdateHoverFromPointerMove(canvas, e);
      } catch (_) {}
    }

    // DP2 — Drag sommet faitage ou mesure (même logique que contour)
    const lvi = window.DP2_STATE?.lineVertexInteraction || null;
    if (lvi && typeof lvi.objectIndex === "number" && (lvi.anchor === "A" || lvi.anchor === "B")) {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const objs = window.DP2_STATE?.objects || [];
      const obj = objs[lvi.objectIndex];
      if (obj && (obj.type === "ridge_line" || obj.type === "measure_line") && obj.a && obj.b) {
        const pt = lvi.anchor === "A" ? obj.a : obj.b;
        let nx = coords.x - (lvi.offsetX || 0);
        let ny = coords.y - (lvi.offsetY || 0);
        if (obj.type === "ridge_line") {
          const other = lvi.anchor === "A" ? obj.b : obj.a;
          const snapped = dp2SnapRidgePointForDrawing(other, { x: nx, y: ny }, { force: e.shiftKey });
          nx = snapped.x;
          ny = snapped.y;
        }
        if (Math.abs(nx - (pt.x || 0)) > 1 || Math.abs(ny - (pt.y || 0)) > 1) lvi.hasMoved = true;
        pt.x = nx;
        pt.y = ny;
        if (obj.type === "ridge_line") dp2RebuildRidgeCutsForAllContours();
        renderDP2FromState();
        return;
      }
    }

    const groupInter = window.DP2_STATE?.panelGroupInteraction || null;
    if (groupInter && Array.isArray(groupInter.ids) && groupInter.ids.length >= 2) {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const startCanvas = getDP2CanvasCoords(canvas, groupInter.startClientX, groupInter.startClientY);
      const dx = coords.x - startCanvas.x;
      const dy = coords.y - startCanvas.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) groupInter.hasMoved = true;

      const groupCx = typeof groupInter.groupCx === "number" ? groupInter.groupCx : 0;
      const groupCy = typeof groupInter.groupCy === "number" ? groupInter.groupCy : 0;

      if (groupInter.part === "body") {
        for (const id of groupInter.ids) {
          const panel = dp2GetPanelById(id);
          const start = groupInter.startById?.[id] || null;
          if (!panel || !panel.geometry || !start) continue;
          panel.geometry.x = (start.x || 0) + dx;
          panel.geometry.y = (start.y || 0) + dy;
        }
        renderDP2FromState();
        return;
      }

      if (groupInter.part === "rotate") {
        const angle = Math.atan2(coords.y - groupCy, coords.x - groupCx);
        const delta = angle - (groupInter.startAngle || 0);
        const c = Math.cos(delta);
        const s = Math.sin(delta);
        for (const id of groupInter.ids) {
          const panel = dp2GetPanelById(id);
          const start = groupInter.startById?.[id] || null;
          if (!panel || !panel.geometry || !start) continue;
          const w = start.width || panel.geometry.width || 0;
          const h = start.height || panel.geometry.height || 0;
          const startCx = (start.x || 0) + w / 2;
          const startCy = (start.y || 0) + h / 2;
          const relX = startCx - groupCx;
          const relY = startCy - groupCy;
          const newCx = groupCx + (relX * c - relY * s);
          const newCy = groupCy + (relX * s + relY * c);
          panel.geometry.x = newCx - w / 2;
          panel.geometry.y = newCy - h / 2;
          panel.geometry.rotation = (start.rotation || 0) + delta;
        }
        groupInter.hasMoved = true;
        renderDP2FromState();
        return;
      }

      if (groupInter.part === "scale") {
        const a = groupInter.basisAngle ?? 0;
        const axisXx = Math.cos(a);
        const axisXy = Math.sin(a);
        const axisYx = -Math.sin(a);
        const axisYy = Math.cos(a);
        const dx = coords.x - (groupInter.startPointerX ?? coords.x);
        const dy = coords.y - (groupInter.startPointerY ?? coords.y);
        const deltaLocalX = dx * axisXx + dy * axisXy;
        const deltaLocalY = dx * axisYx + dy * axisYy;
        let newScaleX = (groupInter.startScaleX ?? 1) + deltaLocalX * 0.005;
        let newScaleY = (groupInter.startScaleY ?? 1) + deltaLocalY * 0.005;
        newScaleX = Math.max(0.6, Math.min(1.4, newScaleX));
        newScaleY = Math.max(0.6, Math.min(1.4, newScaleY));
        const startScaleX = groupInter.startScaleX ?? 1;
        const startScaleY = groupInter.startScaleY ?? 1;
        for (const id of groupInter.ids) {
          const panel = dp2GetPanelById(id);
          const start = groupInter.startById?.[id] || null;
          if (!panel || !panel.geometry || !start) continue;
          const w = start.width || panel.geometry.width || 0;
          const h = start.height || panel.geometry.height || 0;
          const startCx = (start.x || 0) + w / 2;
          const startCy = (start.y || 0) + h / 2;
          const relWorldX = startCx - groupCx;
          const relWorldY = startCy - groupCy;
          const relLocalX = relWorldX * axisXx + relWorldY * axisXy;
          const relLocalY = relWorldX * axisYx + relWorldY * axisYy;
          const newRelLocalX = relLocalX * (newScaleX / startScaleX);
          const newRelLocalY = relLocalY * (newScaleY / startScaleY);
          const newRelWorldX = newRelLocalX * axisXx + newRelLocalY * axisYx;
          const newRelWorldY = newRelLocalX * axisXy + newRelLocalY * axisYy;
          const newCx = groupCx + newRelWorldX;
          const newCy = groupCy + newRelWorldY;
          panel.geometry.x = newCx - w / 2;
          panel.geometry.y = newCy - h / 2;
          const panelStartScaleX = start.displayScaleX ?? 1;
          const panelStartScaleY = start.displayScaleY ?? 1;
          panel.geometry.displayScaleX = panelStartScaleX * (newScaleX / startScaleX);
          panel.geometry.displayScaleY = panelStartScaleY * (newScaleY / startScaleY);
        }
        groupInter.hasMoved = true;
        renderDP2FromState();
        return;
      }
    }

    const selRect = window.DP2_STATE?.selectionRect || null;
    if (selRect && typeof selRect.pointerId === "number") {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      selRect.curX = coords.x;
      selRect.curY = coords.y;
      const dx = coords.x - (selRect.startX || 0);
      const dy = coords.y - (selRect.startY || 0);
      if (Math.hypot(dx, dy) > 4) selRect.hasMoved = true;
      renderDP2FromState();
      return;
    }

    const textInter = window.DP2_STATE?.textInteraction || null;
    if (textInter && typeof textInter.pointerId === "number") {
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);

      if (textInter.part === "create") {
        textInter.curX = coords.x;
        textInter.curY = coords.y;
        const dx = coords.x - (textInter.anchorX || 0);
        const dy = coords.y - (textInter.anchorY || 0);
        if (Math.hypot(dx, dy) > 4) textInter.hasMoved = true;
        renderDP2FromState();
        return;
      }

      if (textInter.id) {
        const obj = dp2GetTextById(textInter.id);
        if (!obj || !obj.geometry) return;
        const g = obj.geometry;

        if (textInter.part === "body") {
          const startCanvas = getDP2CanvasCoords(canvas, textInter.startClientX, textInter.startClientY);
          const dx = coords.x - startCanvas.x;
          const dy = coords.y - startCanvas.y;
          g.x = (textInter.startX || 0) + dx;
          g.y = (textInter.startY || 0) + dy;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) textInter.hasMoved = true;
          renderDP2FromState();
          return;
        }

        if (textInter.part === "resize") {
          const tmpObj = {
            geometry: {
              x: textInter.startX,
              y: textInter.startY,
              width: textInter.startW,
              height: textInter.startH,
              rotation: textInter.startRotation
            }
          };
          const local = dp2TextWorldToLocal(tmpObj, coords.x, coords.y);

          const kind = obj.textKind || "free";
          const startW = Math.max(1, textInter.startW || 1);
          const startH = Math.max(1, textInter.startH || 1);
          const startX = typeof textInter.startX === "number" ? textInter.startX : 0;
          const startY = typeof textInter.startY === "number" ? textInter.startY : 0;
          const fs0 = typeof textInter.startFontSize === "number" ? textInter.startFontSize : DP2_TEXT_DEFAULT_FONT_SIZE;

          // DP6/DP7/DP8 : resize uniforme STRICT + fontSize proportionnelle (comportement historique)
          if (kind === "DP6" || kind === "DP7" || kind === "DP8") {
            const rawW = Math.max(1, (local.x - startX));
            const rawH = Math.max(1, (local.y - startY));
            let scale = Math.max(rawW / startW, rawH / startH);
            const minScale = Math.max(DP2_TEXT_MIN_W_PX / startW, DP2_TEXT_MIN_H_PX / startH);
            if (scale < minScale) scale = minScale;
            g.x = startX;
            g.y = startY;
            g.width = startW * scale;
            g.height = startH * scale;
            obj.fontSize = Math.max(6, fs0 * scale);
            textInter.hasMoved = true;
            renderDP2FromState();
            return;
          }

          // Texte libre : resize NON uniforme autorisé (W/H indépendants),
          // fontSize s’adapte UNIQUEMENT à la hauteur (scale vertical).
          const left0 = startX;
          const top0 = startY;
          const right0 = startX + startW;
          const bottom0 = startY + startH;
          let left = left0;
          let top = top0;
          let right = right0;
          let bottom = bottom0;

          const handle = textInter.resizeHandle || "br";
          switch (handle) {
            case "br": right = local.x; bottom = local.y; break;
            case "tr": right = local.x; top = local.y; break;
            case "bl": left = local.x; bottom = local.y; break;
            case "tl": left = local.x; top = local.y; break;
            case "mr": right = local.x; break;
            case "ml": left = local.x; break;
            case "bm": bottom = local.y; break;
            case "tm": top = local.y; break;
            default: right = local.x; bottom = local.y; break;
          }

          const minW = DP2_TEXT_MIN_W_PX;
          const minH = DP2_TEXT_MIN_H_PX;

          // Empêcher inversion / maintenir taille min selon le côté manipulé
          if ((right - left) < minW) {
            const leftMoves = handle === "tl" || handle === "bl" || handle === "ml";
            if (leftMoves) left = right - minW;
            else right = left + minW;
          }
          if ((bottom - top) < minH) {
            const topMoves = handle === "tl" || handle === "tr" || handle === "tm";
            if (topMoves) top = bottom - minH;
            else bottom = top + minH;
          }

          g.x = left;
          g.y = top;
          g.width = Math.max(1, right - left);
          g.height = Math.max(1, bottom - top);

          const scaleY = g.height / startH;
          obj.fontSize = Math.max(6, fs0 * scaleY);
          textInter.hasMoved = true;
          renderDP2FromState();
          return;
        }

        if (textInter.part === "rotate") {
          const cx = textInter.cx;
          const cy = textInter.cy;
          const angle = Math.atan2(coords.y - cy, coords.x - cx);
          const delta = angle - textInter.startAngle;
          g.rotation = (textInter.startRotation || 0) + delta;
          textInter.hasMoved = true;
          renderDP2FromState();
          return;
        }
      }
    }

    const panelInter = window.DP2_STATE?.panelInteraction || null;
    if (panelInter && panelInter.id) {
      const panel = dp2GetPanelById(panelInter.id);
      if (!panel || !panel.geometry) return;
      const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
      const g = panel.geometry;
      const w = g.width || 0;
      const h = g.height || 0;
      const cx = (g.x || 0) + w / 2;
      const cy = (g.y || 0) + h / 2;

      if (panelInter.part === "body") {
        const startCanvas = getDP2CanvasCoords(canvas, panelInter.startClientX, panelInter.startClientY);
        const dx = coords.x - startCanvas.x;
        const dy = coords.y - startCanvas.y;
        g.x = (panelInter.startX || 0) + dx;
        g.y = (panelInter.startY || 0) + dy;
        panelInter.hasMoved = true;

        // Snap intelligent (collage) : en déplacement, uniquement panneau↔panneau (rotation identique)
        const snap = dp2TrySnapPanel(g, coords, panelInter.id);
        if (snap && snap.targetCenterWorld) {
          g.x = snap.targetCenterWorld.x - w / 2;
          g.y = snap.targetCenterWorld.y - h / 2;
        }

        renderDP2FromState();
        return;
      }

      if (panelInter.part === "rotate") {
        const angle = Math.atan2(coords.y - cy, coords.x - cx);
        const delta = angle - panelInter.startAngle;
        g.rotation = (panelInter.startRotation || 0) + delta;
        panelInter.hasMoved = true;
        renderDP2FromState();
        return;
      }

      if (panelInter.part === "scale") {
        const dx = coords.x - (panelInter.startPointerX ?? coords.x);
        const dy = coords.y - (panelInter.startPointerY ?? coords.y);
        const angle = panelInter.startRotation ?? 0;
        const axisXx = Math.cos(angle);
        const axisXy = Math.sin(angle);
        const axisYx = -Math.sin(angle);
        const axisYy = Math.cos(angle);
        const deltaLocalX = dx * axisXx + dy * axisXy;
        const deltaLocalY = dx * axisYx + dy * axisYy;
        let newScaleX = (panelInter.startScaleX ?? 1) + deltaLocalX * 0.005;
        let newScaleY = (panelInter.startScaleY ?? 1) + deltaLocalY * 0.005;
        newScaleX = Math.max(0.6, Math.min(1.4, newScaleX));
        newScaleY = Math.max(0.6, Math.min(1.4, newScaleY));
        g.displayScaleX = newScaleX;
        g.displayScaleY = newScaleY;
        panelInter.hasMoved = true;
        renderDP2FromState();
        return;
      }
    }

    const inter = window.DP2_STATE?.businessInteraction || null;
    if (inter && inter.id) {
    const obj = getDP2BusinessObjectById(inter.id);
    if (obj && obj.geometry) {
    if (inter.part === "move" || inter.part === "resize" || inter.part === "rotate") {
      if (inter.part === "resize") canvas.style.cursor = "nwse-resize";
      else canvas.style.cursor = "grabbing";
    }

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    const g = obj.geometry;

    if (inter.part === "create") {
      const dx = coords.x - inter.anchorX;
      const dy = coords.y - inter.anchorY;
      if ((inter.createMode || "box") === "vector") {
        const len = Math.hypot(dx, dy);
        if (len > 2) inter.hasMoved = true;
        if (inter.hasMoved) {
          const minLen = 16;
          const w = Math.max(minLen, len);
          const rot = Math.atan2(dy, dx);

          // Centre monde = milieu entre ancre et curseur (taille + orientation)
          const centerX = inter.anchorX + dx / 2;
          const centerY = inter.anchorY + dy / 2;

          let h = Math.max(12, inter.metaDefaultH || 50);
          // Angle de prise de vue : hauteur suffisante pour contenir le cône (2 rayons)
          if (obj.type === "angle_vue") {
            const a = Math.PI / 6; // ouverture ~30°
            const neededHalf = Math.sin(a) * w;
            h = Math.max(24, neededHalf * 2 + 8);
          }

          g.width = w;
          g.height = h;
          g.rotation = rot;
          g.x = centerX - w / 2;
          g.y = centerY - h / 2;
        }
      } else {
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) inter.hasMoved = true;
        if (inter.hasMoved) {
          const rect = dp2NormalizeRectFromDrag(inter.anchorX, inter.anchorY, coords.x, coords.y, 10);
          g.x = rect.x;
          g.y = rect.y;
          g.width = rect.width;
          g.height = rect.height;
        }
      }
      dp2ScheduleBusinessDragRender();
      return;
    }

    if (inter.part === "move") {
      const startCanvas = getDP2CanvasCoords(canvas, inter.startClientX, inter.startClientY);
      const dx = coords.x - startCanvas.x;
      const dy = coords.y - startCanvas.y;
      const dist = Math.hypot(dx, dy);
      g.x = (inter.startX || 0) + dx;
      g.y = (inter.startY || 0) + dy;
      if (dist > 2) inter.hasMoved = true;
      dp2ScheduleBusinessDragRender();
      return;
    }

    if (inter.part === "resize") {
      if (dp2IsFramelessBusinessObject(obj.type)) {
        dp2ApplyFramelessBusinessResize(obj, inter, coords);
        inter.hasMoved = true;
        dp2ScheduleBusinessDragRender();
        return;
      }
      const tmpObj = {
        geometry: {
          x: inter.startX,
          y: inter.startY,
          width: inter.startW,
          height: inter.startH,
          rotation: inter.startRotation
        }
      };
      const local = dp2BusinessWorldToLocal(tmpObj, coords.x, coords.y);
      dp2ApplyBusinessResizeFromLocal(inter, g, local.x, local.y, obj.type);
      inter.hasMoved = true;
      dp2ScheduleBusinessDragRender();
      return;
    }

    if (inter.part === "rotate") {
      const cx = inter.cx;
      const cy = inter.cy;
      const angle = Math.atan2(coords.y - cy, coords.x - cx);
      const delta = angle - inter.startAngle;
      g.rotation = (inter.startRotation || 0) + delta;
      inter.hasMoved = true;
      dp2ScheduleBusinessDragRender();
      return;
    }
    }
    }

    try {
      dp2FinalizeInteractionChrome();
    } catch (_) {}
  });

  canvas.addEventListener("pointerup", (e) => {
    dp2ClearTempOlBuildingDragIfNeeded();

    const cand = window.DP2_STATE?.measureLabelDragCandidate || null;
    if (cand && typeof cand.pointerId === "number" && cand.pointerId === e.pointerId) {
      window.DP2_STATE.measureLabelDragCandidate = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }
    const bdcUp = window.DP2_STATE?.businessDragCandidate || null;
    if (bdcUp && typeof bdcUp.pointerId === "number" && bdcUp.pointerId === e.pointerId) {
      window.DP2_STATE.businessDragCandidate = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }
    const mld = window.DP2_STATE?.measureLabelDrag || null;
    if (mld && typeof mld.pointerId === "number" && mld.pointerId === e.pointerId) {
      window.DP2_STATE.measureLabelDrag = null;
      window.DP2_STATE._lastMeasureLabelDragAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const pld = window.DP2_STATE?.parcelLabelDrag || null;
    if (pld && typeof pld.pointerId === "number" && pld.pointerId === e.pointerId) {
      try {
        dp2SyncContourLabelOffsetsToFeature(pld.contourId);
      } catch (_) {}
      window.DP2_STATE.parcelLabelDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const rld = window.DP2_STATE?.ridgeLabelDrag || null;
    if (rld && typeof rld.pointerId === "number" && rld.pointerId === e.pointerId) {
      window.DP2_STATE.ridgeLabelDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const ghdUp = window.DP2_STATE?.gutterHeightDrag || null;
    if (ghdUp && typeof ghdUp.pointerId === "number" && ghdUp.pointerId === e.pointerId) {
      window.DP2_STATE.gutterHeightDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const ghVsUp = window.DP2_STATE?.gutterHeightVisualScaleDrag || null;
    if (ghVsUp && typeof ghVsUp.pointerId === "number" && ghVsUp.pointerId === e.pointerId) {
      window.DP2_STATE.gutterHeightVisualScaleDrag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const lvi = window.DP2_STATE?.lineVertexInteraction || null;
    if (lvi && typeof lvi.pointerId === "number" && lvi.pointerId === e.pointerId) {
      const obj = window.DP2_STATE?.objects?.[lvi.objectIndex];
      if (obj && obj.type === "ridge_line" && obj.a && obj.b) {
        dp2RebuildRidgeCutsForAllContours();
      }
      window.DP2_STATE.lineVertexInteraction = null;
      window.DP2_STATE._lastLineVertexInteractionAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const groupInter = window.DP2_STATE?.panelGroupInteraction || null;
    if (groupInter && Array.isArray(groupInter.ids) && groupInter.ids.length >= 2) {
      window.DP2_STATE.panelGroupInteraction = null;
      if (groupInter.hasMoved) window.DP2_STATE._lastSelectionRectAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const selRect = window.DP2_STATE?.selectionRect || null;
    if (selRect && typeof selRect.pointerId === "number") {
      window.DP2_STATE.selectionRect = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (selRect.hasMoved) {
        const ax = selRect.startX || 0;
        const ay = selRect.startY || 0;
        const bx = selRect.curX || ax;
        const by = selRect.curY || ay;
        const minX = Math.min(ax, bx);
        const minY = Math.min(ay, by);
        const maxX = Math.max(ax, bx);
        const maxY = Math.max(ay, by);
        const rect = { minX, minY, maxX, maxY };

        const selectedPanels = [];
        const items = window.DP2_STATE?.panels || [];
        for (const p of items) {
          if (!p || p.type !== "panel" || p.visible !== true || !p.geometry) continue;
          const g = p.geometry;
          const center = dp2PanelCenterFromGeometry(g);
          const centerInside = center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
          if (centerInside) {
            selectedPanels.push(p.id);
            continue;
          }
          const aabb = dp2PanelWorldAABB(g);
          if (!aabb) continue;
          const bboxInside = aabb.minX >= minX && aabb.maxX <= maxX && aabb.minY >= minY && aabb.maxY <= maxY;
          if (bboxInside) selectedPanels.push(p.id);
        }

        const selectedTexts = [];
        const texts = window.DP2_STATE?.textObjects || [];
        for (const t of texts) {
          if (!t || t.type !== "text" || t.visible !== true || !t.geometry) continue;
          const g = t.geometry;
          const center = dp2PanelCenterFromGeometry(g);
          const centerInside = center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
          if (centerInside) {
            selectedTexts.push(t.id);
            continue;
          }
          const aabb = dp2PanelWorldAABB(g);
          if (!aabb) continue;
          const bboxInside = aabb.minX >= minX && aabb.maxX <= maxX && aabb.minY >= minY && aabb.maxY <= maxY;
          if (bboxInside) selectedTexts.push(t.id);
        }

        // UX : lasso peut sélectionner panneaux OU textes.
        // Si des textes sont trouvés, on privilégie la sélection texte (annotations).
        if (selectedTexts.length) dp2SetSelectedTextIds(selectedTexts);
        else dp2SetSelectedPanelIds(selectedPanels);
        window.DP2_STATE._lastSelectionRectAt = Date.now();
      }
      renderDP2FromState();
      return;
    }

    const textInter = window.DP2_STATE?.textInteraction || null;
    if (textInter && typeof textInter.pointerId === "number") {
      window.DP2_STATE.textInteraction = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

      if (textInter.part === "create") {
        if (textInter.hasMoved) {
          const ax = textInter.anchorX || 0;
          const ay = textInter.anchorY || 0;
          const bx = textInter.curX != null ? textInter.curX : ax;
          const by = textInter.curY != null ? textInter.curY : ay;
          const rect = dp2NormalizeRectFromDrag(ax, ay, bx, by, 1);
          const w = Math.max(DP2_TEXT_MIN_W_PX, rect.width);
          const h = Math.max(DP2_TEXT_MIN_H_PX, rect.height);

          const tool = textInter.tool || "text_free";
          const textKind =
            tool === "text_DP6" ? "DP6"
            : tool === "text_DP7" ? "DP7"
            : tool === "text_DP8" ? "DP8"
            : "free";
          const content =
            textKind === "DP6" ? "DP6"
            : textKind === "DP7" ? "DP7"
            : textKind === "DP8" ? "DP8"
            : "Double-cliquez pour éditer";

          dp2CommitHistoryPoint();
          const created = createDP2TextObject(textKind, content, {
            x: rect.x,
            y: rect.y,
            width: w,
            height: h,
            rotation: 0
          }, DP2_TEXT_DEFAULT_FONT_SIZE);
          window.DP2_STATE.textObjects.push(created);
          dp2SetSelectedTextIds([created.id]);
          window.DP2_STATE._lastTextInteractionAt = Date.now();

          dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "text_created" });
          return;
        }
        renderDP2FromState();
        return;
      }

      if (textInter.hasMoved) window.DP2_STATE._lastTextInteractionAt = Date.now();
      renderDP2FromState();
      return;
    }

    const panelInter = window.DP2_STATE?.panelInteraction || null;
    if (panelInter && panelInter.id) {
      window.DP2_STATE.panelInteraction = null;
      if (panelInter.hasMoved) window.DP2_STATE._lastPvPanelInteractionAt = Date.now();
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      renderDP2FromState();
      return;
    }

    const inter = window.DP2_STATE?.businessInteraction || null;
    if (!inter || !inter.id) return;
    const wasBusinessCreate = inter.part === "create";
    const obj = getDP2BusinessObjectById(inter.id);
    if (obj && obj.geometry && inter.part === "create" && inter.hasMoved !== true) {
      if ((inter.createMode || "box") === "vector") {
        // Interdit : création à taille fixe au clic pour les outils "vector"
        const items = window.DP2_STATE?.businessObjects || [];
        const idx = items.findIndex((o) => o && o.id === inter.id);
        if (idx >= 0) items.splice(idx, 1);
        if (window.DP2_STATE?.selectedBusinessObjectId === inter.id) {
          window.DP2_STATE.selectedBusinessObjectId = null;
        }
      } else {
        // Click simple : créer avec taille par défaut centrée sur le point
        const w = inter.metaDefaultW || 80;
        const h = inter.metaDefaultH || 50;
        obj.geometry.x = (inter.anchorX || 0) - w / 2;
        obj.geometry.y = (inter.anchorY || 0) - h / 2;
        obj.geometry.width = w;
        obj.geometry.height = h;
        obj.geometry.rotation = 0;
      }
    }
    dp2CancelPendingBusinessDragRender();
    if (!wasBusinessCreate) {
      window.DP2_STATE._businessGripReleaseAt = Date.now();
    }
    window.DP2_STATE.businessInteraction = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = "";
    if (wasBusinessCreate) {
      dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "business_object_created" });
    } else {
      renderDP2FromState();
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") {
      canvas.style.cursor = "";
      if (window.DP2_STATE?._businessHoverId != null) {
        window.DP2_STATE._businessHoverId = null;
        renderDP2FromState();
      }
      return;
    }
    dp2TryUpdateBusinessHoverCursor(canvas, e.clientX, e.clientY);

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    const scale = window.DP2_STATE?.scale_m_per_px;

    // Panneaux PV : preview NOIRE sous souris + fantôme GRIS (snap) — aucune insertion dans DP2_STATE.panels ici
    if (tool === "panels") {
      const dims = dp2GetPanelDimsPx();
      if (!dims) {
        showDP2Toast("Sélectionnez un module PV dans Paramètres.");
        dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "panel_dims_missing" });
        return;
      }

      const wPx = dims.wPx;
      const hPx = dims.hPx;
      const selectedId = window.DP2_STATE?.selectedPanelId || null;
      const selected = selectedId ? dp2GetPanelById(selectedId) : null;
      const rot = selected?.geometry?.rotation != null ? selected.geometry.rotation : 0;

      const previewGeom = {
        x: coords.x - wPx / 2,
        y: coords.y - hPx / 2,
        width: wPx,
        height: hPx,
        rotation: rot
      };

      const snap = dp2TrySnapPanel(previewGeom, coords);
      let ghostGeom = previewGeom;
      let snapped = false;
      if (snap && snap.targetCenterWorld) {
        ghostGeom = {
          x: snap.targetCenterWorld.x - wPx / 2,
          y: snap.targetCenterWorld.y - hPx / 2,
          width: wPx,
          height: hPx,
          rotation: rot
        };
        snapped = Math.hypot(ghostGeom.x - previewGeom.x, ghostGeom.y - previewGeom.y) > 0.5;
      }

      window.DP2_STATE.panelPlacementPreview = { preview: previewGeom, ghost: ghostGeom, snapped };
      renderDP2FromState();
      return;
    }

    // Trait de mesure : preview A → souris (mesure en temps réel)
    if (tool === "measure_line" && window.DP2_STATE.measureLineStart) {
      const from = window.DP2_STATE.measureLineStart;
      const snapped = dp2SnapPointForDrawing(from, coords, { force: e.shiftKey });
      const to = { x: snapped.x, y: snapped.y };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      window.DP2_STATE.drawingPreview = {
        from: { x: from.x, y: from.y },
        to,
        lengthM,
        snapped: snapped.snapped === true
      };
      renderDP2FromState();
      return;
    }
    if (tool === "measure_line") {
      if (window.DP2_STATE.drawingPreview != null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
      }
      return;
    }

    // Faîtage : preview A → souris (mesure en temps réel)
    if (tool === "ridge_line" && window.DP2_STATE.ridgeLineStart) {
      const from = window.DP2_STATE.ridgeLineStart;
      const snapped = dp2SnapRidgePointForDrawing(from, coords, { force: e.shiftKey });
      const to = { x: snapped.x, y: snapped.y };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      window.DP2_STATE.drawingPreview = {
        from: { x: from.x, y: from.y },
        to,
        lengthM,
        previewType: "ridge_line",
        snapped: snapped.snapped === true,
        ridgeSnap: snapped.contourSnap || null,
        segmentAngle: snapped.segmentAngle
      };
      renderDP2FromState();
      return;
    }
    if (tool === "ridge_line") {
      if (window.DP2_STATE.drawingPreview != null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
      }
      return;
    }

    // Hauteur égout (DP4) : prévisualisation = symbole fixe sous la souris (1 clic — pas de segment)
    if (tool === "gutter_height_dimension") {
      window.DP2_STATE.drawingPreview = {
        previewType: "gutter_height_dimension",
        anchorX: coords.x,
        anchorY: coords.y,
        heightM: null
      };
      renderDP2FromState();
      return;
    }

    // Contour bâti : prévisualisation segment → OpenLayers Draw (plus de rubber-band canvas)
    if (tool === "building_outline") {
      if (window.DP2_STATE.drawingPreview != null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
      }
      return;
    }

  });

  canvas.addEventListener("mouseleave", () => {
    const canvasEl = document.getElementById("dp2-draw-canvas");
    if (canvasEl) canvasEl.style.cursor = "";
    if (window.DP2_STATE?._businessHoverId != null) {
      window.DP2_STATE._businessHoverId = null;
      renderDP2FromState();
    }
    if (window.DP2_STATE.drawingPreview != null) {
      window.DP2_STATE.drawingPreview = null;
      renderDP2FromState();
    }
    if (window.DP2_STATE?.panelPlacementPreview != null) {
      window.DP2_STATE.panelPlacementPreview = null;
      renderDP2FromState();
    }
    // Ne pas effacer measureLineStart au leave : l'utilisateur peut revenir pour clic B
  });

  canvas.addEventListener("click", (e) => {
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;

    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);

    if (tool === "select") {
      const hitParcelAnchor = dp2HitTestParcelEdgeAnchorChoice(canvas, coords.x, coords.y);
      if (hitParcelAnchor && (hitParcelAnchor.anchor === "A" || hitParcelAnchor.anchor === "B")) {
        e.preventDefault();
        e.stopPropagation();
        const pe = window.DP2_STATE?.parcelEdgeEdit;
        if (pe) {
          pe.anchor = hitParcelAnchor.anchor;
          dp2CommitParcelSegmentResize({
            contourId: pe.contourId,
            segmentIndex: pe.segmentIndex,
            requestedLengthM: pe.requestedLengthM,
            anchor: pe.anchor
          });
          dp2ClearParcelEdgeEdit();
          if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
        }
        renderDP2FromState();
        return;
      }
      // Choix A/B sur le plan : clic sur repère A ou B = définir resizeAnchor puis prévisualisation
      const hitAnchor = dp2HitTestMeasureLineAnchor(canvas, coords.x, coords.y);
      if (hitAnchor && typeof hitAnchor.objectIndex === "number" && (hitAnchor.anchor === "A" || hitAnchor.anchor === "B")) {
        const objs = window.DP2_STATE?.objects || [];
        const obj = objs[hitAnchor.objectIndex];
        if (obj && obj.type === "measure_line") {
          obj.resizeAnchor = hitAnchor.anchor;
          dp2CommitMeasureResize(obj);
          if (typeof dp2RemoveMeasureAnchorChoiceOverlay === "function") dp2RemoveMeasureAnchorChoiceOverlay();
          if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
          renderDP2FromState();
          return;
        }
      }
      // Si un lasso / drag groupé vient de se terminer, ignorer le click (évite d'écraser la sélection groupée)
      const last = window.DP2_STATE?._lastSelectionRectAt || 0;
      if (Date.now() - last < 250) return;
      // Si un drag texte vient de se terminer, ignorer le click (évite d'écraser la sélection après move/resize/rotate)
      const lastText = window.DP2_STATE?._lastTextInteractionAt || 0;
      if (Date.now() - lastText < 250) return;
      const lastLvi = window.DP2_STATE?._lastLineVertexInteractionAt || 0;
      if (Date.now() - lastLvi < 250) return;

      const hitText = dp2HitTestText(coords.x, coords.y);
      if (hitText && hitText.id) {
        dp2ClearSelectedBuildingContour();
        dp2SetSelectedTextIds([hitText.id]);
        renderDP2FromState();
        return;
      }

      const hitPanel = dp2HitTestPanel(coords.x, coords.y);
      if (hitPanel && hitPanel.id) {
        dp2ClearSelectedBuildingContour();
        dp2SetSelectedPanelIds([hitPanel.id]);
        renderDP2FromState();
        return;
      }

      const hitBizClick = dp2HitTestBusiness(coords.x, coords.y);
      if (hitBizClick && hitBizClick.id) {
        const bizHitObj = getDP2BusinessObjectById(hitBizClick.id);
        if (bizHitObj) {
          dp2ClearSelectedPanels();
          dp2ClearSelectedTexts();
          window.DP2_STATE.selectedBuildingContourId = null;
          try {
            window.__DP2_BUILDING_MODIFY_MODE__ = false;
          } catch (_) {}
          window.DP2_STATE.selectedObjectId = null;
          window.DP2_STATE.selectedBusinessObjectId = hitBizClick.id;
          renderDP2FromState();
          return;
        }
      }

      const hitAnyObject = dp2HitTest(canvas, coords.x, coords.y);
      if (hitAnyObject && hitAnyObject.kind === "object") {
        window.DP2_STATE.selectedObjectId = hitAnyObject.index;
        dp2ClearSelectedBuildingContour();
        dp2ClearSelectedPanels();
        dp2ClearSelectedTexts();
        window.DP2_STATE.selectedBusinessObjectId = null;
        renderDP2FromState();
        return;
      }

      const olB =
        typeof dp2PickDp2BuildingOlFeatureAtCanvasPixel === "function"
          ? dp2PickDp2BuildingOlFeatureAtCanvasPixel(canvas, coords.x, coords.y)
          : null;
      if (olB) {
        const fid = olB.getId() != null ? olB.getId() : olB.get("dp2FeatureId");
        if (fid != null) {
          dp2SetSelectedBuildingContourId(String(fid));
          renderDP2FromState();
          return;
        }
      }

      const hitAny = dp2HitTest(canvas, coords.x, coords.y);
      const idx = hitAny && hitAny.kind === "object" ? hitAny.index : null;
      window.DP2_STATE.selectedObjectId = idx;
      dp2ClearSelectedBuildingContour();
      dp2ClearSelectedPanels();
      dp2ClearSelectedTexts();
      window.DP2_STATE.selectedBusinessObjectId = null;
      renderDP2FromState();
      return;
    }

    // Hauteur égout (DP4) : 1 clic → saisie ; annuler = aucun objet
    if (tool === "gutter_height_dimension") {
      const raw = window.prompt(
        "Hauteur égout (m) — saisir la valeur (annotation métier, symbole fixe à l’écran).",
        "3,00"
      );
      if (raw == null) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      const normalized = String(raw).trim().replace(",", ".");
      const num = parseFloat(normalized);
      if (Number.isNaN(num) || num < 0) {
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "gutter_height_dimension",
        x: coords.x,
        y: coords.y,
        heightM: num,
        __gutterMigratedV2: true
      });
      window.DP2_STATE.drawingPreview = null;
      dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "gutter_height_dimension_created" });
      renderDP2FromState();
      return;
    }

    // Trait de mesure : clic 1 = point A, clic 2 = point B (trait définitif) puis retour sélection
    if (tool === "measure_line") {
      if (window.DP2_STATE.measureLineStart == null) {
        window.DP2_STATE.measureLineStart = { x: coords.x, y: coords.y };
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      const a = window.DP2_STATE.measureLineStart;
      const snapped = dp2SnapPointForDrawing(a, coords, { force: e.shiftKey });
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "measure_line",
        a: { x: a.x, y: a.y },
        b: { x: snapped.x, y: snapped.y }
      });
      window.DP2_STATE.measureLineStart = null;
      window.DP2_STATE.drawingPreview = null;
      dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "measure_line_created" });
      return;
    }

    // Faîtage : clic 1 = point A, clic 2 = point B (faîtage définitif)
    if (tool === "ridge_line") {
      if (window.DP2_STATE.ridgeLineStart == null) {
        const startSnap = dp2NearestPointOnBuildingContours(coords.x, coords.y, 18);
        window.DP2_STATE.ridgeLineStart = startSnap ? { x: startSnap.x, y: startSnap.y } : { x: coords.x, y: coords.y };
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      const a = window.DP2_STATE.ridgeLineStart;
      const ridgeA = { x: a.x, y: a.y };
      const snapped = dp2SnapRidgePointForDrawing(a, coords, { force: e.shiftKey });
      const ridgeB = { x: snapped.x, y: snapped.y };
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "ridge_line",
        a: ridgeA,
        b: ridgeB
      });
      // Application structurante sur les COTES du contour bâti (sans toucher aux points)
      dp2RebuildRidgeCutsForAllContours();

      window.DP2_STATE.ridgeLineStart = null;
      window.DP2_STATE.drawingPreview = null;
      dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "ridge_line_created" });
      return;
    }

    // Panneaux PV : poser un module à taille réelle (m → px via scale_m_per_px), rotatif, non redimensionnable,
    // avec collage automatique intelligent entre panneaux.
    if (tool === "panels") {
      // Si un drag/rotate vient de se terminer, ignorer le click (évite une pose involontaire)
      const last = window.DP2_STATE?._lastPvPanelInteractionAt || 0;
      if (Date.now() - last < 250) return;
      // Si une interaction texte vient de se terminer, ignorer le click (évite de poser un panneau en cliquant un texte)
      const lastText = window.DP2_STATE?._lastTextInteractionAt || 0;
      if (Date.now() - lastText < 250) return;

      // Si clic sur un panneau existant : sélection (pas de création)
      // FIX snap au clic : si un fantome aimante est actif, on POSE le nouveau panneau
      // colle au voisin au lieu de selectionner le voisin.
      const ppSnap = window.DP2_STATE?.panelPlacementPreview;
      const hit = dp2HitTestPanel(coords.x, coords.y);
      if (hit && hit.id && !(ppSnap && ppSnap.snapped)) {
        dp2SetSelectedPanelIds([hit.id]);
        renderDP2FromState();
        return;
      }

      const dims = dp2GetPanelDimsPx();
      if (!dims) {
        showDP2Toast("Sélectionnez un module PV dans Paramètres.");
        dp2ResetActiveToolToNeutral({ preserveSelection: true, reason: "panel_dims_missing_click" });
        return;
      }

      const wPx = dims.wPx;
      const hPx = dims.hPx;
      const selectedId = window.DP2_STATE?.selectedPanelId || null;
      const selected = selectedId ? dp2GetPanelById(selectedId) : null;
      const rot = selected?.geometry?.rotation != null ? selected.geometry.rotation : 0;

      // Position finale = fantôme (snap) si actif, sinon pose libre
      const previewState = window.DP2_STATE?.panelPlacementPreview || null;
      let placeGeom = previewState?.ghost || null;
      if (!placeGeom) {
        const previewGeom = {
          x: coords.x - wPx / 2,
          y: coords.y - hPx / 2,
          width: wPx,
          height: hPx,
          rotation: rot
        };
        const snap = dp2TrySnapPanel(previewGeom, coords);
        if (snap && snap.targetCenterWorld) {
          placeGeom = {
            x: snap.targetCenterWorld.x - wPx / 2,
            y: snap.targetCenterWorld.y - hPx / 2,
            width: wPx,
            height: hPx,
            rotation: rot
          };
        } else {
          placeGeom = previewGeom;
        }
      }

      dp2CommitHistoryPoint();
      const panels = window.DP2_STATE.panels || (window.DP2_STATE.panels = []);
      const id = "panel_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      const geom = {
        x: placeGeom.x,
        y: placeGeom.y,
        width: wPx,
        height: hPx,
        rotation: rot
      };
      if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
        geom.displayScaleX = 1;
        geom.displayScaleY = 1;
      }
      panels.push({
        id,
        type: "panel",
        geometry: geom,
        lockedSize: true,
        visible: true
      });
      if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile() && typeof dp4Append3857PanelFromDp2Placement === "function") {
        try {
          dp4Append3857PanelFromDp2Placement(panels[panels.length - 1]);
        } catch (_) {}
      }
      dp2SetSelectedPanelIds([id]);
      window.DP2_STATE.panelPlacementPreview = null; // recalcul immédiat au prochain move
      // FIX pose continue : rester dans l'outil "panneaux" pour enchainer les poses
      // (ne pas repasser en selection apres chaque panneau).
      return;
    }

    // Contour bâti : création / fermeture 100 % OpenLayers (interaction Draw) — pas de clic canvas
    if (tool === "building_outline") {
      return;
    }
  });

  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const tool = window.DP2_STATE?.currentTool || "select";
    if (tool === "pan") return;
    const coords = getDP2CanvasCoords(canvas, e.clientX, e.clientY);
    const objs = window.DP2_STATE?.objects || [];

    function openMeasureLineEdit(objectIndex) {
      const obj = objs[objectIndex];
      if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b) return false;
      return dp2ShowMeasureLineInlineInput(canvas, objectIndex);
    }

    // PRIORITAIRE — double-clic sur le libellé de cote parcelle (chiffre affiché) → champ inline (état dédié, pas objects[])
    const hitParcelLabel = dp2HitTestParcelLabelForDblClick(coords.x, coords.y);
    if (hitParcelLabel && hitParcelLabel.contourId != null && typeof hitParcelLabel.segmentIndex === "number") {
      e.preventDefault();
      e.stopPropagation();
      window.DP2_STATE.parcelEdgeEdit = {
        contourId: hitParcelLabel.contourId,
        segmentIndex: hitParcelLabel.segmentIndex,
        requestedLengthM: null,
        anchor: null
      };
      dp2ShowParcelSegmentInlineInput(canvas);
      renderDP2FromState();
      return;
    }

    // Mesures : étiquette puis segment (avant égout / texte) — stopPropagation pour limiter les doubles clics carte OL
    if (tool === "select") {
      const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
      if (hitLabel && hitLabel.kind === "measure_label" && typeof hitLabel.index === "number") {
        e.stopPropagation();
        window.DP2_STATE.measureLabelDrag = null;
        window.DP2_STATE.measureLabelDragCandidate = null;
        const lastDrag = window.DP2_STATE._lastMeasureLabelDragAt || 0;
        if (Date.now() - lastDrag > 300) {
          openMeasureLineEdit(hitLabel.index);
        }
        return;
      }
      const hitMeasDbl = dp2HitTest(canvas, coords.x, coords.y);
      if (hitMeasDbl && hitMeasDbl.kind === "object" && typeof hitMeasDbl.index === "number") {
        const objM = objs[hitMeasDbl.index];
        if (objM && objM.type === "measure_line") {
          e.stopPropagation();
          if (window.__SN_DP_DP2_AUDIT__ === true) {
            try {
              console.log("[DP2 MEASURE EDIT]", hitMeasDbl);
            } catch (_) {}
          }
          window.DP2_STATE.measureLabelDrag = null;
          window.DP2_STATE.measureLabelDragCandidate = null;
          const lastDrag2 = window.DP2_STATE._lastMeasureLabelDragAt || 0;
          if (Date.now() - lastDrag2 > 300) {
            openMeasureLineEdit(hitMeasDbl.index);
          }
          return;
        }
      }
    }

    const hitGhLblDbl = dp2HitTestGutterHeightLabel(canvas, coords.x, coords.y);
    if (hitGhLblDbl && hitGhLblDbl.kind === "gutter_height_label" && typeof hitGhLblDbl.index === "number") {
      if (dp2OpenGutterHeightDimensionEdit(hitGhLblDbl.index)) return;
    }
    const hitGhSegDbl = dp2HitTest(canvas, coords.x, coords.y);
    if (hitGhSegDbl && hitGhSegDbl.kind === "object" && typeof hitGhSegDbl.index === "number" && !hitGhSegDbl.vertexAnchor) {
      const ogh = objs[hitGhSegDbl.index];
      if (ogh && ogh.type === "gutter_height_dimension") {
        dp2MigrateGutterHeightDimensionIfNeeded(ogh);
        if (typeof ogh.x === "number" && typeof ogh.y === "number") {
          if (dp2OpenGutterHeightDimensionEdit(hitGhSegDbl.index)) return;
        }
      }
    }

    // 1) Contour bâti : fermeture via OpenLayers Draw (double-clic natif OL) — pas de handler canvas

    // 2) Texte libre : double-clic = édition simple (prompt)
    const hitText = dp2HitTestText(coords.x, coords.y);
    if (hitText && hitText.id) {
      const t = dp2GetTextById(hitText.id);
      if (t && t.type === "text" && t.visible === true && t.textKind === "free") {
        const current = typeof t.content === "string" ? t.content : "";
        const next = window.prompt("Texte :", current);
        if (next != null) {
          dp2CommitHistoryPoint();
          t.content = String(next);
          dp2SetSelectedTextIds([t.id]);
          renderDP2FromState();
        }
      }
    }
  });
}

// --------------------------
// DP2 — MOTEUR DE RENDU PASSIF (ÉTAPE 3)
// Bâti : source DP2_STATE.features (EPSG:3857) + rendu / hit-test OpenLayers ; buildingContours = cache pixels (UI cotes / poignées canvas uniquement).
// Miroirs dp2drv réservés aux formes métier (businessObjects) — plus de doublon contour bâti.
// --------------------------
/** Préfixe des objets miroir (synchronisation formes métier → objects ; pas le bâti). */
var DP2_DRV_SYNC_PREFIX = "dp2drv:";

/**
 * Recolle dans DP2_STATE.objects des entrées dérivées des contours bâti et formes métier,
 * afin que `objects` reflète aussi ce qui est tracé hors ce tableau (sans double rendu : dp2SyncKey).
 */
function dp2RebuildDerivedObjectsMirrors() {
  const s = window.DP2_STATE;
  if (!s) return;
  if (!Array.isArray(s.objects)) s.objects = [];
  const PREF = DP2_DRV_SYNC_PREFIX;
  s.objects = s.objects.filter(function (o) {
    return !(o && typeof o.dp2SyncKey === "string" && o.dp2SyncKey.indexOf(PREF) === 0);
  });
  /* Plus de miroir contour dans objects[] : bâti = DP2_STATE.features + cache buildingContours. */
  const biz = s.businessObjects || [];
  for (let bi = 0; bi < biz.length; bi++) {
    const o = biz[bi];
    if (!o || o.visible === false || !o.geometry) continue;
    const g = o.geometry;
    const gx = typeof g.x === "number" ? g.x : 0;
    const gy = typeof g.y === "number" ? g.y : 0;
    const gw = typeof g.width === "number" ? g.width : 0;
    const gh = typeof g.height === "number" ? g.height : 0;
    const rot = typeof g.rotation === "number" ? g.rotation : 0;
    const key = PREF + "biz:" + String(o.id);
    if (o.type === "circle") {
      s.objects.push({
        type: "circle",
        x: gx + Math.max(1, gw) / 2,
        y: gy + Math.max(1, gh) / 2,
        radius: Math.max(1, Math.min(Math.max(1, gw), Math.max(1, gh)) / 2),
        strokeStyle: "#111827",
        lineWidth: 2,
        dp2SyncKey: key,
      });
    } else {
      s.objects.push({
        type: "rectangle",
        x: gx,
        y: gy,
        width: Math.max(1, gw),
        height: Math.max(1, gh),
        rotation: rot,
        strokeStyle: "#111827",
        lineWidth: 2,
        dp2SyncKey: key,
      });
    }
  }
  if (window.__SN_DP_DP2_AUDIT__ === true) {
    try {
      const n = (s.objects || []).length;
      if (s._dp2DbgObjLen !== n) {
        s._dp2DbgObjLen = n;
        console.log("[DP2 TEST OBJECTS]", n);
      }
    } catch (_) {}
  }
}

function renderDP2FromState() {
  const canvas = document.getElementById("dp2-draw-canvas");
  if (!canvas) {
    console.warn("[DP2] Canvas introuvable pour rendu");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.warn("[DP2] Contexte 2D introuvable");
    return;
  }

  // Vérifier que DP2_STATE est initialisé
  if (!window.DP2_STATE) {
    console.warn("[DP2] DP2_STATE non initialisé");
    return;
  }

  try {
    dp2RebuildContourDisplayCacheFromFeatures();
  } catch (_) {}

  try {
    dp2RebuildDerivedObjectsMirrors();
  } catch (e) {
    console.warn("[DP2] dp2RebuildDerivedObjectsMirrors", e);
  }

  if (window.__SN_DP_DP2_AUDIT__ === true) {
    try {
      const bSrc = window.DP2_MAP && window.DP2_MAP.dp2BuildingVectorSource;
      const olN = bSrc && typeof bSrc.getFeatures === "function" ? bSrc.getFeatures().length : null;
      console.log("[DP2 SOURCE]", {
        features: (window.DP2_STATE?.features || []).length,
        contoursCache: (window.DP2_STATE?.buildingContours || []).length,
        olLayerFeatures: olN
      });
      if (dp2IsDP4RoofProfile()) {
        console.log("[DP4][AUDIT] canvas features count", (window.DP2_STATE?.features || []).length);
      }
      if (olN != null) {
        console.log("[DP2 OL FEATURES]", olN);
      }
    } catch (_) {}
  }

  // Effacer le canvas (calque pur)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Parcourir tous les objets depuis la source de vérité unique
  const objects = window.DP2_STATE.objects || [];

  const hideIndividualPanels = dp2GetDisplayMode() === "simple";

  // Le contour bati est dessine par OpenLayers UNIQUEMENT quand le calque OL est la
  // surface reellement affichee. En mode image figee (reouverture d'une version validee :
  // l'image capturee recouvre la carte, ou carte demontee), le calque OL est masque/absent :
  // le canvas doit alors tracer le contour lui-meme, sinon seules les cotes apparaissent.
  const __dp2CapWrap = document.getElementById("dp2-captured-image-wrap");
  const __dp2CapImg = document.getElementById("dp2-captured-image");
  const __dp2CapturedShown = !!(
    __dp2CapWrap &&
    __dp2CapWrap.style.display !== "none" &&
    __dp2CapImg &&
    typeof __dp2CapImg.src === "string" &&
    __dp2CapImg.src.indexOf("data:image") === 0
  );
  const __dp2OlBuildingLive =
    !!(window.DP2_MAP && window.DP2_MAP.dp2BuildingVectorSource && typeof ol !== "undefined") &&
    !__dp2CapturedShown &&
    !(
      window.DP2_MAP.dp2BuildingVectorLayer &&
      typeof window.DP2_MAP.dp2BuildingVectorLayer.getVisible === "function" &&
      !window.DP2_MAP.dp2BuildingVectorLayer.getVisible()
    );
  if (typeof dp2BuildingRenderUsesFeatures === "function" && dp2BuildingRenderUsesFeatures() && __dp2OlBuildingLive) {
    try {
      dp2RenderFeaturesOL();
    } catch (e) {
      console.warn("[DP2] dp2RenderFeaturesOL", e);
    }
    /* Canvas : poignées / cotes / surcouches uniquement — géométrie bâti = calque OL (pas de tracé poly ici). */
    const contours = dp2GetBuildingContours();
    const activeId = window.DP2_STATE?.selectedBuildingContourId || null;
    const isDP4Roof = typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile();
    for (const c of contours) {
      renderDP2BuildingContour(ctx, c, {
        active: isDP4Roof ? true : !!(c && activeId && c.id === activeId),
        skipBasics: true
      });
    }
  } else {
    const contours = dp2GetBuildingContours();
    const activeId = window.DP2_STATE?.selectedBuildingContourId || null;
    const isDP4Roof = typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile();
    for (const c of contours) {
      renderDP2BuildingContour(ctx, c, {
        active: isDP4Roof ? true : !!(c && activeId && c.id === activeId)
      });
    }
  }

  // Rendu standard (DP2) : une seule passe dans l'ordre des objets.
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || !obj.type) {
      console.warn("[DP2] Objet invalide ignoré", obj);
      continue;
    }
    if (typeof obj.dp2SyncKey === "string" && obj.dp2SyncKey.indexOf(DP2_DRV_SYNC_PREFIX) === 0) {
      continue;
    }

    // Dessiner selon le type d'objet
    switch (obj.type) {
      case "rectangle":
        renderRectangle(ctx, obj);
        break;
      case "pv_panel":
        if (!hideIndividualPanels) renderPvPanel(ctx, obj);
        break;
      case "line":
        renderLine(ctx, obj);
        break;
      case "circle":
        renderCircle(ctx, obj);
        break;
      case "polygon":
        renderPolygon(ctx, obj);
        break;
      case "text":
        renderText(ctx, obj);
        break;
      case "building_outline":
        renderBuildingOutline(ctx, obj);
        break;
      case "measure_line":
        // __parcelEdge = support temporaire pour édition contour : jamais dessiner de segment vert
        if (!obj.__parcelEdge) renderMeasureLine(ctx, obj, i);
        break;
      case "ridge_line":
        renderRidgeLine(ctx, obj, i);
        break;
      case "gutter_height_dimension":
        if (typeof renderGutterHeightDimension === "function") renderGutterHeightDimension(ctx, obj, i);
        break;
      default:
        console.warn("[DP2] Type d'objet non supporté :", obj.type);
    }
  }

  // Panneaux PV (calepinage simple) : source de vérité dédiée DP2_STATE.panels[]
  const panels = window.DP2_STATE.panels || [];
  if (hideIndividualPanels) {
    const roofBBox = computePanelsBoundingBox(panels);
    if (roofBBox) renderRoofAreaRect(ctx, roofBBox);
  } else {
    for (const panel of panels) {
      renderDP2Panel(ctx, panel);
    }
  }

  // Formes métier (ÉTAPE 6) : calque au-dessus des objets existants
  const businessObjects = window.DP2_STATE.businessObjects || [];
  for (const obj of businessObjects) {
    renderDP2BusinessObject(ctx, obj);
  }

  const hoverBizId = window.DP2_STATE._businessHoverId;
  const pendingSelBizId = window.DP2_STATE.selectedBusinessObjectId;
  if (hoverBizId && hoverBizId !== pendingSelBizId) {
    const ho = getDP2BusinessObjectById(hoverBizId);
    const hb = dp2BizUiBlend01(window.DP2_STATE._bizHoverChromeAt, 100);
    if (ho) renderDP2BusinessHoverHighlight(ctx, ho, hb);
  }

  // Textes (annotations) : calque au-dessus (hors légende)
  const textObjects = window.DP2_STATE.textObjects || [];
  for (const obj of textObjects) {
    renderDP2TextObject(ctx, obj);
  }

  // Sélection visuelle uniquement : surligner l'objet sélectionné
  const selectedId = window.DP2_STATE.selectedObjectId;
  if (selectedId != null && objects[selectedId]) {
    renderSelectionHighlight(ctx, objects[selectedId]);
  }

  // Sélection + handles (panneaux PV) — masqué en mode emprise simple (données / interactions inchangées)
  if (!hideIndividualPanels) {
    const selectedPanelIds = dp2GetEffectiveSelectedPanelIds();
    if (selectedPanelIds.length >= 2) {
      renderDP2PanelGroupSelection(ctx, selectedPanelIds);
    } else if (selectedPanelIds.length === 1) {
      const selPanel = dp2GetPanelById(selectedPanelIds[0]);
      if (selPanel) renderDP2PanelSelection(ctx, selPanel);
    }
  }

  // Sélection + handles (formes métier)
  const selectedBizId = window.DP2_STATE.selectedBusinessObjectId;
  if (window.DP2_STATE) {
    const st = window.DP2_STATE;
    if (st._bizUiPrevSelBizId !== selectedBizId) {
      st._bizUiPrevSelBizId = selectedBizId;
      st._bizSelChromeAt = selectedBizId ? Date.now() : null;
    }
  }
  if (selectedBizId) {
    const sel = getDP2BusinessObjectById(selectedBizId);
    if (sel) renderDP2BusinessSelection(ctx, sel);
  }

  // Sélection + handles (textes)
  const selectedTextIds = typeof dp2GetEffectiveSelectedTextIds === "function" ? dp2GetEffectiveSelectedTextIds() : [];
  if (selectedTextIds.length >= 2) {
    renderDP2TextGroupSelection(ctx, selectedTextIds);
  } else if (selectedTextIds.length === 1) {
    const selText = dp2GetTextById(selectedTextIds[0]);
    if (selText) renderDP2TextSelection(ctx, selText);
  }

  // Prévisualisation dynamique : contour bâti (segment temporaire) ou trait de mesure (A → souris)
  const preview = window.DP2_STATE.drawingPreview;
  if (preview && preview.previewType === "gutter_height_dimension" && typeof preview.anchorX === "number" && typeof preview.anchorY === "number") {
    if (typeof renderGutterHeightDimension === "function") {
      renderGutterHeightDimension(
        ctx,
        {
          type: "gutter_height_dimension",
          x: preview.anchorX,
          y: preview.anchorY,
          heightM: typeof preview.heightM === "number" && Number.isFinite(preview.heightM) ? preview.heightM : null,
          __gutterPreview: true
        },
        null
      );
    }
  } else if (preview && preview.from && preview.to) {
    ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = preview.previewType === "ridge_line" ? DP2_RIDGE_GREEN : DP2_MEASURE_GREEN;
      ctx.lineWidth = preview.previewType === "ridge_line" ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(preview.from.x, preview.from.y);
      ctx.lineTo(preview.to.x, preview.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (preview.snapped) {
        ctx.strokeStyle = "rgba(37, 99, 235, 0.58)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(preview.to.x - 14, preview.to.y);
        ctx.lineTo(preview.to.x + 14, preview.to.y);
        ctx.moveTo(preview.to.x, preview.to.y - 14);
        ctx.lineTo(preview.to.x, preview.to.y + 14);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (preview.previewType === "ridge_line" && preview.ridgeSnap) {
        const snap = preview.ridgeSnap;
        dp2DrawTransparentPoint(ctx, snap.x, snap.y, DP2_PREVIEW_STROKE, 4.5, 1.2);
        if (typeof snap.segmentAngle === "number") {
          const ridgeAngle = Math.atan2(preview.to.y - preview.from.y, preview.to.x - preview.from.x);
          const diff = Math.abs(Math.atan2(Math.sin(ridgeAngle - snap.segmentAngle), Math.cos(ridgeAngle - snap.segmentAngle)));
          const right = Math.min(Math.abs(diff - Math.PI / 2), Math.abs(diff + Math.PI / 2));
          if (right < Math.PI / 22) {
            const s = 11;
            const ux = Math.cos(snap.segmentAngle);
            const uy = Math.sin(snap.segmentAngle);
            const vx = -uy;
            const vy = ux;
            ctx.strokeStyle = "rgba(37, 99, 235, 0.7)";
            ctx.lineWidth = 1.15;
            ctx.beginPath();
            ctx.moveTo(snap.x + ux * s, snap.y + uy * s);
            ctx.lineTo(snap.x + ux * s + vx * s, snap.y + uy * s + vy * s);
            ctx.lineTo(snap.x + vx * s, snap.y + vy * s);
            ctx.stroke();
          }
        }
      }
      const text = (preview.lengthM != null ? preview.lengthM.toFixed(2) : "0,00").replace(".", ",") + " m";
      dp2FillAlignedCoteLabel(ctx, text, preview.from, preview.to, null, preview.snapped ? "active" : null);
    ctx.restore();
  }

  // Trait de mesure : point A seul (en attente du clic B)
  const measureLineStart = window.DP2_STATE.measureLineStart;
  if (window.DP2_STATE.currentTool === "measure_line" && measureLineStart) {
    ctx.save();
    dp2DrawLinePoint(ctx, measureLineStart.x, measureLineStart.y, DP2_MEASURE_POINT_STROKE);
    ctx.restore();
  }

  // Faîtage : point A seul (en attente du clic B)
  const ridgeLineStart = window.DP2_STATE.ridgeLineStart;
  if (window.DP2_STATE.currentTool === "ridge_line" && ridgeLineStart) {
    ctx.save();
    dp2DrawLinePoint(ctx, ridgeLineStart.x, ridgeLineStart.y, DP2_RIDGE_POINT_STROKE);
    ctx.restore();
  }

  // Prévisualisation panneaux PV (NOIR) + fantôme snap (GRIS)
  const pp = window.DP2_STATE.panelPlacementPreview || null;
  if (window.DP2_STATE.currentTool === "panels" && pp && pp.preview) {
    if (pp.snapped && pp.ghost) renderDP2PanelRect(ctx, pp.ghost, DP2_PANEL_GHOST_STYLE);
    renderDP2PanelRect(ctx, pp.preview, DP2_PANEL_PREVIEW_STYLE);
  }

  // Rectangle de sélection (lasso rectangulaire) — visuel uniquement
  const sr = window.DP2_STATE.selectionRect || null;
  if (sr && typeof sr.startX === "number" && typeof sr.startY === "number") {
    const ax = sr.startX;
    const ay = sr.startY;
    const bx = typeof sr.curX === "number" ? sr.curX : ax;
    const by = typeof sr.curY === "number" ? sr.curY : ay;
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    ctx.save();
    ctx.fillStyle = "rgba(59, 130, 246, 0.14)";   // bleu clair
    ctx.strokeStyle = "rgba(59, 130, 246, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Prévisualisation création texte (rubber-band)
  const ti = window.DP2_STATE?.textInteraction || null;
  if (ti && ti.part === "create" && typeof ti.anchorX === "number" && typeof ti.anchorY === "number") {
    const ax = ti.anchorX;
    const ay = ti.anchorY;
    const bx = typeof ti.curX === "number" ? ti.curX : ax;
    const by = typeof ti.curY === "number" ? ti.curY : ay;
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Légende overlay (lecture seule) : toujours basée sur getDP2GlobalLegendForPdf()
  // -> maj automatique à chaque ajout/suppression (via les rendus successifs)
  // DP4 (toiture) : synchroniser la géométrie en continu (sans calculs, sans calepinage)
  try {
    if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile() && typeof dp4SyncRoofGeometryFromDP2State === "function") {
      dp4SyncRoofGeometryFromDP2State();
    }
  } catch (_) {}
  dp2TryScheduleBizUiChromeFrame();
  syncDP2LegendOverlayUI();
  syncDP2DrawActionsUI();
  syncDP2SelectionInspectorUI();
  dp2SyncMeasureResizePreviewOverlay();
  try {
    dp2FinalizeInteractionChrome();
    dp2SyncMapAnchoredOverlays();
  } catch (_) {}
  syncDP2DisplayModeToolbarUI();
  try {
    dp2SyncBuildingOlPointerPassThrough();
    dp2SyncBuildingOlInteractions();
  } catch (_) {}
}

// --------------------------
// DP2 — OVERLAY PRÉVISUALISATION (Valider uniquement) — measure_line avec requestedLengthM + resizeAnchor
// Aucun commit géométrique : Valider = fermer l’overlay (état prêt pour PROMPT 5), Annuler = effacer preview
// --------------------------
// DP2 — COMMIT GÉOMÉTRIQUE D'UNE MESURE (PROMPT 5)
// Applique réellement requestedLengthM sur obj.a ou obj.b
// --------------------------
function dp2CommitParcelSegmentResize(params) {
  const p = params || {};
  const contourId = p.contourId;
  const segmentIndex = p.segmentIndex;
  const requestedLengthM = p.requestedLengthM;
  const anchor = p.anchor;
  if (contourId == null || typeof segmentIndex !== "number" || typeof requestedLengthM !== "number") return;
  if (anchor !== "A" && anchor !== "B") return;
  const scale = window.DP2_STATE?.scale_m_per_px;
  if (!scale || scale <= 0) return;
  const contour = dp2GetBuildingContourById(contourId);
  if (!contour || !Array.isArray(contour.points) || contour.points.length < 2) return;
  const pts = contour.points;
  const n = pts.length;
  const segIdx = segmentIndex;
  const p1 = pts[segIdx];
  const p2 = pts[(segIdx + 1) % n];
  if (!p1 || !p2) return;
  const ax = p1.x;
  const ay = p1.y;
  const bx = p2.x;
  const by = p2.y;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthPx = Math.sqrt(dx * dx + dy * dy);
  if (lengthPx <= 0) return;
  const lengthM = lengthPx * scale;
  const deltaM = requestedLengthM - lengthM;
  const deltaPx = deltaM / scale;
  const ux = dx / lengthPx;
  const uy = dy / lengthPx;

  dp2CommitHistoryPoint();
  if (anchor === "A") {
    pts[segIdx].x = ax - ux * deltaPx;
    pts[segIdx].y = ay - uy * deltaPx;
  } else {
    const idx2 = (segIdx + 1) % n;
    pts[idx2].x = bx + ux * deltaPx;
    pts[idx2].y = by + uy * deltaPx;
  }
  const featPe = dp2FindPolygonFeatureById(contourId);
  if (featPe && Array.isArray(featPe.coordinates)) {
    for (let ii = 0; ii < pts.length && ii < featPe.coordinates.length; ii++) {
      const mc = dp2PixelToMapCoord(pts[ii].x, pts[ii].y);
      if (mc) featPe.coordinates[ii] = mc;
    }
    dp2ClosePolygonFeatureCoordinatesInPlace(featPe);
    try {
      delete featPe.cuts;
    } catch (_) {
      featPe.cuts = undefined;
    }
  }
  try {
    dp2RebuildContourDisplayCacheFromFeatures();
  } catch (_) {}
  try {
    dp2RenderFeaturesOL();
  } catch (_) {}
  dp2ClearParcelEdgeTransientObjects();
}

function dp2CommitMeasureResize(obj) {
  if (
    !obj ||
    obj.type !== "measure_line" ||
    typeof obj.requestedLengthM !== "number" ||
    (obj.resizeAnchor !== "A" && obj.resizeAnchor !== "B")
  ) return;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (!scale || scale <= 0) return;

  const parcelEdge = obj.__parcelEdge;
  if (parcelEdge && parcelEdge.contourId != null && typeof parcelEdge.segmentIndex === "number") {
    dp2CommitParcelSegmentResize({
      contourId: parcelEdge.contourId,
      segmentIndex: parcelEdge.segmentIndex,
      requestedLengthM: obj.requestedLengthM,
      anchor: obj.resizeAnchor
    });
    const objects = window.DP2_STATE?.objects || [];
    const idx = objects.indexOf(obj);
    if (idx >= 0) objects.splice(idx, 1);
    return;
  }

  const ax = obj.a.x;
  const ay = obj.a.y;
  const bx = obj.b.x;
  const by = obj.b.y;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthPx = Math.sqrt(dx * dx + dy * dy);
  if (lengthPx <= 0) return;

  const lengthM = lengthPx * scale;
  const deltaM = obj.requestedLengthM - lengthM;
  const deltaPx = deltaM / scale;

  const ux = dx / lengthPx;
  const uy = dy / lengthPx;

  // Commit historique AVANT modification
  dp2CommitHistoryPoint();

  if (obj.resizeAnchor === "A") {
    obj.a = {
      x: ax - ux * deltaPx,
      y: ay - uy * deltaPx
    };
  } else {
    obj.b = {
      x: bx + ux * deltaPx,
      y: by + uy * deltaPx
    };
  }

  // Nettoyage état temporaire
  delete obj.requestedLengthM;
  delete obj.resizeAnchor;
}

function dp2RemoveMeasureResizePreviewOverlay() {
  const el = document.getElementById("dp2-measure-resize-preview-overlay");
  if (el && el.parentNode) el.parentNode.removeChild(el);
  if (window._dp2MeasureResizePreviewOutsideHandler) {
    document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
    window._dp2MeasureResizePreviewOutsideHandler = null;
  }
}

function dp2SyncMeasureResizePreviewOverlay() {
  const objects = window.DP2_STATE?.objects || [];
  let previewObj = null;
  let previewIndex = -1;
  const pe = window.DP2_STATE?.parcelEdgeEdit;
  let parcelPreviewMid = null;
  if (
    pe &&
    pe.contourId != null &&
    typeof pe.segmentIndex === "number" &&
    typeof pe.requestedLengthM === "number" &&
    (pe.anchor === "A" || pe.anchor === "B")
  ) {
    const contourPe = dp2GetBuildingContourById(pe.contourId);
    const stubPe = contourPe ? dp2BuildParcelEdgeMeasureStub(pe, contourPe, pe.segmentIndex) : null;
    const prevPe = stubPe ? getMeasureLinePreviewPoints(stubPe) : null;
    if (prevPe) {
      parcelPreviewMid = {
        midX: (prevPe.aPreview.x + prevPe.bPreview.x) / 2,
        midY: (prevPe.aPreview.y + prevPe.bPreview.y) / 2
      };
    }
  }

  if (!parcelPreviewMid) {
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (
        obj &&
        obj.type === "measure_line" &&
        obj.a &&
        obj.b &&
        typeof obj.requestedLengthM === "number" &&
        (obj.resizeAnchor === "A" || obj.resizeAnchor === "B")
      ) {
        previewObj = obj;
        previewIndex = i;
        break;
      }
    }
  }

  const canvas = document.getElementById("dp2-draw-canvas");
  const container = document.getElementById("dp2-zoom-container");
  if (!canvas || !container) return;

  if (!previewObj && !parcelPreviewMid) {
    dp2RemoveMeasureResizePreviewOverlay();
    return;
  }

  let midX;
  let midY;
  if (parcelPreviewMid) {
    midX = parcelPreviewMid.midX;
    midY = parcelPreviewMid.midY;
  } else {
    midX = (previewObj.a.x + previewObj.b.x) / 2;
    midY = (previewObj.a.y + previewObj.b.y) / 2;
  }
  const labelY = midY + 22;
  const pt = getDP2CanvasToClient(canvas, midX, labelY);
  const containerRect = container.getBoundingClientRect();
  let left = pt.clientX - containerRect.left - 90;
  let top = pt.clientY - containerRect.top + 4;

  let overlay = document.getElementById("dp2-measure-resize-preview-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "dp2-measure-resize-preview-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Valider la modification");
    overlay.style.cssText =
      "position:absolute;z-index:51;display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(17,24,39,0.95);color:#f3f4f6;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font:13px system-ui,sans-serif;";
    const title = document.createElement("div");
    title.textContent = "Prévisualisation — aucun changement appliqué tant que vous ne validez pas";
    title.style.cssText = "font-weight:600;margin-bottom:2px;";
    overlay.appendChild(title);
    const btnValider = document.createElement("button");
    btnValider.type = "button";
    btnValider.id = "dp2-measure-resize-preview-validate-btn";
    btnValider.textContent = "Valider la modification";
    btnValider.style.cssText =
      "padding:6px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;background:#059669;color:#fff;cursor:pointer;font:inherit;";
    overlay.appendChild(btnValider);
    overlay.addEventListener("click", (e) => e.stopPropagation());
    container.appendChild(overlay);
  }

  function cancelPreview() {
    const peLive = window.DP2_STATE?.parcelEdgeEdit;
    if (
      peLive &&
      typeof peLive.requestedLengthM === "number" &&
      (peLive.anchor === "A" || peLive.anchor === "B")
    ) {
      dp2ClearParcelEdgeEdit();
    } else {
      const objs = window.DP2_STATE?.objects || [];
      const obj = objs.find((o) => o && o.type === "measure_line" && typeof o.resizeAnchor === "string");
      if (obj) {
        if (obj.__parcelEdge != null) {
          const idx = objs.indexOf(obj);
          if (idx >= 0) objs.splice(idx, 1);
        } else {
          delete obj.requestedLengthM;
          delete obj.resizeAnchor;
        }
      }
    }
    dp2RemoveMeasureResizePreviewOverlay();
    if (window._dp2MeasureResizePreviewOutsideHandler) {
      document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
      window._dp2MeasureResizePreviewOutsideHandler = null;
    }
    renderDP2FromState();
  }

  let btnValider = document.getElementById("dp2-measure-resize-preview-validate-btn");
  if (!btnValider && overlay) btnValider = overlay.querySelector("button");
  if (btnValider && !btnValider.id) btnValider.id = "dp2-measure-resize-preview-validate-btn";
  if (btnValider) {
    btnValider.onclick = () => {
      const peNow = window.DP2_STATE?.parcelEdgeEdit;
      if (
        peNow &&
        typeof peNow.requestedLengthM === "number" &&
        (peNow.anchor === "A" || peNow.anchor === "B")
      ) {
        dp2CommitParcelSegmentResize({
          contourId: peNow.contourId,
          segmentIndex: peNow.segmentIndex,
          requestedLengthM: peNow.requestedLengthM,
          anchor: peNow.anchor
        });
        dp2ClearParcelEdgeEdit();
      } else {
        const objs = window.DP2_STATE?.objects || [];
        const obj = objs.find((o) => o && o.type === "measure_line" && typeof o.resizeAnchor === "string");
        if (obj) dp2CommitMeasureResize(obj);
      }
      dp2RemoveMeasureResizePreviewOverlay();
      if (window._dp2MeasureResizePreviewOutsideHandler) {
        document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
        window._dp2MeasureResizePreviewOutsideHandler = null;
      }
      renderDP2FromState();
    };
  }

  if (!window._dp2MeasureResizePreviewOutsideHandler) {
    window._dp2MeasureResizePreviewOutsideHandler = function outsidePreview(e) {
      if (overlay && overlay.contains(e.target)) return;
      cancelPreview();
    };
    setTimeout(() => document.addEventListener("click", window._dp2MeasureResizePreviewOutsideHandler), 0);
  }
  left = Math.max(4, left);
  top = Math.max(4, top);
  overlay.style.left = left + "px";
  overlay.style.top = top + "px";
  const ow = overlay.offsetWidth || 200;
  const oh = overlay.offsetHeight || 120;
  if (left + ow > containerRect.width - 4) left = Math.max(4, containerRect.width - 4 - ow);
  if (top + oh > containerRect.height - 4) top = Math.max(4, containerRect.height - 4 - oh);
  overlay.style.left = left + "px";
  overlay.style.top = top + "px";
}

// --------------------------
// DP2 — OVERLAY CHOIX DU POINT À DÉPLACER (measure_line, après édition requestedLengthM)
// Aucune modification géométrique : choix explicite A ou B, stocké dans obj.resizeAnchor
// --------------------------
function dp2RemoveMeasureAnchorChoiceOverlay() {
  const el = document.getElementById("dp2-measure-anchor-overlay");
  if (el && el.parentNode) el.parentNode.removeChild(el);
  const guard = document.getElementById("dp2-measure-anchor-overlay-guard");
  if (guard && guard.parentNode) guard.parentNode.removeChild(guard);
  document.removeEventListener("click", window._dp2MeasureAnchorChoiceOutsideHandler);
  window._dp2MeasureAnchorChoiceOutsideHandler = null;
}

function dp2SyncMeasureAnchorChoiceOverlay() {
  // Choix A/B se fait par clic direct sur les repères A/B sur le plan — pas d’overlay "A ou B"
  dp2RemoveMeasureAnchorChoiceOverlay();
}

function dp2TeardownParcelInlineOutsideHandler() {
  if (window._dp2ParcelInlineOutsideDown) {
    document.removeEventListener("pointerdown", window._dp2ParcelInlineOutsideDown, true);
    window._dp2ParcelInlineOutsideDown = null;
  }
}

function dp2RemoveParcelEdgeInlineInput(committedValue) {
  dp2TeardownParcelInlineOutsideHandler();
  const input = document.getElementById("dp2-parcel-edge-inline-input");
  const pe = window.DP2_STATE?.parcelEdgeEdit;
  const objs = window.DP2_STATE?.objects || [];
  const ix = objs.findIndex((o) => o && o.__parcelEdge);
  const obj = ix >= 0 ? objs[ix] : null;

  let didCommit = false;
  if (pe && pe.contourId != null && typeof pe.segmentIndex === "number" && committedValue !== undefined) {
    const normalized = String(committedValue).trim().replace(",", ".");
    const num = parseFloat(normalized);
    if (!Number.isNaN(num) && num >= 0) {
      pe.requestedLengthM = num;
      pe.anchor = null;
      didCommit = true;
    }
  } else if (obj && obj.type === "measure_line" && obj.__parcelEdge && committedValue !== undefined) {
    const normalized = String(committedValue).trim().replace(",", ".");
    const num = parseFloat(normalized);
    if (!Number.isNaN(num) && num >= 0) {
      obj.requestedLengthM = num;
      didCommit = true;
    }
  }

  if (input && input.parentNode) input.parentNode.removeChild(input);
  if (window.dp2InteractionState) {
    window.dp2InteractionState.editingFeatureId = null;
    try {
      dp2FinalizeInteractionChrome();
    } catch (_) {}
  }

  if (didCommit && typeof renderDP2FromState === "function") renderDP2FromState();
}

// DP2 — Édition inline cote parcelle : #dp2-overlay-layer (parcelEdgeEdit, pas de measure_line temporaire)
function dp2ShowParcelSegmentInlineInput(canvas) {
  dp2EnsureOverlayLayer();
  const layer = document.getElementById("dp2-overlay-layer");
  const pe = window.DP2_STATE?.parcelEdgeEdit;
  if (!pe || pe.contourId == null || typeof pe.segmentIndex !== "number" || !layer || !canvas) return;

  if (document.getElementById("dp2-parcel-edge-inline-input")) dp2RemoveParcelEdgeInlineInput();

  const contour = dp2GetBuildingContourById(pe.contourId);
  if (!contour || !Array.isArray(contour.points)) {
    dp2ClearParcelEdgeEdit();
    return;
  }
  const pts = contour.points;
  const n = pts.length;
  const p1 = pts[pe.segmentIndex];
  const p2 = pts[(pe.segmentIndex + 1) % n];
  if (!p1 || !p2) {
    dp2ClearParcelEdgeEdit();
    return;
  }

  const scale = window.DP2_STATE?.scale_m_per_px;
  const lengthPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
  const currentStr = lengthM.toFixed(2).replace(".", ",");

  if (window.dp2InteractionState) {
    window.dp2InteractionState.editingFeatureId = "parcelSeg:" + pe.contourId + ":" + pe.segmentIndex;
  }

  const input = document.createElement("input");
  input.id = "dp2-parcel-edge-inline-input";
  input.className = "dp2-parcel-edge-inline-input";
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Longueur du segment (mètres)");
  input.value = currentStr;
  input.style.cssText =
    "position:absolute;z-index:54;width:72px;height:24px;padding:2px 6px;box-sizing:border-box;background:#fff;color:#111827;border:1px solid rgba(17,24,39,0.28);border-radius:3px;box-shadow:0 2px 8px rgba(15,23,42,0.16);font:11px system-ui,sans-serif;text-align:center;outline:none;";
  dp2LayoutParcelEdgeInlineInputInLayer(canvas, input);
  layer.appendChild(input);
  dp2SyncMapAnchoredOverlays();
  try {
    dp2FinalizeInteractionChrome();
  } catch (_) {}

  input.focus();
  input.select();

  function cancel() {
    dp2TeardownParcelInlineOutsideHandler();
    const inputEl = document.getElementById("dp2-parcel-edge-inline-input");
    if (inputEl && inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
    if (window.dp2InteractionState) window.dp2InteractionState.editingFeatureId = null;
    dp2ClearParcelEdgeEdit();
    const idx = (window.DP2_STATE?.objects || []).findIndex((o) => o && o.__parcelEdge);
    if (idx >= 0) window.DP2_STATE.objects.splice(idx, 1);
    try {
      dp2FinalizeInteractionChrome();
    } catch (_) {}
    if (typeof renderDP2FromState === "function") renderDP2FromState();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dp2RemoveParcelEdgeInlineInput(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });

  window._dp2ParcelInlineOutsideDown = function parcelInlineOutside(ev) {
    if (!document.getElementById("dp2-parcel-edge-inline-input")) return;
    if (input.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest("#dp2-toolbar")) return;
    if (ev.target.closest && ev.target.closest("#dp2-settings-panel")) return;
    dp2RemoveParcelEdgeInlineInput(input.value);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (document.getElementById("dp2-parcel-edge-inline-input") && window._dp2ParcelInlineOutsideDown) {
          document.addEventListener("pointerdown", window._dp2ParcelInlineOutsideDown, true);
        }
      });
    });
  } else {
    setTimeout(() => {
      if (document.getElementById("dp2-parcel-edge-inline-input") && window._dp2ParcelInlineOutsideDown) {
        document.addEventListener("pointerdown", window._dp2ParcelInlineOutsideDown, true);
      }
    }, 0);
  }
}

function dp2RemoveMeasureLineInlineInput(committedValue) {
  if (window._dp2MeasureLineInlineOutsideDown) {
    document.removeEventListener("pointerdown", window._dp2MeasureLineInlineOutsideDown, true);
    window._dp2MeasureLineInlineOutsideDown = null;
  }
  const input = document.getElementById("dp2-measure-line-inline-input");
  const objectIndex = input ? parseInt(input.dataset.objectIndex || "-1", 10) : -1;
  const obj = window.DP2_STATE?.objects?.[objectIndex];
  let didCommit = false;

  if (obj && obj.type === "measure_line" && obj.a && obj.b && committedValue !== undefined) {
    const normalized = String(committedValue).trim().replace(",", ".");
    const num = parseFloat(normalized);
    if (!Number.isNaN(num) && num >= 0) {
      dp2CommitHistoryPoint();
      obj.requestedLengthM = num;
      delete obj.resizeAnchor;
      didCommit = true;
    }
  }

  if (input && input.parentNode) input.parentNode.removeChild(input);
  if (didCommit && typeof renderDP2FromState === "function") renderDP2FromState();
}

function dp2ShowMeasureLineInlineInput(canvas, objectIndex) {
  dp2EnsureOverlayLayer();
  const layer = document.getElementById("dp2-overlay-layer");
  const obj = window.DP2_STATE?.objects?.[objectIndex];
  if (!layer || !canvas || !obj || obj.type !== "measure_line" || !obj.a || !obj.b) return false;
  if (document.getElementById("dp2-measure-line-inline-input")) dp2RemoveMeasureLineInlineInput();

  const scale = window.DP2_STATE?.scale_m_per_px;
  const lengthPx = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y);
  const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
  const currentStr = lengthM.toFixed(2).replace(".", ",");
  const offset = dp2ManualCoteOffset(obj.labelOffset);
  const labelPt = dp2ComputeCoteLabelPoint(obj.a, obj.b, offset);
  if (!labelPt) return false;

  const input = document.createElement("input");
  input.id = "dp2-measure-line-inline-input";
  input.dataset.objectIndex = String(objectIndex);
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Longueur du trait de mesure (metres)");
  input.value = currentStr;
  input.style.cssText =
    "position:absolute;z-index:54;width:72px;height:24px;padding:2px 6px;box-sizing:border-box;background:#fff;color:#111827;border:1px solid rgba(17,24,39,0.28);border-radius:3px;box-shadow:0 2px 8px rgba(15,23,42,0.16);font:11px system-ui,sans-serif;text-align:center;outline:none;";

  const wrap = document.getElementById("dp2-captured-image-wrap");
  const wrapperRect = wrap ? wrap.getBoundingClientRect() : null;
  const client = getDP2CanvasToClient(canvas, labelPt.x, labelPt.y);
  const w = 72;
  const h = 24;
  let left = wrapperRect ? client.clientX - wrapperRect.left - w / 2 : 0;
  let top = wrapperRect ? client.clientY - wrapperRect.top - h / 2 : 0;
  const pad = 8;
  if (wrapperRect) {
    left = Math.min(Math.max(pad, left), Math.max(pad, wrapperRect.width - w - pad));
    top = Math.min(Math.max(pad, top), Math.max(pad, wrapperRect.height - h - pad));
  }
  input.style.left = `${left}px`;
  input.style.top = `${top}px`;

  layer.appendChild(input);
  input.focus();
  input.select();

  function cancel() {
    if (window._dp2MeasureLineInlineOutsideDown) {
      document.removeEventListener("pointerdown", window._dp2MeasureLineInlineOutsideDown, true);
      window._dp2MeasureLineInlineOutsideDown = null;
    }
    const inputEl = document.getElementById("dp2-measure-line-inline-input");
    if (inputEl && inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dp2RemoveMeasureLineInlineInput(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });

  window._dp2MeasureLineInlineOutsideDown = function measureLineInlineOutside(ev) {
    if (!document.getElementById("dp2-measure-line-inline-input")) return;
    if (input.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest("#dp2-toolbar")) return;
    if (ev.target.closest && ev.target.closest("#dp2-settings-panel")) return;
    dp2RemoveMeasureLineInlineInput(input.value);
  };
  setTimeout(() => {
    if (document.getElementById("dp2-measure-line-inline-input") && window._dp2MeasureLineInlineOutsideDown) {
      document.addEventListener("pointerdown", window._dp2MeasureLineInlineOutsideDown, true);
    }
  }, 0);
  return true;
}

function dp2ShowMeasureAnchorChoiceOverlay(canvas, objectIndex) {
  const objs = window.DP2_STATE?.objects || [];
  const obj = objs[objectIndex];
  if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || typeof obj.requestedLengthM !== "number") return;
  if (obj.resizeAnchor === "A" || obj.resizeAnchor === "B") return;

  dp2RemoveMeasureAnchorChoiceOverlay();

  const container = document.getElementById("dp2-zoom-container");
  if (!container) return;

  const midX = (obj.a.x + obj.b.x) / 2;
  const midY = (obj.a.y + obj.b.y) / 2;
  const pt = getDP2CanvasToClient(canvas, midX, midY);
  const containerRect = container.getBoundingClientRect();
  const left = pt.clientX - containerRect.left - 95;
  const top = pt.clientY - containerRect.top - 8;

  const overlay = document.createElement("div");
  overlay.id = "dp2-measure-anchor-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Choisir le point à déplacer");
  overlay.style.cssText = "position:absolute;z-index:52;display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(17,24,39,0.96);color:#f3f4f6;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.35);font:13px system-ui,sans-serif;min-width:160px;";
  const title = document.createElement("div");
  title.textContent = "Quel point déplacer ?";
  title.style.cssText = "font-weight:600;margin-bottom:2px;";
  overlay.appendChild(title);

  const btnA = document.createElement("button");
  btnA.type = "button";
  btnA.textContent = "Déplacer point A";
  btnA.style.cssText = "padding:8px 12px;border:1px solid rgba(255,255,255,0.25);border-radius:6px;background:#16a34a;color:#fff;cursor:pointer;font:inherit;text-align:left;";
  overlay.appendChild(btnA);

  const btnB = document.createElement("button");
  btnB.type = "button";
  btnB.textContent = "Déplacer point B";
  btnB.style.cssText = "padding:8px 12px;border:1px solid rgba(255,255,255,0.25);border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font:inherit;text-align:left;";
  overlay.appendChild(btnB);

  const btnAnnuler = document.createElement("button");
  btnAnnuler.type = "button";
  btnAnnuler.textContent = "Annuler";
  btnAnnuler.style.cssText = "padding:6px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;background:transparent;color:#9ca3af;cursor:pointer;font:inherit;";
  overlay.appendChild(btnAnnuler);

  function applyChoice(anchor) {
    const o = window.DP2_STATE?.objects?.[objectIndex];
    if (o && o.type === "measure_line") {
      o.resizeAnchor = anchor;
      dp2CommitMeasureResize(o);
    }
    dp2RemoveMeasureAnchorChoiceOverlay();
    if (typeof dp2RemoveMeasureResizePreviewOverlay === "function") dp2RemoveMeasureResizePreviewOverlay();
    renderDP2FromState();
  }

  function cancelChoice() {
    const o = window.DP2_STATE?.objects?.[objectIndex];
    if (o && o.type === "measure_line" && o.__parcelEdge != null) {
      const objects = window.DP2_STATE?.objects || [];
      const idx = objects.indexOf(o);
      if (idx >= 0) objects.splice(idx, 1);
    }
    dp2RemoveMeasureAnchorChoiceOverlay();
    renderDP2FromState();
  }

  btnA.onclick = (e) => { e.stopPropagation(); applyChoice("A"); };
  btnB.onclick = (e) => { e.stopPropagation(); applyChoice("B"); };
  btnAnnuler.onclick = (e) => { e.stopPropagation(); cancelChoice(); };

  overlay.addEventListener("click", (e) => e.stopPropagation());
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    if (target === btnB) applyChoice("B");
    else if (target === btnAnnuler) cancelChoice();
    else applyChoice("A");
  });

  overlay.style.left = Math.max(4, left) + "px";
  overlay.style.top = Math.max(4, top) + "px";
  container.appendChild(overlay);
  try { btnA.focus(); } catch (_) {}

  window._dp2MeasureAnchorChoiceOutsideHandler = function outsideHandler(e) {
    if (overlay.contains(e.target)) return;
    const guard = document.getElementById("dp2-measure-anchor-overlay-guard");
    if (guard && guard.contains(e.target)) return;
    cancelChoice();
    document.removeEventListener("click", window._dp2MeasureAnchorChoiceOutsideHandler);
    window._dp2MeasureAnchorChoiceOutsideHandler = null;
  };
  setTimeout(() => document.addEventListener("click", window._dp2MeasureAnchorChoiceOutsideHandler), 0);
}

// --------------------------
// DP2 — HELPERS DE RENDU PAR TYPE D'OBJET
// --------------------------
function renderRectangle(ctx, obj) {
  // obj: { type: "rectangle", x, y, width, height, fillStyle?, strokeStyle?, lineWidth?, rotation? }
  ctx.save();
  
  if (obj.rotation) {
    const cx = obj.x + (obj.width || 0) / 2;
    const cy = obj.y + (obj.height || 0) / 2;
    ctx.translate(cx, cy);
    ctx.rotate(obj.rotation);
    ctx.translate(-cx, -cy);
  }

  if (obj.fillStyle) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fillRect(obj.x, obj.y, obj.width || 0, obj.height || 0);
  }

  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.strokeRect(obj.x, obj.y, obj.width || 0, obj.height || 0);
  }

  ctx.restore();
}

function renderPvPanel(ctx, obj) {
  // obj: { type:"pv_panel", x,y,width,height,rotation }
  const w = obj.width || 0;
  const h = obj.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = (obj.x || 0) + w / 2;
  const cy = (obj.y || 0) + h / 2;
  const rot = obj.rotation || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const x = -w / 2;
  const y = -h / 2;

  // Corps panneau (rendu sobre et fidèle à la légende)
  ctx.fillStyle = DP2_PANEL_STYLE.fill;
  ctx.strokeStyle = DP2_PANEL_STYLE.stroke;
  ctx.lineWidth = DP2_PANEL_STYLE.lineWidth;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// --------------------------
// DP2 — RENDU PANNEAUX PV (DP2_STATE.panels[])
// Modèle imposé :
// { id, type:"panel", geometry:{x,y,width,height,rotation}, lockedSize:true, visible:true }
// --------------------------
function renderDP2PanelRect(ctx, geom, style) {
  const g = geom || null;
  const w = g?.width || 0;
  const h = g?.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const isDP4Roof = typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile();
  const scaleX = isDP4Roof ? (g.displayScaleX ?? g.displayScale ?? 1) : 1;
  const scaleY = isDP4Roof ? (g.displayScaleY ?? g.displayScale ?? 1) : 1;

  const cx = (g.x || 0) + w / 2;
  const cy = (g.y || 0) + h / 2;
  const rot = g.rotation || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  if (isDP4Roof && (scaleX !== 1 || scaleY !== 1)) ctx.scale(scaleX, scaleY);

  const x = -w / 2;
  const y = -h / 2;

  const st = style || DP2_PANEL_STYLE;
  ctx.fillStyle = st.fill;
  ctx.strokeStyle = st.stroke;
  ctx.lineWidth = st.lineWidth || 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  if (st.stroke) ctx.stroke();

  if (st === DP2_PANEL_STYLE) {
    const cols = Math.max(2, Math.min(6, Math.round(w / Math.max(12, h * 0.42))));
    ctx.strokeStyle = "rgba(248, 250, 252, 0.18)";
    ctx.lineWidth = 0.7;
    for (let i = 1; i < cols; i++) {
      const gx = x + (w * i) / cols;
      ctx.beginPath();
      ctx.moveTo(gx, y + 1);
      ctx.lineTo(gx, y + h - 1);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Emprise PV type « plan simple » : rectangle axe-aligned, style distinct des panneaux (aucun lien DP2_PANEL_STYLE). */
function renderRoofAreaRect(ctx, rect) {
  const r = rect || null;
  const rw = r?.width || 0;
  const rh = r?.height || 0;
  if (!r || !(rw > 0) || !(rh > 0)) return;
  const rx = r.x || 0;
  const ry = r.y || 0;
  ctx.save();
  ctx.fillStyle = "rgba(185, 28, 28, 0.14)";
  ctx.strokeStyle = "#991b1b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderDP2Panel(ctx, panel) {
  if (!panel || panel.type !== "panel" || panel.visible !== true || !panel.geometry) return;
  renderDP2PanelRect(ctx, panel.geometry, DP2_PANEL_STYLE);
}

function renderDP2PanelSelection(ctx, panel) {
  if (!panel || panel.type !== "panel" || panel.visible !== true || !panel.geometry) return;
  const g = panel.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = (g.x || 0) + w / 2;
  const cy = (g.y || 0) + h / 2;
  const rot = g.rotation || 0;
  const ui = dp2GetPanelSelectionUiScale();
  const rotateHandleOffset = 20 * ui;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const x = -w / 2;
  const y = -h / 2;

  // bbox
  ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = Math.max(1.4, 2 * ui);
  ctx.strokeRect(x, y, w, h);

  // poignée rotation (pas de resize)
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = Math.max(1.2, 1.5 * ui);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(0, y - rotateHandleOffset);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, y - rotateHandleOffset, 9 * ui, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const sx = g.displayScaleX ?? g.displayScale ?? 1;
    const sy = g.displayScaleY ?? g.displayScale ?? 1;
    const wEff = w * sx;
    const hEff = h * sy;
    const scaleHandleX = wEff / 2 + 14;
    const scaleHandleY = hEff / 2 + 14;
    ctx.fillStyle = "#C39847";
    ctx.fillRect(scaleHandleX - 5 * ui, scaleHandleY - 5 * ui, 10 * ui, 10 * ui);
  }

  ctx.restore();
}

function renderDP2PanelGroupSelection(ctx, panelIds) {
  const ids = Array.isArray(panelIds) ? panelIds : [];
  if (ids.length < 2) return;
  const aabb = dp2PanelsGroupAABB(ids);
  if (!aabb) return;

  const x = aabb.minX;
  const y = aabb.minY;
  const w = aabb.maxX - aabb.minX;
  const h = aabb.maxY - aabb.minY;
  if (!(w > 0) || !(h > 0)) return;

  const rotateHandleOffset = 18;

  ctx.save();

  // bbox groupe (axis-aligned)
  ctx.fillStyle = "rgba(37, 99, 235, 0.06)";
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = Math.max(1.4, 2 * ui);
  ctx.strokeRect(x, y, w, h);

  // poignée rotation unique (haut-centre)
  const hx = aabb.cx;
  const hy = y - rotateHandleOffset;
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = Math.max(1.2, 1.5 * ui);
  ctx.beginPath();
  ctx.moveTo(hx, y);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(hx, hy, 9 * ui, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const scaleHx = aabb.maxX + 14;
    const scaleHy = aabb.maxY + 14;
    ctx.fillStyle = "#C39847";
    ctx.fillRect(scaleHx - 5 * ui, scaleHy - 5 * ui, 10 * ui, 10 * ui);
  }

  ctx.restore();
}

function renderLine(ctx, obj) {
  // obj: { type: "line", x1, y1, x2, y2, strokeStyle?, lineWidth? }
  ctx.save();
  
  ctx.beginPath();
  ctx.moveTo(obj.x1 || 0, obj.y1 || 0);
  ctx.lineTo(obj.x2 || 0, obj.y2 || 0);
  
  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

function renderCircle(ctx, obj) {
  // obj: { type: "circle", x, y, radius, fillStyle?, strokeStyle?, lineWidth? }
  ctx.save();
  
  ctx.beginPath();
  ctx.arc(obj.x || 0, obj.y || 0, obj.radius || 0, 0, Math.PI * 2);
  
  if (obj.fillStyle) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fill();
  }
  
  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

function renderPolygon(ctx, obj) {
  // obj: { type: "polygon", points: [{x, y}, ...], fillStyle?, strokeStyle?, lineWidth?, closed?: bool }
  if (!obj.points || !Array.isArray(obj.points) || obj.points.length < 2) {
    return;
  }
  
  ctx.save();
  
  ctx.beginPath();
  ctx.moveTo(obj.points[0].x || 0, obj.points[0].y || 0);
  for (let i = 1; i < obj.points.length; i++) {
    ctx.lineTo(obj.points[i].x || 0, obj.points[i].y || 0);
  }
  if (obj.closed !== false) {
    ctx.closePath();
  }
  
  if (obj.fillStyle) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fill();
  }
  
  if (obj.strokeStyle) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

function renderText(ctx, obj) {
  // obj: { type: "text", x, y, text, font?, fillStyle?, strokeStyle?, textAlign?, textBaseline? }
  ctx.save();
  
  if (obj.font) {
    ctx.font = obj.font;
  }
  if (obj.textAlign) {
    ctx.textAlign = obj.textAlign;
  }
  if (obj.textBaseline) {
    ctx.textBaseline = obj.textBaseline;
  }
  
  if (obj.fillStyle && obj.text) {
    ctx.fillStyle = obj.fillStyle;
    ctx.fillText(obj.text, obj.x || 0, obj.y || 0);
  }
  
  if (obj.strokeStyle && obj.text) {
    ctx.strokeStyle = obj.strokeStyle;
    ctx.lineWidth = obj.lineWidth || 1;
    ctx.strokeText(obj.text, obj.x || 0, obj.y || 0);
  }
  
  ctx.restore();
}

// --------------------------
// DP2 — PRÉVISUALISATION MESURE (sans modifier obj.a / obj.b)
// Condition : obj.requestedLengthM défini, obj.resizeAnchor "A" ou "B".
// Retourne { aPreview: {x,y}, bPreview: {x,y}, deltaPx, lengthM } ou null.
// --------------------------
function getMeasureLinePreviewPoints(obj) {
  if (!obj || !obj.a || !obj.b) return null;
  const requested = typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 ? obj.requestedLengthM : null;
  const anchor = obj.resizeAnchor === "A" || obj.resizeAnchor === "B" ? obj.resizeAnchor : null;
  if (requested == null || !anchor) return null;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return null;

  const dx = obj.b.x - obj.a.x;
  const dy = obj.b.y - obj.a.y;
  const lengthPx = Math.hypot(dx, dy);
  if (lengthPx < 1e-6) return null;

  const lengthM = lengthPx * scale;
  const deltaM = requested - lengthM;
  const deltaPx = deltaM / scale;
  const ux = dx / lengthPx;
  const uy = dy / lengthPx;

  let aPreview, bPreview;
  if (anchor === "A") {
    aPreview = { x: obj.a.x - ux * deltaPx, y: obj.a.y - uy * deltaPx };
    bPreview = { x: obj.b.x, y: obj.b.y };
  } else {
    aPreview = { x: obj.a.x, y: obj.a.y };
    bPreview = { x: obj.b.x + ux * deltaPx, y: obj.b.y + uy * deltaPx };
  }
  return { aPreview, bPreview, deltaPx, lengthM };
}

// --------------------------
// DP2 — RENDU TRAIT DE MESURE (cote DP indépendante)
// Objet : { type: "measure_line", a: { x, y }, b: { x, y }, requestedLengthM?, resizeAnchor?: "A"|"B" }
// objectIndex : optionnel, pour feedback visuel (point à déplacer surligné, autre atténué)
// En mode prévisualisation (requestedLengthM + resizeAnchor) : segment en pointillés, flèche, longueur demandée.
// --------------------------
function renderMeasureLine(ctx, obj, objectIndex) {
  if (!obj.a || !obj.b) return;
  // measure_line liée à un contour (__parcelEdge) : jamais rendue ici, preview dessinée sur le contour
  if (obj.__parcelEdge) return;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const anchor = obj.resizeAnchor === "A" || obj.resizeAnchor === "B" ? obj.resizeAnchor : null;
  const preview = getMeasureLinePreviewPoints(obj);

  ctx.save();

  if (preview) {
    // Prévisualisation dynamique (requestedLengthM + resizeAnchor) : segment pointillés, flèche, longueur demandée. Aucun commit sur obj.a/obj.b.
    // On ne dessine que le preview (pas le segment obj.a→obj.b) pour éviter le dédoublement visuel du point déplacé.
    ctx.strokeStyle = DP2_PREVIEW_STROKE;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(preview.aPreview.x, preview.aPreview.y);
    ctx.lineTo(preview.bPreview.x, preview.bPreview.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const from = anchor === "A" ? obj.a : obj.b;
    const to = anchor === "A" ? preview.aPreview : preview.bPreview;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > 2) {
      ctx.strokeStyle = "rgba(37, 99, 235, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const fixed = anchor === "A" ? obj.b : obj.a;
    const movedPreview = anchor === "A" ? preview.aPreview : preview.bPreview;
    dp2DrawTransparentPoint(ctx, fixed.x, fixed.y, "rgba(107, 114, 128, 0.65)", 3.4, 1.2);
    dp2DrawTransparentPoint(ctx, movedPreview.x, movedPreview.y, DP2_PREVIEW_STROKE, 6, 1.8);

    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    const text = (typeof obj.requestedLengthM === "number" ? obj.requestedLengthM : 0).toFixed(2).replace(".", ",") + " m";
    dp2FillAlignedCoteLabel(ctx, text, preview.aPreview, preview.bPreview, off, "editing");
  } else if (typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 && obj.resizeAnchor !== "A" && obj.resizeAnchor !== "B") {
    // Choix du point à déplacer : segment + repères A (vert) et B (bleu) sur le plan, label
    ctx.strokeStyle = DP2_MEASURE_GREEN;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(obj.a.x, obj.a.y);
    ctx.lineTo(obj.b.x, obj.b.y);
    ctx.stroke();
    dp2DrawAnchorChoice(ctx, obj.a.x, obj.a.y, "A", DP2_MEASURE_GREEN);
    dp2DrawAnchorChoice(ctx, obj.b.x, obj.b.y, "B", DP2_PREVIEW_STROKE);
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    const text = obj.requestedLengthM.toFixed(2).replace(".", ",") + " m";
    dp2FillAlignedCoteLabel(ctx, text, obj.a, obj.b, off, null);
  } else {
    const mfid = typeof objectIndex === "number" ? "measure:" + objectIndex : null;
    const mtier = mfid ? dp2InteractionTierForFeature(mfid) : null;
    // Comportement normal (pas de prévisualisation) — points comme contour de bâti (6px, blanc, stroke)
    ctx.strokeStyle = DP2_MEASURE_GREEN;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(obj.a.x, obj.a.y);
    ctx.lineTo(obj.b.x, obj.b.y);
    ctx.stroke();
    dp2DrawCoteSegmentTier(ctx, obj.a, obj.b, mtier);
    dp2DrawLinePoint(ctx, obj.a.x, obj.a.y, DP2_MEASURE_POINT_STROKE);
    dp2DrawLinePoint(ctx, obj.b.x, obj.b.y, DP2_MEASURE_POINT_STROKE);

    if (typeof scale === "number" && scale > 0) {
      const dx = obj.b.x - obj.a.x;
      const dy = obj.b.y - obj.a.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = lengthPx * scale;
      const requested = typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 ? obj.requestedLengthM : null;
      const text = requested != null
        ? requested.toFixed(2).replace(".", ",") + " m"
        : lengthM.toFixed(2).replace(".", ",") + " m";
      const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
      dp2FillAlignedCoteLabel(ctx, text, obj.a, obj.b, off, mtier);
    }
  }
  ctx.restore();
}

// DP2 — Style des points faitage/mesure (aligné contour de bâti : 6px, blanc, stroke)
const DP2_RIDGE_POINT_STROKE = DP2_RIDGE_GREEN;
const DP2_MEASURE_POINT_STROKE = DP2_MEASURE_GREEN;

function dp2DrawLinePoint(ctx, x, y, strokeColor) {
  dp2DrawTransparentPoint(ctx, x, y, strokeColor || "#C39847", 6, 1.8);
}

// --------------------------
// DP2 — RENDU FAÎTAGE (segment structurant)
// Objet : { type: "ridge_line", a: { x, y }, b: { x, y }, labelOffset?: { x, y } }
// Points comme contour de bâti ; mesure dynamique (longueur en m) + label déplaçable.
// --------------------------
function renderRidgeLine(ctx, obj, objectIndex) {
  if (!obj.a || !obj.b) return;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const rfid = typeof objectIndex === "number" ? "ridge:" + objectIndex : null;
  const rtier = rfid ? dp2InteractionTierForFeature(rfid) : null;
  const selected = typeof objectIndex === "number" && window.DP2_STATE?.selectedObjectId === objectIndex;
  const lvi = window.DP2_STATE?.lineVertexInteraction;
  const editing = !!(lvi && lvi.objectIndex === objectIndex);
  const showPoints = selected || editing || rtier === "hover" || rtier === "active" || rtier === "editing";
  ctx.save();
  ctx.strokeStyle = DP2_RIDGE_GREEN;
  ctx.lineWidth = showPoints ? 2.15 : 1.8;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(obj.a.x, obj.a.y);
  ctx.lineTo(obj.b.x, obj.b.y);
  ctx.stroke();
  dp2DrawCoteSegmentTier(ctx, obj.a, obj.b, rtier);
  if (showPoints) {
    dp2DrawLinePoint(ctx, obj.a.x, obj.a.y, DP2_RIDGE_POINT_STROKE);
    dp2DrawLinePoint(ctx, obj.b.x, obj.b.y, DP2_RIDGE_POINT_STROKE);
  }
  if (typeof scale === "number" && scale > 0) {
    const lengthM = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y) * scale;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    dp2FillAlignedCoteLabel(ctx, lengthM.toFixed(2).replace(".", ",") + " m", obj.a, obj.b, off, rtier);
  }
  ctx.restore();
}

/**
 * Migration unique (legacy → { x, y, heightM }) : a/b ou gutterAnchor* → centre ; heightM une fois depuis pixels si absent.
 * Supprime a, b, gutterAnchor*, labelOffset. Pas de lien pixels↔heightM après migration.
 */
function dp2MigrateGutterHeightDimensionIfNeeded(obj) {
  if (!obj || obj.type !== "gutter_height_dimension") return;

  if (typeof obj.visualScale === "number" && Number.isFinite(obj.visualScale)) {
    obj.visualScale = Math.min(
      DP2_GUTTER_HEIGHT_VISUAL_SCALE_MAX,
      Math.max(DP2_GUTTER_HEIGHT_VISUAL_SCALE_MIN, obj.visualScale)
    );
  } else if (obj.visualScale != null) {
    delete obj.visualScale;
  }

  if (obj.__gutterMigratedV2) return;

  const hasModernXY =
    typeof obj.x === "number" &&
    Number.isFinite(obj.x) &&
    typeof obj.y === "number" &&
    Number.isFinite(obj.y);
  const hasLegacyGeometry =
    !!(obj.a && obj.b) ||
    (typeof obj.gutterAnchorX === "number" && Number.isFinite(obj.gutterAnchorX));

  if (hasModernXY && !hasLegacyGeometry) {
    if (!(typeof obj.heightM === "number" && Number.isFinite(obj.heightM) && obj.heightM >= 0)) obj.heightM = 0;
    delete obj.labelOffset;
    obj.__gutterMigratedV2 = true;
    return;
  }

  let nx = null;
  let ny = null;
  if (typeof obj.gutterAnchorX === "number" && Number.isFinite(obj.gutterAnchorX)) {
    nx = obj.gutterAnchorX;
    ny = typeof obj.gutterAnchorY === "number" && Number.isFinite(obj.gutterAnchorY) ? obj.gutterAnchorY : 0;
  } else if (obj.a && obj.b) {
    nx = ((obj.a.x || 0) + (obj.b.x || 0)) / 2;
    ny = ((obj.a.y || 0) + (obj.b.y || 0)) / 2;
  } else if (hasModernXY) {
    nx = obj.x;
    ny = obj.y;
  }
  if (nx == null || ny == null) return;

  if (!(typeof obj.heightM === "number" && Number.isFinite(obj.heightM) && obj.heightM >= 0)) {
    const scale = window.DP2_STATE?.scale_m_per_px;
    if (obj.a && obj.b && typeof scale === "number" && scale > 0) {
      const legacyPx = Math.abs((obj.b.y || 0) - (obj.a.y || 0));
      obj.heightM = legacyPx > 0 ? legacyPx * scale : 0;
    } else {
      obj.heightM = 0;
    }
  }

  obj.x = nx;
  obj.y = ny;
  delete obj.a;
  delete obj.b;
  delete obj.gutterAnchorX;
  delete obj.gutterAnchorY;
  delete obj.labelOffset;
  obj.__gutterMigratedV2 = true;
}

function dp2GutterHeightDisplayM(obj) {
  if (!obj || obj.type !== "gutter_height_dimension") return null;
  if (typeof obj.heightM === "number" && Number.isFinite(obj.heightM) && obj.heightM >= 0) return obj.heightM;
  return null;
}

function dp2OpenGutterHeightDimensionEdit(objectIndex) {
  const objs = window.DP2_STATE?.objects || [];
  const obj = objs[objectIndex];
  if (!obj || obj.type !== "gutter_height_dimension") return false;
  dp2MigrateGutterHeightDimensionIfNeeded(obj);
  const cur = typeof obj.heightM === "number" && Number.isFinite(obj.heightM) ? obj.heightM : 0;
  const currentStr = cur.toFixed(2).replace(".", ",");
  const raw = window.prompt("Hauteur égout (m) :", currentStr);
  if (raw == null) return false;
  const normalized = String(raw).trim().replace(",", ".");
  const num = parseFloat(normalized);
  if (Number.isNaN(num) || num < 0) return false;
  dp2CommitHistoryPoint();
  obj.heightM = num;
  renderDP2FromState();
  return true;
}

/** Facteur graphique pur (annotation hauteur égout) — clamp [0.5, 3]. */
function dp2ClampGutterHeightVisualScale(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(DP2_GUTTER_HEIGHT_VISUAL_SCALE_MAX, Math.max(DP2_GUTTER_HEIGHT_VISUAL_SCALE_MIN, v));
}

/**
 * Échelle d’affichage du symbole ↕ : inverse zoom canvas × visualScale objet (ne modifie jamais heightM).
 * @param {object|null|undefined} obj gutter_height_dimension ou null (légende / défaut)
 */
function dp2GutterHeightVisualScale(obj) {
  const ui = typeof dp2GetBusinessSelectionUiScale === "function" ? dp2GetBusinessSelectionUiScale() : 1;
  const vs =
    obj && obj.type === "gutter_height_dimension" && typeof obj.visualScale === "number" && Number.isFinite(obj.visualScale)
      ? dp2ClampGutterHeightVisualScale(obj.visualScale)
      : 1;
  return ui * vs;
}

/** Centre de la poignée resize visuel (canvas px). */
function dp2GutterHeightVisualHandleLayout(obj) {
  if (!obj || obj.type !== "gutter_height_dimension") return null;
  if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
  const sc = dp2GutterHeightVisualScale(obj);
  const half = DP2_GUTTER_HEIGHT_ICON_HALF_PX * sc;
  return { hx: obj.x, hy: obj.y - half - 9 * sc, r: 7 * sc };
}

function dp2HitTestGutterHeightVisualHandle(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "gutter_height_dimension") continue;
    dp2MigrateGutterHeightDimensionIfNeeded(obj);
    const L = dp2GutterHeightVisualHandleLayout(obj);
    if (!L) continue;
    if (Math.hypot(x - L.hx, y - L.hy) <= L.r) return { index: i, kind: "gutter_height_visual_scale" };
  }
  return null;
}

function dp2DrawGutterHeightIcon(ctx, cx, cy, stroke, scale) {
  const sc = typeof scale === "number" && scale > 0 ? scale : 1;
  const strokeColor = stroke || "#0f766e";
  const half = DP2_GUTTER_HEIGHT_ICON_HALF_PX * sc;
  const yTop = cy - half;
  const yBot = cy + half;
  const cap = 5.5 * sc;
  const ah = 7 * sc;
  const aw = 4.2 * sc;
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1, 1.25 * sc);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, yTop);
  ctx.lineTo(cx, yBot);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - cap, yTop);
  ctx.lineTo(cx + cap, yTop);
  ctx.moveTo(cx - cap, yBot);
  ctx.lineTo(cx + cap, yBot);
  ctx.stroke();
  ctx.fillStyle = strokeColor;
  ctx.beginPath();
  ctx.moveTo(cx, yTop - ah);
  ctx.lineTo(cx - aw, yTop);
  ctx.lineTo(cx + aw, yTop);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, yBot + ah);
  ctx.lineTo(cx - aw, yBot);
  ctx.lineTo(cx + aw, yBot);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function dp2DrawTextWithHalo(ctx, text, x, y, fill, maxStroke) {
  ctx.save();
  ctx.lineWidth = maxStroke || 2.4;
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill || "#134e4a";
  ctx.fillText(text, x, y);
  ctx.restore();
}

// DP2 / DP4 — Annotation métier : icône ↕ + valeur « X,XX m ». Modèle : { type, x, y, heightM, visualScale? }.
function renderGutterHeightDimension(ctx, obj, objectIndex) {
  if (!obj || obj.type !== "gutter_height_dimension") return;
  const isPreview = !!obj.__gutterPreview;
  if (!isPreview && objectIndex != null) dp2MigrateGutterHeightDimensionIfNeeded(obj);

  const ax = typeof obj.x === "number" && Number.isFinite(obj.x) ? obj.x : null;
  const ay = typeof obj.y === "number" && Number.isFinite(obj.y) ? obj.y : null;
  if (ax == null || ay == null) return;

  const sc = dp2GutterHeightVisualScale(obj);
  dp2DrawGutterHeightIcon(ctx, ax, ay, "#0f766e", sc);
  const labelX = ax + 14 * sc;
  const labelY = ay;
  const hm = dp2GutterHeightDisplayM(obj);
  const valStr = hm != null && Number.isFinite(hm) ? hm.toFixed(2).replace(".", ",") + " m" : "—";
  ctx.save();
  ctx.globalAlpha = isPreview ? 0.72 : 1;
  const fontPx = 11 * sc;
  ctx.font = "500 " + fontPx + "px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  dp2DrawTextWithHalo(ctx, valStr, labelX, labelY, "#134e4a", 2.6 * sc);
  const showScaleHandle = !isPreview && typeof objectIndex === "number" && objectIndex >= 0;
  if (showScaleHandle) {
    const L = dp2GutterHeightVisualHandleLayout(obj);
    if (L) {
      ctx.beginPath();
      ctx.arc(L.hx, L.hy, 4 * sc, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 118, 110, 0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(19, 78, 74, 0.9)";
      ctx.lineWidth = Math.max(1, 1 * sc);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// --------------------------
// DP2 — RENDU CONTOUR BÂTI + MESURES (ÉTAPE 4)
// Objet : { type: "building_outline", points: [{x,y}, ...], closed: boolean }
// Mesures générées dynamiquement via scale_m_per_px (affichage au milieu de chaque segment)
// --------------------------
function renderBuildingOutline(ctx, obj) {
  if (!obj.points || !Array.isArray(obj.points) || obj.points.length < 1) {
    return;
  }
  const scale = window.DP2_STATE?.scale_m_per_px;
  const points = obj.points;

  ctx.save();

  // Polyligne (trait) — dès 2 points ; avec 1 point on affiche seulement le sommet (début de trait)
  if (points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    if (obj.closed) {
      ctx.closePath();
    }
    ctx.strokeStyle = obj.strokeStyle || "#1e40af";
    ctx.lineWidth = obj.lineWidth != null ? obj.lineWidth : 2;
    ctx.stroke();
    if (obj.closed && (obj.fillStyle != null)) {
      ctx.fillStyle = obj.fillStyle || "rgba(30, 64, 175, 0.08)";
      ctx.fill();
    }
  }

  // Points (sommets) — visibles dès le premier clic
  ctx.fillStyle = "#1e40af";
  for (let i = 0; i < points.length; i++) {
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mesures : longueur de chaque segment en mètres, texte au milieu du segment (segments définitifs uniquement)
  if (points.length >= 2 && typeof scale === "number" && scale > 0) {
    const segments = obj.closed ? points.length : points.length - 1;
    for (let i = 0; i < segments; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];

      // Segments "coupés" par un faîtage : ne pas afficher la cote globale, afficher L1 et L2
      const cutParts = obj.cuts && obj.cuts[i];
      if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
        for (const part of cutParts) {
          const a = part.a;
          const b = part.b;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const lenM =
            typeof part.lengthM === "number"
              ? part.lengthM
              : Math.hypot(b.x - a.x, b.y - a.y) * scale;
          const text = lenM.toFixed(2).replace(".", ",") + " m";
          dp2FillAlignedCoteLabel(ctx, text, a, b, null, null);
        }
        continue;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      const lengthM = lengthPx * scale;
      const text = lengthM.toFixed(2).replace(".", ",") + " m";
      dp2FillAlignedCoteLabel(ctx, text, p1, p2, null, null);
    }
  }

  ctx.restore();
}

// --------------------------
// DP2 — RENDU CONTOURS DE BÂTI (multi, éditables) — DP2 UNIQUEMENT
// --------------------------
const DP2_BUILDING_CONTOUR_ACTIVE_STROKE = DP2_TECH_BLUE;
const DP2_BUILDING_CONTOUR_INACTIVE_STROKE = DP2_TECH_BLUE;

function renderDP2BuildingContour(ctx, contour, options) {
  if (!contour || !Array.isArray(contour.points) || contour.points.length < 1) return;
  const opt = options || {};
  const active = opt.active === true;
  const skipBasics = opt.skipBasics === true;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const pts = contour.points;

  ctx.save();

  // Polyligne / polygone (ignoré si rendu géométrique délégué à OpenLayers)
  if (!skipBasics && pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (contour.closed) ctx.closePath();
    ctx.strokeStyle = active ? DP2_BUILDING_CONTOUR_ACTIVE_STROKE : DP2_BUILDING_CONTOUR_INACTIVE_STROKE;
    ctx.lineWidth = active ? 2.4 : 2;
    ctx.setLineDash([]);
    ctx.stroke();
    if (contour.closed) {
      ctx.fillStyle = active ? "rgba(30, 64, 175, 0.10)" : "rgba(30, 64, 175, 0.05)";
      ctx.fill();
    }
  }

  // Poignées (sommets) : uniquement sur le contour actif
  if (active) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = DP2_BUILDING_CONTOUR_ACTIVE_STROKE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Mesures : longueur de chaque segment en mètres (mêmes règles que le rendu historique)
  if (pts.length >= 2 && typeof scale === "number" && scale > 0) {
    const segments = contour.closed ? pts.length : pts.length - 1;
    const objects = window.DP2_STATE?.objects || [];
    const peEdit = window.DP2_STATE?.parcelEdgeEdit;
    for (let i = 0; i < segments; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const fidSeg = "parcelSeg:" + contour.id + ":" + i;
      const editingThisSeg =
        window.dp2InteractionState &&
        window.dp2InteractionState.editingFeatureId === fidSeg;
      const tierSeg = dp2InteractionTierForFeature(fidSeg);
      const legacyML = objects.find(
        (o) =>
          o &&
          o.type === "measure_line" &&
          o.__parcelEdge &&
          o.__parcelEdge.contourId === contour.id &&
          o.__parcelEdge.segmentIndex === i
      );
      const parcelEdgeEditing =
        dp2ParcelEdgeEditMatchesSegment(peEdit, contour.id, i) || !!legacyML;
      let previewStub = null;
      let hasParcelEdgeResizePreview = false;
      if (dp2ParcelEdgeEditMatchesSegment(peEdit, contour.id, i)) {
        previewStub = dp2BuildParcelEdgeMeasureStub(peEdit, contour, i);
      } else if (legacyML) {
        previewStub = legacyML;
      }

      // Édition segment contour : surcouches A/B + prévisualisation (parcelEdgeEdit ou brouillon __parcelEdge).
      if (parcelEdgeEditing) {
        let noAnchorYet = false;
        if (dp2ParcelEdgeEditMatchesSegment(peEdit, contour.id, i)) {
          noAnchorYet =
            typeof peEdit.requestedLengthM === "number" &&
            peEdit.anchor !== "A" &&
            peEdit.anchor !== "B";
        } else if (legacyML) {
          noAnchorYet =
            typeof legacyML.requestedLengthM === "number" &&
            legacyML.resizeAnchor !== "A" &&
            legacyML.resizeAnchor !== "B";
        }
        const hasValue = previewStub && typeof previewStub.requestedLengthM === "number";
        if (hasValue && noAnchorYet) {
          ctx.save();
          dp2DrawAnchorChoice(ctx, p1.x, p1.y, "A", DP2_MEASURE_GREEN);
          dp2DrawAnchorChoice(ctx, p2.x, p2.y, "B", DP2_PREVIEW_STROKE);
          ctx.restore();
        }
        const preview =
          previewStub &&
          typeof previewStub.requestedLengthM === "number" &&
          (previewStub.resizeAnchor === "A" || previewStub.resizeAnchor === "B")
            ? getMeasureLinePreviewPoints(previewStub)
            : null;
        if (preview) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = DP2_PREVIEW_STROKE;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(preview.aPreview.x, preview.aPreview.y);
          ctx.lineTo(preview.bPreview.x, preview.bPreview.y);
          ctx.stroke();
          ctx.setLineDash([]);
          const anchor = previewStub.resizeAnchor;
          const from = anchor === "A" ? p1 : p2;
          const to = anchor === "A" ? preview.aPreview : preview.bPreview;
          const dist = Math.hypot(to.x - from.x, to.y - from.y);
          if (dist > 2) {
            ctx.strokeStyle = "rgba(37, 99, 235, 0.55)";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          const text =
            (typeof previewStub.requestedLengthM === "number" ? previewStub.requestedLengthM : 0)
              .toFixed(2)
              .replace(".", ",") + " m";
          if (!editingThisSeg) dp2FillAlignedCoteLabel(ctx, text, preview.aPreview, preview.bPreview, null, "editing", { exteriorOf: contour });
          hasParcelEdgeResizePreview = true;
          ctx.restore();
        }
      }
      if (hasParcelEdgeResizePreview) continue;

      const offMap = contour.labelOffsets && typeof contour.labelOffsets === "object" ? contour.labelOffsets : {};
      const segOff = offMap[i] && typeof offMap[i].x === "number" && typeof offMap[i].y === "number" ? offMap[i] : { x: 0, y: 0 };
      const cutParts = contour.cuts && contour.cuts[i];
      if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
        const tierDrawCuts = tierSeg || (parcelEdgeEditing ? "editing" : null);
        for (const part of cutParts) {
          const a = part.a;
          const b = part.b;
          const lenM =
            typeof part.lengthM === "number"
              ? part.lengthM
              : Math.hypot(b.x - a.x, b.y - a.y) * scale;
          const text = lenM.toFixed(2).replace(".", ",") + " m";
          dp2DrawCoteSegmentTier(ctx, a, b, tierDrawCuts);
          if (!editingThisSeg) dp2FillAlignedCoteLabel(ctx, text, a, b, segOff, tierDrawCuts, { exteriorOf: contour });
        }
        continue;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      let lengthM = lengthPx * scale;
      if (previewStub && typeof previewStub.requestedLengthM === "number") {
        lengthM = previewStub.requestedLengthM;
      }
      const text = lengthM.toFixed(2).replace(".", ",") + " m";
      const tierDraw = tierSeg || (parcelEdgeEditing ? "editing" : null);
      dp2DrawCoteSegmentTier(ctx, p1, p2, tierDraw);
      if (!editingThisSeg) dp2FillAlignedCoteLabel(ctx, text, p1, p2, segOff, tierDraw, { exteriorOf: contour });
    }
  }

  ctx.restore();
}

/**
 * Rendu bâti 100 % OpenLayers (EPSG:3857) depuis DP2_STATE.features.
 * Polygone fermé → Polygon ; contour ouvert (dessin) → LineString.
 */
function dp2RenderFeaturesOL() {
  const pkg = window.DP2_MAP;
  if (!pkg || !pkg.dp2BuildingVectorSource || typeof ol === "undefined") return;
  if (window.__DP2_SUPPRESS_OL_RERENDER__ === true) return;
  const source = pkg.dp2BuildingVectorSource;
  source.clear();
  const feats = window.DP2_STATE?.features || [];
  feats.forEach(function (f) {
    if (!f || f.type !== "polygon" || !Array.isArray(f.coordinates)) return;
    const ring = [];
    for (let i = 0; i < f.coordinates.length; i++) {
      const c = f.coordinates[i];
      if (!c || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      ring.push([c[0], c[1]]);
    }
    if (ring.length < 2) return;
    try {
      if (f.closed === true && ring.length >= 3) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
        if (ring.length >= 4) {
          const feat = new ol.Feature({ geometry: new ol.geom.Polygon([ring]) });
          if (f.id != null) {
            try {
              feat.setId(String(f.id));
            } catch (_) {}
            feat.set("dp2FeatureId", f.id);
          }
          source.addFeature(feat);
        }
      } else {
        const feat = new ol.Feature({ geometry: new ol.geom.LineString(ring) });
        if (f.id != null) {
          try {
            feat.setId(String(f.id));
          } catch (_) {}
          feat.set("dp2FeatureId", f.id);
        }
        source.addFeature(feat);
      }
    } catch (err) {
      console.warn("[DP2] dp2RenderFeaturesOL skip", f && f.id, err);
    }
  });
  try {
    pkg.dp2BuildingVectorLayer?.changed();
  } catch (_) {}
}

function dp2SyncBuildingFeatureGeometryToState(feature) {
  if (!feature || !feature.getGeometry || !window.DP2_STATE) return false;
  const geom = feature.getGeometry();
  if (!geom) return false;
  const gt = geom.getType();
  let coords = null;
  if (gt === "Polygon") coords = geom.getCoordinates()?.[0];
  else if (gt === "LineString") coords = geom.getCoordinates();
  if (!Array.isArray(coords)) return false;
  const id0 = feature.getId() != null ? feature.getId() : feature.get("dp2FeatureId");
  if (id0 == null) return false;
  const id = String(id0);
  const target = (window.DP2_STATE.features || []).find((x) => x && String(x.id) === id);
  if (!target) return false;
  target.coordinates = gt === "Polygon" ? dp2StripClosingCoordinate(coords) : coords.map((c) => [c[0], c[1]]);
  if (gt === "Polygon") target.closed = true;
  try {
    delete target.cuts;
  } catch (_) {
    target.cuts = undefined;
  }
  return true;
}

let _dp2BuildingGeometryCanvasRefreshRaf = null;
function dp2RequestBuildingGeometryCanvasRefresh(feature) {
  if (feature) {
    try {
      dp2SyncBuildingFeatureGeometryToState(feature);
    } catch (_) {}
  }
  if (_dp2BuildingGeometryCanvasRefreshRaf != null) return;
  _dp2BuildingGeometryCanvasRefreshRaf = requestAnimationFrame(() => {
    _dp2BuildingGeometryCanvasRefreshRaf = null;
    try {
      dp2RebuildContourDisplayCacheFromFeatures();
    } catch (_) {}
    try {
      dp2RebuildRidgeCutsForAllContours();
    } catch (_) {}
    window.__DP2_SUPPRESS_OL_RERENDER__ = true;
    try {
      renderDP2FromState();
    } finally {
      window.__DP2_SUPPRESS_OL_RERENDER__ = false;
    }
  });
}

/**
 * Pixel canvas (repère capture) → pixel interne OpenLayers pour forEachFeatureAtPixel.
 */
function dp2CanvasPixelToOlPixel(canvas, canvasX, canvasY) {
  const map = window.DP2_MAP && window.DP2_MAP.map;
  if (!map || !canvas) return null;
  const cap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : null;
  const wCap =
    (cap && typeof cap.width === "number" && cap.width > 0 ? cap.width : null) ??
    (window.DP2_STATE && window.DP2_STATE.backgroundImage && window.DP2_STATE.backgroundImage.width) ??
    0;
  const hCap =
    (cap && typeof cap.height === "number" && cap.height > 0 ? cap.height : null) ??
    (window.DP2_STATE && window.DP2_STATE.backgroundImage && window.DP2_STATE.backgroundImage.height) ??
    0;
  if (!cap || !(wCap > 0) || !(hCap > 0)) return null;
  const v = typeof dp4ValidateDP2CaptureForImport === "function" ? dp4ValidateDP2CaptureForImport(cap) : { ok: true };
  if (!v.ok) return null;
  const size = map.getSize();
  if (!size || size[0] <= 0 || size[1] <= 0) return null;
  return [(canvasX / wCap) * size[0], (canvasY / hCap) * size[1]];
}

/** Sélection bâti : seule source = couche vectorielle OL (pas buildingContours / canvas). */
function dp2PickDp2BuildingFeatureAtOlPixel(pixel) {
  const map = window.DP2_MAP && window.DP2_MAP.map;
  const layer = window.DP2_MAP && window.DP2_MAP.dp2BuildingVectorLayer;
  if (!map || !layer || !pixel || pixel.length < 2) return null;
  let found = null;
  try {
    map.forEachFeatureAtPixel(
      pixel,
      function (feat, lyr) {
        if (lyr === layer) {
          found = feat;
          return true;
        }
      },
      { hitTolerance: 8, layerFilter: function (ly) {
        return ly === layer;
      } }
    );
  } catch (_) {}
  return found;
}

function dp2PickDp2BuildingOlFeatureAtCanvasPixel(canvas, canvasX, canvasY) {
  const pix = dp2CanvasPixelToOlPixel(canvas, canvasX, canvasY);
  if (!pix) return null;
  return dp2PickDp2BuildingFeatureAtOlPixel(pix);
}

/** UI toolbar : retour outil Sélection après fin de polygone OL (équivalent ancien flux canvas). */
function dp2EnterSelectToolAfterBuildingOlComplete() {
  if (!window.DP2_STATE) return;
  window.DP2_STATE.currentTool = "select";
  const toolbar = document.getElementById("dp2-toolbar");
  if (toolbar) {
    toolbar.querySelectorAll(".dp2-tool-btn").forEach(function (btn) {
      btn.classList.remove("dp2-tool-active");
      btn.setAttribute("aria-pressed", "false");
    });
  }
  const selBtn = document.getElementById("dp2-tool-select");
  const measuresBtn = document.getElementById("dp2-tool-measures");
  const measuresIconEl = measuresBtn && measuresBtn.querySelector ? measuresBtn.querySelector(".dp2-tool-icon") : null;
  const measuresLabelEl = measuresBtn && measuresBtn.querySelector ? measuresBtn.querySelector(".dp2-tool-label") : null;
  selBtn && selBtn.classList.add("dp2-tool-active");
  selBtn && selBtn.classList.remove("dp2-tool-btn-disabled");
  if (selBtn) selBtn.disabled = false;
  selBtn && selBtn.setAttribute("aria-pressed", "true");
  measuresBtn && measuresBtn.classList.remove("dp2-tool-active");
  measuresBtn && measuresBtn.classList.remove("dp2-dropdown-open");
  measuresBtn && measuresBtn.setAttribute("aria-pressed", "false");
  measuresBtn && measuresBtn.setAttribute("aria-expanded", "false");
  const measuresMenu = document.getElementById("dp2-measures-menu");
  if (measuresMenu) measuresMenu.hidden = true;
  if (measuresIconEl) measuresIconEl.textContent = "📐";
  if (measuresLabelEl) measuresLabelEl.textContent = "Mesures";
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  if (imgWrap) imgWrap.classList.remove("dp2-tool-pan");
  try {
    window.__DP2_BUILDING_MODIFY_MODE__ = true;
  } catch (_) {}
  try {
    dp2SyncInteractionToolFromDp2State();
    dp2FinalizeInteractionChrome();
  } catch (_) {}
  try {
    refreshDP2ModeStrip();
  } catch (_) {}
}

function dp2SyncBuildingOlPointerPassThrough() {
  const zig = document.getElementById("dp2-zoom-container");
  if (!zig) return;
  const tool = window.DP2_STATE && window.DP2_STATE.currentTool;
  /* Priorité OL : outil contour bâti, ou handoff temporaire (pointerdown sur sommet en Sélection). Sinon le canvas reçoit les événements. */
  const pass =
    tool === "building_outline" ||
    (typeof window !== "undefined" && window.__DP2_TEMP_OL_DRAG__ === true);
  zig.classList.toggle("dp2-building-ol-priority", pass);
}

/** Hit-test sommets `buildingContours[].points` (pixels canvas) pour activer brièvement la priorité OL (drag Modify). */
function dp2HitTestBuildingContourVertexForOlHandoff(canvasX, canvasY, tolPx) {
  const tol = typeof tolPx === "number" && tolPx > 0 ? tolPx : DP2_BUILDING_VERTEX_OL_HANDOFF_TOL_PX;
  const list = typeof dp2GetBuildingContours === "function" ? dp2GetBuildingContours() : [];
  if (!list.length) return false;
  let best = tol + 1;
  for (let ci = 0; ci < list.length; ci++) {
    const c = list[ci];
    if (!c || !Array.isArray(c.points)) continue;
    const pts = c.points;
    for (let pi = 0; pi < pts.length; pi++) {
      const p = pts[pi];
      if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
      const d = Math.hypot(p.x - canvasX, p.y - canvasY);
      if (d <= tol && d < best) best = d;
    }
  }
  return best <= tol;
}

/** Après `dp2-building-ol-priority`, réinjecte le pointerdown sous le point pour OpenLayers (canvas au-dessus de la carte). */
function dp2ForwardPointerDownToBuildingOlMap(e) {
  const mapRoot = document.getElementById("dp2-ign-map");
  if (!mapRoot || typeof PointerEvent === "undefined") return false;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under || !mapRoot.contains(under)) return false;
  try {
    under.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        buttons: e.buttons
      })
    );
  } catch (_) {
    return false;
  }
  return true;
}

function dp2ClearTempOlBuildingDragIfNeeded() {
  if (window.__DP2_TEMP_OL_DRAG__) {
    window.__DP2_TEMP_OL_DRAG__ = false;
    dp2SyncBuildingOlPointerPassThrough();
  }
}

/** true si un hit canvas (mesure / faîtage / …) doit passer avant le pick bâti OpenLayers en pointerdown. */
function dp2PointerDownDeferBuildingOlPick(canvas, x, y) {
  if (dp2HitTestPanelGroup(x, y)) return true;
  if (dp2HitTestPanel(x, y)) return true;
  if (dp2HitTestText(x, y)) return true;
  if (dp2HitTestBusiness(x, y)) return true;
  const hit = dp2HitTest(canvas, x, y);
  if (!hit || hit.kind !== "object" || typeof hit.index !== "number") return false;
  const obj = window.DP2_STATE?.objects?.[hit.index];
  if (!obj || !obj.type) return false;
  if (obj.type === "measure_line" || obj.type === "ridge_line") return true;
  if (obj.type === "gutter_height_dimension") return true;
  if (obj.type === "pv_panel") return true;
  if (obj.type === "circle" || obj.type === "rectangle") return true;
  return false;
}

function dp2SyncBuildingOlInteractions() {
  const pkg = window.DP2_MAP;
  if (!pkg || !pkg.map) return;
  const draw = pkg.dp2BuildingDraw;
  const mod = pkg.dp2BuildingModify;
  const snap = pkg.dp2BuildingSnap;
  if (!draw || !mod || !snap) return;
  const tool = (window.DP2_STATE && window.DP2_STATE.currentTool) || "select";
  const isOutline = tool === "building_outline";
  try {
    draw.setActive(isOutline);
  } catch (_) {}
  try {
    mod.setActive(tool === "select");
  } catch (_) {}
  try {
    snap.setActive(isOutline);
  } catch (_) {}
}

function dp2ApplyRightAngleSnapToOlPolygonCoords(coordinates) {
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return coordinates;
  const ring = coordinates[0];
  if (!Array.isArray(ring) || ring.length < 2) return coordinates;
  const lastIdx = ring.length - 1;
  const prev = ring[lastIdx - 1];
  const cur = ring[lastIdx];
  if (!Array.isArray(prev) || !Array.isArray(cur)) return coordinates;
  const snapped = dp2SnapPointForDrawing(
    { x: prev[0], y: prev[1] },
    { x: cur[0], y: cur[1] },
    { angles: [0, Math.PI / 2, Math.PI, -Math.PI / 2], threshold: Math.PI / 24 }
  );
  if (snapped && snapped.snapped === true) {
    ring[lastIdx] = [snapped.x, snapped.y];
  }
  return coordinates;
}

function dp2RightAngleSketchStyles(feature) {
  if (typeof ol === "undefined" || !feature || !feature.getGeometry) return null;
  const geom = feature.getGeometry();
  if (!geom || geom.getType() !== "Polygon") return null;
  const coords = geom.getCoordinates()?.[0];
  if (!Array.isArray(coords) || coords.length < 3) return null;
  const pts = [];
  for (const c of coords) {
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(prev[0] - c[0], prev[1] - c[1]) < 0.001) continue;
    pts.push(c);
  }
  if (pts.length < 3) return null;
  const resolution = window.DP2_MAP?.map?.getView?.().getResolution?.() || 1;
  const size = resolution * 12;
  const styles = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const v1 = { x: a[0] - b[0], y: a[1] - b[1] };
    const v2 = { x: c[0] - b[0], y: c[1] - b[1] };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 0.001 || l2 < 0.001) continue;
    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (Math.abs(angleDeg - 90) > 3) continue;
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const pA = [b[0] + u1.x * size, b[1] + u1.y * size];
    const pB = [pA[0] + u2.x * size, pA[1] + u2.y * size];
    const pC = [b[0] + u2.x * size, b[1] + u2.y * size];
    styles.push(
      new ol.style.Style({
        geometry: new ol.geom.LineString([pA, pB, pC]),
        stroke: new ol.style.Stroke({ color: "rgba(37, 99, 235, 0.62)", width: 1.15 })
      })
    );
  }
  return styles.length ? styles : null;
}

// --------------------------
// DP2 — SURVOL SÉLECTION (visuel uniquement)
// --------------------------
function dp2SketchSegmentLengthM(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const pa = dp2MapCoordToPixel(a);
  const pb = dp2MapCoordToPixel(b);
  const scale = window.DP2_STATE?.scale_m_per_px;
  if (pa && pb && typeof scale === "number" && scale > 0) {
    return Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * scale;
  }
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function dp2BuildingSketchMeasureStyles(feature) {
  if (typeof ol === "undefined" || !feature || !feature.getGeometry) return null;
  const geom = feature.getGeometry();
  if (!geom || geom.getType() !== "Polygon") return null;
  const ring = geom.getCoordinates()?.[0];
  if (!Array.isArray(ring) || ring.length < 2) return null;
  const styles = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.001) continue;
    const lenM = dp2SketchSegmentLengthM(a, b);
    if (typeof lenM !== "number" || !Number.isFinite(lenM)) continue;
    styles.push(
      new ol.style.Style({
        geometry: new ol.geom.Point([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]),
        text: new ol.style.Text({
          text: lenM.toFixed(2).replace(".", ",") + " m",
          font: "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          fill: new ol.style.Fill({ color: "#1f2937" }),
          stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.92)", width: 3 }),
          backgroundFill: new ol.style.Fill({ color: "rgba(255,255,255,0.86)" }),
          backgroundStroke: new ol.style.Stroke({ color: "rgba(30,64,175,0.24)", width: 1 }),
          padding: [2, 5, 2, 5],
          overflow: true,
          textAlign: "center",
          textBaseline: "middle"
        })
      })
    );
  }
  return styles.length ? styles : null;
}

function renderSelectionHighlight(ctx, obj) {
  if (!obj || !obj.type) return;
  // Panneaux PV : sélection + poignée rotation (sans resize)
  if (obj.type === "pv_panel") {
    const w = obj.width || 0;
    const h = obj.height || 0;
    if (!(w > 0) || !(h > 0)) return;
    const cx = (obj.x || 0) + w / 2;
    const cy = (obj.y || 0) + h / 2;
    const rot = obj.rotation || 0;
    const rotateHandleOffset = 18;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    const x = -w / 2;
    const y = -h / 2;
    // bbox
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // poignée rotation
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(0, y - rotateHandleOffset);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, y - rotateHandleOffset, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  if (obj.type === "building_outline" && obj.points && obj.points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(obj.points[0].x, obj.points[0].y);
    for (let i = 1; i < obj.points.length; i++) {
      ctx.lineTo(obj.points[i].x, obj.points[i].y);
    }
    if (obj.closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// --------------------------
// DP2 — TEXTES (annotations) : rendu + sélection
// Modèle imposé :
// { id, type:"text", textKind:"free"|"DP6"|"DP7"|"DP8", content, geometry:{x,y,width,height,rotation}, fontSize, visible:true }
// --------------------------
function dp2WrapTextLines(ctx, text, maxWidth) {
  const raw = typeof text === "string" ? text : "";
  const paragraphs = raw.split(/\r?\n/);
  const lines = [];
  const maxW = Math.max(1, maxWidth || 1);

  function pushLine(s) {
    lines.push(s);
  }

  for (const para of paragraphs) {
    const words = String(para).split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      pushLine("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      const next = cur ? (cur + " " + w) : w;
      if (ctx.measureText(next).width <= maxW) {
        cur = next;
        continue;
      }
      if (cur) pushLine(cur);
      // Mot trop long : fallback coupe caractère par caractère
      if (ctx.measureText(w).width > maxW) {
        let chunk = "";
        for (const ch of String(w)) {
          const tryChunk = chunk + ch;
          if (ctx.measureText(tryChunk).width <= maxW) {
            chunk = tryChunk;
          } else {
            if (chunk) pushLine(chunk);
            chunk = ch;
          }
        }
        cur = chunk;
      } else {
        cur = w;
      }
    }
    if (cur) pushLine(cur);
  }
  return lines;
}

function renderDP2TextObject(ctx, obj) {
  if (!obj || obj.type !== "text" || obj.visible !== true || !obj.geometry) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  const rot = g.rotation || 0;
  const fontSize = typeof obj.fontSize === "number" && obj.fontSize > 0 ? obj.fontSize : DP2_TEXT_DEFAULT_FONT_SIZE;
  const pad = Math.max(4, Math.min(10, Math.min(w, h) * 0.10));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  ctx.fillStyle = "#111827";
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = Math.max(1, w - pad * 2);
  const lineHeight = Math.max(10, fontSize * 1.2);
  let lines = dp2WrapTextLines(ctx, obj.content, maxWidth);

  const maxLines = Math.max(1, Math.floor(Math.max(1, h - pad * 2) / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    // Ellipsis simple sur la dernière ligne
    const lastIdx = lines.length - 1;
    let s = lines[lastIdx];
    while (s.length > 0 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
    lines[lastIdx] = (s || "").trimEnd() + "…";
  }

  const totalH = lines.length * lineHeight;
  let y0 = -totalH / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, y0 + i * lineHeight);
  }

  ctx.restore();
}

function renderDP2TextSelection(ctx, obj) {
  if (!obj || obj.type !== "text" || obj.visible !== true || !obj.geometry) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  const rot = g.rotation || 0;
  const rotateHandleOffset = 18;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  const x = -w / 2;
  const y = -h / 2;

  // bbox
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Poignées resize :
  // - texte libre : coins + côtés
  // - DP6/DP7/DP8 : une seule poignée (coin bas-droit)
  const kind = obj.textKind || "free";
  const isDPKind = kind === "DP6" || kind === "DP7" || kind === "DP8";
  const drawHandle = (hx, hy) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hx - 6, hy - 6, 12, 12);
    ctx.fill();
    ctx.stroke();
  };
  if (isDPKind) {
    drawHandle(x + w, y + h);
  } else {
    // Coins
    drawHandle(x, y);
    drawHandle(x + w, y);
    drawHandle(x, y + h);
    drawHandle(x + w, y + h);
    // Côtés
    drawHandle(x + w / 2, y);
    drawHandle(x + w / 2, y + h);
    drawHandle(x, y + h / 2);
    drawHandle(x + w, y + h / 2);
  }

  // poignée rotation (haut-centre)
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(0, y - rotateHandleOffset);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, y - rotateHandleOffset, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function renderDP2TextGroupSelection(ctx, textIds) {
  const ids = Array.isArray(textIds) ? textIds : [];
  if (ids.length < 2) return;
  const aabb = dp2TextsGroupAABB(ids);
  if (!aabb) return;
  const x = aabb.minX;
  const y = aabb.minY;
  const w = aabb.maxX - aabb.minX;
  const h = aabb.maxY - aabb.minY;
  if (!(w > 0) || !(h > 0)) return;

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

// --------------------------
// DP2 — RENDU FORMES MÉTIER (ÉTAPE 6)
// Modèle imposé : {id,type,legendKey,geometry:{x,y,width,height,rotation},visible:true}
// --------------------------
function renderDP2BusinessObject(ctx, obj) {
  if (!obj || obj.visible !== true || !obj.geometry || !obj.type) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(g.rotation || 0);

  const x = -w / 2;
  const y = -h / 2;

  // Style par défaut (sobre, lisible sur fond plan)
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
  ctx.fillStyle = "transparent";

  function roundedRect(rx, ry, rw, rh, r) {
    const rr = Math.max(0, Math.min(r, Math.min(rw, rh) / 2));
    ctx.beginPath();
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + rw - rr, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
    ctx.lineTo(rx + rw, ry + rh - rr);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
    ctx.lineTo(rx + rr, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
    ctx.lineTo(rx, ry + rr);
    ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
    ctx.closePath();
  }

  switch (obj.type) {
    // Batterie : rectangle BLEU (abstrait, non figuratif)
    case "batterie": {
      // Règles : 1 info = 1 couleur ; forme simple ; aucun pictogramme
      const blue = "#2563eb";
      const pad = Math.max(1.5, Math.min(4, Math.min(w, h) * 0.14));
      const stroke = Math.max(0.9, Math.min(1.6, Math.min(w, h) * 0.09));
      ctx.setLineDash([]);
      ctx.strokeStyle = blue;
      ctx.fillStyle = blue;
      ctx.lineWidth = stroke;
      ctx.beginPath();
      ctx.rect(x + pad, y + pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2));
      ctx.fill();
      ctx.stroke();
      break;
    }

    // Compteur électrique : carré VERT (abstrait, non figuratif)
    case "compteur": {
      // Règles : 1 info = 1 couleur ; forme simple ; aucun pictogramme
      const green = "#16a34a";
      const pad = Math.max(1.5, Math.min(4, Math.min(w, h) * 0.14));
      const stroke = Math.max(0.9, Math.min(1.6, Math.min(w, h) * 0.09));
      const size = Math.max(1, Math.min(w, h) - pad * 2); // carré dans le bbox
      const sx = -size / 2;
      const sy = -size / 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = green;
      ctx.fillStyle = green;
      ctx.lineWidth = stroke;
      ctx.beginPath();
      ctx.rect(sx, sy, size, size);
      ctx.fill();
      ctx.stroke();
      break;
    }

    // Disjoncteur : symbole "interdiction" vectoriel (sans emoji)
    case "disjoncteur": {
      // Symbole métier volontairement sobre : petit carré rouge, lisible sur le plan et en PDF.
      const red = "#dc2626";
      const pad = Math.max(1, Math.min(3, Math.min(w, h) * 0.16));
      const stroke = Math.max(0.8, Math.min(1.4, Math.min(w, h) * 0.08));
      const size = Math.max(1, Math.min(w, h) - pad * 2);
      const sx = -size / 2;
      const sy = -size / 2;

      ctx.setLineDash([]);
      ctx.strokeStyle = red;
      ctx.fillStyle = red;
      ctx.lineWidth = stroke;
      ctx.beginPath();
      ctx.rect(sx, sy, size, size);
      ctx.fill();
      ctx.stroke();
      break;
    }

    // Annotations géométriques
    case "rect": {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
      break;
    }
    case "circle": {
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "triangle": {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.stroke();
      break;
    }

    // Flèche libre (neutre)
    case "arrow": {
      const x1 = -w / 2;
      const x2 = w / 2;
      const yy = 0;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
      const head = Math.max(10, Math.min(18, w / 4));
      ctx.fillStyle = "rgba(17, 24, 39, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x2, yy);
      ctx.lineTo(x2 - head, yy - head * 0.55);
      ctx.lineTo(x2 - head, yy + head * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    }

    // Sens de la pente : ROUGE, flèche fine, pointe fine et allongée (évoque la gravité)
    case "sens_pente": {
      const active = dp2BusinessFramelessActiveLevel(obj);
      const red = active > 0 ? "rgba(153, 27, 27, 0.98)" : "rgba(153, 27, 27, 0.88)";
      const x1 = -w * 0.42;
      const x2 = w * 0.42;
      const yOffset = Math.min(7, Math.max(2.5, h * 0.16));
      const y1 = -yOffset;
      const y2 = yOffset;
      ctx.lineWidth = 1.25 + active * 0.35;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.strokeStyle = red;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const headLen = Math.max(9, Math.min(15, w / 4.4));
      const headHalfWidth = Math.max(2.4, Math.min(4.2, headLen * 0.22));
      ctx.beginPath();
      // Construire la pointe autour de la direction du segment (x1,y1)->(x2,y2)
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Vecteur normal (perpendiculaire) pour l'ouverture du chevron
      const nx = -uy;
      const ny = ux;
      const tipX = x2;
      const tipY = y2;
      const backX = tipX - ux * headLen;
      const backY = tipY - uy * headLen;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX + nx * headHalfWidth, backY + ny * headHalfWidth);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX - nx * headHalfWidth, backY - ny * headHalfWidth);
      ctx.stroke();
      break;
    }

    // Voie d’accès : violet pointillé, style "chemin" (pas une flèche pleine)
    case "voie_acces": {
      const active = dp2BusinessFramelessActiveLevel(obj);
      const access = active > 0 ? "rgba(30, 64, 175, 0.82)" : "rgba(75, 85, 99, 0.74)";
      const x1 = -w / 2;
      const x2 = w / 2;
      const yy = 0;
      ctx.lineWidth = 1.25 + active * 0.3;
      ctx.strokeStyle = access;
      ctx.fillStyle = "transparent";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }

    // Nord : marqueur simple SANS lettre (pas de "N" textuel)
    case "nord": {
      const pad = 10;
      const x1 = x + pad;
      const x2 = x + w - pad;
      const yy = 0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, yy);
      ctx.lineTo(x2, yy);
      ctx.stroke();
      const head = Math.max(10, Math.min(18, w / 4));
      ctx.beginPath();
      ctx.moveTo(x2, yy);
      ctx.lineTo(x2 - head, yy - head / 2);
      ctx.lineTo(x2 - head, yy + head / 2);
      ctx.closePath();
      ctx.fillStyle = "rgba(17, 24, 39, 0.95)";
      ctx.fill();
      break;
    }

    // Angle de prise de vue : cône ouvert (2 lignes divergentes) + arc intérieur (style "Solteo")
    case "angle_vue": {
      const active = dp2BusinessFramelessActiveLevel(obj);
      const a = Math.PI / 7;
      const baseX = x + Math.max(4, Math.min(8, Math.min(w, h) * 0.10));
      const baseY = 0;
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.12));
      const r = Math.max(9, Math.min(w - pad * 2, (h / 2 - pad) / Math.sin(a)));
      const dark = active > 0 ? "rgba(17, 24, 39, 0.95)" : "rgba(17, 24, 39, 0.82)";
      ctx.lineWidth = 1.05 + active * 0.25;
      ctx.setLineDash([]);
      ctx.strokeStyle = dark;
      ctx.fillStyle = "transparent";
      const ex1 = baseX + Math.cos(-a) * r;
      const ey1 = baseY + Math.sin(-a) * r;
      const ex2 = baseX + Math.cos(a) * r;
      const ey2 = baseY + Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(ex1, ey1);
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(ex2, ey2);
      ctx.stroke();
      const rArc = r * 0.66;
      ctx.beginPath();
      ctx.arc(baseX, baseY, rArc, -a, a);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(baseX, baseY, Math.max(1.5, 2.2 + active), 0, Math.PI * 2);
      ctx.fillStyle = dark;
      ctx.fill();
      break;
    }

    default: {
      // Fallback : cadre
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Survol d’une forme métier non sélectionnée (léger + transition d’apparition). */
function renderDP2BusinessHoverHighlight(ctx, obj, alphaBlend) {
  if (!obj || obj.visible !== true || !obj.geometry) return;
  const ab = typeof alphaBlend === "number" ? alphaBlend : 1;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(g.rotation || 0);
  const x = -w / 2;
  const y = -h / 2;

  if (dp2IsFramelessBusinessObject(obj.type)) {
    ctx.restore();
    return;
  }

  ctx.globalAlpha = ab;
  ctx.fillStyle = "rgba(79, 70, 229, 0.055)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(79, 70, 229, 0.36)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function renderDP2BusinessSelection(ctx, obj) {
  if (!obj || obj.visible !== true || !obj.geometry) return;
  const g = obj.geometry;
  const w = g.width || 0;
  const h = g.height || 0;
  if (!(w > 0) || !(h > 0)) return;

  const cx = g.x + w / 2;
  const cy = g.y + h / 2;
  const m = dp2GetBusinessSelectionMetrics();
  const { visualHalf, rotLine, rotVisR, sc } = m;
  const tool = window.DP2_STATE?.currentTool || "select";
  const allowHandles = isDP2BusinessTool(tool) || tool === "select";
  const st = window.DP2_STATE;
  const flash = !!(st && st._businessSelectionFlashPhase);
  const selBlend = st && st._bizSelChromeAt != null ? dp2BizUiBlend01(st._bizSelChromeAt, 100) : 1;
  const grip = dp2BizSelectionGripBlend(st, obj.id);

  const H = "#4f46e5";
  const H_DIM = "rgba(79, 70, 229, 0.92)";
  const lw = 1.22;

  ctx.save();
  ctx.translate(cx, cy);
  const gScale = 1 + 0.0065 * grip;
  ctx.scale(gScale, gScale);
  ctx.rotate(g.rotation || 0);

  const x = -w / 2;
  const y = -h / 2;

  if (dp2IsFramelessBusinessObject(obj.type)) {
    ctx.restore();
    return;
  }

  const fillA = (0.065 + 0.035 * selBlend) * (1 + 0.35 * grip);
  ctx.fillStyle = flash ? `rgba(99, 102, 241, ${0.1 + 0.06 * grip})` : `rgba(79, 70, 229, ${fillA})`;
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = "rgba(55, 48, 163, 0.08)";
  ctx.shadowBlur = flash ? 3 : 1 + grip * 2;
  ctx.strokeStyle = flash ? "#4338ca" : H;
  ctx.lineWidth = (flash ? 2.1 : 1.45) + grip * 0.65;
  ctx.globalAlpha = 0.88 + 0.12 * selBlend + 0.08 * grip;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  if (allowHandles) {
    const rCy = y - rotLine;
    const vh = visualHalf * 0.76;

    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";

    // Resize : discret (hit inchangée côté métrique)
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.strokeStyle = "rgba(79, 70, 229, 0.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x + w - vh, y + h - vh, vh * 2, vh * 2);
    ctx.fill();
    ctx.stroke();

    // Rotation : tige + arc fin + pointe nette
    ctx.strokeStyle = H_DIM;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(0, rCy + rotVisR);
    ctx.stroke();

    const startA = -Math.PI * 0.52;
    const sweep = Math.PI * 1.48;
    const endA = startA + sweep;
    ctx.lineWidth = Math.max(0.75, lw * 0.62);
    ctx.strokeStyle = H;
    ctx.beginPath();
    ctx.arc(0, rCy, rotVisR, startA, endA, false);
    ctx.stroke();

    const ax = rotVisR * Math.cos(endA);
    const ay = rCy + rotVisR * Math.sin(endA);
    const tx = -Math.sin(endA);
    const ty = Math.cos(endA);
    const nx = Math.cos(endA);
    const ny = Math.sin(endA);
    const al = Math.max(3.4, 3.6 * sc);
    const aw = Math.max(1.45, 1.65 * sc);
    ctx.lineWidth = lw;
    ctx.fillStyle = H;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + tx * al + nx * aw, ay + ty * al + ny * aw);
    ctx.lineTo(ax + tx * al - nx * aw, ay + ty * al - ny * aw);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 0.45;
    ctx.stroke();
  }

  ctx.restore();
}

// --------------------------

// DP2 map/cadastre helpers are loaded from dp-map.js before initDP2 runs.

// DP2 — INIT GLOBAL (CAPTURE MODE)
// Source de vérité UNIQUE : window.DP1_STATE.selectedParcel (geometry, section, parcelle).
// Fond : vectoriel MVT (ol/layer/VectorTile) : parcelles + bâtiments en rendu EPSG:3857.
// --------------------------
async function initDP2() {
  setDP2ModeCapture();
  dp2MvtTilesLoadingCount = 0;
  dp2MvtFeatureLogged = false;

  try {
    dp2SanitizeVersionsInPlace();
    if (typeof dp2PruneRedundantEmptyVersionsInPlace === "function" && dp2PruneRedundantEmptyVersionsInPlace()) {
      if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
    }
  } catch (_) {}

  try {
    if (typeof window.snDpVSetupPageUi === "function") {
      window.snDpVSetupPageUi("dp2", {
        onAfter: function () {
          try {
            if (typeof dp2RenderEntryPanel === "function") dp2RenderEntryPanel();
          } catch (_) {}
        },
      });
    }
  } catch (_) {}

  // UI DP2 (bouton Télécharger DP2) — même pattern que DP1
  initDP2_UIStates();

  const modal = document.getElementById("dp2-map-modal");
  if (!modal) {
    console.warn("[DP2] dp2-map-modal introuvable (HTML DP2 incomplet).");
    return;
  }

  modal.dataset.bound = "0";
  dp2TeardownMapIfAny();

  const mapEl = document.getElementById("dp2-ign-map");
  const scaleEl = document.getElementById("dp2-scale");
  const captureBtn = document.getElementById("dp2-capture-btn");

  if (!mapEl) {
    console.warn("[DP2] dp2-ign-map introuvable (page non prête).");
    return;
  }

  // UI Métadonnées DP2 (passif) : binds select catégorie + module PV
  initDP2MetadataUI();

  // Toolbar = DOM-only : initialisée dès l'injection de la page (boutons cliquables immédiatement).
  // Canvas = image-dependent : initialisé uniquement dans img.onload via initDP2Editor().
  initDP2Toolbar();
  initDP2DrawActions();
  bindDP2SelectionInspectorActions();

  function closeDP2Modal() {
    try {
      dp2SyncActiveVersionBeforeDraft();
    } catch (_) {}
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dp-lock-scroll");
    if (document.activeElement) {
      try { document.activeElement.blur(); } catch (_) {}
    }
    try {
      dp2RenderEntryPanel();
    } catch (_) {}
    try {
      if (typeof window.__snDpForceFlush === "function") {
        void window.__snDpForceFlush();
      } else if (typeof window.DpDraftStore?.forceSaveDraft === "function") {
        void window.DpDraftStore.forceSaveDraft();
      } else if (typeof window.__snDpPersistDebounced === "function") {
        window.__snDpPersistDebounced("fast");
      }
    } catch (_) {}
  }

  window.dp2CloseMapModal = closeDP2Modal;

  function openDP2Modal() {
    dp2EnsureVersionRowBeforeEdit();
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("dp-lock-scroll");
    try {
      const planCap =
        typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
      const hasPlan = !!(planCap && planCap.imageBase64);
      const mapWrap = document.getElementById("dp2-ign-map");
      const imgWrap = document.getElementById("dp2-captured-image-wrap");
      if (hasPlan) {
        if (mapWrap) {
          mapWrap.style.display = "";
          mapWrap.style.pointerEvents = "none";
        }
        if (imgWrap) imgWrap.style.display = "block";
      } else {
        if (mapWrap) {
          mapWrap.style.display = "";
          mapWrap.style.pointerEvents = "";
        }
        if (imgWrap) imgWrap.style.display = "none";
      }
    } catch (_) {}

    // Créer la map uniquement après que le modal soit visible (conteneur avec taille réelle)
    requestAnimationFrame(async () => {
      await ensureDP2MapReady();
      if (window.DP2_MAP?.map) {
        await dp2SyncOpenLayersSizeToContainer(window.DP2_MAP.map);
      }
      try {
        const m = window.DP2_MAP?.map || null;
        if (m) {
          try { m.updateSize(); } catch (_) {}
          try { m.renderSync(); } catch (_) {}
          requestAnimationFrame(() => { try { m.renderSync(); } catch (_) {} });
        }
      } catch (_) {}
      syncDP2LegendOverlayUI();
    });
  }

  window.dp2OpenMapModal = openDP2Modal;

  async function ensureDP2MapReady() {
    if (window.__DP2_INIT_DONE === true && window.DP2_MAP?.map) return;

    const selectedParcel = window.DP1_STATE?.selectedParcel || null;
    let usedParcelGeometry = false;
    let geom = null;

    // ——— Grille de résolution (EPSG:3857) — même pas de WMTS raster pour DP2
    // fond DP2 = rendu vectoriel MVT (ol/layer/VectorTile) uniquement
    // ———
    // Origine WebMercator (EPSG:3857) : valeur plus précise que -20037508 (évite décalage de tuiles).
    const WMTS_ORIGIN = [-20037508.342789244, 20037508.342789244];
    const WMTS_RESOLUTIONS = [
      156543.03392804103, 78271.51696402051, 39135.75848201024,
      19567.87924100512, 9783.93962050256, 4891.96981025128,
      2445.98490512564, 1222.99245256282, 611.49622628141,
      305.748113140705, 152.8740565703525, 76.43702828517625,
      38.21851414258813, 19.109257071294063, 9.554628535647032,
      4.777314267823516, (2.3 + 0.088657133911758), 1.194328566955879,
      0.5971642834779395, 0.29858214173896974, 0.14929107086948487
    ];
    const DP2_MAPTILER_EXTRA_RESOLUTIONS = [
      0.07464553543474244,
      0.03732276771737122,
      0.01866138385868561
    ];
    const DP2_MAP_RESOLUTIONS = WMTS_RESOLUTIONS.concat(DP2_MAPTILER_EXTRA_RESOLUTIONS);
    window.__DP_WMTS_RESOLUTIONS_PM = DP2_MAP_RESOLUTIONS;
    const WMTS_MATRIX_IDS = WMTS_RESOLUTIONS.map((_, i) => String(i));
    const wmtsGridPM = new ol.tilegrid.WMTS({
      origin: WMTS_ORIGIN,
      resolutions: WMTS_RESOLUTIONS,
      matrixIds: WMTS_MATRIX_IDS
    });

    const centerParis = fromLonLat([2.3488, 48.8534]);
    const view = new ol.View({
      projection: "EPSG:3857",
      center: centerParis,
      resolutions: DP2_MAP_RESOLUTIONS,
      constrainResolution: true,
      enableRotation: false
    });

    const map = new ol.Map({
      target: mapEl,
      layers: [],
      view,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      moveTolerance: 2,
      maxTilesLoading: 16
    });

    // --------------------------
    // DP2 — Fond de carte MapTiler via style.json (ol-mapbox-style)
    // --------------------------
    let dp2CadastreVectorTileSource = null;
    let dp2CadastreVectorTileLayer = null;
    let dp2MapTilerRasterSource = null;
    let dp2MapTilerRasterLayer = null;
    let dp2DirectMvtTestSource = null;
    let dp2DirectMvtTestLayer = null;
    let dp2OfficialCadastreWfsSource = null;
    let dp2OfficialCadastreWfsLayer = null;
    const dp2BaseMapResult = await dp2ApplyMapTilerStyleOrFallback(map, wmtsGridPM);
    const dp2BaseMapProvider = dp2BaseMapResult.provider;
    const dp2BaseMapError = dp2BaseMapResult.error;

    // --------------------------
    // DP2 — Couche WFS officielle (plan DP final propre) : par défaut cachée
    // --------------------------
    try {
      dp2OfficialCadastreWfsSource = new ol.source.Vector({ wrapX: false });
      dp2OfficialCadastreWfsLayer = new ol.layer.Vector({
        source: dp2OfficialCadastreWfsSource,
        style: dp2OfficialCadastreWfsParcelStyle,
        zIndex: 11,
        visible: false,
      });
      // IMPORTANT: pas d'attachement permanent à la carte en mode affichage DP2.
      // Cette couche WFS est utilisée uniquement dans le pipeline PDF.
    } catch (e) {
      console.warn("[DP2 WFS] impossible d'initialiser la couche WFS :", e);
    }

    const dp2BuildingVectorSource = new ol.source.Vector({ wrapX: false });
    const dp2BuildingVectorLayer = new ol.layer.Vector({
      source: dp2BuildingVectorSource,
      zIndex: 120,
      style: function (feature) {
        const g = feature.getGeometry();
        if (!g) return [];
        const gt = g.getType();
        const fid = feature.get("dp2FeatureId");
        const activeId = window.DP2_STATE?.selectedBuildingContourId;
        const active = fid != null && activeId != null && String(fid) === String(activeId);
        if (gt === "Polygon") {
          return [
            new ol.style.Style({
              fill: new ol.style.Fill({
                color: active ? "rgba(30, 64, 175, 0.08)" : "rgba(30, 64, 175, 0.04)"
              }),
              stroke: new ol.style.Stroke({
                color: "#1e40af",
                width: active ? 2.4 : 2
              })
            })
          ];
        }
        if (gt === "LineString") {
          return [
            new ol.style.Style({
              stroke: new ol.style.Stroke({
                color: "#1e40af",
                width: active ? 2.4 : 2
              })
            })
          ];
        }
        return [];
      }
    });
    map.addLayer(dp2BuildingVectorLayer);

    try {
      dp2SanitizeDp2BaseLayers(map);
      dp2LogDp2LayerAudit(map);
    } catch (_) {}

    if (selectedParcel && selectedParcel.geometry) {
      try {
        const geoJsonFormat = new ol.format.GeoJSON();
        geom = geoJsonFormat.readGeometry(selectedParcel.geometry, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857"
        });
        if (!geom) throw new Error("readGeometry retourne null");
        const extent = geom.getExtent();
        view.fit(extent, {
          padding: [40, 40, 40, 40],
          maxZoom: 22
        });
        usedParcelGeometry = true;
      } catch (e) {
        console.warn("[DP2] Géométrie parcelle invalide", e);
        geom = null;
        usedParcelGeometry = false;
      }
    }

    if (!usedParcelGeometry) {
      if (!selectedParcel || !selectedParcel.geometry) {
        console.warn("[DP2] Parcelle absente → fallback carte centrée sur adresse");
      }
      const d1 = window.DP1_CONTEXT;
      const ok = d1 && dp2CenterMapViewOnLatLon(view, d1.lat, d1.lon, DP2_MAP_RESOLUTIONS);
      if (!ok) {
        console.warn("[DP2] Pas de coordonnées CRM — centre par défaut (Île-de-France).");
      }
    }

    try {
      applySafeInitialResolution(map, view.getResolution(), DP2_MAP_RESOLUTIONS);
    } catch (_) {}

    const dp2NeighborParcelsSource = new ol.source.Vector();
    window.DP2_MAP = {
      map,
      planSource: null,
      planTileLayer: null,
      mvtSource: dp2CadastreVectorTileSource,
      mvtTileLayer: dp2CadastreVectorTileLayer,
      mapTilerRasterSource: dp2MapTilerRasterSource,
      mapTilerRasterLayer: dp2MapTilerRasterLayer,
      baseMapFallbackLayer: dp2BaseMapResult.fallbackLayer,
      baseMapProvider: dp2BaseMapProvider,
      baseMapError: dp2BaseMapError,
      directMvtTestSource: dp2DirectMvtTestSource,
      directMvtTestLayer: dp2DirectMvtTestLayer,
      neighborParcelsSource: dp2NeighborParcelsSource,
      dp2OfficialCadastreWfsSource,
      dp2OfficialCadastreWfsLayer,
      dp2BuildingVectorSource,
      dp2BuildingVectorLayer,
      vectorProvider: dp2CadastreVectorTileSource ? "maptiler-or-fallback" : dp2BaseMapProvider
    };

    if (usedParcelGeometry && geom && selectedParcel) {
      var __dp2ParcelLabel =
        selectedParcel.parcel != null && String(selectedParcel.parcel).trim()
          ? String(selectedParcel.parcel).trim()
          : selectedParcel.numero != null && String(selectedParcel.numero).trim()
            ? String(selectedParcel.numero).trim()
            : "";

      function __dp2ParcelCentroidPointGeometry(feature) {
        var g = feature.getGeometry();
        return dp2OlGeometryCentroidPoint(g);
      }

      const parcelSource = new ol.source.Vector();
      const parcelFeature = new ol.Feature({ geometry: geom });
      parcelSource.addFeature(parcelFeature);
      const parcelVectorLayer = new ol.layer.Vector({
        source: parcelSource,
        zIndex: 200,
        declutter: true,
        style: function (feature, resolution) {
          const pxStrokeWidth = resolution == null || !Number.isFinite(resolution) ? 0.8 : resolution < 1 ? 1 : 0.75;
          var styles = [
            new ol.style.Style({
              fill: new ol.style.Fill({ color: "rgba(0, 0, 0, 0)" }), // remplissage transparent
              stroke: new ol.style.Stroke({
                color: "#2F80ED",
                width: pxStrokeWidth,
                lineJoin: "round",
                lineCap: "round",
              }),
            }),
          ];
          if (__dp2ParcelLabel) {
            styles.push(
              new ol.style.Style({
                geometry: function (feat) {
                  return __dp2ParcelCentroidPointGeometry(feat);
                },
                text: new ol.style.Text({
                  text: __dp2ParcelLabel,
                  font: dp2ParcelPrimaryLabelFontCSS(resolution),
                  fill: new ol.style.Fill({ color: "#374151" }),
                  stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.55)", width: 1 }),
                  overflow: true,
                  textAlign: "center",
                  textBaseline: "middle"
                })
              })
            );
          }
          return styles;
        }
      });
      map.addLayer(parcelVectorLayer);
      window.DP2_MAP.parcelVectorLayer = parcelVectorLayer;

      if (scaleEl) {
        const res = view.getResolution();
        scaleEl.textContent = res ? `Échelle : résolution ${res.toFixed(2)}` : "Échelle : —";
      }
      view.on("change:resolution", () => {
        parcelVectorLayer.changed();
        if (scaleEl) {
          const res = view.getResolution();
          scaleEl.textContent = res ? `Échelle : résolution ${res.toFixed(2)}` : "Échelle : —";
        }
      });
    } else {
      if (scaleEl) {
        const res = view.getResolution();
        scaleEl.textContent = res ? `Échelle : résolution ${res.toFixed(2)}` : "Échelle : —";
      }
      view.on("change:resolution", () => {
        if (scaleEl) {
          const res = view.getResolution();
          scaleEl.textContent = res ? `Échelle : résolution ${res.toFixed(2)}` : "Échelle : —";
        }
      });
    }

    try {
      if (window.__dp2MapResizeObs) {
        window.__dp2MapResizeObs.disconnect();
        window.__dp2MapResizeObs = null;
      }
      if (typeof ResizeObserver !== "undefined" && mapEl) {
        window.__dp2MapResizeObs = new ResizeObserver(function () {
          if (window.DP2_MAP && window.DP2_MAP.map) {
            try {
              window.DP2_MAP.map.updateSize();
            } catch (_) {}
          }
        });
        window.__dp2MapResizeObs.observe(mapEl);
      }
    } catch (_) {}

    const dp2BuildingDraw = new ol.interaction.Draw({
      source: dp2BuildingVectorSource,
      type: "Polygon",
      geometryFunction: function (coordinates, geometry) {
        const snappedCoords = dp2ApplyRightAngleSnapToOlPolygonCoords(coordinates);
        if (!geometry) geometry = new ol.geom.Polygon(snappedCoords);
        else geometry.setCoordinates(snappedCoords);
        return geometry;
      },
      style: function (feature) {
        const styles = [
          new ol.style.Style({
            fill: new ol.style.Fill({ color: "rgba(30, 64, 175, 0.08)" }),
            stroke: new ol.style.Stroke({ color: "#1e40af", width: 2.0 }),
            image: new ol.style.Circle({
              radius: 4,
              fill: new ol.style.Fill({ color: "rgba(255,255,255,0)" }),
              stroke: new ol.style.Stroke({ color: "#1e40af", width: 2 })
            })
          })
        ];
        const rightAngleStyles = dp2RightAngleSketchStyles(feature);
        if (rightAngleStyles) styles.push(...rightAngleStyles);
        const measureStyles = dp2BuildingSketchMeasureStyles(feature);
        if (measureStyles) styles.push(...measureStyles);
        return styles;
      }
    });
    dp2BuildingDraw.setActive(false);
    dp2BuildingDraw.on("drawend", function (evt) {
      try {
        const geom = evt.feature && evt.feature.getGeometry();
        if (!geom || geom.getType() !== "Polygon") return;
        const ring = geom.getCoordinates()[0];
        if (!Array.isArray(ring) || ring.length < 4) return;
        dp2BuildingVectorSource.removeFeature(evt.feature);
        window.DP2_STATE = window.DP2_STATE || {};
        dp2EnsureFeaturesArray();
        const id = typeof dp2NewBuildingContourId === "function" ? dp2NewBuildingContourId() : "f_" + Date.now();
        window.DP2_STATE.features.push({
          id,
          type: "polygon",
          closed: true,
          coordinates: dp2StripClosingCoordinate(ring)
        });
        window.DP2_STATE.selectedBuildingContourId = id;
        if (window.__SN_DP_DP2_AUDIT__ === true) {
          try {
            console.log("[DP2 DRAW FEATURE]", { id: id, type: "polygon", closed: true, coordinates: ring });
          } catch (_) {}
        }
        try {
          if (typeof dp2CommitHistoryPoint === "function") dp2CommitHistoryPoint();
        } catch (_) {}
        try {
          dp2RenderFeaturesOL();
        } catch (_) {}
        try {
          dp2RebuildContourDisplayCacheFromFeatures();
        } catch (_) {}
        try {
          dp2EnterSelectToolAfterBuildingOlComplete();
        } catch (_) {}
        try {
          dp2SyncBuildingOlInteractions();
        } catch (_) {}
        try {
          dp2SyncBuildingOlPointerPassThrough();
        } catch (_) {}
        try {
          renderDP2FromState();
        } catch (_) {}
      } catch (err) {
        console.warn("[DP2] drawend", err);
      }
    });

    const dp2BuildingModify = new ol.interaction.Modify({
      source: dp2BuildingVectorSource,
      pixelTolerance: 6,
      snapToPointer: false
    });
    dp2BuildingVectorSource.on("changefeature", function (evt) {
      try {
        dp2RequestBuildingGeometryCanvasRefresh(evt.feature);
      } catch (_) {}
    });
    dp2BuildingModify.on("modifystart", function () {
      try {
        const snap = window.DP2_MAP?.dp2BuildingSnap;
        if (snap && typeof snap.setActive === "function") snap.setActive(false);
      } catch (_) {}
      window.__DP2_TEMP_OL_DRAG__ = true;
      try {
        dp2SyncBuildingOlPointerPassThrough();
      } catch (_) {}
    });
    dp2BuildingModify.on("modifyend", function (evt) {
      try {
        const col = evt.features;
        if (!col) return;
        const list = typeof col.getArray === "function" ? col.getArray() : Array.isArray(col) ? col : [];
        for (let fi = 0; fi < list.length; fi++) {
          const f = list[fi];
          const geom = f.getGeometry();
          if (!geom) continue;
          const gt = geom.getType();
          let coords = null;
          if (gt === "Polygon") coords = geom.getCoordinates()[0];
          else if (gt === "LineString") coords = geom.getCoordinates();
          if (!coords) continue;
          const id0 = f.getId() != null ? f.getId() : f.get("dp2FeatureId");
          if (id0 == null) continue;
          const id = String(id0);
          const target = (window.DP2_STATE.features || []).find(function (x) {
            return x && String(x.id) === id;
          });
          if (target) {
            target.coordinates = gt === "Polygon" ? dp2StripClosingCoordinate(coords) : coords;
            if (gt === "Polygon") target.closed = true;
            try {
              delete target.cuts;
            } catch (_) {
              target.cuts = undefined;
            }
          }
        }
        if (list.length === 0 && typeof col.forEach === "function") {
          col.forEach(function (f) {
            const geom = f.getGeometry();
            if (!geom) return;
            const gt = geom.getType();
            let coords = null;
            if (gt === "Polygon") coords = geom.getCoordinates()[0];
            else if (gt === "LineString") coords = geom.getCoordinates();
            if (!coords) return;
            const id0 = f.getId() != null ? f.getId() : f.get("dp2FeatureId");
            if (id0 == null) return;
            const id = String(id0);
            const target = (window.DP2_STATE.features || []).find(function (x) {
              return x && String(x.id) === id;
            });
            if (target) {
              target.coordinates = gt === "Polygon" ? dp2StripClosingCoordinate(coords) : coords;
              if (gt === "Polygon") target.closed = true;
              try {
                delete target.cuts;
              } catch (_) {
                target.cuts = undefined;
              }
            }
          });
        }
        if (window.__SN_DP_DP2_AUDIT__ === true) {
          try {
            console.log("[DP2 MODIFY]");
          } catch (_) {}
        }
        try {
          if (typeof dp2CommitHistoryPoint === "function") dp2CommitHistoryPoint();
        } catch (_) {}
        try {
          dp2RenderFeaturesOL();
        } catch (_) {}
        try {
          dp2RebuildContourDisplayCacheFromFeatures();
        } catch (_) {}
        try {
          dp2RebuildRidgeCutsForAllContours();
        } catch (_) {}
        try {
          renderDP2FromState();
        } catch (_) {}
      } catch (err2) {
        console.warn("[DP2] modifyend", err2);
      } finally {
        window.__DP2_TEMP_OL_DRAG__ = false;
        try {
          dp2SyncBuildingOlInteractions();
        } catch (_) {}
        try {
          dp2SyncBuildingOlPointerPassThrough();
        } catch (_) {}
      }
    });

    const dp2BuildingSnap = new ol.interaction.Snap({ source: dp2BuildingVectorSource });

    map.addInteraction(dp2BuildingDraw);
    map.addInteraction(dp2BuildingModify);
    map.addInteraction(dp2BuildingSnap);

    window.DP2_MAP.dp2BuildingDraw = dp2BuildingDraw;
    window.DP2_MAP.dp2BuildingModify = dp2BuildingModify;
    window.DP2_MAP.dp2BuildingSnap = dp2BuildingSnap;

    try {
      dp2SyncBuildingOlInteractions();
    } catch (_) {}

    window.__DP2_INIT_DONE = true;
    console.log(
      "[DP2] Mode CAPTURE prêt (fond vectoriel MVT)" +
        (usedParcelGeometry ? " + parcelle vectorielle" : " — vue sans parcelle (fallback adresse CRM)") +
        ")."
    );
  }

  if (modal.dataset.dp2ModalChromeBound !== "1") {
    modal.dataset.dp2ModalChromeBound = "1";
    modal.dataset.bound = "1";
    if (captureBtn) {
      captureBtn.addEventListener("click", async () => {
        await captureDP2Map();
      });
    }
    modal.addEventListener("click", (e) => {
      if (
        e.target.closest(".dp-modal-close") ||
        e.target.closest("#dp2-map-cancel") ||
        e.target.classList?.contains?.("dp-modal-backdrop")
      ) {
        e.preventDefault();
        closeDP2Modal();
        return;
      }
    });
  }

  const dp2PageEl = document.getElementById("dp2-page");
  if (dp2PageEl && dp2PageEl.dataset.dp2EntryBound !== "1") {
    dp2PageEl.dataset.dp2EntryBound = "1";
    document.getElementById("dp2-btn-create-plan")?.addEventListener("click", dp2OnEntryCreateFirstPlan);
    document.getElementById("dp2-btn-continue")?.addEventListener("click", dp2OnEntryContinue);
    document.getElementById("dp2-btn-collapse-versions")?.addEventListener("click", async function (e) {
      e.preventDefault();
      if (
        !(await window.__snDpConfirm(
          "Toutes les versions du menu seront supprimées sauf celle qui correspond au plan actuellement affiché à l’écran. Continuer ?",
          {
            title: "Nettoyer les versions DP2",
            confirmLabel: "Continuer",
            cancelLabel: "Annuler",
          }
        ))
      ) {
        return;
      }
      if (typeof window.dp2CollapseVersionsToSingleActive === "function") {
        void window.dp2CollapseVersionsToSingleActive();
      }
    });
    try {
      dp2UpdateRepairHintVisibility();
    } catch (_) {}
  }

  // ESC : fermeture overlay DP2 (ne pas toucher aux autres ESC, ex: menus)
  if (window.__DP2_MODAL_ESC_BOUND !== true) {
    window.__DP2_MODAL_ESC_BOUND = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Toujours cibler le modal courant (si la page DP2 est ré-injectée)
      const m = document.getElementById("dp2-map-modal");
      if (!m || m.getAttribute("aria-hidden") !== "false") return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.dp2CloseMapModal === "function") {
        window.dp2CloseMapModal();
      } else {
        m.setAttribute("aria-hidden", "true");
        document.body.classList.remove("dp-lock-scroll");
        if (document.activeElement) {
          try { document.activeElement.blur(); } catch (_) {}
        }
      }
    });
  }

  try {
    dp2RenderEntryPanel();
  } catch (_) {}
  if (window.DP2_UI?.setState) {
    window.DP2_UI.setState(dp2GetCapturePlan()?.imageBase64 ? "GENERATED" : "EMPTY");
  }
  if (dp2GetCapturePlan()?.imageBase64) {
    dp2BootstrapEditorDomFromWorking();
  }
}

// --------------------------
// DP2 — CAPTURE MAP (PLAN DE MASSE)
// --------------------------
/**
 * Capture plan de masse (IGN plan) : centre, résolution, rotation, image — pour alignement DP4 uniquement.
 * Migration : anciens brouillons avec seulement `capture` (sans `capture_plan`).
 */
function dp2GetCapturePlan() {
  const s = window.DP2_STATE;
  if (!s || typeof s !== "object") return null;
  if (s.editorProfile === "DP4_ROOF" && window.DP4_STATE) {
    const ortho = window.DP4_STATE.capture_ortho || window.DP4_STATE.capture;
    if (ortho && typeof ortho === "object" && ortho.imageBase64) return ortho;
  }
  const plan = s.capture_plan;
  if (plan && typeof plan === "object" && plan.imageBase64) return plan;
  const legacy = s.capture;
  if (legacy && typeof legacy === "object" && legacy.imageBase64) return legacy;
  return plan || null;
}

/** Aligne map.getSize() sur la boîte réelle du conteneur (#dp2-ign-map) puis attend un rendu stable. */
async function dp2SyncOpenLayersSizeToContainer(map) {
  const el = map.getTargetElement();
  if (!el) return;
  map.updateSize();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const w = Math.max(1, Math.round(el.clientWidth));
  const h = Math.max(1, Math.round(el.clientHeight));
  const sz = map.getSize();
  if (!sz || sz[0] !== w || sz[1] !== h) {
    map.setSize([w, h]);
  }
  map.renderSync();
  await new Promise((resolve) => {
    map.once("rendercomplete", resolve);
    map.renderSync();
  });
}

/** Remet #dp2-ign-map en frère de #dp2-captured-image-wrap (mode capture / teardown). */
function dp2RestoreMapNodeToWrapForCapture() {
  const mapEl = document.getElementById("dp2-ign-map");
  const wrap = document.querySelector(".dp2-map-wrap");
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  if (!mapEl || !wrap) return;
  if (mapEl.parentElement === wrap) return;
  if (imgWrap && wrap.contains(imgWrap)) {
    wrap.insertBefore(mapEl, imgWrap);
  } else {
    wrap.insertBefore(mapEl, wrap.firstChild);
  }
}

/** Carte OpenLayers sous l’image + canvas (plan figé + bâti vectoriel). */
function dp2MountOlMapUnderCanvasIfNeeded() {
  const zig = document.getElementById("dp2-zoom-container");
  const mapEl = document.getElementById("dp2-ign-map");
  if (!zig || !mapEl || !window.DP2_MAP?.map) return;
  if (!zig.contains(mapEl)) {
    zig.insertBefore(mapEl, zig.firstChild);
  }
}

function dp2ApplyCaptureViewToMapForEdition() {
  const map = window.DP2_MAP?.map;
  const cap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : null;
  if (!map || !cap) return;
  const view = map.getView();
  if (!view) return;
  try {
    if (cap.rotation != null && Number.isFinite(cap.rotation)) view.setRotation(cap.rotation);
  } catch (_) {}
  if (cap.center != null) {
    const c = cap.center;
    const cx = Array.isArray(c) ? c[0] : c.x;
    const cy = Array.isArray(c) ? c[1] : c.y;
    if (Number.isFinite(cx) && Number.isFinite(cy)) view.setCenter([cx, cy]);
  }
  if (cap.resolution != null && Number.isFinite(cap.resolution)) {
    try {
      view.setResolution(cap.resolution);
    } catch (_) {}
  } else if (typeof cap.zoom === "number" && Number.isFinite(cap.zoom)) {
    try {
      view.setZoom(cap.zoom);
    } catch (_) {}
  }
}

/** Après capture ou init éditeur : taille OL, vue figée, tuiles masquées, bâti vectoriel. */
function dp2SyncEditionOlMapLayoutSync() {
  const map = window.DP2_MAP?.map;
  const cap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : null;
  if (!map || !cap?.imageBase64) return;
  try {
    dp2MountOlMapUnderCanvasIfNeeded();
    map.updateSize();
    map.renderSync();
  } catch (_) {}
  try {
    dp2ApplyCaptureViewToMapForEdition();
  } catch (_) {}
  try {
    if (window.DP2_MAP?.mvtTileLayer) window.DP2_MAP.mvtTileLayer.setVisible(false);
  } catch (_) {}
  try {
    if (window.DP2_MAP?.parcelVectorLayer) window.DP2_MAP.parcelVectorLayer.setVisible(false);
  } catch (_) {}
  try {
    dp2RenderFeaturesOL();
  } catch (_) {}
}

async function captureDP2Map() {
  if (!window.DP2_MAP || !window.DP2_MAP.map) {
    console.warn("[DP2] Map DP2 introuvable pour capture");
    return;
  }

  try {
    dp2RestoreMapNodeToWrapForCapture();
  } catch (_) {}
  try {
    if (window.DP2_MAP.mvtTileLayer) window.DP2_MAP.mvtTileLayer.setVisible(true);
  } catch (_) {}
  try {
    if (window.DP2_MAP.parcelVectorLayer) window.DP2_MAP.parcelVectorLayer.setVisible(true);
  } catch (_) {}

  const map = window.DP2_MAP.map;
  const view = map.getView();
  const mapEl = map.getTargetElement();

  lockDPView({ map });

  await dp2SyncOpenLayersSizeToContainer(map);

  if (window.DP2_MAP.mvtSource) {
    // Sécurité : évite une résolution immédiate si les events tileload ne démarrent pas au moment exact.
    dp2MvtTilesLoadingCount = Math.max(1, dp2MvtTilesLoadingCount);
    await waitMvtTilesIdle(2800);
  }

  await dp2SyncOpenLayersSizeToContainer(map);

  await new Promise((resolve) => {
    map.once("rendercomplete", resolve);
    map.renderSync();
  });
  await new Promise((r) => requestAnimationFrame(() => r()));

  const wPx = Math.max(1, Math.round(mapEl.clientWidth));
  const hPx = Math.max(1, Math.round(mapEl.clientHeight));
  let size = map.getSize();
  if (!size || size[0] !== wPx || size[1] !== hPx) {
    map.setSize([wPx, hPx]);
    map.renderSync();
    await new Promise((resolve) => {
      map.once("rendercomplete", resolve);
      map.renderSync();
    });
    size = map.getSize();
  }
  if (!size || size[0] < 1 || size[1] < 1) {
    console.warn("[DP2] Taille de map inconnue");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext("2d");

  // Fond blanc (comme DP1) : évite transparence / halos si une couche WMTS a des zones vides.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const canvases = mapEl.querySelectorAll(".ol-layer canvas");
  canvases.forEach((c) => {
    if (c.width > 0 && c.height > 0) {
      ctx.save();
      const opacity = c.parentNode.style.opacity;
      ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
      const transform = c.style.transform;
      if (transform) {
        const m = transform.match(/^matrix\(([^\(]*)\)$/);
        if (m) {
          const matrix = m[1].split(",").map(Number);
          ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        }
      }
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    }
  });

  // ✅ Rose des vents (même asset/style que DP1) : doit être intégrée à l'image capturée
  // Important : cibler spécifiquement l'arrow du modal DP2 (DP1 a aussi une .dp1-north-arrow).
  try {
    const modal = document.getElementById("dp2-map-modal");
    const arrow = modal ? modal.querySelector(".dp1-north-arrow") : null;
    if (arrow) {
      // S'assure que l'image est décodée avant drawImage (sinon: pas de rose des vents dans le PNG)
      if (!(arrow.complete && arrow.naturalWidth > 0)) {
        await Promise.race([
          new Promise((resolve) => { arrow.onload = resolve; arrow.onerror = resolve; }),
          new Promise((resolve) => setTimeout(resolve, 1200))
        ]);
      }

      if (arrow.complete && arrow.naturalWidth > 0) {
        const r = arrow.getBoundingClientRect();
        const mr = mapEl.getBoundingClientRect();
        // On dessine l'image à la position relative au conteneur OpenLayers (#dp2-ign-map)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(
          arrow,
          r.left - mr.left,
          r.top - mr.top,
          r.width,
          r.height
        );
      }
    }
  } catch (_) {}

  const imageBase64 = canvas.toDataURL("image/png");

  // Données métriques
  const resolution = view.getResolution(); // unités projetées / px (Web Mercator : pas m/px au sol)
  const rotation = view.getRotation(); // radians
  const center = view.getCenter();
  const zoom = view.getZoom();

  let extent3857 = null;
  try {
    extent3857 = view.calculateExtent(size);
  } catch (_) {}

  // ✅ OBLIGATOIRE : width/height + centre/zoom/rotation pour capture_preview (alignement vue DP4 sur DP2).
  window.DP2_STATE.capture_plan = {
    imageBase64,
    resolution,
    rotation,
    center,
    zoom,
    width: size[0],
    height: size[1],
    extent3857,
    capturedAt: Date.now()
  };

  /** Aperçu figé de la vue (DP4 aligne la carte ortho sur ces valeurs). */
  window.DP2_STATE.capture_preview = {
    center: center ? center.slice() : null,
    zoom: typeof zoom === "number" && Number.isFinite(zoom) ? zoom : null,
    rotation: typeof rotation === "number" && Number.isFinite(rotation) ? rotation : 0
  };

  console.log("[DP2] Capture plan (masse) enregistrée", window.DP2_STATE.capture_plan);

  // ⚠️ ÉTAPE 2 : CALCULER ET FIGER L'ÉCHELLE (UNE SEULE FOIS, IMMUTABLE)
  // En EPSG:3857 (Web Mercator), view.getResolution() donne des m/px à l'équateur uniquement.
  // Au sol (à la latitude du centre), 1 px représente une autre distance : il faut
  // getPointResolution(..., "m") pour obtenir le vrai m/px au centre de la vue.
  // Utiliser scale_m_per_px (pas scale) comme source de vérité unique.
  // Si scale_m_per_px est déjà défini, ne pas l'écraser
  if (window.DP2_STATE.scale_m_per_px == null) {
    const scale_m_per_px = ol.proj.getPointResolution(
      map.getView().getProjection(),
      map.getView().getResolution(),
      map.getView().getCenter(),
      "m"
    );
    window.DP2_STATE.scale_m_per_px = scale_m_per_px;
    console.log("[DP2] scale_m_per_px (ground) =", scale_m_per_px, "m/px");
  } else {
    console.log("[DP2] Échelle déjà figée (ignorée) :", window.DP2_STATE.scale_m_per_px, "m / px");
  }

  // ⚠️ ÉTAPE 3 : VERROUILLER DÉFINITIVEMENT LA CARTE APRÈS CAPTURE
  // Désactiver TOUTES les interactions OpenLayers (zoom, pan, scroll, drag)
  map.getInteractions().forEach(i => i.setActive(false));
  console.log("[DP2] Toutes les interactions OpenLayers désactivées");

  // Carte conservée (sous le canvas) : bâti vectoriel + getCoordinateFromPixel alignés sur la capture
  const mapWrap = document.getElementById("dp2-ign-map");
  if (mapWrap) {
    mapWrap.style.display = "";
    mapWrap.style.pointerEvents = "none";
  }

  // Éviter la double rose des vents : elle est maintenant "baked" dans l'image capturée
  try {
    const modal = document.getElementById("dp2-map-modal");
    const arrow = modal ? modal.querySelector(".dp1-north-arrow") : null;
    if (arrow) arrow.style.display = "none";
  } catch (_) {}

  // Afficher l'image capturée comme fond figé
  const imgWrap = document.getElementById("dp2-captured-image-wrap");
  const imgEl = document.getElementById("dp2-captured-image");

  if (imgWrap && imgEl) {
    // Timing image → canvas : n'appeler initDP2Editor qu'une fois l'image
    // entièrement chargée (naturalWidth/naturalHeight > 0), sinon le canvas
    // est initialisé en 0×0 et ne reçoit aucun clic.
    imgEl.onload = function () {
      initDP2Editor();
    };
    imgEl.src = imageBase64;
    imgWrap.style.display = "block";
  } else {
    initDP2Editor();
  }

  const imgElStyle = document.getElementById("dp2-captured-image");
  if (imgElStyle) {
    imgElStyle.style.pointerEvents = "none";
    imgElStyle.style.userSelect = "none";
    imgElStyle.style.transform = "none";
    imgElStyle.style.maxWidth = "100%";
    imgElStyle.style.height = "auto";
  }

  // ⚠️ ÉTAPE 4 : PASSER EN MODE ÉDITION
  setDP2ModeEdition();

  // optionnel : passer l’état UI en GENERATED (bouton Télécharger DP2)
  if (window.DP2_UI?.setState) {
    window.DP2_UI.setState("GENERATED");
  }
  if (typeof window.__snDpAfterCaptureDp2 === "function") {
    try {
      window.__snDpAfterCaptureDp2();
    } catch (err) {
      console.warn("[DP2] draft hook", err);
    }
  }

  try {
    dp2EnsureVersionRowBeforeEdit();
    dp2SyncActiveVersionBeforeDraft();
    dp2RenderEntryPanel();
  } catch (_) {}
}
