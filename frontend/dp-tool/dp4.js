// Extracted from dp-app.js. Loaded after dp-app.js in legacy script order.
// ======================================================
// DP4 — PLAN DE TOITURE (UI ONLY)
// ======================================================

// DP4 : export minimal (format DP2 interne) -> DP4_STATE[cat]
function dp4SyncRoofGeometryFromDP2State() {
  if (!dp2IsDP4RoofProfile()) return;
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  const cat = window.DP4_STATE?.photoCategory ?? window.DP2_STATE?.photoCategory ?? null;
  if (cat !== "before" && cat !== "after") return;
  const stateCat = window.DP4_STATE[cat];
  if (!stateCat) return;
  const objects = window.DP2_STATE?.objects || [];

  // A. Contours bâti : priorité DP2_STATE.features (EPSG:3857 → pixels plan) ; fallback cache buildingContours
  const feats3857 = Array.isArray(window.DP2_STATE?.features) ? window.DP2_STATE.features : [];
  let roofFromContours = [];
  if (feats3857.length && typeof dp2MapCoordToPixel === "function") {
    roofFromContours = feats3857
      .filter(
        (f) =>
          f &&
          f.type === "polygon" &&
          f.closed === true &&
          Array.isArray(f.coordinates) &&
          f.coordinates.length >= 3
      )
      .map((f) => {
        const points = [];
        for (let ci = 0; ci < f.coordinates.length; ci++) {
          const c = f.coordinates[ci];
          const px = dp2MapCoordToPixel(c);
          if (px && px.length >= 2) points.push({ x: px[0], y: px[1] });
        }
        return {
          type: "building_outline",
          points,
          closed: true
        };
      })
      .filter((o) => o.points && o.points.length >= 3);
  }
  if (!roofFromContours.length) {
    const contours = dp2GetBuildingContours();
    roofFromContours = contours
      .filter((c) => c && c.closed === true && Array.isArray(c.points) && c.points.length >= 3)
      .map((c) => ({
        type: "building_outline",
        points: (c.points || []).map((p) => ({ x: p?.x ?? 0, y: p?.y ?? 0 })),
        closed: true
      }));
  }

  // B. Conserver roofFromObjects : cotes / faîtage (segments) + hauteur égout (annotation x,y,heightM)
  const roofFromObjects = objects.filter((o) => {
    if (!o || typeof o.type !== "string") return false;
    if (o.type === "gutter_height_dimension") {
      return typeof o.x === "number" && Number.isFinite(o.x) && typeof o.y === "number" && Number.isFinite(o.y);
    }
    if (o.type === "measure_line" || o.type === "ridge_line") {
      if (Array.isArray(o.points) && o.points.length >= 2) return true;
      return !!(o.a && o.b && typeof o.a.x === "number" && typeof o.a.y === "number" && typeof o.b.x === "number" && typeof o.b.y === "number");
    }
    return false;
  });

  // C. Composer (contour depuis features 3857 → roof_outline pixels, ridge/measure depuis objects)
  const roofObjects = [...roofFromContours, ...roofFromObjects];
  stateCat.roofGeometry = dp2CloneForHistory(roofObjects);

  // DP4 : persister aussi les paramètres & objets "graphiques" (copie stricte DP2 -> DP4)
  try {
    window.DP4_STATE.photoCategory = window.DP2_STATE?.photoCategory ?? null;
    window.DP4_STATE.panelModel = window.DP2_STATE?.panelModel ?? null;
    stateCat.panels = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.panels) ? window.DP2_STATE.panels : []);
    stateCat.textObjects = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.textObjects) ? window.DP2_STATE.textObjects : []);
    stateCat.businessObjects = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.businessObjects) ? window.DP2_STATE.businessObjects : []);
    stateCat.history = dp2CloneForHistory(Array.isArray(window.DP2_STATE?.history) ? window.DP2_STATE.history : []);
  } catch (_) {}

  if (dp2IsDP4RoofProfile() && window.__SN_DP_DP2_AUDIT__ === true) {
    try {
      console.log("[DP4][AUDIT] after dp4Sync: features=", (window.DP2_STATE?.features || []).length);
    } catch (_) {}
  }

  // UI DP4 : lecture seule
  try { syncDP4LegendOverlayUI(); } catch (_) {}
  try { syncDP4ScaleUI(); } catch (_) {}
}

/**
 * Injecte roofGeometry / panels / … de DP4_STATE[cat] dans le moteur canvas DP2 (repère pixels toiture).
 */
function dp4ApplyDp4CategoryGeometryToDp2Editor(cat) {
  if (!window.DP2_STATE) return;
  dp2EnsureFeaturesArray();
  if (cat !== "before" && cat !== "after") {
    window.DP2_STATE.features = [];
    window.DP2_STATE.objects = [];
    dp2RebuildContourDisplayCacheFromFeatures();
    return;
  }
  const stateCat = window.DP4_STATE?.[cat];
  if (!stateCat) {
    window.DP2_STATE.features = [];
    window.DP2_STATE.objects = [];
    dp2RebuildContourDisplayCacheFromFeatures();
    return;
  }
  const roofGeometry = stateCat.roofGeometry || [];
  const outlinesFromRoof = roofGeometry.filter((o) => o && o.type === "building_outline");
  const orthoCapForPts = typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : null;
  const orthoPtsOk = orthoCapForPts && dp4ValidateDP2CaptureForImport(orthoCapForPts).ok;
  const contoursConstruits = outlinesFromRoof.map((o, index) => ({
    id: "dp4_contour_" + index,
    points: (o.points || []).map((p) => ({ x: typeof p?.x === "number" ? p.x : 0, y: typeof p?.y === "number" ? p.y : 0 })),
    closed: o.closed === true
  }));
  const seen = new Set();
  const filtered = contoursConstruits.filter((c) => {
    if (!c || !Array.isArray(c.points) || c.points.length < 3) return false;
    const key = JSON.stringify(c.points.map((p) => ({ x: p.x, y: p.y })));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const features = [];
  for (let ci = 0; ci < filtered.length; ci++) {
    const c = filtered[ci];
    const coords = [];
    for (let pi = 0; pi < c.points.length; pi++) {
      const p = c.points[pi];
      const px = typeof p?.x === "number" ? p.x : 0;
      const py = typeof p?.y === "number" ? p.y : 0;
      let mc = null;
      if (orthoPtsOk && Math.abs(px) > 1e5 && Math.abs(py) > 1e5) {
        mc = [px, py];
      } else {
        mc = dp2PixelToMapCoord(px, py);
      }
      if (mc && mc.length >= 2) coords.push(mc);
    }
    if (coords.length < 3) continue;
    features.push({
      id: c.id,
      type: "polygon",
      closed: true,
      coordinates: coords
    });
  }
  window.DP2_STATE.features = features;
  window.DP2_STATE.objects = roofGeometry.filter((o) => o && o.type !== "building_outline");
  window.DP2_STATE.objects = (window.DP2_STATE.objects || []).filter((o) => o?.type !== "building_outline");
  window.DP2_STATE.panels = dp2CloneForHistory(stateCat.panels || []);
  window.DP2_STATE.textObjects = dp2CloneForHistory(stateCat.textObjects || []);
  window.DP2_STATE.businessObjects = dp2CloneForHistory(stateCat.businessObjects || []);
  window.DP2_STATE.history = dp2CloneForHistory(stateCat.history || []);
  dp2RebuildContourDisplayCacheFromFeatures();
}

// ======================================================
// DP4 — PERSISTENCE (2 PLANS : before / after)
// - Un seul moteur DP4 / un seul canvas
// - La catégorie active AU MOMENT DU SAVE décide de tout
// ======================================================
function dp4SessionStateKey() {
  return __solarnextSessionScopedKey("DP4_STATE_V1");
}
// ======================================================
// DP4 — RENDU FINAL (NETTOYAGE VISUEL) — PERSISTENCE SÉPARÉE
// Objectif :
// - NE PAS modifier DP4_STATE (état de travail)
// - Stocker un rendu "mairie" (fond blanc, traits gris/noir) pour :
//   - miniatures
//   - base future PDF DP4
// ======================================================
function dp4FinalRenderKey() {
  return __solarnextScopedStorageKey("DP4_FINAL_RENDER_V1");
}

function dp4FinalDefaultStore() {
  return {
    before: null, // { imageBase64, finalizedAt }
    after: null
  };
}

function dp4FinalLoadStore() {
  try {
    const raw = localStorage.getItem(dp4FinalRenderKey());
    if (!raw) return dp4FinalDefaultStore();
    const parsed = JSON.parse(raw);
    const base = dp4FinalDefaultStore();
    const s = { ...base, ...(parsed || {}) };
    // sanity minimale
    for (const k of ["before", "after"]) {
      const v = s[k];
      if (!v) continue;
      if (typeof v.imageBase64 !== "string" || !v.imageBase64.startsWith("data:image")) s[k] = null;
    }
    return s;
  } catch (_) {
    return dp4FinalDefaultStore();
  }
}

function dp4FinalSaveStore(store) {
  try {
    localStorage.setItem(dp4FinalRenderKey(), JSON.stringify(store || dp4FinalDefaultStore()));
  } catch (_) {}
}

/** Snapshots DP4 pour lead_dp.state_json (état + rendus finaux cache navigateur). */
window.__snDpGetDp4SnapshotForDraft = function __snDpGetDp4SnapshotForDraft() {
  try {
    return {
      state: dp4NormalizeLoadedState(window.DP4_STATE || dp4DefaultState()),
      finalRenders: dp4FinalLoadStore(),
    };
  } catch (e) {
    return null;
  }
};

window.__snHydrateDp4FromDraft = function __snHydrateDp4FromDraft(payload) {
  if (payload == null || typeof payload !== "object") return;
  try {
    window.__DP4_LS_LOADED = false;
    var rawState = payload.state != null ? payload.state : payload;
    window.DP4_STATE = dp4NormalizeLoadedState(rawState);
    if (payload.finalRenders && typeof payload.finalRenders === "object") {
      var def = dp4FinalDefaultStore();
      var merged = { ...def, ...payload.finalRenders };
      dp4FinalSaveStore(merged);
    }
  } catch (e) {
    console.warn("[DP] __snHydrateDp4FromDraft", e);
  }
};

function dp4GetFinalRenderFor(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return null;
  const s = dp4FinalLoadStore();
  return s?.[cat] || null;
}

function dp4IsFinalized(category) {
  const v = dp4GetFinalRenderFor(category);
  return !!(v && typeof v.imageBase64 === "string" && v.imageBase64.startsWith("data:image"));
}

function dp4SetFinalRenderFor(category, imageBase64) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;
  if (!(typeof imageBase64 === "string" && imageBase64.startsWith("data:image"))) return;
  const s = dp4FinalLoadStore();
  s[cat] = { imageBase64, finalizedAt: Date.now() };
  dp4FinalSaveStore(s);
  try {
    if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
  } catch (_) {}
}

async function dp4BuildFinalRenderImageBase64FromCurrentDom() {
  // IMPORTANT :
  // - Fond blanc
  // - NE PAS inclure l'image satellite (#dp2-captured-image)
  // - Conserver exactement les mêmes couleurs que le canvas (pas de normalisation gris)
  // - Traits plus fins dans le rendu final uniquement (contours 1.5px, faîtage 2px, mesures 1.2px)
  const overlayCanvas = document.getElementById("dp2-draw-canvas");
  if (!overlayCanvas || overlayCanvas.width <= 0 || overlayCanvas.height <= 0) return null;

  // S'assurer que l'affichage reflète l'état courant (sans recalcul géométrique).
  if (typeof window.renderDP2FromState === "function") {
    try { window.renderDP2FromState(); } catch (_) {}
  } else if (typeof renderDP2FromState === "function") {
    try { renderDP2FromState(); } catch (_) {}
  }

  const w = overlayCanvas.width;
  const h = overlayCanvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  // Fond blanc uniforme (satellite supprimé)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  // ==========================
  // Calque STRUCTUREL (gris/noir)
  // Types concernés :
  // - building_outline (contours de pans)
  // - measure_line (cotes / lignes de mesure)
  // - ridge_line (faîtage)
  // ==========================
  try {
    const structuralCanvas = document.createElement("canvas");
    structuralCanvas.width = w;
    structuralCanvas.height = h;
    const sctx = structuralCanvas.getContext("2d");
    if (sctx && window.DP2_STATE) {
      const objects = window.DP2_STATE.objects || [];
      // Réduction légère des épaisseurs pour le rendu final
      const ORIGINAL_LINE_WIDTH = sctx.lineWidth;
      // 1) Contours bâti : cache pixels (dérivé de features) — même rendu que l’éditeur
      if (typeof renderDP2BuildingContour === "function") {
        const contours = dp2GetBuildingContours();
        for (const c of contours) {
          const prevLineWidth = sctx.lineWidth;
          sctx.lineWidth = 1.5;
          renderDP2BuildingContour(sctx, c, { active: false });
          sctx.lineWidth = prevLineWidth;
        }
      }
      // 2) Lignes de mesure + faîtage
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (!obj || !obj.type) continue;
        if (obj.type === "measure_line" && typeof renderMeasureLine === "function") {
          const prevMeasureWidth = sctx.lineWidth;
          sctx.lineWidth = 1.2;
          renderMeasureLine(sctx, obj, i);
          sctx.lineWidth = prevMeasureWidth;
        } else if (obj.type === "ridge_line" && typeof renderRidgeLine === "function") {
          const prevRidgeWidth = sctx.lineWidth;
          sctx.lineWidth = 2;
          renderRidgeLine(sctx, obj, null);
          sctx.lineWidth = prevRidgeWidth;
        } else if (obj.type === "gutter_height_dimension" && typeof renderGutterHeightDimension === "function") {
          const prevGw = sctx.lineWidth;
          sctx.lineWidth = 1.5;
          renderGutterHeightDimension(sctx, obj, i);
          sctx.lineWidth = prevGw;
        }
      }

      ctx.drawImage(structuralCanvas, 0, 0, w, h);
    }
  } catch (_) {}

  // ==========================
  // Calque UTILISATEUR (couleurs originales)
  // - objets "libres" (rectangle/ligne/cercle/polygone/texte/pv_panel...)
  // - panneaux (DP2_STATE.panels)
  // - objets métier (DP2_STATE.businessObjects)
  // - textes (DP2_STATE.textObjects)
  // ==========================
  try {
    const userCanvas = document.createElement("canvas");
    userCanvas.width = w;
    userCanvas.height = h;
    const uctx = userCanvas.getContext("2d");
    if (uctx && window.DP2_STATE) {
      const objects = window.DP2_STATE.objects || [];
      for (const obj of objects) {
        if (!obj || !obj.type) continue;
        // FIX cadres fantomes (DP4/PDF) : ignorer les miroirs techniques "dp2drv:" (boites
        // englobantes des objets metier). L'editeur les ignore deja (renderDP2FromState) ;
        // ils ne doivent jamais apparaitre dans le rendu final.
        if (typeof obj.dp2SyncKey === "string" && obj.dp2SyncKey.indexOf("dp2drv:") === 0) continue;
        // Exclure les éléments structurels (déjà rendus + normalisés)
        if (obj.type === "building_outline" || obj.type === "measure_line" || obj.type === "ridge_line" || obj.type === "gutter_height_dimension") continue;

        switch (obj.type) {
          case "rectangle":
            if (typeof renderRectangle === "function") renderRectangle(uctx, obj);
            break;
          case "pv_panel":
            if (typeof renderPvPanel === "function") renderPvPanel(uctx, obj);
            break;
          case "line":
            if (typeof renderLine === "function") renderLine(uctx, obj);
            break;
          case "circle":
            if (typeof renderCircle === "function") renderCircle(uctx, obj);
            break;
          case "polygon":
            if (typeof renderPolygon === "function") renderPolygon(uctx, obj);
            break;
          case "text":
            if (typeof renderText === "function") renderText(uctx, obj);
            break;
          default:
            // ignore (types inconnus)
            break;
        }
      }

      // Panneaux PV (calepinage simple)
      const panels = window.DP2_STATE.panels || [];
      if (typeof renderDP2Panel === "function") {
        for (const panel of panels) renderDP2Panel(uctx, panel);
      }

      // Objets métier
      const businessObjects = window.DP2_STATE.businessObjects || [];
      if (typeof renderDP2BusinessObject === "function") {
        for (const obj of businessObjects) renderDP2BusinessObject(uctx, obj);
      }

      // Textes (annotations)
      const textObjects = window.DP2_STATE.textObjects || [];
      if (typeof renderDP2TextObject === "function") {
        for (const obj of textObjects) renderDP2TextObject(uctx, obj);
      }

      ctx.drawImage(userCanvas, 0, 0, w, h);
    }
  } catch (_) {}

  // ==========================
  // Échelle graphique (DÉCLARATIVE, PDF UNIQUEMENT)
  // - Aucun calcul, aucune conversion
  // - N'afficher rien si non défini
  // ==========================
  try {
    const metersRaw = window.DP4_STATE?.scaleGraphicMeters ?? null;
    const meters =
      typeof metersRaw === "number" && Number.isFinite(metersRaw) ? metersRaw : null;
    if (meters === 1 || meters === 2 || meters === 5 || meters === 10) {
      // Format "urbanisme" : trait horizontal + label centré (déclaratif, sans conversion m->px basée sur résolution)
      const margin = Math.max(14, Math.round(Math.min(w, h) * 0.022));
      const pxByMeters = { 1: 110, 2: 160, 5: 240, 10: 320 };
      let barW = pxByMeters[meters] || 200;
      barW = Math.max(80, Math.min(barW, w - margin * 2));

      const x0 = margin;
      const x1 = margin + barW;
      const y = h - margin - 16; // laisse de la place pour le label au-dessus
      const cx = (x0 + x1) / 2;

      ctx.save();
      ctx.strokeStyle = "#111";
      ctx.fillStyle = "#111";

      // Label
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${meters} m`, cx, y - 6);

      // Trait principal
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      // Petites marques aux extrémités
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y - 7);
      ctx.lineTo(x0, y + 7);
      ctx.moveTo(x1, y - 7);
      ctx.lineTo(x1, y + 7);
      ctx.stroke();

      ctx.restore();
    }
  } catch (_) {}

  return out.toDataURL("image/png");
}

function dp4DefaultState() {
  return {
    // Source unique de vérité (menu gauche DP4)
    photoCategory: null, // "before" | "after" | null
    // Échelle graphique (déclarative, PDF uniquement)
    scaleGraphicMeters: null, // ex: 1 | 2 | 5 | 10 | null

    // Données Avant / Après (indépendantes, aucun écrasement)
    before: {
      roofGeometry: [],
      panels: [],
      textObjects: [],
      businessObjects: [],
      history: []
    },
    after: {
      roofGeometry: [],
      panels: [],
      textObjects: [],
      businessObjects: [],
      history: []
    },
    capture: { imageBase64: null },
    /** Orthophoto toiture (validation DP4) — ne pas confondre avec le plan masse DP2. */
    capture_ortho: { imageBase64: null },
    roofType: null,
    panelModel: null,

    // 2 plans stockés (persistance)
    plans: {
      before: null,
      after: null
    },

    /** Copie figée des contours DP2 (EPSG:3857) — jamais réécrite depuis DP2 après scellement. */
    baseFeatures: [],
    /** Panneaux ajoutés en EPSG:3857 (couche OL au-dessus du bâti). */
    panels: [],
    /** True = baseFeatures provient déjà d’un gel DP2 (ne pas recloner). */
    _dp4BaseFeaturesSealed: false
  };
}

function dp4NormalizeLoadedState(raw) {
  const base = dp4DefaultState();
  const s = { ...base, ...(raw || {}) };
  // Sécuriser structures
  s.capture = { ...(base.capture || {}), ...(s.capture || {}) };
  s.capture_ortho = { ...(base.capture_ortho || {}), ...(s.capture_ortho || {}) };
  if (!s.capture_ortho.imageBase64 && s.capture && s.capture.imageBase64) {
    s.capture_ortho = { ...s.capture };
  }
  s.plans = { ...(base.plans || {}), ...(s.plans || {}) };
  // Assurer before/after avec structures complètes
  for (const cat of ["before", "after"]) {
    if (!s[cat] || typeof s[cat] !== "object") s[cat] = { ...base[cat] };
    const sc = s[cat];
    if (!Array.isArray(sc.roofGeometry)) sc.roofGeometry = [];
    if (!Array.isArray(sc.panels)) sc.panels = [];
    if (!Array.isArray(sc.textObjects)) sc.textObjects = [];
    if (!Array.isArray(sc.businessObjects)) sc.businessObjects = [];
    if (!Array.isArray(sc.history)) sc.history = [];
  }
  // Migration : ancien état avec roofGeometry au top-level -> before/after
  if (Array.isArray(raw?.roofGeometry) && raw.roofGeometry.length > 0) {
    const targetCat = raw.photoCategory === "after" ? "after" : "before";
    if (!s[targetCat].roofGeometry?.length) s[targetCat].roofGeometry = raw.roofGeometry;
    if (Array.isArray(raw.panels) && !s[targetCat].panels?.length) s[targetCat].panels = raw.panels;
    if (Array.isArray(raw.textObjects) && !s[targetCat].textObjects?.length) s[targetCat].textObjects = raw.textObjects;
    if (Array.isArray(raw.businessObjects) && !s[targetCat].businessObjects?.length) s[targetCat].businessObjects = raw.businessObjects;
    if (Array.isArray(raw.history) && !s[targetCat].history?.length) s[targetCat].history = raw.history;
  }
  // Migration soft : ancien champ string `scaleGraphic` -> `scaleGraphicMeters`
  if (s.scaleGraphicMeters == null && typeof s.scaleGraphic === "string" && s.scaleGraphic) {
    const m = Number(String(s.scaleGraphic).replace(",", ".").replace(/[^\d.]/g, ""));
    if (m === 1 || m === 2 || m === 5 || m === 10) s.scaleGraphicMeters = m;
  }
  if (!(typeof s.scaleGraphicMeters === "number" && Number.isFinite(s.scaleGraphicMeters))) s.scaleGraphicMeters = null;
  if (!(s.scaleGraphicMeters === 1 || s.scaleGraphicMeters === 2 || s.scaleGraphicMeters === 5 || s.scaleGraphicMeters === 10)) {
    s.scaleGraphicMeters = null;
  }
  // Nettoyer l'ancien champ pour éviter toute utilisation accidentelle
  try { delete s.scaleGraphic; } catch (_) {}
  if (!Array.isArray(s.baseFeatures)) s.baseFeatures = [];
  if (!Array.isArray(s.panels)) s.panels = [];
  if (typeof s._dp4BaseFeaturesSealed !== "boolean") s._dp4BaseFeaturesSealed = false;
  return s;
}

/**
 * Capture ortho toiture DP4 (validation carte). Rétrocompat : `capture` si pas encore migré.
 * @param {object} [stateIn] — défaut : window.DP4_STATE
 */
function dp4GetCaptureOrtho(stateIn) {
  const s = stateIn || window.DP4_STATE;
  if (!s || typeof s !== "object") return null;
  const ortho = s.capture_ortho;
  if (ortho && typeof ortho === "object" && ortho.imageBase64) return ortho;
  const legacy = s.capture;
  if (legacy && typeof legacy === "object" && legacy.imageBase64) return legacy;
  return ortho || null;
}

function dp4LoadState() {
  if (window.__SN_DP_SERVER_DRAFT_ACTIVE) {
    return dp4DefaultState();
  }
  try {
    const raw = sessionStorage.getItem(dp4SessionStateKey());
    try { localStorage.removeItem(__solarnextScopedStorageKey("DP4_STATE_V1")); } catch (_) {}
    if (!raw) return dp4DefaultState();
    return dp4NormalizeLoadedState(JSON.parse(raw));
  } catch (_) {
    return dp4DefaultState();
  }
}

function dp4SaveState(state) {
  try {
    const normalized = dp4NormalizeLoadedState(state);
    // Cache session (non source de vérité — aligné sur state_json via DpDraftStore)
    sessionStorage.setItem(dp4SessionStateKey(), JSON.stringify(normalized));
  } catch (_) {}
  try {
    if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced(false);
  } catch (_) {}
}

function dp4EnsureStateLoadedOnce() {
  if (window.__DP4_LS_LOADED === true) return;
  window.__DP4_LS_LOADED = true;
  if (window.__SN_DP_SERVER_DRAFT_ACTIVE) {
    window.DP4_STATE = dp4NormalizeLoadedState(window.DP4_STATE || dp4DefaultState());
    return;
  }
  window.DP4_STATE = dp4NormalizeLoadedState(dp4LoadState());
}

function dp4ResetDp4BaseFeaturesSeal() {
  const s = window.DP4_STATE;
  if (!s || typeof s !== "object") return;
  s._dp4BaseFeaturesSealed = false;
  s.baseFeatures = [];
  s.panels = [];
}

/**
 * Gèle une copie profonde de DP2_STATE.features dans DP4_STATE.baseFeatures (une seule fois par cycle DP4).
 * Ne modifie jamais DP2_STATE.
 */
function dp4EnsureBaseFeaturesFromDp2FrozenOnce() {
  window.DP4_STATE = dp4NormalizeLoadedState(window.DP4_STATE || dp4DefaultState());
  const s = window.DP4_STATE;
  if (s._dp4BaseFeaturesSealed) return;
  const beforeSource = s.photoCategory === "before" ? dp4GetDp2BeforeImportSource() : { ok: false };
  const src =
    beforeSource.ok && Array.isArray(beforeSource.state?.features)
      ? beforeSource.state.features
      : Array.isArray(window.DP2_STATE?.features)
        ? window.DP2_STATE.features
        : [];
  try {
    s.baseFeatures = typeof dp2CloneForHistory === "function" ? dp2CloneForHistory(src) : JSON.parse(JSON.stringify(src));
  } catch (_) {
    s.baseFeatures = [];
  }
  s._dp4BaseFeaturesSealed = true;
}

function dp4GetDp2CapturePreviewForView() {
  const beforeSource = window.DP4_STATE?.photoCategory === "before" ? dp4GetDp2BeforeImportSource() : { ok: false };
  const beforeState = beforeSource.ok ? beforeSource.state : null;
  const pv = beforeState?.capture_preview || window.DP2_STATE?.capture_preview;
  if (pv && Array.isArray(pv.center) && pv.center.length >= 2) return pv;
  if (beforeSource.ok) return beforeSource.capture || null;
  return typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : null;
}

/** Anneau linéaire EPSG:3857 fermé pour ol.geom.Polygon (à partir d’un feature DP2 type polygon). */
function dp4Build3857RingFromPolygonFeature(f) {
  if (!f || f.type !== "polygon" || !Array.isArray(f.coordinates)) return null;
  const ring = [];
  for (let i = 0; i < f.coordinates.length; i++) {
    const c = f.coordinates[i];
    if (!Array.isArray(c) || c.length < 2) continue;
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    ring.push([c[0], c[1]]);
  }
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function dp4ApplyCapturePreviewToMapView(map) {
  if (!map || typeof ol === "undefined") return;
  const pv = dp4GetDp2CapturePreviewForView();
  if (!pv || !Array.isArray(pv.center) || pv.center.length < 2) return;
  const view = map.getView();
  if (!view) return;
  try {
    view.setCenter(pv.center.slice());
  } catch (_) {}
  try {
    if (typeof pv.rotation === "number" && Number.isFinite(pv.rotation)) view.setRotation(pv.rotation);
  } catch (_) {}
  try {
    if (typeof pv.zoom === "number" && Number.isFinite(pv.zoom)) view.setZoom(pv.zoom);
  } catch (_) {}
}

function dp4MountVectorLayersFromState(map) {
  if (!map || typeof ol === "undefined") return;
  const toRemove = [];
  try {
    map.getLayers().forEach(function (ly) {
      const p = ly && ly.get && ly.get("dp4Layer");
      if (p === "base" || p === "panels") toRemove.push(ly);
    });
  } catch (_) {}
  for (let ri = 0; ri < toRemove.length; ri++) {
    try {
      map.removeLayer(toRemove[ri]);
    } catch (_) {}
  }

  const baseSrc = new ol.source.Vector();
  const bf = window.DP4_STATE?.baseFeatures || [];
  for (let bi = 0; bi < bf.length; bi++) {
    const f = bf[bi];
    const ring = dp4Build3857RingFromPolygonFeature(f);
    if (!ring) continue;
    const feat = new ol.Feature({ geometry: new ol.geom.Polygon([ring]) });
    if (f && f.id != null) feat.setId(String(f.id));
    baseSrc.addFeature(feat);
  }
  const baseLayer = new ol.layer.Vector({
    source: baseSrc,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "rgba(195, 152, 71, 0.95)", width: 2.5 }),
      fill: new ol.style.Fill({ color: "rgba(195, 152, 71, 0.14)" })
    }),
    zIndex: 10
  });
  baseLayer.set("dp4Layer", "base");

  const panelSrc = new ol.source.Vector();
  const panels = window.DP4_STATE?.panels || [];
  for (let pi = 0; pi < panels.length; pi++) {
    const p = panels[pi];
    if (!p || p.type !== "panel") continue;
    let ring = null;
    if (Array.isArray(p.coordinates)) {
      const head = p.coordinates[0];
      if (Array.isArray(head) && typeof head[0] === "number") {
        ring = dp4Build3857RingFromPolygonFeature({ type: "polygon", coordinates: p.coordinates });
      } else if (Array.isArray(head) && Array.isArray(head[0])) {
        ring = dp4Build3857RingFromPolygonFeature({ type: "polygon", coordinates: head });
      }
    }
    if (!ring) continue;
    const pf = new ol.Feature({ geometry: new ol.geom.Polygon([ring]) });
    if (p.id != null) pf.setId(String(p.id));
    panelSrc.addFeature(pf);
  }
  const panelLayer = new ol.layer.Vector({
    source: panelSrc,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "rgba(37, 99, 235, 0.92)", width: 2 }),
      fill: new ol.style.Fill({ color: "rgba(37, 99, 235, 0.12)" })
    }),
    zIndex: 20
  });
  panelLayer.set("dp4Layer", "panels");

  map.addLayer(baseLayer);
  map.addLayer(panelLayer);
  map.set("dp4BaseVectorSource", baseSrc);
  map.set("dp4PanelVectorSource", panelSrc);
  try {
    console.log("[DP4 BASE]", bf.length);
    console.log("[DP4 PANELS]", panels.length);
  } catch (_) {}
}

/**
 * Enregistre un panneau posé sur l’ortho toiture dans DP4_STATE.panels (anneau EPSG:3857), pour la couche OL.
 */
function dp4SetMapHelperLayersVisibleForCapture(map, visible) {
  const changed = [];
  if (!map || !map.getLayers) return changed;
  try {
    map.getLayers().forEach(function (ly) {
      const kind = ly && ly.get && ly.get("dp4Layer");
      if (kind !== "base" && kind !== "panels") return;
      const prev = ly.getVisible ? ly.getVisible() : true;
      changed.push({ layer: ly, visible: prev });
      if (ly.setVisible) ly.setVisible(visible);
    });
  } catch (_) {}
  return changed;
}

function dp4RestoreMapHelperLayersAfterCapture(changed) {
  if (!Array.isArray(changed)) return;
  for (const entry of changed) {
    try {
      if (entry && entry.layer && entry.layer.setVisible) entry.layer.setVisible(entry.visible !== false);
    } catch (_) {}
  }
}

function dp4Append3857PanelFromDp2Placement(panelEntry) {
  if (!panelEntry || panelEntry.type !== "panel" || !panelEntry.geometry) return;
  const g = panelEntry.geometry;
  const x = g.x;
  const y = g.y;
  const w = g.width;
  const h = g.height;
  if (!(typeof x === "number" && typeof y === "number" && w > 0 && h > 0)) return;
  const rotDeg = typeof g.rotation === "number" && Number.isFinite(g.rotation) ? g.rotation : 0;
  const rad = (rotDeg * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const corners = [
    { lx: -w / 2, ly: -h / 2 },
    { lx: w / 2, ly: -h / 2 },
    { lx: w / 2, ly: h / 2 },
    { lx: -w / 2, ly: h / 2 }
  ];
  const ring = [];
  for (let i = 0; i < corners.length; i++) {
    const lx = corners[i].lx;
    const ly = corners[i].ly;
    const rx = lx * Math.cos(rad) - ly * Math.sin(rad);
    const ry = lx * Math.sin(rad) + ly * Math.cos(rad);
    const px = cx + rx;
    const py = cy + ry;
    const mc = typeof dp2PixelToMapCoord === "function" ? dp2PixelToMapCoord(px, py) : null;
    if (mc && mc.length >= 2 && Number.isFinite(mc[0]) && Number.isFinite(mc[1])) ring.push([mc[0], mc[1]]);
  }
  if (ring.length < 3) return;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);

  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  if (!Array.isArray(window.DP4_STATE.panels)) window.DP4_STATE.panels = [];
  const pid = panelEntry.id != null ? String(panelEntry.id) : "panel_" + Date.now();
  const next = window.DP4_STATE.panels.filter((p) => p && String(p.id) !== pid);
  next.push({ type: "panel", id: panelEntry.id, coordinates: ring });
  window.DP4_STATE.panels = next;
  try {
    console.log("[DP4 PANELS]", window.DP4_STATE.panels.length);
  } catch (_) {}
  try {
    dp4RefreshPanelVectorLayerFromState();
  } catch (_) {}
}

/** Après ajout d’un panneau EPSG:3857 dans DP4_STATE.panels. */
function dp4RefreshPanelVectorLayerFromState() {
  const map = window.DP4_OL_MAP;
  if (!map) return;
  try {
    dp4MountVectorLayersFromState(map);
    map.renderSync();
  } catch (_) {}
}

function dp4GetStoredPlan(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return null;
  return window.DP4_STATE?.plans?.[cat] || null;
}

function dp4ApplyStoredPlanToActive(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  // Source unique de vérité (menu gauche)
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  window.DP4_STATE.photoCategory = cat;
  if (window.__SN_DP4_EDITOR_ACTIVE === true && window.DP4_EDITOR_STATE) {
    window.DP4_EDITOR_STATE.photoCategory = window.DP4_STATE.photoCategory;
  }

  const plan = dp4GetStoredPlan(cat);
  window.DP4_STATE[cat] = window.DP4_STATE[cat] || { roofGeometry: [], panels: [], textObjects: [], businessObjects: [], history: [] };
  if (!plan) {
    // Nouveau plan : repartir d'un état vide (sans toucher aux autres catégories)
    window.DP4_CAPTURE_IMAGE = null;
    window.DP4_STATE.capture = { imageBase64: null };
    window.DP4_STATE.capture_ortho = { imageBase64: null };
    window.DP4_STATE[cat].roofGeometry = [];
    window.DP4_STATE[cat].panels = [];
    window.DP4_STATE[cat].textObjects = [];
    window.DP4_STATE[cat].businessObjects = [];
    window.DP4_STATE[cat].history = [];
    window.DP4_STATE.roofType = null;
    window.DP4_STATE.scaleGraphicMeters = null;
    window.DP4_STATE.panelModel = null;
    try {
      dp4ResetDp4BaseFeaturesSeal();
    } catch (_) {}
    return;
  }

  // Charger le plan stocké dans DP4_STATE[cat]
  try {
    const orthoFromPlan = plan.capture_ortho || plan.capture || { imageBase64: null };
    const orthoClone = dp2CloneForHistory(orthoFromPlan);
    window.DP4_STATE.capture_ortho = orthoClone;
    window.DP4_STATE.capture = dp2CloneForHistory(orthoClone);
    window.DP4_STATE[cat].roofGeometry = dp2CloneForHistory(Array.isArray(plan.roofGeometry) ? plan.roofGeometry : []);
    window.DP4_STATE[cat].panels = dp2CloneForHistory(Array.isArray(plan.panels) ? plan.panels : []);
    window.DP4_STATE[cat].textObjects = dp2CloneForHistory(Array.isArray(plan.textObjects) ? plan.textObjects : []);
    window.DP4_STATE[cat].businessObjects = dp2CloneForHistory(Array.isArray(plan.businessObjects) ? plan.businessObjects : []);
    window.DP4_STATE[cat].history = dp2CloneForHistory(Array.isArray(plan.history) ? plan.history : []);
    window.DP4_STATE.roofType = plan.roofType ?? null;
    window.DP4_STATE.scaleGraphicMeters =
      typeof plan.scaleGraphicMeters === "number" && Number.isFinite(plan.scaleGraphicMeters)
        ? plan.scaleGraphicMeters
        : null;
    window.DP4_STATE.panelModel = plan.panelModel ?? null;
    if (Array.isArray(plan.dp4BaseFeatures) && plan.dp4BaseFeatures.length > 0) {
      window.DP4_STATE.baseFeatures = dp2CloneForHistory(plan.dp4BaseFeatures);
      window.DP4_STATE._dp4BaseFeaturesSealed = true;
    } else {
      window.DP4_STATE.baseFeatures = [];
      window.DP4_STATE._dp4BaseFeaturesSealed = false;
    }
    window.DP4_STATE.panels = Array.isArray(plan.dp4MapOverlayPanels)
      ? dp2CloneForHistory(plan.dp4MapOverlayPanels)
      : [];
  } catch (_) {
    // fallback sûr (sans déduction)
    window.DP4_STATE.capture = { imageBase64: null };
    window.DP4_STATE.capture_ortho = { imageBase64: null };
    window.DP4_STATE[cat].roofGeometry = [];
  }

  // Piloter l'ouverture : si une capture existe, on saute Google Maps (flow existant)
  const cap = (typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : window.DP4_STATE?.capture)?.imageBase64 || null;
  window.DP4_CAPTURE_IMAGE = typeof cap === "string" && cap.startsWith("data:image") ? cap : null;
}

function dp4RenderEntryMiniatureFor(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  const card = document.getElementById(`dp4-card-${cat}`);
  const img = document.getElementById(`dp4-thumb-${cat}`);
  if (!card || !img) return;

  const plan = dp4GetStoredPlan(cat);
  // Priorité : rendu final "mairie" s'il existe
  const final = dp4GetFinalRenderFor(cat);
  const thumb = final?.imageBase64 || plan?.thumbnailBase64 || null;

  if (typeof thumb === "string" && thumb.startsWith("data:image")) {
    img.src = thumb;
    card.classList.add("has-thumb");
  } else {
    try { img.removeAttribute("src"); } catch (_) {}
    card.classList.remove("has-thumb");
  }
}

function dp4RenderEntryMiniatures() {
  dp4RenderEntryMiniatureFor("before");
  dp4RenderEntryMiniatureFor("after");
  try {
    if (window.DP4_UI && typeof window.DP4_UI.setState === "function") {
      window.DP4_UI.setState("AUTO");
    }
  } catch (_) {}
}

function dp4ImportBeforeIntoAfter() {
  if (!window.DP4_STATE || !window.DP4_STATE.plans) return;

  const beforePlan = window.DP4_STATE.plans.before;
  if (!beforePlan) {
    window.__snDpAlert("Aucun plan Avant travaux à importer.");
    return;
  }

  // Deep clone sécurisé
  const clone = JSON.parse(JSON.stringify(beforePlan));

  // IMPORTANT : on force la catégorie AFTER
  clone.photoCategory = "after";

  // Écrase uniquement AFTER
  window.DP4_STATE.plans.after = clone;

  // Mettre la catégorie active
  window.DP4_STATE.photoCategory = "after";

  // Sauvegarde persistée
  if (typeof dp4SaveState === "function") {
    dp4SaveState(window.DP4_STATE);
  }

  // Rafraîchir la miniature "after"
  dp4RenderEntryMiniatures();

  // Ouvrir directement le canvas DP4
  dp4OpenCanvasFromStoredPlan("after");
}

function dp4OpenCanvasFromStoredPlan(category) {
  if (!window.DP4_STATE || !window.DP4_STATE.plans) return;

  const plan = window.DP4_STATE.plans[category];
  if (!plan) return;

  window.DP4_STATE.photoCategory = category;

  // Injecter capture image
  const imageBase64 = plan.capture?.imageBase64 || null;
  window.DP4_CAPTURE_IMAGE = imageBase64;

  // Charger le plan dans DP4_STATE[category] pour que dp4RenderRoofDrawingStep ait les données
  dp4ApplyStoredPlanToActive(category);

  // Ouvrir le modal (affiche directement l'étape dessin si capture existe)
  if (typeof window.dp4OpenModal === "function") {
    window.dp4OpenModal();
  }
}

async function dp4SaveActivePlanToSelectedCategory() {
  // 1) Synchroniser depuis le moteur DP2 (si on est en DP4_ROOF)
  try { dp4SyncRoofGeometryFromDP2State(); } catch (_) {}

  // 2) Lire EXCLUSIVEMENT la source de vérité : DP4_STATE.photoCategory
  const cat = window.DP4_STATE?.photoCategory ?? null;
  if (cat !== "before" && cat !== "after") return;

  // 3) Miniature :
  // - si plan finalisé => utiliser le rendu final stocké (sans recalcul / sans destruction)
  // - sinon => rendu standard (fond + grille DP4 + overlay) via la même fonction que le PDF DP2
  let thumbnailBase64 = null;
  try {
    const finalized = dp4GetFinalRenderFor(cat);
    if (finalized?.imageBase64) {
      thumbnailBase64 = finalized.imageBase64;
    } else {
      const img = await collectDP2FinalPlanImage();
      if (typeof img === "string" && img.startsWith("data:image")) thumbnailBase64 = img;
    }
  } catch (_) {}

  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  window.DP4_STATE.plans = window.DP4_STATE.plans || { before: null, after: null };
  const stateCat = window.DP4_STATE[cat] || { roofGeometry: [], panels: [], textObjects: [], businessObjects: [], history: [] };

  const orthoForPlan =
    (typeof dp4GetCaptureOrtho === "function" ? dp4GetCaptureOrtho() : window.DP4_STATE.capture) || {
      imageBase64: null
    };
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
    thumbnailBase64,
    savedAt: Date.now(),
    dp4BaseFeatures: dp2CloneForHistory(Array.isArray(window.DP4_STATE.baseFeatures) ? window.DP4_STATE.baseFeatures : []),
    dp4MapOverlayPanels: dp2CloneForHistory(Array.isArray(window.DP4_STATE.panels) ? window.DP4_STATE.panels : [])
  };

  dp4SaveState(window.DP4_STATE);
}

// ======================================================
// GOOGLE MAPS (UTILS) — DP4 / DP6
// - Facteur commun STRICT (DP4 = source de vérité)
// ======================================================
function dpGetProjectCenterForGoogleMaps() {
  // 1) Priorité : point validé/curent côté DP1 (si DP1 a déjà été utilisé)
  const p = window.DP1_STATE?.currentPoint;
  if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
    return { center: { lat: p.lat, lng: p.lon }, zoom: 20 };
  }

  // 2) Contexte projet (ERPNext) si disponible
  const ctx = window.DP1_CONTEXT;
  if (ctx && Number.isFinite(ctx.lat) && Number.isFinite(ctx.lon)) {
    return { center: { lat: ctx.lat, lng: ctx.lon }, zoom: 20 };
  }

  // 3) Défaut cohérent (France / zoom "toiture" raisonnable)
  return { center: { lat: 48.8566, lng: 2.3522 }, zoom: 18 };
}

/**
 * Carte 2D optionnelle sur #dp6-gmap-debug-map (DP6) pour vérifier que l’API Google charge bien les tuiles
 * (distinct du panorama Street View). Activer en affichant #dp6-gmap-debug (retirer hidden).
 */
function dpMaybeAttachDp6VerifyMap2D() {
  if (window.__dpGoogleVerifyMapInstance) return;
  try {
    const g = window.google;
    if (!g || !g.maps) return;
    const el = document.getElementById("dp6-gmap-debug-map");
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return;
    const { center } = dpGetProjectCenterForGoogleMaps();
    window.__dpGoogleVerifyMapInstance = new g.maps.Map(el, {
      center: center || { lat: 48.8566, lng: 2.3522 },
      zoom: 18,
      mapTypeControl: false,
      streetViewControl: false,
    });
    setTimeout(() => {
      try {
        g.maps.event.trigger(window.__dpGoogleVerifyMapInstance, "resize");
      } catch (_) {}
    }, 300);
    console.log("MAP VERIFY 2D OK");
  } catch (e) {
    console.warn("[DP6] diagnostic carte 2D impossible", e);
  }
}

/**
 * Charge l’API Google Maps une seule fois (sans callback=initMap dans l’URL).
 * Réutilise un script maps.googleapis.com déjà présent (Calpinage / autre) via polling.
 * @returns {Promise<typeof window.google>}
 */
function dpLoadGoogleMapsJsOnce() {
  if (window.google && window.google.maps) {
    console.log("GOOGLE ALREADY LOADED");
    return Promise.resolve(window.google);
  }
  if (window.__dpGoogleMapsLoadPromise) {
    return window.__dpGoogleMapsLoadPromise;
  }

  const GOOGLE_MAPS_API_KEY = __snGoogleMapsPublicKey();

  window.__dpGoogleMapsLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      console.log("GOOGLE SCRIPT EXISTS, WAITING");
      let intervalId = null;
      let timeoutId = null;
      const tryResolve = () => {
        if (window.google && window.google.maps) {
          if (intervalId) clearInterval(intervalId);
          if (timeoutId) clearTimeout(timeoutId);
          console.log("GOOGLE READY (EXISTING)");
          resolve(window.google);
          return true;
        }
        return false;
      };
      intervalId = setInterval(tryResolve, 100);
      existingScript.addEventListener("load", () => {
        tryResolve();
      });
      tryResolve();
      timeoutId = setTimeout(() => {
        if (intervalId) clearInterval(intervalId);
        window.__dpGoogleMapsLoadPromise = null;
        reject(new Error("GOOGLE LOAD TIMEOUT"));
      }, 30000);
      return;
    }

    console.log("LOADING GOOGLE SCRIPT");
    const script = document.createElement("script");
    script.dataset.dpToolGoogleMaps = "1";
    script.src =
      "https://maps.googleapis.com/maps/api/js?v=weekly" +
      "&libraries=geometry" +
      "&key=" +
      encodeURIComponent(GOOGLE_MAPS_API_KEY);
    script.async = true;
    script.defer = true;

    let loadTimeoutId = setTimeout(() => {
      loadTimeoutId = null;
      window.__dpGoogleMapsLoadPromise = null;
      reject(new Error("GOOGLE LOAD TIMEOUT"));
    }, 15000);

    script.onload = () => {
      console.log("GOOGLE LOADED");
      if (window.google && window.google.maps) {
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
        resolve(window.google);
      } else {
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
        window.__dpGoogleMapsLoadPromise = null;
        reject(new Error("google absent après chargement du script"));
      }
    };
    script.onerror = () => {
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      window.__dpGoogleMapsLoadPromise = null;
      reject(new Error("Échec chargement script Google Maps"));
    };

    document.head.appendChild(script);
  });

  return window.__dpGoogleMapsLoadPromise;
}

window.dpLoadGoogleMapsJsOnce = dpLoadGoogleMapsJsOnce;
window.dpGetProjectCenterForGoogleMaps = dpGetProjectCenterForGoogleMaps;
window.dpMaybeAttachDp6VerifyMap2D = dpMaybeAttachDp6VerifyMap2D;

async function dpCaptureElementAsPngDataUrl(host) {
  if (!host) return null;
  if (typeof window.html2canvas !== "function") {
    return null;
  }

  const canvas = await window.html2canvas(host, {
    // Objectif : rendu fidèle du conteneur, sans crop ni zoom.
    // Remarque : selon la politique CORS des tuiles, la capture peut être limitée côté navigateur.
    useCORS: true,
    backgroundColor: null,
    scale: 1,
    logging: false,
  });

  try {
    return canvas.toDataURL("image/png");
  } catch (_) {
    return null;
  }
}

// ======================================================
// DP4 — IMPORT DP2 (conversion mathématique pixel ↔ coordonnées)
// Overlay = contour uniquement ; canvas = tout le dessin.
// ======================================================
function dp2Dp2ImagePixelTo3857Coord(px, py, capture, width, height) {
  const center = capture.center;
  const resolution = capture.resolution;
  const rotation = capture.rotation || 0;

  const dx = (px - width / 2) * resolution;
  const dy = -(py - height / 2) * resolution;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const x = center[0] + cos * dx - sin * dy;
  const y = center[1] + sin * dx + cos * dy;

  return [x, y];
}

/** Inverse de dp2Dp2ImagePixelTo3857Coord : coordonnée EPSG:3857 → pixel image plan masse. */
function dp2Dp2Image3857CoordToPixel(wx, wy, capture, width, height) {
  const center = capture.center;
  const resolution = capture.resolution;
  const rotation = capture.rotation || 0;
  const rdx = wx - center[0];
  const rdy = wy - center[1];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = cos * rdx + sin * rdy;
  const dy = -sin * rdx + cos * rdy;
  const px = dx / resolution + width / 2;
  const py = -dy / resolution + height / 2;
  return { x: px, y: py };
}

function dp4ClonePlain(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function dp4GetRawDp2PlanCaptureFromState(state) {
  if (!state || typeof state !== "object") return null;
  const plan = state.capture_plan;
  if (plan && typeof plan === "object" && plan.imageBase64) return plan;
  const legacy = state.capture;
  if (legacy && typeof legacy === "object" && legacy.imageBase64) return legacy;
  return plan || null;
}

function dp4GetDp2BeforeImportSource() {
  // LOT3: source = vraie DP2 (jamais un etat tampone DP4_ROOF). Priorite :
  // 1) backup memoire pose a l'ouverture DP4 (lot 2), 2) draft.dp2 (garde propre lot 1),
  // 3) DP2_STATE de travail si non DP4_ROOF, 4) versions DP2 non polluees.
  const isDp4Roof = (st) => !!(st && typeof st === "object" && st.editorProfile === "DP4_ROOF");
  const candidates = [];

  try {
    const bk = window.__dp2RealPlanBackup;
    if (bk && typeof bk === "object" && !isDp4Roof(bk)) {
      candidates.push({ label: "backup", state: dp4ClonePlain(bk, null), snapshot_image: null, isActive: true });
    }
  } catch (_) {}

  try {
    const d = window.DpDraftStore && typeof window.DpDraftStore.getDraft === "function" ? window.DpDraftStore.getDraft() : null;
    const draftDp2 = d && d.dp2 && typeof d.dp2 === "object" ? d.dp2 : null;
    if (draftDp2 && !isDp4Roof(draftDp2)) {
      candidates.push({ label: "draft.dp2", state: dp4ClonePlain(draftDp2, null), snapshot_image: null, isActive: true });
    }
  } catch (_) {}

  const s = window.DP2_STATE;
  if (s && typeof s === "object") {
    const current = dp4ClonePlain(s, null);
    if (current && !isDp4Roof(current)) {
      candidates.push({ label: "working", state: current, snapshot_image: null, isActive: true });
    }
    const versions = Array.isArray(s.dp2Versions) ? s.dp2Versions : [];
    for (let i = versions.length - 1; i >= 0; i--) {
      const v = versions[i];
      const sj = v && v.state_json && typeof v.state_json === "object" ? dp4ClonePlain(v.state_json, null) : null;
      if (!sj || isDp4Roof(sj)) continue;
      candidates.push({
        label: v.id || `version_${i}`,
        state: sj,
        snapshot_image: v.snapshot_image || null,
        isActive: s.dp2ActiveVersionId != null && String(s.dp2ActiveVersionId) === String(v.id)
      });
    }
  }

  if (!candidates.length) return { ok: false, reason: "no_dp2_source" };

  // Choix : preferer une DP2 geo-referencee exploitable ; le tag photoCategory n'est plus bloquant.
  const scoreOf = (c) => {
    let n = 0;
    const st = c && c.state ? c.state : {};
    const cp = dp4GetRawDp2PlanCaptureFromState(st);
    if (cp && cp.imageBase64) n += 4;
    if (cp && dp4ValidateDP2CaptureForImport(cp).ok) n += 4;
    if (Array.isArray(st.features) && st.features.some((ff) => ff && ff.type === "polygon")) n += 2;
    if (st.photoCategory === "before") n += 1;
    return n;
  };
  let chosen = null;
  let best = -1;
  for (const c of candidates) {
    const sc = scoreOf(c);
    if (sc > best) { best = sc; chosen = c; }
  }
  if (!chosen) return { ok: false, reason: "no_dp2_source" };

  const state = chosen.state;
  const cap = dp4GetRawDp2PlanCaptureFromState(state);
  if (!cap || !cap.imageBase64) {
    if (chosen.snapshot_image && chosen.snapshot_image.startsWith("data:image")) {
      state.capture_plan = { imageBase64: chosen.snapshot_image, width: null, height: null };
    } else {
      return { ok: false, reason: "missing_capture" };
    }
  }
  return { ok: true, state, capture: dp4GetRawDp2PlanCaptureFromState(state), label: chosen.label };
}

function dp4WithTemporaryDp2State(tempState, fn) {
  const previous = window.DP2_STATE;
  try {
    window.DP2_STATE = dp4ClonePlain(tempState, {});
    if (window.DP2_STATE) {
      window.DP2_STATE.editorProfile = null;
      if (!window.DP2_STATE.capture_plan && window.DP2_STATE.capture) {
        window.DP2_STATE.capture_plan = dp4ClonePlain(window.DP2_STATE.capture, null);
      }
    }
    try {
      if (typeof dp2RebuildContourDisplayCacheFromFeatures === "function") {
        dp2RebuildContourDisplayCacheFromFeatures();
      }
    } catch (_) {}
    return fn(window.DP2_STATE);
  } finally {
    window.DP2_STATE = previous;
    try {
      if (typeof dp2RebuildContourDisplayCacheFromFeatures === "function") {
        dp2RebuildContourDisplayCacheFromFeatures();
      }
    } catch (_) {}
  }
}

/** Vérifie que la capture DP2 contient tout le nécessaire pour projet DP2 → pixels carte DP4 (preview + validation). */
function dp4ValidateDP2CaptureForImport(capture) {
  const missing = [];
  if (!capture || typeof capture !== "object") {
    return { ok: false, missing: ["(capture absente)"] };
  }
  if (!Array.isArray(capture.center) || capture.center.length < 2) {
    missing.push("center");
  } else if (!Number.isFinite(capture.center[0]) || !Number.isFinite(capture.center[1])) {
    missing.push("center");
  }
  if (!(typeof capture.resolution === "number" && Number.isFinite(capture.resolution) && capture.resolution > 0)) {
    missing.push("resolution");
  }
  if (
    capture.rotation != null &&
    (!(typeof capture.rotation === "number") || !Number.isFinite(capture.rotation))
  ) {
    missing.push("rotation");
  }
  if (!(typeof capture.width === "number" && Number.isFinite(capture.width) && capture.width > 0)) {
    missing.push("width");
  }
  if (!(typeof capture.height === "number" && Number.isFinite(capture.height) && capture.height > 0)) {
    missing.push("height");
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Point DP2 (px image plan masse) → pixel écran carte OpenLayers courante.
 * Même pipeline que la validation finale (zéro divergence preview / transform).
 */
function dp4ProjectDP2PointToCurrentMapPixel(point) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const map = window.DP4_OL_MAP;
  const cap = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (!map || !cap) return null;
  const w2 = cap.width ?? window.DP2_STATE?.backgroundImage?.width ?? 0;
  const h2 = cap.height ?? window.DP2_STATE?.backgroundImage?.height ?? 0;
  if (!(w2 > 0) || !(h2 > 0)) return null;
  const v = dp4ValidateDP2CaptureForImport(cap);
  if (!v.ok) return null;
  const coord = dp2Dp2ImagePixelTo3857Coord(point.x, point.y, cap, w2, h2);
  const pix = map.getPixelFromCoordinate(coord);
  if (!pix || pix.length < 2) return null;
  return { x: pix[0], y: pix[1] };
}

/**
 * Pixel image plan masse (DP2) → pixel de la capture carte DP4 (repère du canvas composite / image finale).
 * @param {{ x: number, y: number }} point
 * @param {object} originalDP2Capture — clone de la capture DP2 (plan masse), jamais écrasé avant projection.
 * @param {*} map — instance OpenLayers Map au moment de la capture (getPixelFromCoordinate).
 */
function dp4ProjectDP2PointToFinalCapturePixel(point, originalDP2Capture, map) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!originalDP2Capture || !map) return null;
  const w2 = originalDP2Capture.width ?? 0;
  const h2 = originalDP2Capture.height ?? 0;
  if (!(w2 > 0) || !(h2 > 0)) return null;
  const v = dp4ValidateDP2CaptureForImport(originalDP2Capture);
  if (!v.ok) return null;
  const coord = dp2Dp2ImagePixelTo3857Coord(point.x, point.y, originalDP2Capture, w2, h2);
  const pix = map.getPixelFromCoordinate(coord);
  if (!pix || pix.length < 2) return null;
  return { x: pix[0], y: pix[1] };
}

function dp4EnsureScreenOverlayCanvas() {
  if (window.DP4_IMPORT_OVERLAY_CANVAS) {
    const c = window.DP4_IMPORT_OVERLAY_CANVAS;
    const map = window.DP4_OL_MAP;
    if (map && typeof map.getSize === "function") {
      const s = map.getSize();
      if (s && s[0] > 0 && s[1] > 0 && (c.width !== s[0] || c.height !== s[1])) {
        c.width = s[0];
        c.height = s[1];
      }
    }
    return window.DP4_IMPORT_OVERLAY_CANVAS;
  }
  const mapEl = document.getElementById("dp4-ign-map");
  if (!mapEl || !mapEl.parentNode) return null;
  const wrapper = mapEl.parentNode; // dp-map-canvas
  const canvas = document.createElement("canvas");
  canvas.id = "dp4-import-overlay-canvas";
  canvas.style.cssText = "position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:5;";
  wrapper.appendChild(canvas);
  const map = window.DP4_OL_MAP;
  let w;
  let h;
  if (map && typeof map.getSize === "function") {
    const s = map.getSize();
    w = s && s[0] > 0 ? Math.floor(s[0]) : 1;
    h = s && s[1] > 0 ? Math.floor(s[1]) : 1;
  } else {
    const dpr = typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const r = wrapper.getBoundingClientRect();
    w = Math.max(1, Math.floor((r.width || 0) * dpr));
    h = Math.max(1, Math.floor((r.height || 0) * dpr));
  }
  canvas.width = w;
  canvas.height = h;
  window.DP4_IMPORT_OVERLAY_CANVAS = canvas;
  return canvas;
}

function dp4MakeAffineFromDp2ToMapPixels(sourceCapture, map) {
  if (!sourceCapture || !map || typeof map.getPixelFromCoordinate !== "function") return null;
  const w = sourceCapture.width;
  const h = sourceCapture.height;
  if (!(w > 0) || !(h > 0)) return null;
  const v = dp4ValidateDP2CaptureForImport(sourceCapture);
  if (!v.ok) return null;
  const p0 = map.getPixelFromCoordinate(dp2Dp2ImagePixelTo3857Coord(0, 0, sourceCapture, w, h));
  const pX = map.getPixelFromCoordinate(dp2Dp2ImagePixelTo3857Coord(w, 0, sourceCapture, w, h));
  const pY = map.getPixelFromCoordinate(dp2Dp2ImagePixelTo3857Coord(0, h, sourceCapture, w, h));
  if (!p0 || !pX || !pY) return null;
  const a = (pX[0] - p0[0]) / w;
  const b = (pX[1] - p0[1]) / w;
  const c = (pY[0] - p0[0]) / h;
  const d = (pY[1] - p0[1]) / h;
  const e = p0[0];
  const f = p0[1];
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  return { a, b, c, d, e, f, sourceWidth: w, sourceHeight: h };
}

function dp4ApplyAffinePoint(p, tr) {
  if (!p || !tr || typeof p.x !== "number" || typeof p.y !== "number") return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return {
    x: tr.a * p.x + tr.c * p.y + tr.e,
    y: tr.b * p.x + tr.d * p.y + tr.f
  };
}

function dp4TransformDp2PixelObjectDeep(value, tr) {
  if (Array.isArray(value)) {
    return value.map((item) => dp4TransformDp2PixelObjectDeep(item, tr));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = dp4TransformDp2PixelObjectDeep(value[k], tr);
  }
  if (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  ) {
    const p = dp4ApplyAffinePoint({ x: value.x, y: value.y }, tr);
    if (p) {
      out.x = p.x;
      out.y = p.y;
    }
  }
  return out;
}

function dp4BuildTransparentDp2DrawingCanvas(sourceState, sourceCapture) {
  const w = sourceCapture?.width;
  const h = sourceCapture?.height;
  if (!(w > 0) || !(h > 0)) return null;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  return dp4WithTemporaryDp2State(sourceState, function () {
    try {
      if (typeof renderDP2BuildingContour === "function") {
        const contours = typeof dp2GetBuildingContours === "function" ? dp2GetBuildingContours() : [];
        for (const contour of contours) renderDP2BuildingContour(ctx, contour, { active: false });
      }
    } catch (_) {}

    const objects = window.DP2_STATE?.objects || [];
    for (const obj of objects) {
      if (!obj || !obj.type) continue;
      try {
        if (obj.type === "measure_line" && typeof renderMeasureLine === "function") renderMeasureLine(ctx, obj, null);
        else if (obj.type === "ridge_line" && typeof renderRidgeLine === "function") renderRidgeLine(ctx, obj, null);
        else if (obj.type === "gutter_height_dimension" && typeof renderGutterHeightDimension === "function") renderGutterHeightDimension(ctx, obj, null);
        else if (obj.type === "rectangle" && typeof renderRectangle === "function") renderRectangle(ctx, obj);
        else if (obj.type === "pv_panel" && typeof renderPvPanel === "function") renderPvPanel(ctx, obj);
        else if (obj.type === "line" && typeof renderLine === "function") renderLine(ctx, obj);
        else if (obj.type === "circle" && typeof renderCircle === "function") renderCircle(ctx, obj);
        else if (obj.type === "polygon" && typeof renderPolygon === "function") renderPolygon(ctx, obj);
        else if (obj.type === "text" && typeof renderText === "function") renderText(ctx, obj);
      } catch (_) {}
    }

    try {
      const panels = window.DP2_STATE?.panels || [];
      if (typeof renderDP2Panel === "function") {
        for (const panel of panels) renderDP2Panel(ctx, panel);
      }
    } catch (_) {}
    try {
      const businessObjects = window.DP2_STATE?.businessObjects || [];
      if (typeof renderDP2BusinessObject === "function") {
        for (const obj of businessObjects) renderDP2BusinessObject(ctx, obj);
      }
    } catch (_) {}
    try {
      const textObjects = window.DP2_STATE?.textObjects || [];
      if (typeof renderDP2TextObject === "function") {
        for (const obj of textObjects) renderDP2TextObject(ctx, obj);
      }
    } catch (_) {}
    return out;
  });
}

function dp4DrawFrozenDp2BeforeOverlay() {
  const cat = window.DP4_STATE?.photoCategory ?? null;
  if (cat !== "before") {
    window.__snDpAlert("L'import DP2 est disponible uniquement pour la DP4 avant travaux.");
    return false;
  }
  const source = dp4GetDp2BeforeImportSource();
  if (!source.ok) {
    window.__snDpAlert("Import DP2 impossible : aucune DP2 avant travaux exploitable.");
    return false;
  }
  const map = window.DP4_OL_MAP;
  const overlay = dp4EnsureScreenOverlayCanvas();
  if (!map || !overlay) return false;
  const cap = source.capture;
  const v = dp4ValidateDP2CaptureForImport(cap);
  if (!v.ok) {
    window.__snDpAlert("Import DP2 impossible : la capture DP2 avant travaux ne contient pas les repères nécessaires.");
    return false;
  }
  const drawing = dp4BuildTransparentDp2DrawingCanvas(source.state, cap);
  const tr = dp4MakeAffineFromDp2ToMapPixels(cap, map);
  if (!drawing || !tr) return false;

  const ctx = overlay.getContext("2d");
  if (!ctx) return false;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.save();
  ctx.setTransform(tr.a, tr.b, tr.c, tr.d, tr.e, tr.f);
  ctx.drawImage(drawing, 0, 0);
  ctx.restore();

  const view = map.getView();
  window.DP4_IMPORT_DP2_ACTIVE = true;
  window.DP4_IMPORT_VIEW_SNAPSHOT = view
    ? {
      center: view.getCenter()?.slice?.() || null,
      resolution: view.getResolution(),
      rotation: view.getRotation()
    }
    : null;
  window.DP4_IMPORT_DP2_FROZEN_TRANSFORM = dp4ClonePlain(tr, tr);
  dp4HideImportStaleMessage();
  return true;
}

function dp4ImportViewSnapshotDiffersFromMap(snap, map) {
  if (!snap || !map || !map.getView) return false;
  const v = map.getView();
  if (!v) return false;
  const c = v.getCenter();
  const r = v.getResolution();
  const rot = v.getRotation();
  const EPS_C = 1e-3;
  const EPS_R = 1e-9;
  if (!Array.isArray(c) || !Array.isArray(snap.center) || c.length < 2 || snap.center.length < 2) return true;
  if (Math.abs(c[0] - snap.center[0]) > EPS_C || Math.abs(c[1] - snap.center[1]) > EPS_C) return true;
  if (!(typeof r === "number" && Number.isFinite(r) && typeof snap.resolution === "number" && Number.isFinite(snap.resolution))) {
    return true;
  }
  if (Math.abs(r - snap.resolution) > EPS_R * Math.max(1, Math.abs(snap.resolution))) return true;
  const ra = typeof rot === "number" && Number.isFinite(rot) ? rot : 0;
  const rb = typeof snap.rotation === "number" && Number.isFinite(snap.rotation) ? snap.rotation : 0;
  if (Math.abs(ra - rb) > 1e-5) return true;
  return false;
}

function dp4EnsureImportStaleHintEl() {
  const host = document.getElementById("dp4-ign-map");
  const wrap = host && host.parentNode ? host.parentNode : null;
  if (!wrap) return null;
  let el = document.getElementById("dp4-import-stale-hint");
  if (el) return el;
  el = document.createElement("div");
  el.id = "dp4-import-stale-hint";
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:absolute;left:8px;right:8px;bottom:8px;z-index:8;background:rgba(17,24,39,0.92);color:#fef3c7;padding:8px 10px;border-radius:6px;font-size:13px;display:none;pointer-events:none;";
  el.textContent = "Carte modifiée : recliquez sur Importer DP2 pour mettre à jour l’aperçu.";
  wrap.appendChild(el);
  return el;
}

function dp4ShowImportStaleMessage() {
  const el = dp4EnsureImportStaleHintEl();
  if (el) el.style.display = "block";
}

function dp4HideImportStaleMessage() {
  const el = document.getElementById("dp4-import-stale-hint");
  if (el) el.style.display = "none";
}

function dp4ClearImportOverlayPixelsOnly() {
  const c = window.DP4_IMPORT_OVERLAY_CANVAS;
  if (!c) return;
  const ctx = c.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, c.width, c.height);
}

function dp4UnbindImportStaleGuardOnMapMove() {
  const map = window.DP4_OL_MAP;
  const h = window.DP4_IMPORT_STALE_MOVEEND_HANDLER;
  if (map && typeof map.un === "function" && typeof h === "function") {
    try {
      map.un("moveend", h);
    } catch (_) {}
  }
  window.DP4_IMPORT_STALE_MOVEEND_HANDLER = null;
}

function dp4BindImportStaleGuardOnMapMove() {
  dp4UnbindImportStaleGuardOnMapMove();
  // Le nouveau garde-fou DP4 garde le dessin DP2 fixe en pixels écran.
  // La carte peut donc bouger dessous sans invalider l'overlay.
}

function dp4RemoveScreenOverlayCanvas() {
  dp4UnbindImportStaleGuardOnMapMove();
  window.DP4_IMPORT_VIEW_SNAPSHOT = null;
  window.DP4_IMPORT_DP2_FROZEN_TRANSFORM = null;
  dp4HideImportStaleMessage();
  if (window.DP4_IMPORT_OVERLAY_CANVAS) {
    try {
      window.DP4_IMPORT_OVERLAY_CANVAS.remove();
    } catch (_) {}
    window.DP4_IMPORT_OVERLAY_CANVAS = null;
  }
}

function dp4DrawDP2ContourOnScreenOverlay() {
  /* DP4 : contour carte = baseFeatures (OpenLayers) uniquement — plus d’overlay import plan→carte. */
}

/**
 * Remplit les `building_outline` de DP4_STATE[cat].roofGeometry depuis DP4_STATE.baseFeatures (EPSG:3857).
 */
function dp4SeedRoofGeometryFromBaseFeatures(cat) {
  if (cat !== "before" && cat !== "after") return;
  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  const stateCat = window.DP4_STATE[cat];
  if (!stateCat) return;
  const bf = Array.isArray(window.DP4_STATE.baseFeatures) ? window.DP4_STATE.baseFeatures : [];
  const outlines = [];
  for (let i = 0; i < bf.length; i++) {
    const f = bf[i];
    if (!f || f.type !== "polygon" || !Array.isArray(f.coordinates)) continue;
    const pts = [];
    for (let j = 0; j < f.coordinates.length; j++) {
      const c = f.coordinates[j];
      if (!Array.isArray(c) || c.length < 2) continue;
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      pts.push({ x: c[0], y: c[1] });
    }
    if (pts.length < 3) continue;
    outlines.push({
      type: "building_outline",
      closed: f.closed === true,
      points: pts
    });
  }
  const rest = (stateCat.roofGeometry || []).filter((o) => o && o.type !== "building_outline");
  stateCat.roofGeometry = outlines.concat(rest);
}

function dp4SeedBeforePlanFromFrozenDp2Import() {
  const cat = window.DP4_STATE?.photoCategory ?? null;
  if (cat !== "before") return false;
  const source = dp4GetDp2BeforeImportSource();
  if (!source.ok) return false;
  const cap = source.capture;
  const v = dp4ValidateDP2CaptureForImport(cap);
  if (!v.ok) return false;
  // Si l'utilisateur bouge la carte apres "Importer DP2", l'overlay DP2 reste volontairement fige
  // a l'ecran. La validation doit donc reprendre ce que l'utilisateur voit, pas la geoloc DP2 initiale.
  const mapMovedAfterImport = dp4ImportViewSnapshotDiffersFromMap(
    window.DP4_IMPORT_VIEW_SNAPSHOT,
    window.DP4_OL_MAP
  );
  const tr =
    mapMovedAfterImport && window.DP4_IMPORT_DP2_FROZEN_TRANSFORM
      ? window.DP4_IMPORT_DP2_FROZEN_TRANSFORM
      : dp4MakeAffineFromDp2ToMapPixels(cap, window.DP4_OL_MAP) || window.DP4_IMPORT_DP2_FROZEN_TRANSFORM;
  if (!tr) return false;
  const stateCat = window.DP4_STATE?.before;
  if (!stateCat) return false;

  const roofGeometry = [];
  const features = Array.isArray(source.state?.features) ? source.state.features : [];
  for (const f of features) {
    if (!f || f.type !== "polygon" || !Array.isArray(f.coordinates)) continue;
    const points = [];
    for (const coord of f.coordinates) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
      const srcPx = dp2Dp2Image3857CoordToPixel(coord[0], coord[1], cap, cap.width, cap.height);
      const dst = dp4ApplyAffinePoint(srcPx, tr);
      if (dst) points.push(dst);
    }
    if (points.length >= 3) {
      roofGeometry.push({
        type: "building_outline",
        points,
        closed: f.closed === true
      });
    }
  }

  const objects = Array.isArray(source.state?.objects) ? source.state.objects : [];
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    if (obj.type === "building_outline") continue;
    roofGeometry.push(dp4TransformDp2PixelObjectDeep(obj, tr));
  }

  stateCat.roofGeometry = roofGeometry;
  stateCat.panels = dp4TransformDp2PixelObjectDeep(Array.isArray(source.state?.panels) ? source.state.panels : [], tr);
  stateCat.textObjects = dp4TransformDp2PixelObjectDeep(Array.isArray(source.state?.textObjects) ? source.state.textObjects : [], tr);
  stateCat.businessObjects = dp4TransformDp2PixelObjectDeep(Array.isArray(source.state?.businessObjects) ? source.state.businessObjects : [], tr);
  stateCat.history = [];

  try {
    window.DP4_STATE.baseFeatures = dp4ClonePlain(features, []);
    window.DP4_STATE._dp4BaseFeaturesSealed = true;
  } catch (_) {}
  return true;
}

/**
 * Passage carte ortho → éditeur toiture : contours bâtiment uniquement via baseFeatures (pas d’import pixel).
 * @param {object|null} _originalDP2Capture — ignoré (rétrocompat appelants)
 * @param {import("ol/Map").default|null} map — carte DP4 (garde-fou taille)
 */
function dp4TransformDP2GeometryToMapPixels(_originalDP2Capture, map) {
  void _originalDP2Capture;
  const catEarly = window.DP4_STATE?.photoCategory ?? null;
  if (catEarly !== "before" && catEarly !== "after") return false;
  if (map) {
    const size = map.getSize();
    if (!size || size[0] <= 0 || size[1] <= 0) return false;
  }

  window.DP4_STATE = window.DP4_STATE || dp4DefaultState();
  const stateCat = window.DP4_STATE[catEarly];
  if (!stateCat) return false;

  try {
    if (!dp4SeedBeforePlanFromFrozenDp2Import()) {
      dp4SeedRoofGeometryFromBaseFeatures(catEarly);
    }
  } catch (e) {
    console.warn("[DP4] seed roofGeometry depuis DP2/baseFeatures", e);
  }

  window.DP4_IMPORT_DP2_ACTIVE = false;

  try {
    dp4BeginEditorSession(catEarly);
    if (typeof dp4ApplyDp4CategoryGeometryToDp2Editor === "function") {
      dp4ApplyDp4CategoryGeometryToDp2Editor(catEarly);
    }
    try {
      if (typeof dp2SyncDp4RoofMeasuresMenuVisibility === "function") dp2SyncDp4RoofMeasuresMenuVisibility();
    } catch (_) {}
  } catch (_) {}
  return true;
}

/** @deprecated Conservé pour compat ; la géométrie toiture vient de baseFeatures, plus d’import plan→carte. */
function dp4TransformDP2ToDP4PixelsFromCurrentMapView(opts) {
  const force = !!(opts && opts.force);
  if (!force && !window.DP4_IMPORT_DP2_ACTIVE) return;
  const cat = window.DP4_STATE?.photoCategory ?? null;
  if (cat !== "before" && cat !== "after") return;
  const map = window.DP4_OL_MAP;
  if (!map) return;
  dp4TransformDP2GeometryToMapPixels(null, map);
}

/** Heuristique : composite probablement vide / tuiles grises non chargées. */
function dp4RasterCompositeProbablyBlank(ctx, w, h) {
  if (!(w > 1 && h > 1) || !ctx || !ctx.getImageData) return true;
  const stepX = Math.max(1, Math.floor(w / 10));
  const stepY = Math.max(1, Math.floor(h / 10));
  const lums = [];
  let opaqueCount = 0;
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      let d;
      try {
        d = ctx.getImageData(x, y, 1, 1).data;
      } catch (_) {
        return false;
      }
      if (d[3] > 16) opaqueCount++;
      lums.push((d[0] + d[1] + d[2]) / 3);
    }
  }
  if (!lums.length) return true;
  if (opaqueCount < Math.max(6, lums.length * 0.15)) return true;
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const variance = lums.reduce((a, v) => a + (v - mean) * (v - mean), 0) / lums.length;
  return variance < 25 && mean > 70;
}

async function dp4WaitOrthoTilesIdle(map, timeoutMs) {
  const timeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 4500;
  const start = Date.now();
  const source = window.DP4_ORTHO_SOURCE || null;
  if (map) {
    try {
      map.updateSize();
      map.renderSync();
    } catch (_) {}
  }
  await new Promise((resolve) => {
    function done() {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }
    function check() {
      const loading = Math.max(0, window.DP4_ORTHO_TILES_LOADING || 0);
      let stateReady = true;
      try {
        stateReady = !source || typeof source.getState !== "function" || source.getState() === "ready";
      } catch (_) {}
      if ((loading === 0 && stateReady) || Date.now() - start >= timeout) {
        done();
        return;
      }
      setTimeout(check, 80);
    }
    check();
  });
  if (map) {
    try {
      await new Promise((resolve) => {
        map.once("rendercomplete", resolve);
        map.renderSync();
      });
    } catch (_) {}
  }
}

/**
 * Test console temporaire : centre + 4 coins DP2 → coord monde → pixel DP4 ; delta vs centre/coins carte DP4.
 * Exposer `window.__DP4_DEBUG_ALIGN_DP2_DP4()` pour relancer après resize.
 */
function dp4DebugPixelAlignmentDp2ToDp4Once(map) {
  const cap =
    window.DP2_STATE &&
    (typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE.capture);
  const v = dp4ValidateDP2CaptureForImport(cap);
  if (!v.ok || !map || typeof map.getSize !== "function") {
    console.log("[DP4][ALIGN_TEST] skip", { ok: v.ok, missing: v.missing, hasMap: !!map });
    return;
  }
  const w = cap.width;
  const h = cap.height;
  const size = map.getSize();
  if (!size || !(size[0] > 0) || !(size[1] > 0)) {
    console.log("[DP4][ALIGN_TEST] skip (map sans taille)");
    return;
  }
  const sw = size[0];
  const sh = size[1];
  if (Math.abs(sw - w) > 1 || Math.abs(sh - h) > 1) {
    console.warn("[DP4][ALIGN_TEST] tailles DP2 capture vs DP4 map différentes", { dp2Wh: [w, h], dp4Wh: [sw, sh] });
  }
  const refCenter = { x: sw / 2, y: sh / 2 };
  const refCorners = [
    { name: "TL", x: 0, y: 0 },
    { name: "TR", x: sw, y: 0 },
    { name: "BR", x: sw, y: sh },
    { name: "BL", x: 0, y: sh }
  ];
  const dp2Pts = [
    { name: "center", x: w / 2, y: h / 2 },
    { name: "TL", x: 0, y: 0 },
    { name: "TR", x: w, y: 0 },
    { name: "BR", x: w, y: h },
    { name: "BL", x: 0, y: h }
  ];
  const refList = [
    { name: "center", ...refCenter },
    ...refCorners
  ];
  const deltas = [];
  for (let i = 0; i < dp2Pts.length; i++) {
    const p = dp2Pts[i];
    const ref = refList[i];
    const coord = dp2Dp2ImagePixelTo3857Coord(p.x, p.y, cap, w, h);
    const pix = map.getPixelFromCoordinate(coord);
    if (!pix || pix.length < 2) {
      deltas.push({ name: p.name, err: "no_pixel" });
      continue;
    }
    const dx = pix[0] - ref.x;
    const dy = pix[1] - ref.y;
    deltas.push({
      name: p.name,
      dp2Px: [p.x, p.y],
      dp4Px: [pix[0], pix[1]],
      refPx: [ref.x, ref.y],
      deltaPx: [dx, dy],
      deltaLen: Math.hypot(dx, dy)
    });
  }
  console.log("[DP4][ALIGN_TEST] centre + coins (delta px, objectif ~0)", deltas);
}

window.__DP4_DEBUG_ALIGN_DP2_DP4 = function () {
  if (window.DP4_OL_MAP) dp4DebugPixelAlignmentDp2ToDp4Once(window.DP4_OL_MAP);
};

// ======================================================
// DP4 — OPENLAYERS IGN ORTHO (remplace Google Maps)
// Grille WMTS PM comme DP2 ; couche tuiles = ORTHO uniquement côté DP4 (DP2 = PLAN IGN V2).
// ======================================================
function dp4InitIgnOrthoMap(onReady) {
  const host = document.getElementById("dp4-ign-map");
  if (!host || typeof ol === "undefined") return;

  const WMTS_ORIGIN = [-20037508, 20037508];
  const WMTS_RESOLUTIONS = [
    156543.03392804103, 78271.51696402051, 39135.75848201024,
    19567.87924100512, 9783.93962050256, 4891.96981025128,
    2445.98490512564, 1222.99245256282, 611.49622628141,
    305.748113140705, 152.8740565703525, 76.43702828517625,
    38.21851414258813, 19.109257071294063, 9.554628535647032,
    4.777314267823516, (2.3 + 0.088657133911758), 1.194328566955879,
    0.5971642834779395, 0.29858214173896974, 0.14929107086948487
  ];

  function nearestWmtsResolution(targetRes) {
    if (targetRes == null || typeof targetRes !== "number" || !Number.isFinite(targetRes) || targetRes <= 0) {
      return WMTS_RESOLUTIONS[Math.min(17, WMTS_RESOLUTIONS.length - 1)];
    }
    let best = WMTS_RESOLUTIONS[0];
    let bestDiff = Math.abs(WMTS_RESOLUTIONS[0] - targetRes);
    for (let i = 1; i < WMTS_RESOLUTIONS.length; i++) {
      const d = Math.abs(WMTS_RESOLUTIONS[i] - targetRes);
      if (d < bestDiff) {
        bestDiff = d;
        best = WMTS_RESOLUTIONS[i];
      }
    }
    return best;
  }

  const WMTS_MATRIX_IDS = WMTS_RESOLUTIONS.map((_, i) => String(i));
  const wmtsGridPM = new ol.tilegrid.WMTS({
    origin: WMTS_ORIGIN,
    resolutions: WMTS_RESOLUTIONS,
    matrixIds: WMTS_MATRIX_IDS
  });

  const dp2BeforeSourceForMap =
    window.DP4_STATE?.photoCategory === "before" ? dp4GetDp2BeforeImportSource() : { ok: false };
  const dp2PlanForMap =
    dp2BeforeSourceForMap.ok
      ? dp2BeforeSourceForMap.capture
      : window.DP2_STATE &&
        (typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE.capture);
  const hasDP2Capture = !!(dp2PlanForMap && Array.isArray(dp2PlanForMap.center));

  function dp4ExactWmtsResolutionIndex(dp2Res, list) {
    if (!(typeof dp2Res === "number" && Number.isFinite(dp2Res) && dp2Res > 0) || !list || !list.length) {
      return -1;
    }
    const strict = list.indexOf(dp2Res);
    if (strict >= 0) return strict;
    for (let i = 0; i < list.length; i++) {
      const ri = list[i];
      if (Math.abs(ri - dp2Res) <= 1e-8 * Math.max(Math.abs(ri), Math.abs(dp2Res), 1e-12)) return i;
    }
    return -1;
  }

  let center, resolution, rotation;
  if (hasDP2Capture) {
    center = dp2PlanForMap.center;
    rotation = dp2PlanForMap.rotation || 0;
    const dp2Res = dp2PlanForMap.resolution;
    const cranIdx = dp4ExactWmtsResolutionIndex(dp2Res, WMTS_RESOLUTIONS);
    if (cranIdx >= 0) {
      resolution = WMTS_RESOLUTIONS[cranIdx];
    } else {
      resolution = nearestWmtsResolution(dp2Res);
    }
    const exactCran = cranIdx >= 0;
    console.log("[DP4][WMTS_RES]", {
      dp2Resolution: dp2Res,
      dp4Resolution: resolution,
      exactWmtsCran: exactCran,
      cranIdx: cranIdx >= 0 ? cranIdx : null
    });
    if (
      !exactCran &&
      typeof dp2Res === "number" &&
      Number.isFinite(dp2Res) &&
      dp2Res > 0 &&
      typeof resolution === "number" &&
      Number.isFinite(resolution) &&
      resolution > 0
    ) {
      const deltaPct = (Math.abs(resolution - dp2Res) / dp2Res) * 100;
      console.log("[DP4][WMTS_RES_SNAP]", {
        dp2Resolution: dp2Res,
        dp4Resolution: resolution,
        deltaPct: Number(deltaPct.toFixed(4))
      });
    }
  } else {
    const { center: centerWgs, zoom: zoomWgs } = dpGetProjectCenterForGoogleMaps();
    center = ol.proj.fromLonLat([centerWgs.lng, centerWgs.lat]);
    rotation = 0;
    const viewTemp = new ol.View({ projection: "EPSG:3857" });
    const rawRes = viewTemp.getResolutionForZoom(zoomWgs);
    resolution = nearestWmtsResolution(rawRes);
  }

  const orthoSource = new ol.source.WMTS({
    url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
    layer: "ORTHOIMAGERY.ORTHOPHOTOS",
    matrixSet: "PM",
    format: "image/jpeg",
    style: "normal",
    tileGrid: wmtsGridPM,
    wrapX: false,
    crossOrigin: "anonymous"
  });
  window.DP4_ORTHO_SOURCE = orthoSource;
  window.DP4_ORTHO_TILES_LOADING = 0;
  try {
    orthoSource.on("tileloadstart", function () {
      window.DP4_ORTHO_TILES_LOADING = Math.max(0, (window.DP4_ORTHO_TILES_LOADING || 0) + 1);
    });
    const onTileDone = function () {
      window.DP4_ORTHO_TILES_LOADING = Math.max(0, (window.DP4_ORTHO_TILES_LOADING || 0) - 1);
    };
    orthoSource.on("tileloadend", onTileDone);
    orthoSource.on("tileloaderror", onTileDone);
  } catch (_) {}

  const orthoLayer = new ol.layer.Tile({
    source: orthoSource
  });

  const view = new ol.View({
    projection: "EPSG:3857",
    center: center,
    rotation: rotation,
    resolutions: WMTS_RESOLUTIONS,
    constrainResolution: true,
    resolution: resolution
  });

  // Pas de propriété controls : même syntaxe que DP2 (ol.Map utilise les contrôles par défaut en OL 10.7)
  window.DP4_OL_MAP = new ol.Map({
    target: "dp4-ign-map",
    layers: [orthoLayer],
    view: view,
    pixelRatio: Math.min(2, window.devicePixelRatio || 1)
  });

  applySafeInitialResolution(
    window.DP4_OL_MAP,
    resolution,
    WMTS_RESOLUTIONS
  );

  try {
    forceFirstPaintWMTS(
      window.DP4_OL_MAP,
      orthoSource,
      WMTS_RESOLUTIONS
    );
  } catch (_) {}

  window.DP4_OL_MAP.once("rendercomplete", function dp4FirstRenderAlignTest() {
    try {
      dp4EnsureBaseFeaturesFromDp2FrozenOnce();
      dp4MountVectorLayersFromState(window.DP4_OL_MAP);
      dp4ApplyCapturePreviewToMapView(window.DP4_OL_MAP);
    } catch (e) {
      console.warn("[DP4] couches vectorielles / vue capture_preview", e);
    }
    try {
      if (hasDP2Capture) dp4DebugPixelAlignmentDp2ToDp4Once(window.DP4_OL_MAP);
    } catch (e) {
      console.warn("[DP4][ALIGN_TEST]", e);
    }
    if (typeof onReady === "function") onReady();
  });
}

/** Listener moveend pour repositionner le hint (démonté avant destroy map) */
window.DP4_MAP_HINT_MOVE_END = null;

function dp4UnbindMapCursorHintMoveEnd() {
  const map = window.DP4_OL_MAP;
  const handler = window.DP4_MAP_HINT_MOVE_END;
  if (handler) {
    if (map) {
      try {
        map.un("moveend", handler);
      } catch (_) {}
    }
    window.DP4_MAP_HINT_MOVE_END = null;
  }
}

function dp4HideMapCursorHint() {
  dp4UnbindMapCursorHintMoveEnd();
  const hint = document.getElementById("dp4-cursor-hint");
  if (hint) {
    hint.dataset.dismissed = "1";
    hint.setAttribute("hidden", "");
    hint.style.display = "none";
    console.log("DP4_CURSOR_HIDE");
  }
}

function dp4ShowMapCursorHint() {
  const hint = document.getElementById("dp4-cursor-hint");
  const map = window.DP4_OL_MAP;
  if (!hint || !map) return;
  try {
    delete hint.dataset.dismissed;
  } catch (_) {}
  dp4UnbindMapCursorHintMoveEnd();

  function updatePos() {
    if (!hint || hint.dataset.dismissed === "1" || !window.DP4_OL_MAP) return;
    const view = map.getView();
    if (!view) return;
    const pix = map.getPixelFromCoordinate(view.getCenter());
    if (!pix || pix.length < 2) return;
    hint.style.display = "block";
    hint.removeAttribute("hidden");
    hint.style.left = `${pix[0]}px`;
    hint.style.top = `${pix[1]}px`;
  }

  const onMoveEnd = function () {
    updatePos();
  };
  window.DP4_MAP_HINT_MOVE_END = onMoveEnd;
  map.on("moveend", onMoveEnd);
  console.log("DP4_CURSOR_SHOW");
  updatePos();
}

// ======================================================
// DP4 — SUPPRESSION PLAN
// ======================================================
async function dp4DeletePlan(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  if (
    !(await window.__snDpConfirm("Supprimer définitivement ce plan DP4 ?", {
      title: "Supprimer le plan DP4",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
      details: cat === "before" ? "Plan avant travaux" : "Plan après travaux",
    }))
  ) return;

  try {
    dp4ResetDp4BaseFeaturesSeal();
  } catch (_) {}

  // 1️⃣ Supprimer plan actif
  if (window.DP4_STATE?.plans) {
    window.DP4_STATE.plans[cat] = null;
  }

  // 2️⃣ Supprimer rendu final
  try {
    const store = dp4FinalLoadStore();
    store[cat] = null;
    dp4FinalSaveStore(store);
  } catch (_) {}

  // 3️⃣ Sauvegarder état propre
  dp4SaveState(window.DP4_STATE);

  // 4️⃣ Reset runtime
  window.DP4_CAPTURE_IMAGE = null;

  // 5️⃣ Rafraîchir miniatures
  dp4RenderEntryMiniatures();
}

// ======================================================
// DP4 — INIT (UI MINIMALE)
