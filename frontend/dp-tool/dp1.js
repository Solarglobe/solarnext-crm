// Extracted from dp-app.js. Loaded after dp-app.js in legacy script order.
// ======================================================
// DP1 — STATE GLOBAL (mode / validation / parcelle / centroid)
// Source unique côté front pour piloter DP1 et stocker ensuite en localStorage
// ======================================================
window.DP1_STATE = window.DP1_STATE || {
  // mode de travail carte
  currentMode: "strict", // "strict" | "libre"

  // validation utilisateur
  isValidated: false,

  // parcelle / résultat cadastre courant (quand on l’ajoutera)
  selectedParcel: null, // ex: { section, numero, surface_m2, ... }

  // dernier centroid utilisé comme vérité (lat/lon WGS84)
  lastCentroid: null, // ex: { lat: 48.85, lon: 2.34 }

  // point courant manipulé (avant validation)
  currentPoint: null, // ex: { lat, lon }

  /** aperçus des vues (synchros avec les versions, voir dp1SnapshotImages côté brouillon) */
  dp1SnapshotImages: {},

  dp1Versions: [],
  dp1ActiveVersionId: null,
};

function dp1MarkDirty() {
  if (!window.DP1_STATE) return;
  window.DP1_STATE.isValidated = false;
  window.DP1_STATE.selectedParcel = null;
  window.DP1_STATE.lastCentroid = null;
}

// ======================================================
// Phase 2 — Restauration depuis lead_dp.state_json (hydrate mémoire + DOM au initDP*)
// ======================================================

/** Extrait une URL / data URL exploitable depuis tout format d’image draft (string, { base64 }, { dataUrl }, …). */
function getImageSrc(img) {
  if (img == null) return null;
  if (typeof img === "string") {
    var t = img.trim();
    return t || null;
  }
  if (typeof img === "object") {
    if (img.dataUrl != null && String(img.dataUrl).trim()) return String(img.dataUrl).trim();
    if (img.src != null && String(img.src).trim()) return String(img.src).trim();
    if (img.base64 != null) {
      var b = String(img.base64).trim();
      if (!b) return null;
      if (b.indexOf("data:") === 0) return b;
      return "data:image/png;base64," + b.replace(/^data:image\/\w+;base64,/, "");
    }
  }
  return null;
}

function dp1ImageSrcIsRenderable(src) {
  if (!src || typeof src !== "string") return false;
  if (src.indexOf("data:image") === 0) return true;
  if (/^https?:\/\//i.test(src)) return true;
  if (/^blob:/i.test(src)) return true;
  return false;
}

/** Fusionne les clés images possibles (racine dp1, anciens drafts sous state.images). */
function resolveDp1ImagesFromDraftFragment(d1) {
  if (!d1 || typeof d1 !== "object") return {};
  var base = d1.images && typeof d1.images === "object" ? d1.images : {};
  var nested = d1.state && d1.state.images && typeof d1.state.images === "object" ? d1.state.images : {};
  return Object.assign({}, nested, base);
}

function draftGetDp1Fragment() {
  try {
    var d = window.DpDraftStore && window.DpDraftStore.getDraft && window.DpDraftStore.getDraft();
    if (!d || typeof d !== "object") return null;
    return d.dp1 || (d.dp && d.dp.dp1) || null;
  } catch (_) {
    return null;
  }
}

function draftDp1IndicatesRestore() {
  try {
    var d1 = draftGetDp1Fragment();
    if (!d1) return false;
    var imgs = resolveDp1ImagesFromDraftFragment(d1);
    if (getImageSrc(imgs.view_20000) || getImageSrc(imgs.view_5000) || getImageSrc(imgs.view_650)) return true;
    if (
      d1.state &&
      (d1.state.isValidated ||
        (d1.state.selectedParcel &&
          (d1.state.selectedParcel.section ||
            d1.state.selectedParcel.numero ||
            d1.state.selectedParcel.parcel)))
    )
      return true;
    return false;
  } catch (_) {
    return false;
  }
}

/** DP1_STATE vierge (ré-entrée lead / hydrate sans section brouillon). */
function __snDpFreshDp1State() {
  return {
    currentMode: "strict",
    isValidated: false,
    selectedParcel: null,
    lastCentroid: null,
    currentPoint: null,
    dp1SnapshotImages: {},
    dp1Versions: [],
    dp1ActiveVersionId: null
  };
}

function hydrateDP1(data) {
  if (!data || typeof data !== "object") return;
  if (!window.DP1_STATE) window.DP1_STATE = __snDpFreshDp1State();
  if (Object.keys(data).length === 0) {
    window.DP1_STATE = __snDpFreshDp1State();
    return;
  }

  var s = data.state && typeof data.state === "object" ? data.state : {};
  var selectedParcel = null;
  if (s.selectedParcel != null && typeof s.selectedParcel === "object") {
    selectedParcel = s.selectedParcel;
  } else if (data.selectedParcel != null && typeof data.selectedParcel === "object") {
    selectedParcel = data.selectedParcel;
  }

  Object.assign(window.DP1_STATE, {
    currentMode: s.currentMode != null ? s.currentMode : window.DP1_STATE.currentMode,
    isValidated: !!s.isValidated,
    selectedParcel: selectedParcel,
    lastCentroid: s.lastCentroid != null ? s.lastCentroid : data.lastCentroid != null ? data.lastCentroid : null,
    currentPoint: s.currentPoint != null ? s.currentPoint : data.currentPoint != null ? data.currentPoint : null,
  });
  try {
    if (Array.isArray(s.dp1Versions)) {
      window.DP1_STATE.dp1Versions = JSON.parse(JSON.stringify(s.dp1Versions));
    }
    if (s.dp1ActiveVersionId != null && s.dp1ActiveVersionId !== "") {
      window.DP1_STATE.dp1ActiveVersionId = s.dp1ActiveVersionId;
    }
    if (s.dp1SnapshotImages && typeof s.dp1SnapshotImages === "object") {
      window.DP1_STATE.dp1SnapshotImages = JSON.parse(JSON.stringify(s.dp1SnapshotImages));
    }
  } catch (_) {}
  try {
    if (data.images && typeof data.images === "object") {
      window.DP1_STATE.dp1SnapshotImages = Object.assign(
        {},
        window.DP1_STATE.dp1SnapshotImages || {},
        data.images
      );
    }
  } catch (_) {}
  if (data.context && typeof data.context === "object") {
    window.DP1_CONTEXT = Object.assign({}, data.context);
  }
}

function mergeDp1ContextFromDraft() {
  try {
    var d1 = draftGetDp1Fragment();
    var c = d1 && d1.context;
    if (!c || typeof c !== "object") return;
    if (!window.DP1_CONTEXT) window.DP1_CONTEXT = {};
    var forbidden = ["adresse", "cp", "ville", "lat", "lon"];
    var k;
    for (k in c) {
      if (!Object.prototype.hasOwnProperty.call(c, k)) continue;
      if (forbidden.indexOf(k) !== -1) continue;
      window.DP1_CONTEXT[k] = c[k];
    }
    __solarnextWriteScopedStorage("dp1_context", JSON.stringify(window.DP1_CONTEXT));
  } catch (_) {}
}

function applyDP1DraftImagesToDom() {
  try {
    var d1 = draftGetDp1Fragment();
    var imgs = resolveDp1ImagesFromDraftFragment(d1 || {});

    var anyImg = false;

    function injectIntoDp1View(scale, slotFallbackSel, rawSrc) {
      var src = getImageSrc(rawSrc);
      if (!src || !dp1ImageSrcIsRenderable(src)) return false;
      var root =
        document.querySelector('[data-dp1-view="' + scale + '"]') || document.querySelector(slotFallbackSel);
      if (!root) return false;
      var existing = root.querySelector(".dp-generated img");
      if (!existing) existing = root.querySelector(":scope img");
      if (existing && root.contains(existing)) {
        existing.src = src;
        existing.alt = "DP1 vue";
        return true;
      }
      root.textContent = "";
      var wrap = document.createElement("div");
      wrap.className = "dp-generated";
      var im = document.createElement("img");
      im.alt = "DP1 vue";
      im.src = src;
      wrap.appendChild(im);
      root.appendChild(wrap);
      return true;
    }

    if (injectIntoDp1View("20000", '[data-slot="dp1-view-1"]', imgs.view_20000)) anyImg = true;
    if (injectIntoDp1View("5000", '[data-slot="dp1-view-2"]', imgs.view_5000)) anyImg = true;
    if (injectIntoDp1View("650", '[data-slot="dp1-view-3"]', imgs.view_650)) anyImg = true;

    if (anyImg && window.DP1_UI && typeof window.DP1_UI.setState === "function") {
      window.DP1_UI.setState("GENERATED");
    }

    if (typeof refreshDP1ParcelleUI === "function") refreshDP1ParcelleUI();

    requestAnimationFrame(function () {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch (_) {}
    });
  } catch (e) {
    console.warn("[DP1] applyDP1DraftImagesToDom", e);
  }
}

/** Applique les miniatures DP1 depuis DP1_STATE.dp1SnapshotImages (changement de version). */
function dp1ApplyDp1SnapshotImagesToDom() {
  try {
    var s = window.DP1_STATE;
    if (!s || !s.dp1SnapshotImages || typeof s.dp1SnapshotImages !== "object") return;

    var imgs = s.dp1SnapshotImages;
    var anyImg = false;

    function injectIntoDp1View(scale, slotFallbackSel, rawSrc) {
      var src = getImageSrc(rawSrc);
      if (!src || !dp1ImageSrcIsRenderable(src)) return false;
      var root =
        document.querySelector('[data-dp1-view="' + scale + '"]') || document.querySelector(slotFallbackSel);
      if (!root) return false;
      var existing = root.querySelector(".dp-generated img");
      if (existing && root.contains(existing)) {
        existing.src = src;
        existing.alt = "DP1 vue";
        return true;
      }
      root.textContent = "";
      var wrap = document.createElement("div");
      wrap.className = "dp-generated";
      var im = document.createElement("img");
      im.alt = "DP1 vue";
      im.src = src;
      wrap.appendChild(im);
      root.appendChild(wrap);
      return true;
    }

    if (injectIntoDp1View("20000", '[data-slot="dp1-view-1"]', imgs.view_20000)) anyImg = true;
    if (injectIntoDp1View("5000", '[data-slot="dp1-view-2"]', imgs.view_5000)) anyImg = true;
    if (injectIntoDp1View("650", '[data-slot="dp1-view-3"]', imgs.view_650)) anyImg = true;

    if (anyImg && window.DP1_UI && typeof window.DP1_UI.setState === "function") {
      window.DP1_UI.setState("GENERATED");
    }

    if (typeof refreshDP1ParcelleUI === "function") refreshDP1ParcelleUI();

    requestAnimationFrame(function () {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch (_) {}
    });
  } catch (e) {
    console.warn("[DP1] dp1ApplyDp1SnapshotImagesToDom", e);
  }
}

/**
 * Réhydratation légère au changement de vue (sans réinitialiser les modules ni recharger le HTML).
 */
function hydratePage(pagePath) {
  if (!pagePath || !window.DpDraftStore || typeof window.DpDraftStore.mapPathToPageId !== "function") return;
  var id = window.DpDraftStore.mapPathToPageId(pagePath);
  if (id === "dp1") {
    mergeDp1ContextFromDraft();
    applyDP1DraftImagesToDom();
    if (draftDp1IndicatesRestore() && window.DP1_UI && typeof window.DP1_UI.setState === "function") {
      window.DP1_UI.setState("GENERATED");
    }
  }
  if (id === "dp2") {
    try {
      dp2SanitizeVersionsInPlace();
      if (typeof dp2PruneRedundantEmptyVersionsInPlace === "function" && dp2PruneRedundantEmptyVersionsInPlace()) {
        if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
      }
    } catch (_) {}
    var planCapHydrate =
      typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE && window.DP2_STATE.capture;
    if (window.DP2_STATE && planCapHydrate && planCapHydrate.imageBase64) {
      var mapWrapR = document.getElementById("dp2-ign-map");
      if (mapWrapR) mapWrapR.style.display = "none";
      var imgWrapR = document.getElementById("dp2-captured-image-wrap");
      var imgElR = document.getElementById("dp2-captured-image");
      if (imgWrapR && imgElR) {
        var runEditor = function () {
          try {
            if (typeof initDP2Editor === "function") initDP2Editor();
            if (typeof window.renderDP2FromState === "function") window.renderDP2FromState();
          } catch (err) {
            console.warn("[DP2] hydratePage restore editor", err);
          }
        };
        imgElR.onload = runEditor;
        if (imgElR.src !== planCapHydrate.imageBase64) {
          imgElR.src = planCapHydrate.imageBase64;
        } else {
          requestAnimationFrame(runEditor);
        }
        imgWrapR.style.display = "block";
        if (imgElR.complete && imgElR.naturalWidth > 0) {
          requestAnimationFrame(runEditor);
        }
      }
      try {
        if (typeof setDP2ModeEdition === "function") setDP2ModeEdition();
      } catch (_) {}
    } else if (typeof window.renderDP2FromState === "function") {
      try {
        window.renderDP2FromState();
      } catch (_) {}
    }
    try {
      if (typeof dp2RenderEntryPanel === "function") dp2RenderEntryPanel();
    } catch (_) {}
    if (window.DP2_UI?.setState) {
      const ph = typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
      window.DP2_UI.setState(ph?.imageBase64 ? "GENERATED" : "EMPTY");
    }
    try {
      if (typeof dp2RefreshDocVersionMenu === "function") dp2RefreshDocVersionMenu();
    } catch (_) {}
  }
  if (id === "dp3" && typeof window.DP3_renderHome === "function") {
    try {
      window.DP3_renderHome();
    } catch (_) {}
  }
}

window.hydratePage = hydratePage;

function hydrateDP2(data) {
  if (!data || typeof data !== "object") return;
  if (!window.DP2_STATE) window.DP2_STATE = __snDpFreshDp2State();
  if (Object.keys(data).length === 0) {
    window.DP2_STATE = __snDpFreshDp2State();
    try {
      dp2SanitizeVersionsInPlace();
    } catch (_) {}
    try {
      if (typeof dp2RefreshDocVersionMenu === "function") dp2RefreshDocVersionMenu();
    } catch (_) {}
    return;
  }
  var k;
  for (k in data) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      window.DP2_STATE[k] = data[k];
    }
  }
  try {
    dp2SanitizeVersionsInPlace();
  } catch (_) {}
  try {
    if (typeof dp2PruneRedundantEmptyVersionsInPlace === "function" && dp2PruneRedundantEmptyVersionsInPlace()) {
      if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced("fast");
    }
  } catch (e) {
    console.warn("[DP2] prune versions vides après hydrate", e);
  }
  if (typeof dp2AfterHydrateMigrateVersions === "function") {
    try {
      dp2AfterHydrateMigrateVersions();
    } catch (e) {
      console.warn("[DP2] migrate versions après hydrate", e);
    }
  }
  if (typeof dp2RehydrateWorkingFromActiveVersionIfNeeded === "function") {
    try {
      dp2RehydrateWorkingFromActiveVersionIfNeeded();
    } catch (e) {
      console.warn("[DP2] rehydrate working depuis version active", e);
    }
  }
  try {
    if (typeof dp2RefreshDocVersionMenu === "function") dp2RefreshDocVersionMenu();
  } catch (_) {}
  if (window.DP2_STATE) {
    try {
      dp2ApplyFeaturesHydrateSync();
    } catch (e) {
      console.warn("[DP2] sync features après hydrate", e);
    }
  }
}

function hydrateDP3(data) {
  if (!data || typeof data !== "object") return;
  try {
    if (typeof __solarnextScopedStorageKey === "function") {
      localStorage.setItem(__solarnextScopedStorageKey("DP3_STATE_V1"), JSON.stringify(data));
    }
  } catch (_) {}
  try {
    window.DP3_STATE = JSON.parse(JSON.stringify(data));
  } catch (_) {
    window.DP3_STATE = data;
  }
}

window.hydrateDP1 = hydrateDP1;
window.hydrateDP2 = hydrateDP2;
window.hydrateDP3 = hydrateDP3;

// ======================================================
// DP1 — INIT GLOBAL (par fragment #dp1-page — monté une fois par vue persistante / embed CRM)
// ======================================================
function initDP1() {
  const dp1Page = document.getElementById("dp1-page");
  if (!dp1Page) return;

  initDP1_UIOnly();
  initDP1_UIStates();
  initDP1_MapModal();
  loadDP1LeadContext(); // silencieux
  mergeDp1ContextFromDraft();
  applyDP1DraftImagesToDom();
  initDP1_ImagePreview();

  try {
    if (window.snDpV && typeof window.snDpV.migrateKind === "function") {
      window.snDpV.migrateKind("dp1");
    }
    if (typeof window.snDpVSetupPageUi === "function") {
      window.snDpVSetupPageUi("dp1", {
        onAfter: function () {
          try {
            dp1ApplyDp1SnapshotImagesToDom();
          } catch (_) {}
          try {
            if (typeof refreshDP1ParcelleUI === "function") refreshDP1ParcelleUI();
          } catch (_) {}
        },
      });
    }
  } catch (_) {}
}


// ======================================================
// DP1 — ÉTAPE 1 : UI ONLY
// ======================================================
function initDP1_UIOnly() {
  const dp1Page = document.getElementById("dp1-page");
  if (!dp1Page) return;
  if (dp1Page.dataset.dp1UiOnlyBound === "1") return;
  dp1Page.dataset.dp1UiOnlyBound = "1";

  const uploadBox = document.querySelector("#dp1-upload-card .dp-upload-box");
  const uploadInput = document.getElementById("dp1-upload-input");

  if (!uploadBox || !uploadInput) return;

  // clic sur la carte → ouvre le file picker
  uploadBox.addEventListener("click", () => uploadInput.click());

  uploadBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      uploadInput.click();
    }
  });

  // 🔴 CE QUI MANQUAIT : traitement du fichier
  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const card = document.getElementById("dp1-upload-card");
      card.innerHTML = `
        <div class="dp-generated">
          <img src="${reader.result}" alt="DP1 upload manuel" />
        </div>
      `;

      // optionnel : passer l’état en GENERATED
      if (window.DP1_UI?.setState) {
        window.DP1_UI.setState("GENERATED");
      }
    };

    reader.readAsDataURL(file);
  });
}


// ======================================================
// DP1 — ÉTAPE 2 : ÉTATS UI (EMPTY / GENERATED)
// ======================================================
function initDP1_UIStates() {
  const dp1Page = document.getElementById("dp1-page");
  if (!dp1Page) return;

  const actions = document.querySelector(".dp-page-actions");
  const grid = document.getElementById("dp1-cards");
  if (!actions || !grid) return;

  window.DP1_UI = window.DP1_UI || {};
  window.DP1_UI.state = "EMPTY";

  window.DP1_UI.setState = function (nextState) {
    window.DP1_UI.state = nextState;

    // ===============================
    // ÉTAT EMPTY
    // ===============================
    if (nextState === "EMPTY") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-outline" type="button" disabled>
          Télécharger toutes les annexes
        </button>
        <button class="dp-btn dp-btn-primary" type="button" id="dp1-generate-auto">
          Générer automatiquement
        </button>
      `;
      return;
    }

    // ===============================
    // ÉTAT GENERATED
    // ===============================
    if (nextState === "GENERATED") {
      actions.innerHTML = `
        <button class="dp-btn dp-btn-primary" type="button" id="dp1-download">
          Télécharger DP1
        </button>
      `;

      const dl = document.getElementById("dp1-download");
      if (dl) {
        dl.addEventListener("click", () => {
          generateDP1PDF();
        });
      }

      return;
    }
  };

  // état initial
  if (draftDp1IndicatesRestore()) {
    window.DP1_UI.setState("GENERATED");
  } else {
    window.DP1_UI.setState("EMPTY");
  }
}


// ======================================================
// DP1 — ÉTAPE 3 : CHARGEMENT LEAD (contexte injecté CRM ou mock DEV / cache scoped)
// ======================================================
async function loadDP1LeadContext() {
  const injected = typeof window !== "undefined" ? window.__SOLARNEXT_DP_CONTEXT__ : null;

  if (injected && typeof injected === "object") {
    if (!window.DP1_STATE) window.DP1_STATE = __snDpFreshDp1State();
    const leadId = injected.leadId ?? null;
    const c = injected.context;
    const d = c && typeof c.dp1 === "object" && c.dp1 ? c.dp1 : {};
    const site = c && typeof c.site === "object" && c.site ? c.site : null;
    const id = c && typeof c.identity === "object" && c.identity ? c.identity : null;
    const fullFromIdentity =
      id &&
      (id.fullName || [id.firstName, id.lastName].filter(Boolean).join(" ").trim() || null);
    window.DP1_CONTEXT = {
      lead_id: leadId,
      nom: (d.nom != null && String(d.nom).trim()) || fullFromIdentity || "",
      adresse: d.adresse != null ? d.adresse : site?.address || "",
      cp: d.cp != null ? d.cp : site?.postalCode || "",
      ville: d.ville != null ? d.ville : site?.city || "",
      lat:
        d.lat != null
          ? Number(d.lat)
          : site?.lat != null
            ? Number(site.lat)
            : null,
      lon:
        d.lon != null
          ? Number(d.lon)
          : site?.lon != null
            ? Number(site.lon)
            : null
    };

    if (
      window.DP1_CONTEXT.lat != null &&
      window.DP1_CONTEXT.lon != null &&
      !window.DP1_STATE.currentPoint
    ) {
      window.DP1_STATE.currentPoint = {
        lat: window.DP1_CONTEXT.lat,
        lon: window.DP1_CONTEXT.lon
      };
    }

    __solarnextWriteScopedStorage("dp1_context", JSON.stringify(window.DP1_CONTEXT));
    console.log("[DP1] Contexte CRM injecté", window.DP1_CONTEXT);
    return window.DP1_CONTEXT;
  }

  try {
    if (!window.__SN_DP_SERVER_DRAFT_ACTIVE) {
      const raw = __solarnextReadScopedStorage("dp1_context");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") window.DP1_CONTEXT = parsed;
      }
    }
  } catch (_) {}

  if (window.DP1_CONTEXT && (window.DP1_CONTEXT.nom || window.DP1_CONTEXT.adresse)) {
    if (!window.DP1_STATE) window.DP1_STATE = __snDpFreshDp1State();
    if (
      window.DP1_CONTEXT.lat != null &&
      window.DP1_CONTEXT.lon != null &&
      !window.DP1_STATE.currentPoint
    ) {
      window.DP1_STATE.currentPoint = {
        lat: window.DP1_CONTEXT.lat,
        lon: window.DP1_CONTEXT.lon
      };
    }
    if (window.__SN_DP_DEV_MODE === true) {
      console.warn("[DP1] Mode DEV — contexte mock ou cache secondaire sn_dp:* (pas d’appel réseau lead).");
    }
    return window.DP1_CONTEXT;
  }

  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lead_id")) {
    console.warn(
      "[DP1] Paramètre lead_id en URL sans contexte CRM — ouvrir le DP depuis le CRM ou définir window.__SN_DP_DEV_MODE pour le debug local."
    );
  }
  return null;
}
try {
  window.loadDP1LeadContext = loadDP1LeadContext;
  window.__snDpLoadInjectedDp1Context = loadDP1LeadContext;
} catch (_) {}


// ======================================================
// DP1 — MODAL CARTE (SOLTEO STRICT + LIBRE) — FULL FIXED (STABLE ALL BROWSERS)
// - Centre sur adresse (BAN)
// - Marker SVG
// - Flèche Nord dans capture
// - 3 vues -> slots dp1-view-1/2/3
// - Anti double bind / anti double génération
// - FIX Edge/Firefox gris/zoom: attente réelle des tuiles WMTS (waitTilesIdle)
// ======================================================
function initDP1_MapModal() {
  const modal = document.getElementById("dp1-map-modal");
  if (!modal) return;

  // Anti double-binding sur le même nœud modal (pas de second passage sur le même fragment)
  if (modal.dataset.dp1ModalInit === "1") return;
  modal.dataset.dp1ModalInit = "1";

  function __getDp1MapModalEl() {
    return document.getElementById("dp1-map-modal");
  }

  /** Toujours projeté en EPSG:3857 ; lat/lon peuvent être des nombres ou des chaînes JSON. */
  function dp1Coord3857FromWgs84(lon, lat) {
    const lo = Number(lon);
    const la = Number(lat);
    if (!Number.isFinite(lo) || !Number.isFinite(la)) return null;
    return fromLonLat([lo, la]);
  }

  function dp1FitViewToCadastreGeometry(geoJsonGeometry) {
    if (!map || !geoJsonGeometry) return;
    try {
      const raw = extractGeoJsonGeometry(geoJsonGeometry);
      if (!raw || !window.ol?.format?.GeoJSON) return;
      const gj = new ol.format.GeoJSON();
      const g = gj.readGeometry(raw, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
      if (!g || typeof g.getExtent !== "function") return;
      const ext = g.getExtent();
      if (!ext || !ext.every(Number.isFinite)) return;
      map.getView().fit(ext, {
        padding: [32, 32, 32, 32],
        maxZoom: 21,
        duration: 200
      });
      map.renderSync();
    } catch (e) {
      console.warn("[DP1] fit parcelle impossible", e);
    }
  }

// ===============================
// DP1 — ACTION : RECALCUL PARCELLE (API cadastre)
// ===============================

// Priorité : CADASTRE_POINT_API > __VITE_API_URL__ | __SOLARNEXT_API_BASE__ > origine courante > chemin relatif
// Contrat : base = origine sans /api ; on ajoute une seule fois "/api/cadastre/by-point". Tout suffixe /api résiduel est retiré.
function __solarnextStripTrailingApiSegments(originOrBase) {
  let s = String(originOrBase).trim().replace(/\/+$/, "");
  while (s.length > 0 && s.endsWith("/api")) {
    s = s.slice(0, -4).replace(/\/+$/, "");
  }
  return s;
}
function joinCadastreByPointUrl(originOrBase) {
  const b = __solarnextStripTrailingApiSegments(originOrBase);
  if (!b) return "/api/cadastre/by-point";
  return b + "/api/cadastre/by-point";
}
function getCadastreApiBase() {
  if (window.CADASTRE_POINT_API) return window.CADASTRE_POINT_API;
  var viteOrigin =
    typeof window !== "undefined" && window.__VITE_API_URL__ != null
      ? String(window.__VITE_API_URL__).trim().replace(/\/$/, "")
      : "";
  const base = viteOrigin || window.__SOLARNEXT_API_BASE__ || "";
  if (base && String(base).trim()) return joinCadastreByPointUrl(String(base));
  const o = __solarnextDpApiOrigin();
  if (o) return joinCadastreByPointUrl(o);
  return "/api/cadastre/by-point";
}

// récupère le point courant (priorité : marker -> DP1_STATE -> center map)
function getCurrentPointWGS84() {
  // 1) marker
  if (parcelleMarkerFeature?.getGeometry) {
    const c = parcelleMarkerFeature.getGeometry().getCoordinates();
    const [lon, lat] = ol.proj.toLonLat(c);
    return { lat, lon };
  }

  // 2) state
  if (window.DP1_STATE?.currentPoint) {
    return window.DP1_STATE.currentPoint; // {lat, lon}
  }

  // 3) center map
  if (map?.getView) {
    const c = map.getView().getCenter();
    if (c) {
      const [lon, lat] = ol.proj.toLonLat(c);
      return { lat, lon };
    }
  }

  return null;
}

async function fetchCadastreByPoint(lat, lon) {
  const base = getCadastreApiBase();
  const url =
    `${base}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  console.log("[DP1][CADASTRE] calling", url);

  const headers = __solarnextDpAuthHeadersBearerOnly();

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error(`CADASTRE API HTTP ${res.status}`);
  return await res.json();
}

// ======================================================
// DP1 — Snap initial au centroïde parcellaire (AUTO)
// Pourquoi : les coords ERPNext (lat/lon) pointent souvent sur l'adresse (voie),
// pas sur la parcelle. On améliore le centrage initial en “snappant” au centroïde
// de la parcelle détectée, tout en laissant l’utilisateur libre de déplacer ensuite.
// - Aucune modif backend
// - Ne modifie pas /cadastre/by-point
// - Ne change pas le comportement des boutons Recalculer / Valider
// ======================================================
function extractGeoJsonGeometry(maybeGeo) {
  if (!maybeGeo) return null;
  // cas 1) GeoJSON Geometry direct
  if (maybeGeo.type && maybeGeo.coordinates) return maybeGeo;
  // cas 2) Feature
  if (maybeGeo.type === "Feature" && maybeGeo.geometry) return maybeGeo.geometry;
  // cas 3) FeatureCollection
  if (
    maybeGeo.type === "FeatureCollection" &&
    Array.isArray(maybeGeo.features) &&
    maybeGeo.features[0] &&
    maybeGeo.features[0].geometry
  ) {
    return maybeGeo.features[0].geometry;
  }
  return null;
}

function computeRingCentroidXY(ring) {
  // ring: [[x,y], [x,y], ...] (idéalement fermé)
  if (!Array.isArray(ring) || ring.length < 3) return null;

  let area2 = 0; // 2*A
  let cx6a = 0;  // 6*A*Cx
  let cy6a = 0;  // 6*A*Cy

  // Assurer une boucle : si non fermé, on boucle virtuellement
  const n = ring.length;
  const last = ring[n - 1];
  const first = ring[0];
  const isClosed = last && first && last[0] === first[0] && last[1] === first[1];

  const limit = isClosed ? n - 1 : n;
  for (let i = 0; i < limit; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % limit];
    if (!p0 || !p1) continue;
    const x0 = Number(p0[0]);
    const y0 = Number(p0[1]);
    const x1 = Number(p1[0]);
    const y1 = Number(p1[1]);
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      continue;
    }
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx6a += (x0 + x1) * cross;
    cy6a += (y0 + y1) * cross;
  }

  if (!Number.isFinite(area2) || Math.abs(area2) < 1e-12) {
    // fallback : moyenne des points
    let sx = 0, sy = 0, c = 0;
    for (const p of ring) {
      if (!p) continue;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      sx += x; sy += y; c += 1;
    }
    if (c === 0) return null;
    return { x: sx / c, y: sy / c, areaAbs: 0 };
  }

  const cx = cx6a / (3 * area2); // (6A)/(?) -> 3*area2 = 6A
  const cy = cy6a / (3 * area2);
  return { x: cx, y: cy, areaAbs: Math.abs(area2 / 2) };
}

function computeGeoJsonCentroidWgs84(geoJsonGeometry) {
  const g = extractGeoJsonGeometry(geoJsonGeometry);
  if (!g) return null;
  if (!window.ol?.format?.GeoJSON || !window.ol?.proj?.toLonLat) return null;

  let geom3857 = null;
  try {
    const geoJsonFormat = new ol.format.GeoJSON();
    geom3857 = geoJsonFormat.readGeometry(g, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
  } catch (_) {
    geom3857 = null;
  }
  if (!geom3857 || typeof geom3857.getType !== "function") return null;

  const type = geom3857.getType();

  // Point → trivial
  if (type === "Point" && typeof geom3857.getCoordinates === "function") {
    const xy = geom3857.getCoordinates();
    const [lon, lat] = ol.proj.toLonLat(xy);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  // Polygon/MultiPolygon → centroïde (anneau extérieur) en EPSG:3857, puis retour WGS84
  let best = null; // {x,y,areaAbs}
  try {
    if (type === "Polygon") {
      const coords = geom3857.getCoordinates(); // [ring1, ring2(hole), ...]
      const outer = Array.isArray(coords) ? coords[0] : null;
      best = computeRingCentroidXY(outer);
    } else if (type === "MultiPolygon") {
      const polys = geom3857.getCoordinates(); // [[[ring...]], [[ring...]], ...]
      if (Array.isArray(polys)) {
        for (const poly of polys) {
          const outer = Array.isArray(poly) ? poly[0] : null;
          const c = computeRingCentroidXY(outer);
          if (!c) continue;
          if (!best || (c.areaAbs || 0) > (best.areaAbs || 0)) best = c;
        }
      }
    } else {
      // fallback conservateur : centre de l'extent (évite de casser sur d'autres types)
      if (typeof geom3857.getExtent === "function" && window.ol?.extent?.getCenter) {
        const centerXY = ol.extent.getCenter(geom3857.getExtent());
        const [lon, lat] = ol.proj.toLonLat(centerXY);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { lat, lon };
      }
      return null;
    }
  } catch (_) {
    best = null;
  }

  if (!best || !Number.isFinite(best.x) || !Number.isFinite(best.y)) return null;
  const [lon, lat] = ol.proj.toLonLat([best.x, best.y]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function snapDP1MarkerToDetectedParcelCentroid() {
  // ⚠️ Snapping uniquement au chargement (ne doit pas simuler "Recalculer"/"Valider")
  const p = getCurrentPointWGS84();
  if (!p) return false;

  try {
    const cad = await fetchCadastreByPoint(p.lat, p.lon);
    if (!cad || !cad.geometry) return false;

    const centroid = computeGeoJsonCentroidWgs84(cad.geometry);
    if (!centroid) return false;

    // Déplacer le marker + source de vérité "point courant"
    setParcelleMarker(centroid.lon, centroid.lat);
    window.DP1_STATE.currentPoint = { lat: centroid.lat, lon: centroid.lon };
    dp1FitViewToCadastreGeometry(cad.geometry);
    // On ne touche pas selectedParcel ici (pour ne pas modifier l'UI hors action utilisateur)

    return true;
  } catch (e) {
    console.warn("[DP1][SNAP] Cadastre indisponible ou géométrie invalide, snapping ignoré", e);
    return false;
  }
}

// bouton "Recalculer la parcelle"
const btnRecalc = modal.querySelector("#dp1-map-recalc");
if (btnRecalc) {
  btnRecalc.addEventListener("click", async () => {
    const p = getCurrentPointWGS84();
    if (!p) return;

    try {
      const cad = await fetchCadastreByPoint(p.lat, p.lon);

      // ✅ on stocke dans l’état DP1 (source)
      window.DP1_STATE.lastCentroid = { lat: p.lat, lon: p.lon };
      window.DP1_STATE.selectedParcel = cad; // doit contenir section/numero/surface/etc
      window.DP1_STATE.isValidated = false;

      // ✅ rafraîchir immédiatement l’UI "Parcelle validée"
      refreshDP1ParcelleUI();

      dp1FitViewToCadastreGeometry(cad.geometry);

      console.log("[DP1] Cadastre recalculé", cad);
    } catch (e) {
      console.error("[DP1] Erreur API cadastre", e);
    }
  });
}
// ===============================
// DP1 — ACTION : VALIDER PARCELLE
// ===============================

const btnValidate = modal.querySelector("#dp1-map-validate");
if (btnValidate) {
  btnValidate.addEventListener("click", async () => {
    console.log("[DP1][VALIDATE] Début");

    const p = getCurrentPointWGS84();
    if (!p) {
      console.warn("[DP1][VALIDATE] Validation impossible : aucun point (marker/centre)");
      return;
    }

    if (modal.dataset.generating === "1") {
      console.warn("[DP1][VALIDATE] Génération déjà en cours, ignoré");
      return;
    }

    // Centroid = source de vérité (lat, lon), indépendant du cadastre
    window.DP1_STATE.lastCentroid = { lat: p.lat, lon: p.lon };
    window.DP1_STATE.currentPoint = { lat: p.lat, lon: p.lon };
    window.DP1_STATE.isValidated = false;

    let cad;
    try {
      cad = await fetchCadastreByPoint(p.lat, p.lon);
      window.DP1_STATE.selectedParcel = cad;
      console.log("[DP1][VALIDATE] Cadastre récupéré", cad);
    } catch (e) {
      console.error("[DP1][CADASTRE] Erreur récupération parcelle", e);
      window.DP1_STATE.selectedParcel = null;
      window.__snDpAlert("Impossible de récupérer les données cadastrales (section, parcelle, surface).\nVérifiez que vous êtes connecté au CRM et que le backend est accessible.");
      return;
    }

    if (!cad || (!cad.section && !cad.numero)) {
      console.warn("[DP1][CADASTRE] Réponse incomplète (section/numero manquants)", cad);
      window.DP1_STATE.selectedParcel = null;
      window.__snDpAlert("La parcelle n'a pas pu être identifiée à cet emplacement.\nDéplacez le marqueur au centre de la parcelle et réessayez.");
      return;
    }

    modal.dataset.generating = "1";

    try {
      ensureMap();
      if (!map) {
        console.warn("[DP1][VALIDATE] Carte indisponible — parcelle conservée, sauvegarde brouillon");
        window.DP1_STATE.isValidated = true;
        if (typeof refreshDP1ParcelleUI === "function") refreshDP1ParcelleUI();
        if (typeof window.__snDpAfterDp1Validated === "function") {
          try {
            window.__snDpAfterDp1Validated();
          } catch (errDp) {
            console.warn("[DP1] draft hook", errDp);
          }
        }
        return;
      }
      const view = map.getView();
      const c3857 = dp1Coord3857FromWgs84(p.lon, p.lat);
      if (c3857) view.setCenter(c3857);
      map.renderSync();

      await runDP1ViewGeneration();

      __solarnextWriteScopedStorage("dp1_parcelle", JSON.stringify({ centroid: window.DP1_STATE.lastCentroid }));
      window.DP1_STATE.isValidated = true;
      console.log("[DP1][VALIDATE] Parcelle validée et persistée");
      if (typeof window.__snDpAfterDp1Validated === "function") {
        try {
          window.__snDpAfterDp1Validated();
        } catch (errDp) {
          console.warn("[DP1] draft hook", errDp);
        }
      }
    } catch (err) {
      console.error("[DP1][VALIDATE] Erreur", err);
      // Même si la génération des vues échoue, la parcelle cadastrale est déjà dans l’état : on force l’enregistrement.
      window.DP1_STATE.isValidated = true;
      try {
        if (typeof refreshDP1ParcelleUI === "function") refreshDP1ParcelleUI();
      } catch (_) {}
      try {
        if (typeof window.__snDpForceFlush === "function") window.__snDpForceFlush();
        else if (window.DpDraftStore && typeof window.DpDraftStore.forceSaveDraft === "function") {
          window.DpDraftStore.forceSaveDraft();
        }
      } catch (_) {}
    } finally {
      modal.dataset.generating = "0";
      closeModal();
    }
  });
}


  // --------------------------
  // State
  // --------------------------
  let map = null;

  let ignLayer = null;

  let viewStrict = null;
  let viewLibre = null;

  let currentMode = "strict";

  // Marker layer
  let parcelleMarkerLayer = null;
  // Marker feature (unique) + interaction drag
let parcelleMarkerFeature = null;
let markerModify = null;

// ======================================================
// DP1 — RAFRAÎCHIR UI PARCELLE VALIDÉE (source unique : DP1_STATE.selectedParcel)
// ======================================================
function refreshDP1ParcelleUI() {
  const card = document.getElementById("dp1-parcelle-info");
  if (!card) return;

  const cad = window.DP1_STATE?.selectedParcel || null;

  const sectionEl = document.getElementById("dp1-info-section");
  const parcelleEl = document.getElementById("dp1-info-parcelle");
  const surfaceEl = document.getElementById("dp1-info-surface");

  if (!sectionEl || !parcelleEl || !surfaceEl) return;

  if (!cad) {
    sectionEl.textContent = "—";
    parcelleEl.textContent = "—";
    surfaceEl.textContent = "—";
    card.hidden = true;
    return;
  }

  const section = cad.section || "—";
  const numeroFull =
    (cad.parcel != null && String(cad.parcel).trim()) ||
    [cad.section, cad.numero].filter(Boolean).join(" ").trim();
  const smRaw = cad.surface_m2 != null ? cad.surface_m2 : cad.surface != null ? cad.surface : null;
  const surfaceText =
    smRaw !== null && smRaw !== undefined && String(smRaw).trim() !== ""
      ? String(smRaw).indexOf("m²") >= 0
        ? String(smRaw)
        : `${smRaw} m²`
      : "—";

  sectionEl.textContent = section;
  parcelleEl.textContent = numeroFull || "—";
  surfaceEl.textContent = surfaceText;

  // afficher la carte dès qu’une parcelle est disponible
  card.hidden = false;

  console.log("🟢 UI Parcelle rafraîchie depuis DP1_STATE.selectedParcel", cad);
}

  // --------------------------
  // WMTS GRID PM
  // --------------------------
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
  const WMTS_MATRIX_IDS = WMTS_RESOLUTIONS.map((_, i) => String(i));

  const wmtsGridPM = new ol.tilegrid.WMTS({
    origin: WMTS_ORIGIN,
    resolutions: WMTS_RESOLUTIONS,
    matrixIds: WMTS_MATRIX_IDS
  });

  // --------------------------
  // Helpers
  // --------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // attend un render "utile" même si OL ne déclenche pas toujours rendercomplete
  async function waitRenderComplete(timeoutMs = 1200) {
    if (!map) return;

    let done = false;

    const p = new Promise((resolve) => {
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve();
      }, timeoutMs);

      map.once("rendercomplete", () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve();
      });
    });

    map.renderSync();
    await p;
  }

  // ✅ FIX ALL BROWSERS : attendre que les tuiles WMTS soient réellement chargées/dessinées
  // (rendercomplete n’est pas suffisant sur Firefox/Edge -> écran gris jusqu’à interaction)
  async function waitTilesIdle(timeoutMs = 2500) {
    if (!map || !ignLayer) return;

    const sources = [ignLayer.getSource && ignLayer.getSource()].filter(Boolean);

    if (!sources.length) return;

    let pending = 0;
    let resolved = false;

    const cleanupFns = [];

    function done(resolve) {
      if (resolved) return;
      resolved = true;
      cleanupFns.forEach(fn => {
        try { fn(); } catch(e) {}
      });
      resolve();
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => done(resolve), timeoutMs);

      sources.forEach((src) => {
        const onStart = () => { pending++; };
        const onEnd = () => {
          pending = Math.max(0, pending - 1);
          // si plus aucune tuile en vol, on laisse 1 frame pour que le canvas se peigne
          if (pending === 0) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              clearTimeout(timer);
              done(resolve);
            }));
          }
        };
        const onErr = () => {
          pending = Math.max(0, pending - 1);
          if (pending === 0) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              clearTimeout(timer);
              done(resolve);
            }));
          }
        };

        src.on("tileloadstart", onStart);
        src.on("tileloadend", onEnd);
        src.on("tileloaderror", onErr);

        cleanupFns.push(() => src.un("tileloadstart", onStart));
        cleanupFns.push(() => src.un("tileloadend", onEnd));
        cleanupFns.push(() => src.un("tileloaderror", onErr));
      });

      // kickoff + cas où il n’y a pas d’events qui partent (cache)
      map.renderSync();
      requestAnimationFrame(() => {
        if (pending === 0) {
          clearTimeout(timer);
          done(resolve);
        }
      });
    });
  }

  // force updateSize quand le modal vient d’être affiché
  async function safeUpdateSize() {
    if (!map) return;
    // 2 frames + petit délai = évite "size = 0" si modal vient d’apparaître
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => requestAnimationFrame(() => r()));
    map.updateSize();
    map.renderSync();
    await waitRenderComplete(800);
  }

  // --------------------------
  // Build layers
  // --------------------------
  function buildLayers() {
    ignLayer = new ol.layer.Tile({
      opacity: 1,
      transition: 0,
      preload: 2,
      cacheSize: 1024,
      source: new ol.source.WMTS({
        url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
        layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
        matrixSet: "PM",
        format: "image/png",
        style: "normal",
        tileGrid: wmtsGridPM,
        wrapX: false,
        crossOrigin: "anonymous"
      })
    });

  }

  // --------------------------
  // Build views
  // --------------------------
  function buildViews() {
    const centerParis = fromLonLat([2.3488, 48.8534]);

   viewStrict = new ol.View({
  center: centerParis,

  // 🔴 ON TRAVAILLE EN RÉSOLUTION, PAS EN ZOOM
  resolutions: WMTS_RESOLUTIONS,
  constrainResolution: true,

  enableRotation: false
});


    viewLibre = new ol.View({
      center: centerParis,
      zoom: 17,
      minZoom: 12,
      maxZoom: 23,
      constrainResolution: false,
      enableRotation: false
    });
  }

  // --------------------------
  // Marker layer + marker
  // --------------------------
  function initParcelleMarkerLayer() {
    if (!map || parcelleMarkerLayer) return;

    parcelleMarkerLayer = new ol.layer.Vector({
      source: new ol.source.Vector(),
      zIndex: 9999
    });

    map.addLayer(parcelleMarkerLayer);
  }
function setParcelleMarker(lon, lat) {
  if (!map || !parcelleMarkerLayer) return;

  const source = parcelleMarkerLayer.getSource();
  const coords = dp1Coord3857FromWgs84(lon, lat);
  if (!coords) return;

  // 1ère fois : on crée la feature
  if (!parcelleMarkerFeature) {
    parcelleMarkerFeature = new ol.Feature({
      geometry: new ol.geom.Point(coords)
    });

    // Épingle « carte » (SVG inline, pas de fichier) — même palette #ff3b3b
    // TODO: optionnellement basculer vers asset packagé si besoin de variante HDPI
    var dp1PinSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">' +
      '<path fill="#ff3b3b" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" d="M20 2C11 2 4 9 4 17.5c0 10 16 32.5 16 32.5s16-22.5 16-32.5C36 9 29 2 20 2z"/>' +
      '<circle cx="20" cy="17" r="5" fill="#ffffff"/>' +
      "</svg>";
    parcelleMarkerFeature.setStyle(
      new ol.style.Style({
        image: new ol.style.Icon({
          src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(dp1PinSvg),
          anchor: [0.5, 1],
          anchorXUnits: "fraction",
          anchorYUnits: "fraction",
          scale: 1
        })
      })
    );

    source.clear();
    source.addFeature(parcelleMarkerFeature);
    window.parcelleMarkerFeature = parcelleMarkerFeature;
    return;
  }

  // sinon : on déplace la feature existante
  parcelleMarkerFeature.getGeometry().setCoordinates(coords);
  window.parcelleMarkerFeature = parcelleMarkerFeature;
}

function enableMarkerDrag() {
  if (!map || !parcelleMarkerLayer) return;
  if (markerModify) return; // anti double bind

  markerModify = new ol.interaction.Modify({
    source: parcelleMarkerLayer.getSource(),
    pixelTolerance: 16
  });

  map.addInteraction(markerModify);

  markerModify.on("modifyend", () => {
    if (!parcelleMarkerFeature) return;

    const coords = parcelleMarkerFeature.getGeometry().getCoordinates();
    const [lon, lat] = ol.proj.toLonLat(coords);

    window.DP1_STATE.currentPoint = { lat, lon };

    dp1MarkDirty();

    console.log("[DP1] Marker déplacé -> currentPoint", { lat, lon });
  });
}

/** Dernier état de la vue : centrage sur le marker (après toutes les animations OL). */
function dp1CenterViewOnParcelleMarker() {
  const mapOl = window.__DP1_OL_MAP;
  const feature = window.parcelleMarkerFeature;
  if (!mapOl || !feature) return;
  const geom = feature.getGeometry();
  if (!geom || typeof geom.getCoordinates !== "function") return;
  const coord = geom.getCoordinates();
  if (!coord || !coord.every(Number.isFinite)) return;
  setTimeout(() => {
    const view = mapOl.getView();
    view.setCenter(coord);
    try {
      view.setZoom(19);
    } catch (_) {
      /* vue WMTS stricte */
    }
    try {
      mapOl.renderSync();
    } catch (_) {}
  }, 100);
}

// --------------------------
// Center map from lead
// Priorité : lat/lon ERPNext → fallback BAN
// --------------------------
async function centerMapFromLead() {
  if (!window.DP1_CONTEXT) return null;

  const { lat, lon, adresse, cp, ville } = window.DP1_CONTEXT;

  // ======================================================
  // 1️⃣ PRIORITÉ ABSOLUE — coordonnées ERPNext (nombre ou chaîne JSON)
  // ======================================================
  const la0 = Number(lat);
  const lo0 = Number(lon);
  if (Number.isFinite(la0) && Number.isFinite(lo0)) {
    setParcelleMarker(lo0, la0);
    return fromLonLat([lo0, la0]);
  }

  // ======================================================
  // 2️⃣ FALLBACK — géocodage BAN (adresse)
  // ======================================================
  if (!adresse || !ville) return null;

  try {
    const q = encodeURIComponent(`${adresse} ${cp || ""} ${ville}`);
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`
    );
    if (!res.ok) return null;

    const json = await res.json();
    if (!json.features?.length) return null;

    const [lonBan, latBan] = json.features[0].geometry.coordinates;

    setParcelleMarker(lonBan, latBan);

    return fromLonLat([Number(lonBan), Number(latBan)]);
  } catch (e) {
    console.warn("[DP1] BAN impossible", e);
    return null;
  }
}


  // --------------------------
  // Ensure map
  // --------------------------
  function ensureMap() {
    if (map) return;

    const target = document.getElementById("dp1-ign-map");
    if (!target) {
      console.error("[DP1] #dp1-ign-map introuvable — impossible d’initialiser la carte.");
      return;
    }

    try {
      buildLayers();
      buildViews();

      map = new ol.Map({
        target,
        layers: [ignLayer],
        view: viewStrict,
        // Limiter le DPR : au-delà de 2, le coût GPU/largeur canvas explose sans gain net sur plans cadastraux.
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        moveTolerance: 2,
        maxTilesLoading: 12,
        controls: [
          new ol.control.Zoom(),
          new ol.control.Rotate({ autoHide: true })
        ]
      });

      window.__DP1_OL_MAP = map;

      initParcelleMarkerLayer();
      currentMode = "strict";
      enableMarkerDrag();

      // API exposée
      window.DP1_MAP = {
        get map() {
          return map;
        },
        get mode() {
          return currentMode;
        },
        setMode,
        setDP1Scale,
        waitRenderComplete,
        centerMapFromLead,
        setParcelleMarker
      };
    } catch (e) {
      console.error("[DP1] Échec initialisation OpenLayers", e);
      map = null;
    }
  }

  // --------------------------
  // Mode switch SAFE (corrigé)
  // --------------------------
  function setMode(mode) {
    if (!map) return;
    if (mode !== "strict" && mode !== "libre") return;
    if (mode === currentMode) return;

    const oldView = map.getView();
    const c = oldView.getCenter();
    const z = oldView.getZoom();

    currentMode = mode;

    if (mode === "strict") {
      map.setView(viewStrict);

      if (c) viewStrict.setCenter(c);
      if (typeof z === "number") viewStrict.setZoom(Math.min(20, Math.max(12, z)));

      map.renderSync();
      return;
    }

    map.setView(viewLibre);

    if (c) viewLibre.setCenter(c);
    if (typeof z === "number") viewLibre.setZoom(Math.min(23, Math.max(12, z)));

    map.renderSync();
  }

 // --------------------------
// Scale DP1 (Solteo-like) — VERSION STABLE WMTS
// Objectif : recréer EXACTEMENT la vue propre obtenue
// après zoom/dézoom utilisateur
// --------------------------
function setDP1Scale(scale) {
  if (!map) return;

  const view = map.getView();

  const SCALES = {
    20000: WMTS_RESOLUTIONS[15],
    5000:  WMTS_RESOLUTIONS[17],
    650:   WMTS_RESOLUTIONS[20]
  };

  const targetResolution = SCALES[scale];
  if (!targetResolution) return;

  setMode("strict");

  const idx = WMTS_RESOLUTIONS.indexOf(targetResolution);
  if (idx < 0) return;

  // 🔁 Phase 1 — passage volontaire par une autre résolution
  if (idx > 0) {
    view.setResolution(WMTS_RESOLUTIONS[idx - 1]);
    map.renderSync();
  }

  // 🔁 Phase 2 — retour sur la cible (comme l’utilisateur)
  view.setResolution(targetResolution);
  map.renderSync();
}

// --------------------------
// STABILISATION WMTS AVANT CAPTURE
// (équivalent visuel à un zoom manuel terminé)
// --------------------------
async function stabilizeWMTSView() {
  // attendre que TOUTES les tuiles soient vraiment posées
  await waitTilesIdle(3000);

  // attendre la fin réelle du rendu
  await waitRenderComplete(1500);

  // 🔴 FRAME SUPPLÉMENTAIRE (clé)
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  // 🔴 MICRO PAUSE — comme un humain qui lâche la souris
  await new Promise(r => setTimeout(r, 120));
}

// --------------------------
// CAPTURE WMTS STRICTE — VERSION DÉFINITIVE
// Capture la vue OL RÉELLE (pas DOM, pas zoom fake)
// --------------------------
async function captureMapAsPngDataUrl() {
  if (!map) return null;

  // 🔒 on attend le rendu WMTS FINAL (post snap)
  await waitTilesIdle(3000);
  await waitRenderComplete(1500);

  const mapEl = document.getElementById("dp1-ign-map");
  if (!mapEl) return null;

  const size = map.getSize();
  const canvas = document.createElement("canvas");
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext("2d");

  // fond blanc DP
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ✅ COMPOSITION EXACTE DES CANVAS OPENLAYERS (WMTS NATIF)
  const layers = mapEl.querySelectorAll(".ol-layer canvas");
  layers.forEach((c) => {
    if (!c.width || !c.height) return;

    ctx.save();

    const opacity = c.parentNode?.style?.opacity;
    ctx.globalAlpha = opacity ? Number(opacity) : 1;

    const transform = window.getComputedStyle(c).transform;
    if (transform && transform !== "none") {
      const m = transform.match(/^matrix\((.+)\)$/);
      if (m) {
        const v = m[1].split(",").map(Number);
        ctx.setTransform(v[0], v[1], v[2], v[3], v[4], v[5]);
      }
    }

    ctx.drawImage(c, 0, 0);
    ctx.restore();
  });

  // flèche nord (overlay réel)
  const arrow = document.querySelector(".dp1-north-arrow");
  if (arrow) {
    const r = arrow.getBoundingClientRect();
    const mr = mapEl.getBoundingClientRect();
    ctx.drawImage(
      arrow,
      r.left - mr.left,
      r.top - mr.top,
      r.width,
      r.height
    );
  }

  return canvas.toDataURL("image/png");
}

// --------------------------
// Injection dans le slot
// --------------------------

async function captureIntoSlot(selector) {
  const dataUrl = await captureMapAsPngDataUrl();
  if (!dataUrl) return;

  const slot = document.querySelector(selector);
  if (!slot) return;

  slot.innerHTML = `
    <div class="dp-generated">
      <img src="${dataUrl}" alt="DP1 vue" />
    </div>
  `;
}

// --------------------------
// DP1 — Génération des 3 vues (1/20000, 1/5000, 1/650) → slots dp1-view-1/2/3
// Utilisée par "Générer" et par "Valider la parcelle".
// Prérequis : map déjà centrée sur le point voulu, DP1_STATE.currentPoint à jour.
// --------------------------
async function runDP1ViewGeneration() {
  // 1️⃣ Vue large — 1:20000
  setDP1Scale(20000);
  await waitTilesIdle(3000);
  await waitRenderComplete(1500);

  // 2️⃣ Vue intermédiaire — 1:5000
  setDP1Scale(5000);
  await waitTilesIdle(3000);
  await waitRenderComplete(1500);

  // 3️⃣ Vue proche — 1:650 (VUE PROPRE)
  setDP1Scale(650);
  await waitTilesIdle(3000);
  await waitRenderComplete(1500);

  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 180));

  // 📸 CAPTURES
  await captureIntoSlot('[data-slot="dp1-view-3"]');
  setDP1Scale(5000);
  await waitTilesIdle(2000);
  await waitRenderComplete(1200);
  await captureIntoSlot('[data-slot="dp1-view-2"]');
  setDP1Scale(20000);
  await waitTilesIdle(2000);
  await waitRenderComplete(1200);
  await captureIntoSlot('[data-slot="dp1-view-1"]');

  setDP1Scale(650);
  if (window.DP1_UI?.setState) window.DP1_UI.setState("GENERATED");

  const viewport = map.getViewport();
  const rect = viewport.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  function fireWheel(deltaY) {
    viewport.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY,
        deltaMode: 0,
        clientX: cx,
        clientY: cy
      })
    );
  }
  fireWheel(160);
  await new Promise(r => setTimeout(r, 120));
  fireWheel(-140);
  await new Promise(r => setTimeout(r, 140));
  fireWheel(40);
  await new Promise(r => setTimeout(r, 80));
  fireWheel(-40);
  await new Promise(r => setTimeout(r, 160));

  await waitTilesIdle(3500);
  await waitRenderComplete(1800);
  await captureIntoSlot('[data-slot="dp1-view-3"]');
  if (typeof writeDP1CadastreFromCurrentPoint === "function") {
    writeDP1CadastreFromCurrentPoint();
  }
  // Rafraîchit l’UI "Parcelle validée" uniquement à partir de DP1_STATE.selectedParcel
  refreshDP1ParcelleUI();

  dp1CenterViewOnParcelleMarker();
}

// --------------------------
// Modal open / close (VERSION CORRECTE)
// --------------------------

function closeModal() {
  const m = __getDp1MapModalEl();
  if (!m) return;
  m.setAttribute("aria-hidden", "true");
  m.dataset.generating = "0";

  if (document.activeElement) {
    document.activeElement.blur();
  }
}

async function openModal() {
  const m = __getDp1MapModalEl();
  if (!m) return;
  // 1) Ouvrir le modal
  m.setAttribute("aria-hidden", "false");

  // 2) Laisser le navigateur poser le layout
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  // 3) Créer la map
  ensureMap();
  if (!map) {
    console.error("[DP1] Impossible d’afficher la carte (initialisation OL ou conteneur).");
    window.__snDpAlert(
      "La carte du DP1 ne s’est pas chargée.\n\nRechargez la page ou ouvrez la console (F12) pour le détail."
    );
    return;
  }

  // 4) Forcer la taille réelle (+ second passage après layout embed CRM / flex)
  map.updateSize();
  map.renderSync();
  await new Promise((r) => setTimeout(r, 60));
  map.updateSize();
  map.renderSync();

  // 5) Recentrer depuis BAN (marker + état ; pas de setCenter ici — centrage final en fin de flux)
  await centerMapFromLead();

  // 5bis) Snapping auto : si une parcelle est détectée depuis le point initial,
  // on repositionne le marker au centroïde avant le rendu final (UX : meilleur centrage).
  await snapDP1MarkerToDetectedParcelCentroid();

  // 6) Rendu stable
  map.renderSync();
  await waitRenderComplete(1200);

  dp1CenterViewOnParcelleMarker();
}

 // --------------------------
// Bind UI events — délégation document unique ; openModal courant via window.__solarnext_dp1_openModal
// --------------------------

// ===============================
// DP1 — Bouton "Modifier la position"
// ===============================
const editBtn = document.getElementById("dp1-parcelle-edit");
if (editBtn) {
  editBtn.addEventListener("click", () => {
    window.DP1_STATE.isValidated = false;
    openModal();
    console.log("✏️ Modification de la parcelle demandée");
  });
}


modal.addEventListener("click", async (e) => {
  // fermeture
  if (
    e.target.closest(".dp-modal-close") ||
    e.target.closest("#dp1-map-cancel")
  ) {
    e.preventDefault();
    closeModal();
    return;
  }
});



  // --------------------------
  // Clavier dev (bind 1 seule fois)
  // --------------------------
  if (!window.__DP1_KEY_BOUND) {
    window.__DP1_KEY_BOUND = true;

    window.addEventListener("keydown", (e) => {
      if (!window.DP1_MAP?.map) return;
      if (e.key === "s" || e.key === "S") window.DP1_MAP.setMode("strict");
      if (e.key === "l" || e.key === "L") window.DP1_MAP.setMode("libre");
    });
  }

  window.__solarnext_dp1_openModal = openModal;
  window.__solarnext_dp1_closeModal = closeModal;

  // Délégation sur #dp-tool-root (pas sur document en bubble) : l’overlay CRM React
  // (DpOverlay) fait stopPropagation sur le panneau — le clic n’atteint jamais document.
  if (!window.__SOLARNEXT_DP1_GENERATE_DELEGATE_BOUND) {
    window.__SOLARNEXT_DP1_GENERATE_DELEGATE_BOUND = true;
    const dpToolRoot = document.getElementById("dp-tool-root");
    const bindTarget = dpToolRoot || document;
    const useCapture = !dpToolRoot;
    bindTarget.addEventListener(
      "click",
      function (e) {
        const raw = e.target;
        const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
        if (!el || !el.closest("#dp1-generate-auto")) return;
        e.preventDefault();
        var fn = window.__solarnext_dp1_openModal;
        if (typeof fn === "function") void fn();
      },
      useCapture
    );
  }
}
function initDP1_ImagePreview() {
  const preview = document.querySelector(".dp-image-preview");
  if (!preview) return;

  const previewImg = preview.querySelector("img");

  // OUVERTURE au clic sur une image DP1 (un seul listener document — évite doublons au retour sur DP1)
  if (!window.__DP1_IMAGE_PREVIEW_DOC_OPEN_BOUND) {
    window.__DP1_IMAGE_PREVIEW_DOC_OPEN_BOUND = true;
    const dpToolRoot = document.getElementById("dp-tool-root");
    const bindTarget = dpToolRoot || document;
    const useCapture = !dpToolRoot;
    bindTarget.addEventListener(
      "click",
      (e) => {
        const raw = e.target;
        const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
        const img = el && el.closest(".dp-generated img");
        if (!img) return;

        const pv = document.querySelector(".dp-image-preview");
        const pvi = pv && pv.querySelector("img");
        if (!pv || !pvi) return;

        pvi.src = img.src;
        pv.setAttribute("aria-hidden", "false");
        document.body.classList.add("dp-lock-scroll");
      },
      useCapture
    );
  }

  // FERMETURE au clic (nœud preview courant)
  preview.addEventListener("click", () => {
    preview.setAttribute("aria-hidden", "true");
    previewImg.src = "";
    document.body.classList.remove("dp-lock-scroll");
  });

  // FERMETURE avec ESC (un seul listener)
  if (!window.__DP1_IMAGE_PREVIEW_ESC_BOUND) {
    window.__DP1_IMAGE_PREVIEW_ESC_BOUND = true;
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const pv = document.querySelector(".dp-image-preview");
      const pvi = pv && pv.querySelector("img");
      if (!pv || !pvi) return;
      pv.setAttribute("aria-hidden", "true");
      pvi.src = "";
      document.body.classList.remove("dp-lock-scroll");
    });
  }
}
// ======================================================
// DP1 — RÉCUPÉRATION DES 3 PLANS POUR PDF
// ======================================================
function collectDP1Images() {
  const slots = {
    view_20000: document.querySelector('[data-slot="dp1-view-1"] img'),
    view_5000: document.querySelector('[data-slot="dp1-view-2"] img'),
    view_650: document.querySelector('[data-slot="dp1-view-3"] img')
  };

  const images = {};

  for (const [key, img] of Object.entries(slots)) {
    if (!img || !img.src || !img.src.startsWith("data:image")) {
      console.warn(`DP1 image manquante ou invalide : ${key}`);
      return null;
    }
    images[key] = img.src; // data:image/png;base64,...
  }

  console.log("✅ DP1 images récupérées", images);
  return images;
}


// ======================================================
// DP1 — GÉNÉRATION PDF (COMME LE MANDAT)
// ======================================================
async function generateDP1PDF() {
  const images = collectDP1Images();
  if (!images) {
    window.__snDpAlert("Images DP1 manquantes");
    return;
  }

  const cad = window.DP1_STATE?.selectedParcel;
  const ctx = window.DP1_CONTEXT || null;

  const dp1Data = {
    client: {
      nom: ctx ? (ctx.nom ?? "—") : "—",
      adresse: ctx ? (ctx.adresse ?? "—") : "—",
      cp: ctx ? (ctx.cp ?? "—") : "—",
      ville: ctx ? (ctx.ville ?? "—") : "—"
    },
    parcelle: {
      numero: cad
        ? [cad.section, cad.numero].filter(Boolean).join(" ")
        : "—",
      surface_m2: cad?.surface_m2 ?? null
    },
    images: {
      "20000": images.view_20000,
      "5000": images.view_5000,
      "650": images.view_650
    },
    note: "Document généré automatiquement"
  };

  await __solarnextDpFetchPdfWithReplace(
    "/pdf/render/dp1/pdf",
    function () {
      return { dp1Data: dp1Data };
    },
    "dp1"
  );
}
