// ======================================================
// SOLARNEXT CRM — contrat d'hébergement (injecté par le loader avant ce script)
// window.__SOLARNEXT_API_BASE__       : origine seule, sans /api (ex. http://localhost:5173) — défaut = location.origin
// window.__SOLARNEXT_DP_CONTEXT__     : réponse GET /api/leads/:id/dp ou { leadId, context: { identity, site, dp1, ... } }
// window.__SOLARNEXT_DP_CRM_EMBED     : true si chargé depuis loadDpTool (CRM) — obligatoire hors __SN_DP_DEV_MODE
// window.__SN_DP_DEV_MODE             : true = contourne la barrière CRM (debug local uniquement)
// window.__SOLARNEXT_DP_STORAGE_KEY__ : suffixe namespace stockage (ex. UUID lead) — défaut si absent = "dp-tool-cache"
// window.__SOLARNEXT_DP_ASSET_BASE__   : URL absolue du dossier dp-tool/ (slash final) — fetch pages/*.html / photos/*
// window.__SOLARNEXT_DP_DRAFT_SERVER__ : brouillon serveur (optionnel, hydratation ultérieure)
// ======================================================
function __solarnextDpResolveAssetUrl(relativePath) {
  const base =
    typeof window !== "undefined" && window.__SOLARNEXT_DP_ASSET_BASE__;
  if (base != null && String(base).trim()) {
    const b = String(base).replace(/\/?$/, "/");
    return new URL(String(relativePath).replace(/^\//, ""), b).href;
  }
  return relativePath;
}
function __solarnextDpApiOrigin() {
  const w = typeof window !== "undefined" ? window : {};
  const b = w.__SOLARNEXT_API_BASE__;
  if (b != null && String(b).trim()) return String(b).replace(/\/$/, "");
  if (w.location && w.location.origin) {
    var isViteDev =
      w.location.hostname === "localhost" && String(w.location.port) === "5173";
    if (isViteDev) return w.location.origin + "/api";
    return w.location.origin;
  }
  return "";
}

/** Clé publique Google Maps : `window.__VITE_GOOGLE_MAPS_API_KEY__` (voir `/config/vite-public-runtime.js`). */
function __snGoogleMapsPublicKey() {
  var w = typeof window !== "undefined" ? window : {};
  var k = w.__VITE_GOOGLE_MAPS_API_KEY__;
  return k && String(k).trim() ? String(k).trim() : "";
}

/** Équiv. `import { fromLonLat } from "ol/proj"` — WGS84 [lon, lat] → EPSG:3857 (bundle ol global). */
function fromLonLat(coord) {
  if (typeof ol === "undefined" || !ol.proj || typeof ol.proj.fromLonLat !== "function") {
    throw new Error(
      "[DP] OpenLayers (ol) introuvable — chargez ol.js avant dp-app.js (embed CRM ou déclaration préalable)."
    );
  }
  return ol.proj.fromLonLat(coord);
}

/** CRM : aligne SMARTPITCH_CTX sur __SOLARNEXT_DP_CONTEXT__ (mandat, DP6, etc.). */
function __solarnextHydrateSmartpitchFromDpContext() {
  var w = typeof window !== "undefined" ? window : {};
  var inj = w.__SOLARNEXT_DP_CONTEXT__;
  if (!inj || typeof inj !== "object") return;
  var c = inj.context;
  if (!c || typeof c !== "object") return;
  var id = c.identity && typeof c.identity === "object" ? c.identity : {};
  var site = c.site && typeof c.site === "object" ? c.site : {};
  var full =
    (id.fullName != null && String(id.fullName).trim()) ||
    [id.firstName, id.lastName].filter(Boolean).join(" ").trim() ||
    "";
  var birth =
    id.birthDate != null && String(id.birthDate).trim()
      ? String(id.birthDate).trim().slice(0, 10)
      : "";
  w.SMARTPITCH_CTX = {
    client: {
      name: full,
      nom: full,
      adresse: site.address != null ? String(site.address) : "",
      ville: site.city != null ? String(site.city) : "",
      date_naissance: birth || undefined,
    },
    project: {
      address: site.address != null ? String(site.address) : "",
      city: site.city != null ? String(site.city) : "",
    },
    leadId: inj.leadId,
    maison: { toiture: "", orientation: "", inclinaison: 0 },
  };
}
try {
  window.__solarnextHydrateSmartpitchFromDpContext = __solarnextHydrateSmartpitchFromDpContext;
} catch (_) {}

/** Corrige les URLs absolues /frontend/dp-tool/... après injection HTML. */
function __solarnextFixDpInjectedAssetUrls(root) {
  if (!root || !root.querySelectorAll) return;
  var prefix = "/frontend/dp-tool/";
  root.querySelectorAll("img[src]").forEach(function (img) {
    var s = img.getAttribute("src") || "";
    if (s.indexOf(prefix) !== 0) return;
    var tail = s.slice(prefix.length);
    img.setAttribute("src", __solarnextDpResolveAssetUrl(tail));
  });
  root.querySelectorAll("[style]").forEach(function (el) {
    var st = el.getAttribute("style");
    if (!st || st.indexOf(prefix) === -1) return;
    el.setAttribute(
      "style",
      st.replace(
        /url\(\s*["']?(\/frontend\/dp-tool\/[^"')]+)["']?\s*\)/g,
        function (_, absPath) {
          var rel = absPath.indexOf(prefix) === 0 ? absPath.slice(prefix.length) : absPath;
          return "url(" + __solarnextDpResolveAssetUrl(rel) + ")";
        }
      )
    );
  });
}

/** URL absolue ou chemin relatif sûr (jamais localhost forcé). */
function __solarnextPdfUrl(path) {
  const p = path.startsWith("/") ? path : "/" + path;
  const o = __solarnextDpApiOrigin();
  return o ? o + p : p;
}

try {
  window.__solarnextMandatSignatureStampUrl = function () {
    return __solarnextPdfUrl("pdf/render/mandat/signature-stamp");
  };
} catch (_) {}

/** Construit une URL absolue vers `/api/<tail>` (ex. `pv/panels`) quel que soit le mode dev/prod. */
function __solarnextDpAbsApiUrl(tail) {
  const t = String(tail || "").replace(/^\//, "");
  const o = __solarnextDpApiOrigin();
  if (!o) return "/api/" + t;
  const base = /\/api$/i.test(o) ? o : String(o).replace(/\/$/, "") + "/api";
  return base + "/" + t;
}

/**
 * En-têtes super-admin / org — implémentation partagée : `dp-super-admin-headers.js` (window.__solarnextDpApplySuperAdminContextHeaders).
 * @param {Record<string, string>} headers
 */
function __solarnextDpMergeCrmAuthHeaders(headers) {
  try {
    var w = typeof window !== "undefined" ? window : null;
    if (w && typeof w.__solarnextDpApplySuperAdminContextHeaders === "function") {
      w.__solarnextDpApplySuperAdminContextHeaders(headers);
    }
  } catch (e) {
    /* ignore */
  }
}

function __solarnextDpAuthHeadersJson() {
  var h = { "Content-Type": "application/json" };
  try {
    var token = typeof localStorage !== "undefined" && localStorage.getItem("solarnext_token");
    if (token) h.Authorization = "Bearer " + token;
  } catch (e) {}
  __solarnextDpMergeCrmAuthHeaders(h);
  return h;
}

function __solarnextDpAuthHeadersBearerOnly() {
  var h = {};
  try {
    var token = typeof localStorage !== "undefined" && localStorage.getItem("solarnext_token");
    if (token) h.Authorization = "Bearer " + token;
  } catch (e) {}
  __solarnextDpMergeCrmAuthHeaders(h);
  return h;
}

function __solarnextDpLeadIdForPdfPayload() {
  try {
    var c = typeof window !== "undefined" && window.__SOLARNEXT_DP_CONTEXT__;
    return c && c.leadId ? String(c.leadId) : null;
  } catch (e) {
    return null;
  }
}

function __solarnextDpMergeLeadId(body) {
  var lid = __solarnextDpLeadIdForPdfPayload();
  var o = body && typeof body === "object" ? body : {};
  if (!lid) return o;
  if (o.leadId || o.lead_id) return o;
  return Object.assign({}, o, { leadId: lid });
}

/** Aligné backend/constants/dpPdfFileNames.js — nom local si réponse = PDF brut (sans enregistrement). */
function __solarnextDpFallbackPdfName(pieceKey) {
  var M = {
    mandat: "mandat-representation.pdf",
    dp1: "dp1-plan-de-situation.pdf",
    dp2: "dp2-plan-de-masse.pdf",
    dp3: "dp3-plan-de-coupe.pdf",
    dp4: "dp4-plan-facades-toitures.pdf",
    dp5: "dp5-representation-graphique.pdf",
    dp6: "dp6-insertion-paysagere.pdf",
    dp7: "dp7-photo-proche.pdf",
    dp8: "dp8-photo-lointaine.pdf",
    cerfa: "cerfa.pdf",
    dp_complet: "dossier-declaration-prealable.pdf",
  };
  var k = String(pieceKey || "document").trim().toLowerCase();
  var num = /^dp\s*(\d+)$/i.exec(k);
  if (num) k = "dp" + num[1];
  return M[k] || "document.pdf";
}

async function __solarnextDpOpenSavedPdfFromJson(j, defaultDownloadName) {
  var docId = j.documentId || j.document_id;
  if (!docId) {
    alert("Réponse serveur invalide (documentId manquant).");
    return;
  }
  var down = await fetch(__solarnextDpAbsApiUrl("documents/" + encodeURIComponent(docId) + "/download"), {
    method: "GET",
    headers: __solarnextDpAuthHeadersBearerOnly(),
  });
  if (!down.ok) {
    try {
      var errJ = await down.json();
      if (errJ && errJ.error) {
        alert(errJ.error);
        return;
      }
    } catch (e2) {}
    alert("Impossible de télécharger le document enregistré.");
    return;
  }
  var blob = await down.blob();
  var url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  var a = document.createElement("a");
  a.href = url;
  a.download = (j.fileName || defaultDownloadName || "document.pdf").replace(/[\r\n]/g, "");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 3000);
}

/**
 * POST PDF DP avec dédoublonnage : si le serveur signale alreadyExists → confirm puis forceReplace.
 */
async function __solarnextDpFetchPdfWithReplace(urlPath, getPayload, pieceKey, getFallbackName) {
  var fallback = function () {
    if (typeof getFallbackName === "function") {
      return getFallbackName();
    }
    return __solarnextDpFallbackPdfName(pieceKey);
  };
  async function post(forceReplace) {
    var p = getPayload();
    if (forceReplace) p.forceReplace = true;
    return fetch(__solarnextPdfUrl(urlPath), {
      method: "POST",
      headers: __solarnextDpAuthHeadersJson(),
      body: JSON.stringify(__solarnextDpMergeLeadId(p)),
    });
  }

  var res = await post(false);
  var ct = (res.headers.get("content-type") || "").toLowerCase();

  if (ct.indexOf("application/json") >= 0) {
    var j = await res.json();
    if (j.alreadyExists === true) {
      var line = j.fileName ? "\n\nFichier actuel : " + j.fileName : "";
      if (!window.confirm("Ce document existe déjà pour ce dossier." + line + "\n\nVoulez-vous le remplacer ?")) {
        return;
      }
      res = await post(true);
      ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") >= 0) {
        j = await res.json();
        if (j.error) {
          alert(j.error);
          return;
        }
        if (j.alreadyExists === true) {
          alert("Impossible de finaliser le remplacement.");
          return;
        }
        if (j.documentId || j.document_id) {
          await __solarnextDpOpenSavedPdfFromJson(j, fallback());
          return;
        }
        alert("Réponse serveur inattendue après remplacement.");
        return;
      }
    } else if (j.error) {
      alert(j.error);
      return;
    } else if (j.documentId || j.document_id) {
      await __solarnextDpOpenSavedPdfFromJson(j, fallback());
      return;
    } else {
      alert("Réponse serveur inattendue.");
      return;
    }
  }

  await __solarnextDpFetchPdfThenOpenOrDownload(res, fallback());
}

async function __solarnextDpFetchPdfThenOpenOrDownload(res, defaultDownloadName) {
  var ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.indexOf("application/json") >= 0) {
    var j = await res.json();
    if (j.error) {
      alert(j.error);
      return;
    }
    if (j.alreadyExists === true) {
      alert("Un document du même type existe déjà — utilisez l’export depuis le CRM avec confirmation.");
      return;
    }
    await __solarnextDpOpenSavedPdfFromJson(j, defaultDownloadName);
    return;
  }
  if (!res.ok) {
    try {
      var ej = await res.json();
      if (ej && ej.error) {
        alert(ej.error);
        return;
      }
    } catch (e3) {}
    alert("Erreur lors de la génération du PDF.");
    return;
  }
  var blob = await res.blob();
  var url2 = URL.createObjectURL(blob);
  window.open(url2, "_blank");
  var a2 = document.createElement("a");
  a2.href = url2;
  a2.download = defaultDownloadName || "document.pdf";
  document.body.appendChild(a2);
  a2.click();
  a2.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url2);
  }, 3000);
}

async function __solarnextDpPersistCerfaPdfBytes(pdfBytes) {
  var lid = __solarnextDpLeadIdForPdfPayload();
  var token = typeof localStorage !== "undefined" && localStorage.getItem("solarnext_token");
  if (!lid || !token) return;
  try {
    var fd = new FormData();
    fd.append("entityType", "lead");
    fd.append("entityId", lid);
    fd.append("document_type", "dp_pdf");
    fd.append("document_category", "DP");
    fd.append(
      "file",
      new Blob([pdfBytes], { type: "application/pdf" }),
      "cerfa-" + lid + ".pdf"
    );
    var r = await fetch(__solarnextDpAbsApiUrl("documents"), {
      method: "POST",
      headers: __solarnextDpAuthHeadersBearerOnly(),
      body: fd,
    });
    if (!r.ok) {
      console.warn("[CERFA] enregistrement document DP", r.status);
    }
  } catch (e) {
    console.warn("[CERFA] persist document", e);
  }
}

/** Blocage plein écran — DP réservé au CRM (sauf __SN_DP_DEV_MODE). */
function solarnextDpInstallCrmRequiredBlock(message) {
  const msg = message || "Ce module doit être utilisé depuis le CRM";
  function paint() {
    if (document.getElementById("sn-dp-crm-required-block")) return;
    const el = document.createElement("div");
    el.id = "sn-dp-crm-required-block";
    el.setAttribute("role", "alert");
    el.textContent = msg;
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#f9fafb;color:#111827;font:600 16px/1.5 system-ui,sans-serif;text-align:center;box-sizing:border-box;";
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
  }
  if (typeof document !== "undefined" && document.body) paint();
  else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", paint, { once: true });
  }
}

(function solarnextDpRunCrmEntryGate() {
  const w = typeof window !== "undefined" ? window : {};
  if (w.__SN_DP_INIT_BLOCKED) {
    solarnextDpInstallCrmRequiredBlock("Ce module doit être utilisé depuis le CRM");
    return;
  }
  if (w.__SN_DP_DEV_MODE === true) return;
  const ctx = w.__SOLARNEXT_DP_CONTEXT__;
  if (!ctx || !ctx.leadId) {
    console.error("[DP INIT BLOCKED — NO CRM CONTEXT]");
    w.__SN_DP_INIT_BLOCKED = true;
    w.__SN_DP_PERSISTENCE_DISABLED = true;
    if (w.__SN_DP_PUT_TRACE__ === true || w.__SN_DP_TRACE__ === true) {
      console.warn(
        "[SN-DP-PUT-TRACE]",
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "persistence_disabled_init",
          source: "dp-app.js solarnextDpRunCrmEntryGate",
          reason: "NO_CRM_CONTEXT",
          leadId: null,
        })
      );
      try {
        w.__SN_DP_TRACE_LAST_DISABLE__ = {
          at: new Date().toISOString(),
          reason: "NO_CRM_CONTEXT",
          code: "INIT_GATE",
        };
      } catch (_) {}
    }
    solarnextDpInstallCrmRequiredBlock("Ce module doit être utilisé depuis le CRM");
    return;
  }
  if (w.__SOLARNEXT_DP_CRM_EMBED !== true) {
    console.error("[DP INIT BLOCKED — NOT CRM EMBED]");
    w.__SN_DP_INIT_BLOCKED = true;
    w.__SN_DP_PERSISTENCE_DISABLED = true;
    if (w.__SN_DP_PUT_TRACE__ === true || w.__SN_DP_TRACE__ === true) {
      console.warn(
        "[SN-DP-PUT-TRACE]",
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "persistence_disabled_init",
          source: "dp-app.js solarnextDpRunCrmEntryGate",
          reason: "NOT_CRM_EMBED",
          leadId: ctx.leadId || null,
        })
      );
      try {
        w.__SN_DP_TRACE_LAST_DISABLE__ = {
          at: new Date().toISOString(),
          reason: "NOT_CRM_EMBED",
          code: "INIT_GATE",
        };
      } catch (_) {}
    }
    solarnextDpInstallCrmRequiredBlock("Ce module doit être utilisé depuis le CRM");
  }
})();

function __solarnextScopedStorageKey(suffix) {
  const w = typeof window !== "undefined" ? window : {};
  const ns = w.__SOLARNEXT_DP_STORAGE_KEY__;
  const part = ns != null && String(ns).trim() ? String(ns).trim() : "dp-tool-cache";
  return "sn_dp:" + part + ":" + suffix;
}

function __solarnextReadScopedStorage(suffix) {
  try {
    return localStorage.getItem(__solarnextScopedStorageKey(suffix));
  } catch (_) {
    return null;
  }
}

function __solarnextWriteScopedStorage(suffix, value) {
  try {
    localStorage.setItem(__solarnextScopedStorageKey(suffix), value);
  } catch (_) {}
}

function __solarnextRemoveScopedStorage(suffix) {
  try {
    localStorage.removeItem(__solarnextScopedStorageKey(suffix));
  } catch (_) {}
}

function __solarnextSessionScopedKey(suffix) {
  return __solarnextScopedStorageKey("sess:" + suffix);
}

// ======================================================
// CRM : contexte lead injecté avant ce script → prioritaire sur le mock
// ======================================================
if (!window.__SN_DP_INIT_BLOCKED) {
  __solarnextHydrateSmartpitchFromDpContext();
}

// ======================================================
// DEV LOCAL — mocks (uniquement si __SN_DP_DEV_MODE — pas de fallback silencieux hors CRM)
// ======================================================
if (window.__SN_DP_DEV_MODE === true) {
  if (!window.SMARTPITCH_CTX) {
    console.warn("[DP DEV] injection SMARTPITCH_CTX mock");
    window.SMARTPITCH_CTX = {
      client: {
        nom: "GIRARD Kim",
        date_naissance: "1970-06-18",
        adresse: "14 Rue Gabriel Peri",
        ville: "Cachan"
      },
      maison: { toiture: "Bacacier", orientation: "N", inclinaison: 15 }
    };
  }
  if (
    !window.DP1_CONTEXT &&
    window.SMARTPITCH_CTX?.client &&
    !window.__SOLARNEXT_DP_CONTEXT__
  ) {
    console.warn("[DP DEV] injection DP1_CONTEXT mock");
    window.DP1_CONTEXT = {
      nom: window.SMARTPITCH_CTX.client.nom || window.SMARTPITCH_CTX.client.name,
      adresse: window.SMARTPITCH_CTX.client.adresse,
      cp: "77520",
      ville: window.SMARTPITCH_CTX.client.ville
    };
  }
}

// ======================================================
// DP VIEW LOCK — Source de vérité vue carto (DP2 → DP4)
// Ne pas remplir automatiquement ; prêt pour lockDPView.
// ======================================================
window.DP_VIEW_LOCK = {
  projection: "EPSG:3857",
  center: null,
  resolution: null,
  size: null
};

// 🔒 HARD RESET runtime-only (jamais persistant)
window.DP4_CAPTURE_IMAGE = null;

// Import DP2 → DP4 (overlay screen-space canvas, PAS layer OpenLayers)
window.DP4_IMPORT_OVERLAY_CANVAS = null;
window.DP4_IMPORT_DP2_ACTIVE = false;
/** Snapshot vue au moment « Importer DP2 » (aperçu figé ; pan/zoom invalide l’aperçu). */
window.DP4_IMPORT_VIEW_SNAPSHOT = null;
/** moveend : invalider aperçu si la vue change (pas de recalcul géo automatique). */
window.DP4_IMPORT_STALE_MOVEEND_HANDLER = null;

function lockDPView({ map }) {
  const view = map.getView();
  const center = view.getCenter();
  const resolution = view.getResolution();
  const size = map.getSize();
  window.DP_VIEW_LOCK.center = center ? center.slice() : null;
  window.DP_VIEW_LOCK.resolution = resolution != null ? resolution : null;
  window.DP_VIEW_LOCK.size = size ? size.slice() : null;
  console.log("[DP] View locked");
}

function applyDPView({ map }) {
  const lock = window.DP_VIEW_LOCK;
  if (!lock || lock.center == null || lock.resolution == null || lock.size == null) return;
  const view = map.getView();
  view.setCenter(lock.center);
  view.setResolution(lock.resolution);
  map.setSize(lock.size);
  console.log("[DP] View applied");
}

function applySafeInitialResolution(map, targetResolution, wmtsResolutions) {
  if (!map || !map.getView) return;
  const view = map.getView();
  if (!view || !Array.isArray(wmtsResolutions)) return;

  const idx = wmtsResolutions.indexOf(targetResolution);
  if (idx <= 0) return; // pas de cran supérieur possible

  const startResolution = wmtsResolutions[idx - 1];

  // 1) On démarre un cran en dessous
  view.setResolution(startResolution);

  // 2) Une fois le premier rendu fait, on revient à la cible
  map.once("rendercomplete", function () {
    requestAnimationFrame(() => {
      view.setResolution(targetResolution);
      try { map.renderSync(); } catch (_) {}
    });
  });
}

// ======================================================
// NAVIGATION / CHARGEMENT DES PAGES (UNIQUE) — mount shell + embed CRM (scripts chargés après DOM ready)
// ======================================================
function solarnextDpMountNavigationShell() {
  if (window.__SN_DP_INIT_BLOCKED) return;
  if (window.__SOLARNEXT_DP_NAV_MOUNTED__) return;
  const viewsRoot = document.getElementById("dp-views-root");
  const content = document.getElementById("page-content");
  const mountRoot = document.getElementById("dp-tool-root") || document.body;
  if (!viewsRoot && !content) return;

  window.__SOLARNEXT_DP_NAV_MOUNTED__ = true;
  const abort = new AbortController();
  window.__SOLARNEXT_DP_NAV_ABORT__ = function solarnextDpNavAbort() {
    try {
      abort.abort();
    } catch (_) {}
    delete window.__SOLARNEXT_DP_NAV_MOUNTED__;
    try {
      delete window.__DP_MOUNTED_PATHS__;
    } catch (_) {
      window.__DP_MOUNTED_PATHS__ = undefined;
    }
    window.__SOLARNEXT_DP_NAV_ABORT__ = undefined;
  };

  const links = mountRoot.querySelectorAll(".dp-menu a[data-page]");

  function setActive(page) {
    links.forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  }

  function wireAccordions(root) {
    if (!root) return;
    root.querySelectorAll(".dp-item-header").forEach((header) => {
      header.addEventListener("click", () => {
        const item = header.closest(".dp-item");
        if (!item) return;
        item.classList.toggle("open");
        const toggle = header.querySelector(".dp-toggle");
        if (toggle) toggle.textContent = item.classList.contains("open") ? "Masquer" : "Voir";
      });
    });
  }

function initInjectedPage(page) {
  if (page.endsWith("dp1.html")) {
    // ✅ initialise TOUT le DP1 (upload + états + modal + lead)
    if (typeof initDP1 === "function") {
      initDP1();
    } else {
      console.warn("[DP1] initDP1 introuvable");
    }
  } else if (page.endsWith("dp2.html")) {
    initDP2();
  } else if (page.endsWith("dp3.html")) {
    initDP3();
  } else if (page.endsWith("dp4.html")) {
    initDP4();
  } else if (page.endsWith("dp6.html")) {
    initDP6();
  } else if (page.endsWith("dp7.html")) {
    if (typeof initDP7 === "function") {
      initDP7();
      try { if (typeof window.bindDP7ExportPdfButton === "function") window.bindDP7ExportPdfButton(); } catch (_) {}
    } else {
      console.warn("[DP7] initDP7 introuvable");
    }
  } else if (page.endsWith("dp8.html")) {
    if (typeof initDP8 === "function") {
      initDP8();
      try { if (typeof window.bindDP8ExportPdfButton === "function") window.bindDP8ExportPdfButton(); } catch (_) {}
    } else {
      console.warn("[DP8] initDP8 introuvable");
    }
  } else if (page.endsWith("mandat.html")) {
    if (typeof window.initMandatPage === "function") {
      window.initMandatPage();
    }
  } else if (page.endsWith("cerfa.html")) {
    if (typeof initCERFA === "function") {
      initCERFA();
    } else {
      console.warn("[CERFA] initCERFA introuvable");
    }
  }
}

  function resolveBootPagePath() {
    var boot = "pages/general.html";
    try {
      if (window.__SN_DP_BOOT_PAGE_PATH__) {
        return String(window.__SN_DP_BOOT_PAGE_PATH__);
      }
      if (window.DpDraftStore && typeof window.DpDraftStore.getDraft === "function") {
        var d = window.DpDraftStore.getDraft();
        var pid = d && d.progression && d.progression.currentPageId;
        if (pid && window.DpDraftStore.pageIdToPath) {
          boot = window.DpDraftStore.pageIdToPath(pid);
        }
      }
    } catch (_) {}
    return boot;
  }

  async function mountViewOnce(pagePath) {
    if (!viewsRoot) return;
    if (!window.__DP_MOUNTED_PATHS__) window.__DP_MOUNTED_PATHS__ = new Set();
    if (window.__DP_MOUNTED_PATHS__.has(pagePath)) return;
    var pageId =
      window.DpDraftStore && typeof window.DpDraftStore.mapPathToPageId === "function"
        ? window.DpDraftStore.mapPathToPageId(pagePath)
        : "general";
    var slot = document.getElementById("view-" + pageId);
    if (!slot) {
      console.warn("[DP] mountViewOnce: slot introuvable", pagePath, pageId);
      return;
    }
    try {
      const res = await fetch(__solarnextDpResolveAssetUrl(pagePath), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      slot.innerHTML = await res.text();
      __solarnextFixDpInjectedAssetUrls(slot);
      wireAccordions(slot);
      initInjectedPage(pagePath);
      window.__DP_MOUNTED_PATHS__.add(pagePath);
    } catch (e) {
      console.error(e);
      slot.innerHTML = `
        <p style="color:#b91c1c;font-weight:600">Erreur de chargement</p>
        <p style="color:#6b7280">${e.message}</p>
      `;
      window.__DP_MOUNTED_PATHS__.add(pagePath);
    }
  }

  function showView(pagePath) {
    if (!viewsRoot) return;
    var pageId =
      window.DpDraftStore && typeof window.DpDraftStore.mapPathToPageId === "function"
        ? window.DpDraftStore.mapPathToPageId(pagePath)
        : "general";
    /* Uniquement les slots racine — ne pas toucher aux .dp-view internes (ex. grille DP1). */
    var i;
    var ch = viewsRoot.children;
    for (i = 0; i < ch.length; i++) {
      var el = ch[i];
      if (el && el.classList && el.classList.contains("dp-view")) {
        el.classList.remove("dp-view--active");
      }
    }
    var slot = document.getElementById("view-" + pageId);
    if (slot) slot.classList.add("dp-view--active");
    setActive(pagePath);
    try {
      if (window.DpDraftStore && typeof window.DpDraftStore.setCurrentPage === "function") {
        window.DpDraftStore.setCurrentPage(pageId);
      }
    } catch (_) {}
    try {
      if (typeof window.hydratePage === "function") window.hydratePage(pagePath);
    } catch (_) {}
    try {
      if (typeof window.__snDpPersistDebounced === "function") window.__snDpPersistDebounced(false);
    } catch (_) {}
  }

  async function navigateTo(pagePath) {
    if (viewsRoot) {
      await mountViewOnce(pagePath);
      showView(pagePath);
      return;
    }
    await legacyLoadPage(pagePath);
  }

  async function legacyLoadPage(page) {
    if (!content) return;
    try {
      const res = await fetch(__solarnextDpResolveAssetUrl(page), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      content.innerHTML = await res.text();
      __solarnextFixDpInjectedAssetUrls(content);
      setActive(page);
      wireAccordions(content);
      initInjectedPage(page);
      try {
        if (typeof window.hydratePage === "function") window.hydratePage(page);
      } catch (_) {}
    } catch (e) {
      console.error(e);
      content.innerHTML = `
        <p style="color:#b91c1c;font-weight:600">Erreur de chargement</p>
        <p style="color:#6b7280">${e.message}</p>
      `;
    }
  }

  mountRoot.addEventListener(
    "click",
    async (e) => {
      const link = e.target.closest(".dp-menu a[data-page]");
      if (!link) return;
      e.preventDefault();
      if (typeof window.__snDpNotifyMenuNavigate === "function") {
        try {
          window.__snDpNotifyMenuNavigate(link.dataset.page);
        } catch (err) {
          console.warn("[DP] draft menu hook", err);
        }
      }
      await navigateTo(link.dataset.page);
    },
    { signal: abort.signal }
  );

  navigateTo(resolveBootPagePath()).catch(function (err) {
    console.error("[DP] boot navigation", err);
  });
}

function solarnextDpScheduleMountShell() {
  if (window.__SN_DP_INIT_BLOCKED) return;
  if (document.getElementById("dp-views-root") || document.getElementById("page-content")) {
    solarnextDpMountNavigationShell();
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        solarnextDpMountNavigationShell();
      },
      { once: true }
    );
  } else {
    queueMicrotask(() => {
      solarnextDpMountNavigationShell();
    });
  }
}

if (!window.__SN_DP_INIT_BLOCKED && !window.__SOLARNEXT_DP_EMBED_LOADER__) {
  solarnextDpScheduleMountShell();
}
window.__SOLARNEXT_DP_MOUNT_SHELL__ = solarnextDpMountNavigationShell;

// ======================================================
// CERFA — INIT (structure + affichage uniquement)
// Texte descriptif réglementaire 100 % déterministe depuis l’état DP / projet.
// ======================================================
window.CERFA_STATE = window.CERFA_STATE || {
  panelCount: "",
  panelPower: "",
  panelHeight: "",
  panelWidth: "",
  panelDepth: "",
  brand: "",
  color: "",
  panelsPerRow: "",
  columnsCount: "",
  rowsCount: "",
  panelOrientation: "",
  roofOrientation: "",
  energyManagement: "",
  /**
   * Cases urbanisme CERFA (triplets oui / non / non concerné). Valeurs : 'oui' | 'non' | 'nc'.
   * null / undefined = ne cocher aucune case de la ligne (pas de supposition métier).
   */
  urbanismeCU: null,
  urbanismeLot: null,
  urbanismeZAC: null,
  urbanismeAFU: null,
  urbanismePUP: null,
  /** '' | 'new' | 'existing' — C2ZA1_nouvelle vs C2ZB1_existante (exclusifs). */
  constructionType: "",
  /** '' | 'personnel' | 'vente' | 'location' — occupation du déclarant. */
  occupationMode: "",
  /** '' | 'principale' | 'secondaire' — résidence concernée. */
  residenceType: "",
  /** true = case D5A (contact email) cochée ; ne pas activer sans consentement explicite. */
  declarantAcceptEmailContact: false,
  /** Surcharge explicite pour case « toiture » (X1V) ; sinon dérivé de roofOrientation. */
  installationOnRoof: null
};

/** Sections général / DP5 — persistance unifiée (state_json) ; pas d’UI dédiée pour l’instant. */
window.DP_GENERAL_STATE = window.DP_GENERAL_STATE || {};
window.DP5_STATE = window.DP5_STATE || {};

function cerfaLogState() {
  console.log("CERFA_STATE", { ...window.CERFA_STATE });
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function normOrientation(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s.includes("por")) return "portrait";
  if (s.includes("pay")) return "paysage";
  if (s === "p") return "portrait";
  if (s === "l") return "paysage";
  return "";
}

function cerfaIsDebugMode() {
  try {
    if (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("SOLARNEXT_CERFA_DEBUG") === "1") {
      return true;
    }
    if (typeof window !== "undefined" && /\bcerfaDebug=1\b/.test(String(window.location && window.location.search))) {
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Date de signature CERFA : format JJ/MM/AAAA (lisible, attendu sur formulaires français).
 * @param {Date} [d]
 * @returns {string}
 */
function formatDateCerfa(d) {
  const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  const dd = String(x.getDate()).padStart(2, "0");
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const yyyy = String(x.getFullYear());
  return dd + "/" + mm + "/" + yyyy;
}

/**
 * Puissance kWc : virgule décimale, sans zéros superflus (ex. 3, 3,5 et non 3.00).
 * @param {number} kwc
 * @returns {string}
 */
function formatPowerCerfa(kwc) {
  const n = Number(kwc);
  if (!Number.isFinite(n) || n < 0) return "";
  const rounded = Math.round(n * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  const s = rounded.toFixed(3).replace(/\.?0+$/, "");
  return s.replace(".", ",");
}

/**
 * Téléphone affichage CERFA : national FR 0X XX XX XX XX si possible ; indicatif séparé.
 * @param {string} raw
 * @returns {{ national: string, indicatif: string, hadInput: boolean }}
 */
function formatPhoneCerfa(raw) {
  const hadInput = raw != null && String(raw).trim() !== "";
  let digits = String(raw || "").replace(/[^\d+]/g, "");
  let indicatif = "33";
  if (digits.startsWith("+33")) {
    digits = "0" + digits.slice(3);
  } else if (digits.startsWith("0033")) {
    digits = "0" + digits.slice(4);
  }
  digits = digits.replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length >= 10) {
    digits = "0" + digits.slice(2);
  }
  if (digits.length === 9 && !digits.startsWith("0")) {
    digits = "0" + digits;
  }
  let national = "";
  if (digits.length >= 10 && digits.startsWith("0")) {
    national = digits.slice(0, 10);
  } else if (digits.length > 0) {
    national = digits;
  }
  return { national, indicatif, hadInput };
}

/**
 * Découpage adresse française : première unité si elle ressemble à un numéro de voirie, sinon tout en voie.
 * Gère les adresses sans numéro en tête (ex. « Rue de la Paix » → voie complète, numéro vide).
 * @param {string} line
 * @returns {{ numeroVoie: string, voie: string }}
 */
function parseFrenchAddressLine(line) {
  const full = String(line || "").trim().replace(/\s+/g, " ");
  if (!full) return { numeroVoie: "", voie: "" };
  const m = full.match(
    /^(\d{1,4}(?:\s*[A-Za-z])?(?:\s*(?:bis|ter|quater))?)\s+(.+)$/i
  );
  if (m) {
    return { numeroVoie: m[1].replace(/\s+/g, " ").trim(), voie: m[2].trim() };
  }
  return { numeroVoie: "", voie: full };
}

function truncateForField(str, max) {
  const s = String(str || "");
  if (!max || s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function normalizeScalarForPdf(value, opts) {
  const allowZero = opts && opts.allowZero;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (allowZero && value === 0) return "0";
    if (!allowZero && value === 0) return "";
    return String(value);
  }
  let s = String(value).trim();
  if (!s || /^undefined$/i.test(s) || /^null$/i.test(s) || s === "[object Object]") return "";
  return s.replace(/\s+/g, " ").trim();
}

function createCerfaFillReport() {
  return {
    filled: [],
    skippedOptional: [],
    missingRequired: [],
    fieldErrors: [],
    warnings: [],
    checkboxesApplied: [],
    checkboxesSkipped: []
  };
}

var CERFA_TEXT_FONT = {
  short: 10,
  medium: 9,
  street: 8.5,
  multiline: 7,
  tiny: 8
};

/**
 * Description CERFA : uniquement à partir de l’objet d’état (aucune lecture DOM).
 * @param {object} cerfaState
 * @returns {string}
 */
function buildCerfaDescriptionText(cerfaState) {
  const S = cerfaState && typeof cerfaState === "object" ? cerfaState : {};
  const safe = (v) => {
    if (v === undefined || v === null) return "";
    const t = String(v).trim();
    if (!t || /^undefined$/i.test(t) || /^null$/i.test(t)) return "";
    return t;
  };

  const panelCount = safe(S.panelCount);
  const panelPower = safe(S.panelPower);
  const panelWidth = safe(S.panelWidth);
  const panelHeight = safe(S.panelHeight);
  const panelThickness = safe(S.panelDepth);
  const columnsCount = safe(S.columnsCount);
  const panelsPerRow = safe(S.panelsPerRow);
  const roofOrientation = safe(S.roofOrientation);
  const panelBrand = safe(S.brand);
  const panelColor = safe(S.color);

  const orientationFr =
    S.panelOrientation === "landscape" || S.panelOrientation === "paysage" || normOrientation(S.panelOrientation) === "paysage"
      ? "paysage"
      : S.panelOrientation || normOrientation(S.panelOrientation)
        ? "portrait"
        : "";

  const phrases = [];

  if (panelCount && panelPower) {
    let p =
      "Pose de " +
      panelCount +
      " panneau(x) solaire(s) photovoltaïque(s) d’une puissance unitaire de " +
      panelPower +
      " Wc";
    if (panelWidth && panelHeight && panelThickness) {
      p += ", de dimensions " + panelWidth + " × " + panelHeight + " × " + panelThickness + " mm";
    }
    phrases.push(p + ".");
  } else if (panelCount || panelPower) {
    phrases.push(
      "Installation photovoltaïque : compléter le nombre de modules et/ou la puissance unitaire (Wc) pour une description conforme."
    );
  }

  if (columnsCount && panelsPerRow) {
    let d =
      "Disposition : " +
      columnsCount +
      " colonne(s), " +
      panelsPerRow +
      " panneau(x) par ligne";
    if (orientationFr) d += ", modules en " + orientationFr;
    phrases.push(d + ".");
  }

  if (roofOrientation) {
    phrases.push("Orientation du pan de toit : " + roofOrientation + ".");
  }

  if (panelBrand || panelColor) {
    const bits = [];
    if (panelBrand) bits.push("marque " + panelBrand);
    if (panelColor) bits.push("couleur " + panelColor);
    phrases.push("Modules : " + bits.join(", ") + ", traitement anti-reflet.");
  }

  return phrases.join("\n").trim();
}

function generateCerfaDescription() {
  const text = buildCerfaDescriptionText(window.CERFA_STATE || {});
  const ta = document.getElementById("cerfa-description");
  if (ta) ta.value = text;
  console.log("[CERFA] Texte généré:", text);
}

function initCERFA() {
  const S = window.CERFA_STATE;
  if (S.panelHeight === undefined) S.panelHeight = "";
  if (S.panelWidth === undefined) S.panelWidth = "";
  if (S.panelDepth === undefined) S.panelDepth = "";
  if (S.columnsCount === undefined) S.columnsCount = "";

  function bindInput(id, key, parse) {
    const el = document.getElementById(id);
    if (!el) return;
    const setVal = (v) => { el.value = v === "" || v == null ? "" : String(v); };
    setVal(S[key]);
    el.addEventListener("input", function () {
      S[key] = parse ? parse(this.value) : this.value;
      cerfaLogState();
    });
  }

  function bindSelect(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = S[key] || "";
    el.addEventListener("change", function () {
      S[key] = this.value;
      cerfaLogState();
    });
  }

  function bindToggleGroup(buttonIds, key, valueTransform) {
    const buttons = buttonIds.map((id) => document.getElementById(id)).filter(Boolean);
    const normalize = valueTransform || ((v) => v);
    buttons.forEach((btn) => {
      const optVal = btn.dataset.value || "";
      if (normalize(optVal) === normalize(S[key] || "")) btn.classList.add("active");
      btn.addEventListener("click", function () {
        buttons.forEach((b) => b.classList.remove("active"));
        this.classList.add("active");
        const raw = this.dataset.value || "";
        S[key] = normalize(raw) || raw;
        cerfaLogState();
      });
    });
  }

  bindInput("cerfa-panel-count", "panelCount", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-panel-power", "panelPower", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-height", "panelHeight", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-width", "panelWidth", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-depth", "panelDepth", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-brand", "brand");
  bindInput("cerfa-panels-per-row", "panelsPerRow", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-columns", "columnsCount", (v) => (v === "" ? "" : Number(v) || v));
  bindInput("cerfa-rows", "rowsCount", (v) => (v === "" ? "" : Number(v) || v));
  bindSelect("cerfa-roof-orientation", "roofOrientation");
  bindToggleGroup(["cerfa-color-noir", "cerfa-color-autre"], "color");
  bindToggleGroup(["cerfa-panel-orientation-portrait", "cerfa-panel-orientation-paysage"], "panelOrientation", normOrientation);
  bindToggleGroup(
    ["cerfa-energy-autoconsommation", "cerfa-energy-vente-surplus", "cerfa-energy-vente-totale"],
    "energyManagement"
  );

  if (S.constructionType === undefined || S.constructionType === null) S.constructionType = "";
  if (S.occupationMode === undefined || S.occupationMode === null) S.occupationMode = "";
  if (S.residenceType === undefined || S.residenceType === null) S.residenceType = "";
  if (S.declarantAcceptEmailContact === undefined) S.declarantAcceptEmailContact = false;

  bindToggleGroup(
    ["cerfa-construction-unset", "cerfa-construction-existing", "cerfa-construction-new"],
    "constructionType"
  );
  bindToggleGroup(
    ["cerfa-occupation-unset", "cerfa-occupation-personnel", "cerfa-occupation-vente", "cerfa-occupation-location"],
    "occupationMode"
  );
  bindToggleGroup(
    ["cerfa-residence-unset", "cerfa-residence-main", "cerfa-residence-sec"],
    "residenceType"
  );

  const consentEl = document.getElementById("cerfa-email-consent");
  if (consentEl) {
    consentEl.checked = S.declarantAcceptEmailContact === true;
    consentEl.addEventListener("change", function () {
      S.declarantAcceptEmailContact = !!consentEl.checked;
      cerfaLogState();
    });
  }

  const btnGenerate = document.getElementById("cerfa-btn-generate-description");
  if (btnGenerate) btnGenerate.addEventListener("click", generateCerfaDescription);

  const btnCreatePdf = document.getElementById("cerfa-btn-create-pdf");
  if (btnCreatePdf) btnCreatePdf.addEventListener("click", createCerfaPdf);
}

// ======================================================
// CERFA — Création PDF prérempli (frontend uniquement, pdf-lib)
// ======================================================
async function loadPdf() {
  const res = await fetch(__solarnextDpResolveAssetUrl("photos/cerfa_16702-02.pdf"), { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de charger le PDF CERFA");
  return res.arrayBuffer();
}

/**
 * Normalise une réponse urbanisme CERFA (oui | non | nc).
 * @param {unknown} val
 * @returns {'oui'|'non'|'nc'|''}
 */
function normOuiNonNc(val) {
  const v = val != null ? String(val).trim().toLowerCase() : "";
  if (v === "oui" || v === "o" || v === "yes" || v === "true") return "oui";
  if (v === "non" || v === "n" || v === "no" || v === "false") return "non";
  if (v === "nc" || v === "n/c" || v === "na" || v === "n.a." || v === "non concerné" || v === "non concerne") {
    return "nc";
  }
  return "";
}

/**
 * Remplissage CERFA + rapport structuré (champs remplis, manquants, cases, erreurs PDF).
 * @returns {ReturnType<typeof createCerfaFillReport>}
 */
function fillCerfaFields(pdfDoc, state, descriptionText, options) {
  if (!pdfDoc.getForm) return createCerfaFillReport();
  const form = options?.form ?? pdfDoc.getForm();
  const helveticaFont = options?.helveticaFont;
  const report = options?.report || createCerfaFillReport();
  const cerfaState = options?.cerfaState && typeof options.cerfaState === "object" ? options.cerfaState : {};
  void helveticaFont;

  function applyFontSize(field, category, fieldName) {
    const sz = CERFA_TEXT_FONT[category] || CERFA_TEXT_FONT.medium;
    try {
      field.setFontSize(sz);
    } catch (e) {
      report.warnings.push({ code: "FONT_SIZE_SKIP", field: fieldName, detail: String(e.message || e) });
    }
  }

  function setTextField(name, raw, opts) {
    const required = !!(opts && opts.required);
    const category = (opts && opts.category) || "medium";
    const maxLen = opts && opts.maxLen;
    const allowZero = !!(opts && opts.allowZero);
    let text = normalizeScalarForPdf(raw, { allowZero });
    if (!text && (raw === 0 || raw === "0") && allowZero) text = "0";
    if (!text) {
      if (required) report.missingRequired.push({ name, detail: "valeur vide" });
      else report.skippedOptional.push({ name });
      return;
    }
    if (maxLen) text = truncateForField(text, maxLen);
    try {
      const field = form.getTextField(name);
      applyFontSize(field, category, name);
      field.setText(text);
      report.filled.push({ name });
    } catch (err) {
      report.fieldErrors.push({ name, message: err.message || String(err) });
    }
  }

  function setDescriptionMultiline(text) {
    const body = normalizeScalarForPdf(text, {});
    if (!body) {
      report.missingRequired.push({ name: "C2ZD1_description", detail: "description vide" });
      return;
    }
    try {
      const descField = form.getTextField("C2ZD1_description");
      descField.enableMultiline();
      applyFontSize(descField, "multiline", "C2ZD1_description");
      descField.setText(truncateForField(body, 8000));
      report.filled.push({ name: "C2ZD1_description" });
    } catch (err) {
      report.fieldErrors.push({ name: "C2ZD1_description", message: err.message || String(err) });
    }
  }

  function checkTripletOUINONNC(map, rawValue, label) {
    const v = normOuiNonNc(rawValue);
    if (!v || !map[v]) {
      report.checkboxesSkipped.push({ group: label, reason: "aucune valeur métier (oui|non|nc)" });
      return;
    }
    const fieldName = map[v];
    try {
      form.getCheckBox(fieldName).check();
      report.checkboxesApplied.push(fieldName);
    } catch (err) {
      report.fieldErrors.push({ name: fieldName, message: err.message || String(err) });
    }
  }

  function checkWhen(name, condition, reason) {
    if (!condition) {
      report.checkboxesSkipped.push({ name, reason: reason || "condition non remplie" });
      return;
    }
    try {
      form.getCheckBox(name).check();
      report.checkboxesApplied.push(name);
    } catch (err) {
      report.fieldErrors.push({ name, message: err.message || String(err) });
    }
  }

  setTextField("N1FCA_formulaire", "DPC", { required: true, category: "short" });

  setTextField("D1N_nom", state.nom, { required: true, category: "short" });
  setTextField("D1P_prenom", state.prenom, { category: "short" });
  setTextField("D1E_pays", state.pays || "FRANCE", { required: true, category: "short" });

  setTextField("D3N_numero", state.numeroVoie, { category: "tiny" });
  setTextField("D3V_voie", state.voie, { category: "street", maxLen: 120 });
  setTextField("D3L_localite", state.ville, { required: true, category: "medium" });
  setTextField("D3C_code", state.cp, { required: true, category: "short" });
  setTextField("D3T_telephone", state.telephone, { category: "medium" });
  setTextField("D3K_indicatif", state.indicatif || "33", { category: "tiny" });

  setTextField("D5GE1_email", state.emailLocal, { category: "medium" });
  setTextField("D5GE2_email", state.emailDomain, { category: "medium" });

  if (state.declarantAcceptEmailContact === true) {
    checkWhen("D5A_acceptation", true, null);
  } else {
    report.checkboxesSkipped.push({ name: "D5A_acceptation", reason: "consentement contact email non attesté (CERFA_STATE.declarantAcceptEmailContact)" });
  }

  setTextField("T2Q_numero", state.numeroVoie, { category: "tiny" });
  setTextField("T2V_voie", state.voie, { category: "street", maxLen: 120 });
  setTextField("T2L_localite", state.ville, { category: "medium" });
  setTextField("T2C_code", state.cp, { category: "short" });
  setTextField("T2S_section", state.parcelleSection, { category: "short" });
  setTextField("T2N_numero", state.parcelleNumero, { category: "short" });
  setTextField("T2T_superficie", state.parcelleSurfaceM2, { category: "tiny" });
  setTextField("D5T_total", state.superficieTotale, { category: "tiny", allowZero: true });

  checkTripletOUINONNC({ oui: "T3A_CUoui", non: "T3H_CUnon", nc: "T3B_CUnc" }, cerfaState.urbanismeCU, "urbanismeCU");
  checkTripletOUINONNC({ oui: "T3I_lotoui", non: "T3L_lotnon", nc: "T3S_lotnc" }, cerfaState.urbanismeLot, "urbanismeLot");
  checkTripletOUINONNC({ oui: "T3J_ZACoui", non: "T3Q_ZACnon", nc: "T3T_ZACnc" }, cerfaState.urbanismeZAC, "urbanismeZAC");
  checkTripletOUINONNC({ oui: "T3G_AFUoui", non: "T3R_AFUnon", nc: "T3E_AFUnc" }, cerfaState.urbanismeAFU, "urbanismeAFU");
  checkTripletOUINONNC({ oui: "T3P_PUPoui", non: "T3C_PUPnon", nc: "T3F_PUPnc" }, cerfaState.urbanismePUP, "urbanismePUP");

  const ctype = cerfaState.constructionType != null ? String(cerfaState.constructionType).trim().toLowerCase() : "";
  if (ctype === "new" || ctype === "nouvelle") {
    checkWhen("C2ZA1_nouvelle", true, null);
  } else if (ctype === "existing" || ctype === "existante" || ctype === "existant") {
    checkWhen("C2ZB1_existante", true, null);
  } else {
    report.checkboxesSkipped.push({
      name: "C2ZA1|C2ZB1",
      reason: "constructionType non renseigné (new|existing) — cases travaux neuf / existant non cochées"
    });
  }

  setTextField(
    "C2ZA7_autres",
    state.c2za7AutresLabel || "Pose de panneaux solaires photovoltaïques",
    { category: "street", maxLen: 200 }
  );

  setDescriptionMultiline(descriptionText);

  setTextField("C2ZP1_crete", state.puissanceKwc, { required: true, category: "medium" });
  if (state.forcePuissanceElecZero === true) {
    setTextField("C2ZE1_puissance", "0", { category: "tiny", allowZero: true });
  }
  setTextField("C2ZR1_destination", state.destinationEnergie, { category: "street", maxLen: 120 });

  const occ = cerfaState.occupationMode != null ? String(cerfaState.occupationMode).trim().toLowerCase() : "";
  if (occ === "personnel") checkWhen("C5ZD1_personnel", true, null);
  else if (occ === "vente") checkWhen("C5ZD2_vente", true, null);
  else if (occ === "location") checkWhen("C5ZD3_location", true, null);
  else {
    report.checkboxesSkipped.push({ name: "C5ZD*", reason: "occupationMode non renseigné (personnel|vente|location)" });
  }

  const res = cerfaState.residenceType != null ? String(cerfaState.residenceType).trim().toLowerCase() : "";
  if (res === "principale" || res === "princip") {
    checkWhen("C2ZF1_principale", true, null);
  } else if (res === "secondaire" || res === "second") {
    checkWhen("C2ZF2_secondaire", true, null);
  } else {
    report.checkboxesSkipped.push({ name: "C2ZF*", reason: "residenceType non renseigné (principale|secondaire)" });
  }

  setTextField("W3ES2_creee", normalizeScalarForPdf(state.surfaceCreee, { allowZero: true }) || "0", {
    category: "tiny",
    allowZero: true
  });
  setTextField("W3ES3_supprimee", normalizeScalarForPdf(state.surfaceSupprimee, { allowZero: true }) || "0", {
    category: "tiny",
    allowZero: true
  });

  setTextField("E1L_lieu", state.signatureLieu, { category: "medium" });
  setTextField("E1D_date", state.signatureDateFormatted, { required: true, category: "short" });

  try {
    const sigField = form.getTextField("E1S_signature");
    applyFontSize(sigField, "multiline", "E1S_signature");
    sigField.setText("");
    report.filled.push({ name: "E1S_signature", detail: "laissé vierge (signature manuscrite)" });
  } catch (err) {
    report.fieldErrors.push({ name: "E1S_signature", message: err.message || String(err) });
  }

  let onRoof = null;
  if (cerfaState.installationOnRoof === true) onRoof = true;
  else if (cerfaState.installationOnRoof === false) onRoof = false;
  else {
    const ro = normalizeScalarForPdf(cerfaState.roofOrientation, {});
    onRoof = ro.length > 0 ? true : null;
  }
  if (onRoof === true) checkWhen("X1V_toiture", true, null);
  else if (onRoof === false) checkWhen("X1V0_toiture", true, null);
  else {
    report.checkboxesSkipped.push({
      name: "X1V_toiture",
      reason: "emplacement non déduit — renseigner roofOrientation ou CERFA_STATE.installationOnRoof"
    });
  }

  return report;
}

/**
 * Validations pré-export (bloque la génération si erreurs bloquantes).
 */
function validateCerfaPreExport(payload) {
  const errors = [];
  const warnings = [];
  const nom = normalizeScalarForPdf(payload.nom, {});
  const cp = normalizeScalarForPdf(payload.cp, {});
  const ville = normalizeScalarForPdf(payload.ville, {});
  const descriptionText = String(payload.descriptionText || "").trim();
  const puissanceKwc = normalizeScalarForPdf(payload.puissanceKwc, {});
  const destinationEnergie = normalizeScalarForPdf(payload.destinationEnergie, {});

  if (!nom) {
    errors.push({
      code: "DECLARANT_NOM_MANQUANT",
      message: "Nom du déclarant introuvable (DP1_CONTEXT.nom ou client.nom)."
    });
  }
  if (!cp || !ville) {
    errors.push({
      code: "ADRESSE_POSTALE_INCOMPLETE",
      message: "Code postal et commune obligatoires (DP1_CONTEXT ou client : cp, ville)."
    });
  }
  if (!descriptionText) {
    errors.push({
      code: "DESCRIPTION_VIDE",
      message: "Description projet vide : saisir les données CERFA puis « Générer la description du projet »."
    });
  }

  const count = payload.panelCount;
  const power = payload.panelPower;
  const hasPanels = count !== "" && count != null && Number.isFinite(Number(count)) && Number(count) > 0;
  const hasPower = power !== "" && power != null && Number.isFinite(Number(power)) && Number(power) > 0;
  if (!hasPanels || !hasPower) {
    errors.push({
      code: "PUISSANCE_CRETE_INCOMPLETE",
      message: "Nombre de panneaux et puissance unitaire (Wc) obligatoires pour la puissance crête."
    });
  }
  if (!puissanceKwc) {
    errors.push({ code: "PUISSANCE_KWC_VIDE", message: "Puissance crête (kWc) non calculée." });
  }

  const phone = payload.phoneFormat || { national: "" };
  if (!phone.national) {
    warnings.push({ code: "TELEPHONE_ABSENT", message: "Téléphone absent : champ D3T laissé vide dans le PDF." });
  }

  const dp1 = payload.dp1State;
  const parcel = dp1 && dp1.selectedParcel;
  const hasParcelId =
    parcel &&
    (normalizeScalarForPdf(parcel.section, {}) ||
      normalizeScalarForPdf(parcel.numero, {}) ||
      (parcel.parcel != null && String(parcel.parcel).trim()));
  if (!hasParcelId) {
    warnings.push({
      code: "PARCELLE_MANQUANTE",
      message: "Parcelle cadastrale absente dans DP1 : section/numéro vides — compléter DP1 ou le PDF à la main."
    });
  }
  if (dp1 && dp1.isValidated === false && hasParcelId) {
    warnings.push({
      code: "DP1_NON_VALIDE",
      message: "DP1 non validé (isValidated=false) : vérifier la parcelle avant dépôt."
    });
  }

  if (!destinationEnergie) {
    warnings.push({
      code: "GESTION_ENERGIE_NON_RENSEIGNEE",
      message: "Mode de gestion de l’énergie non choisi : le champ « destination » (C2ZR1) sera vide dans le PDF."
    });
  }

  return { errors, warnings };
}

function openPdfInNewTab(pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

async function createCerfaPdf() {
  const PDFLib = window.PDFLib;
  if (!PDFLib || !PDFLib.PDFDocument) {
    console.warn("[CERFA PDF] pdf-lib non chargé");
    return;
  }
  const debug = cerfaIsDebugMode();
  try {
    const arrayBuffer = await loadPdf();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);

    const { StandardFonts } = PDFLib;
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();

    const ctx = window.DP1_CONTEXT || {};
    const client = window.SMARTPITCH_CTX?.client || {};
    const cad = window.DP1_STATE?.selectedParcel || null;
    const dp1State = window.DP1_STATE || {};
    const cerfaState = window.CERFA_STATE || {};

    const nomComplet = normalizeScalarForPdf(ctx.nom || client.nom, {});
    const parts = nomComplet ? nomComplet.split(/\s+/) : [];
    let nom = "";
    let prenom = "";
    if (parts.length > 1) {
      nom = parts[parts.length - 1].toUpperCase();
      prenom = parts.slice(0, -1).join(" ");
    } else {
      nom = nomComplet ? nomComplet.toUpperCase() : "";
      prenom = "";
    }

    const adresse = normalizeScalarForPdf(ctx.adresse || client.adresse, {});
    const cp = normalizeScalarForPdf(ctx.cp || client.cp, {});
    const ville = normalizeScalarForPdf(ctx.ville || client.ville, {});
    const parsedAddr = parseFrenchAddressLine(adresse);
    const numeroVoie = parsedAddr.numeroVoie;
    const voie = parsedAddr.voie;

    const phoneFmt = formatPhoneCerfa(client.telephone || ctx.telephone || "");
    const telNational = phoneFmt.national;
    const indicatif = phoneFmt.indicatif;

    const email = normalizeScalarForPdf(client.email || client.mail || ctx.email, {});
    const split = email.split("@");
    const emailLocal = normalizeScalarForPdf(split[0], {});
    const emailDomain = normalizeScalarForPdf(split[1], {});

    const count = cerfaState.panelCount;
    const power = cerfaState.panelPower;
    const hasPanels = count !== "" && count != null && Number.isFinite(Number(count)) && Number(count) > 0;
    const hasPower = power !== "" && power != null && Number.isFinite(Number(power)) && Number(power) > 0;
    let puissanceKwcRaw = "";
    if (hasPanels && hasPower) {
      puissanceKwcRaw = formatPowerCerfa((Number(count) * Number(power)) / 1000);
    }

    let destinationEnergie = "";
    if (cerfaState.energyManagement === "Autoconsommation") destinationEnergie = "Autoconsommation";
    else if (cerfaState.energyManagement === "Autoconsommation + Vente de surplus") {
      destinationEnergie = "Autoconsommation avec vente du surplus";
    } else if (cerfaState.energyManagement === "Vente totale") destinationEnergie = "Vente totale";
    else if (cerfaState.energyManagement) destinationEnergie = normalizeScalarForPdf(cerfaState.energyManagement, {});

    const parcelleSection = normalizeScalarForPdf(cad && cad.section, {});
    let parcelleNumero = normalizeScalarForPdf(cad && cad.numero, {});
    if (!parcelleNumero && cad && cad.parcel != null) {
      parcelleNumero = normalizeScalarForPdf(String(cad.parcel), {});
    }
    const surfRaw = cad && (cad.surface_m2 != null ? cad.surface_m2 : cad.surface);
    const parcelleSurfaceM2 = surfRaw != null && String(surfRaw).trim() !== "" ? normalizeScalarForPdf(String(surfRaw), {}) : "";

    const s1 = Number(parcelleSurfaceM2 || 0);
    const superficieTotale = s1 > 0 ? String(Math.round(s1)) : "";

    const signatureLieu = ville || "";
    const signatureDateFormatted = formatDateCerfa(new Date());

    const descriptionText = buildCerfaDescriptionText(cerfaState);

    const pre = validateCerfaPreExport({
      nom,
      cp,
      ville,
      descriptionText,
      puissanceKwc: puissanceKwcRaw,
      destinationEnergie,
      panelCount: count,
      panelPower: power,
      dp1State,
      phoneFormat: phoneFmt
    });

    if (pre.errors.length > 0) {
      const msg = pre.errors.map((e) => e.message).join("\n");
      console.error("[CERFA] Export bloqué", pre.errors, pre.warnings);
      window.alert("Impossible de générer le CERFA :\n\n" + msg);
      return;
    }
    for (const w of pre.warnings) {
      console.warn("[CERFA]", w.code, w.message);
    }
    if (pre.warnings.length > 0) {
      const wtxt = pre.warnings.map((w) => "• " + w.message).join("\n");
      if (!window.confirm("Avertissements avant génération du CERFA :\n\n" + wtxt + "\n\nContinuer ?")) {
        return;
      }
    }

    const state = {
      nom,
      prenom,
      pays: "FRANCE",
      numeroVoie,
      voie,
      cp,
      ville,
      telephone: telNational,
      indicatif,
      emailLocal,
      emailDomain,
      declarantAcceptEmailContact: cerfaState.declarantAcceptEmailContact === true,
      parcelleSection,
      parcelleNumero,
      parcelleSurfaceM2,
      superficieTotale,
      puissanceKwc: puissanceKwcRaw,
      destinationEnergie,
      signatureLieu,
      signatureDateFormatted,
      forcePuissanceElecZero: cerfaState.forcePuissanceElecZero === true,
      surfaceCreee: cerfaState.surfaceCreee,
      surfaceSupprimee: cerfaState.surfaceSupprimee,
      c2za7AutresLabel: cerfaState.c2za7AutresLabel
    };

    const report = createCerfaFillReport();
    fillCerfaFields(pdfDoc, state, descriptionText, {
      helveticaFont,
      form,
      report,
      cerfaState
    });

    for (const w of pre.warnings) {
      report.warnings.push({ code: w.code, detail: w.message });
    }

    if (debug) {
      console.info("[CERFA DEBUG] Rapport remplissage", report);
    }
    try {
      window.__SOLARNEXT_CERFA_LAST_REPORT = report;
    } catch (_) {}

    if (report.missingRequired.length > 0 || report.fieldErrors.length > 0) {
      console.error("[CERFA] Échec remplissage PDF", report.missingRequired, report.fieldErrors);
      window.alert(
        "Le CERFA n’a pas pu être rempli correctement (champs obligatoires manquants ou noms de champs PDF inattendus). " +
          "Voir la console et __SOLARNEXT_CERFA_LAST_REPORT.\n\n" +
          "missingRequired: " +
          report.missingRequired.map((x) => x.name).join(", ") +
          "\nfieldErrors: " +
          report.fieldErrors.map((x) => x.name).join(", ")
      );
      return;
    }

    form.updateFieldAppearances(helveticaFont);

    if (!debug) {
      try {
        form.flatten({ updateFieldAppearances: false });
      } catch (fe) {
        console.error("[CERFA] flatten", fe);
        report.warnings.push({ code: "FLATTEN_FAILED", detail: String(fe.message || fe) });
        window.alert(
          "Le PDF CERFA n’a pas pu être aplati (apparences figées). Le fichier reste éditable. Détail : " +
            (fe.message || fe) +
            "\n\nAstuce : mode debug (?cerfaDebug=1 ou localStorage SOLARNEXT_CERFA_DEBUG=1) pour conserver les champs formulaire."
        );
      }
    } else {
      console.info("[CERFA DEBUG] flatten ignoré (aperçu / champs encore éditables)");
    }

    const pdfBytes = await pdfDoc.save();
    openPdfInNewTab(pdfBytes);
    void __solarnextDpPersistCerfaPdfBytes(pdfBytes);
  } catch (err) {
    console.error("[CERFA PDF]", err);
    window.alert("Erreur génération CERFA : " + (err.message || err));
  }
}

try {
  window.__solarnextCerfaApi = {
    buildCerfaDescriptionText,
    parseFrenchAddressLine,
    formatPowerCerfa,
    formatPhoneCerfa,
    formatDateCerfa,
    validateCerfaPreExport,
    normOuiNonNc,
    cerfaIsDebugMode,
    createCerfaFillReport
  };
} catch (_) {}

// ======================================================
// GÉNÉRATION PDF MANDAT — FRONT (inchangé)
// ======================================================
async function generateMandatPDF() {
  if (!window.SMARTPITCH_CTX) {
    alert("Les données du projet ne sont pas disponibles.");
    return;
  }

  var sig = window.__MANDAT_SIGNATURE__;
  if (!sig || !sig.signed || !sig.signatureDataUrl) {
    alert("Veuillez signer le mandat avant génération");
    return;
  }

  try {
    await __solarnextDpFetchPdfWithReplace(
      "/pdf/render/mandat/pdf",
      function () {
        return {
          mandatData: Object.assign({}, window.SMARTPITCH_CTX, { mandatSignature: sig }),
        };
      },
      "mandat"
    );
  } catch (err) {
    console.error(err);
    alert("Erreur lors de la génération du PDF.");
  }
}

window.generateMandatPDF = generateMandatPDF;

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
      alert("Impossible de récupérer les données cadastrales (section, parcelle, surface).\nVérifiez que vous êtes connecté au CRM et que le backend est accessible.");
      return;
    }

    if (!cad || (!cad.section && !cad.numero)) {
      console.warn("[DP1][CADASTRE] Réponse incomplète (section/numero manquants)", cad);
      window.DP1_STATE.selectedParcel = null;
      alert("La parcelle n'a pas pu être identifiée à cet emplacement.\nDéplacez le marqueur au centre de la parcelle et réessayez.");
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
    alert(
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
    alert("Images DP1 manquantes");
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

  try {
    const map = window.DP2_MAP?.map;
    const mapEl = map && typeof map.getTargetElement === "function" ? map.getTargetElement() : null;
    if (map && mapEl && mapEl.isConnected) {
      const olCanvases = mapEl.querySelectorAll(".ol-layer canvas");
      olCanvases.forEach(function (c) {
        if (c.width > 0 && c.height > 0) {
          ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
        }
      });
    }
  } catch (_) {}

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
  const s = window.DP2_STATE;
  if (!s) return;
  try {
    dp2MigrateFinalGeometryState();
  } catch (_) {}
  try {
    dp2RebuildContourDisplayCacheFromFeatures();
  } catch (_) {}
  const versions = dp2EnsureVersionsArray();
  let id = s.dp2ActiveVersionId;
  if (!id && versions.length) {
    id = versions[versions.length - 1].id;
    s.dp2ActiveVersionId = id;
  }
  if (!id) return;
  const idx = dp2FindVersionIndexById(id);
  if (idx < 0) return;
  const stateJson = dp2CloneWorkingStateForVersionJson();
  const snap = collectDP2FinalPlanImageSync();
  const prev = versions[idx] || {};
  versions[idx] = {
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
    dp2ActiveVersionId: activeId
  };
  Object.keys(s).forEach((k) => {
    delete s[k];
  });
  Object.assign(s, fresh);
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
    setDP2ModeEdition();
  } catch (_) {}
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

function dp2OnEntryDeleteVersion(e) {
  if (e) e.preventDefault();
  if (!window.confirm("Supprimer cette version du plan de masse ?")) return;
  const versions = dp2EnsureVersionsArray();
  const id = window.DP2_STATE.dp2ActiveVersionId;
  const idx = dp2FindVersionIndexById(id);
  if (idx < 0) return;
  versions.splice(idx, 1);
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
    window.DP2_STATE.dp2ActiveVersionId = null;
    dp2ResetWorkingEditorFieldsPreservingVersions();
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
  const plan = await collectDP2FinalPlanImage();
  if (!plan) {
    alert("Image DP2 manquante");
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
    alert("DP4 : aucun rendu final trouvé (DP4_FINAL_RENDER_V1). Validez au moins un plan (Avant/Après).");
    return;
  }

  const dp4Data = {
    meta: {
      generatedAt: new Date().toISOString(),
      titleBase: "DP4 – Plan de toiture",
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

function dpPopulatePvPanelSelectOptions(selectEl, selectedPanelId) {
  if (!selectEl) return;
  const rows = (window.DP_PV_PANELS_CACHE && window.DP_PV_PANELS_CACHE.rows) || [];
  selectEl.textContent = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Sélectionner un module —";
  selectEl.appendChild(opt0);
  for (const row of rows) {
    const m = dpPvRowToPanelModel(row);
    if (!m) continue;
    const o = document.createElement("option");
    o.value = String(row.id);
    o.textContent = dpPvFormatSelectLabel(row);
    selectEl.appendChild(o);
  }
  const want = selectedPanelId != null && String(selectedPanelId) !== "" ? String(selectedPanelId) : "";
  if (want && [...selectEl.options].some((op) => op.value === want)) {
    selectEl.value = want;
  } else {
    selectEl.value = "";
  }
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
  compteur: { legendKey: "COMPTEUR_ELECTRIQUE", label: "Compteur électrique", icon: "🔌", defaultW: 80, defaultH: 50 },
  disjoncteur: { legendKey: "DISJONCTEUR", label: "Disjoncteur", icon: "⛔", defaultW: 80, defaultH: 50 },
  batterie: { legendKey: "BATTERIE_STOCKAGE", label: "Batterie de stockage", icon: "🔋", defaultW: 90, defaultH: 55 },
  sens_pente: { legendKey: "SENS_PENTE", label: "Sens de la pente", icon: "↘", defaultW: 90, defaultH: 50 },
  voie_acces: { legendKey: "VOIE_ACCES", label: "Voie d’accès", icon: "🛣", defaultW: 140, defaultH: 40 },
  angle_vue: { legendKey: "ANGLE_PRISE_VUE", label: "Angle de prise de vue", icon: "📷", defaultW: 110, defaultH: 80 },
  nord: { legendKey: "NORD", label: "Flèche Nord", icon: "🧭", defaultW: 70, defaultH: 90 },
  rect: { legendKey: "ANNOTATION_RECTANGLE", label: "Rectangle libre", icon: "▭", defaultW: 120, defaultH: 70 },
  circle: { legendKey: "ANNOTATION_CERCLE", label: "Cercle libre", icon: "◯", defaultW: 90, defaultH: 90 },
  triangle: { legendKey: "ANNOTATION_TRIANGLE", label: "Triangle libre", icon: "△", defaultW: 100, defaultH: 90 },
  arrow: { legendKey: "ANNOTATION_FLECHE", label: "Flèche libre", icon: "➤", defaultW: 120, defaultH: 50 }
};

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
    displayMode: "detailed"
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

  const parcelIdx = (state.objects || []).findIndex(o => o && o.__parcelEdge);
  if (parcelIdx >= 0 && typeof dp2RemoveParcelEdgeInlineInput === "function") {
    dp2RemoveParcelEdgeInlineInput();
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
      if (window.DP2_STATE) window.DP2_STATE.photoCategory = window.DP4_STATE.photoCategory;
    });
  }

  // Sélection module PV (DP4) — même catalogue API que DP2
  const panelSelect = document.getElementById("dp4-panel-select");
  if (panelSelect) {
    dpEnsurePvPanelsLoaded()
      .then((cache) => {
        window.DP4_STATE.panelModel = dpReconcilePanelModel(window.DP4_STATE.panelModel, cache);
        if (window.DP2_STATE) window.DP2_STATE.panelModel = window.DP4_STATE.panelModel;
        const selId = window.DP4_STATE.panelModel?.panel_id || null;
        dpPopulatePvPanelSelectOptions(panelSelect, selId);

        if (panelSelect.dataset.dpPvPanelBound !== "1") {
          panelSelect.dataset.dpPvPanelBound = "1";
          panelSelect.addEventListener("change", (e) => {
            const value = e.target?.value || "";
            const next = dpModelFromPanelSelectValue(value);
            window.DP4_STATE.panelModel = next;
            if (window.DP2_STATE) window.DP2_STATE.panelModel = next;

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
  return window.DP2_STATE?.editorProfile === "DP4_ROOF";
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
}

function dp2ClearSelectedBuildingContour() {
  dp2EnsureBuildingContoursState();
  window.DP2_STATE.selectedBuildingContourId = null;
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
  let outline = id ? dp2GetBuildingContourById(id) : null;
  if (!outline) {
    const list = dp2GetBuildingContours();
    if (list.length === 1) outline = list[0];
  }
  if (!outline || !Array.isArray(outline.points) || outline.points.length < 2) return;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (typeof scale !== "number" || scale <= 0) return;

  const points = outline.points;
  const segments = outline.closed ? points.length : points.length - 1;

  const dx = ridgeB.x - ridgeA.x;
  const dy = ridgeB.y - ridgeA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;

  const ux = dx / len;
  const uy = dy / len;
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

  const EPS_T = 1e-6;
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
    outline.cuts = {};
    return;
  }

  const s = (inter, extA) => (inter.x - extA.x) * ux + (inter.y - extA.y) * uy;
  intersections.sort((a, b) => s(a.inter, ridgeExtA) - s(b.inter, ridgeExtA));
  const first = intersections[0];
  const last = intersections[intersections.length - 1];

  outline.cuts = {};
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
    dp2ApplyFeaturesHydrateSync();
  } catch (_) {}

  try {
    dp2MountOlMapUnderCanvasIfNeeded();
    dp2SyncEditionOlMapLayoutSync();
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
    objs.splice(objIdx, 1);
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
// Limites : 0.5× → 3×. Zoom centré sur la position de la souris.
// --------------------------
const DP2_VIEW_ZOOM_MIN = 0.5;
const DP2_VIEW_ZOOM_MAX = 3;

// Applique la transform visuelle du conteneur zoom : translate(pan) + scale(zoom). Ne touche pas à scale_m_per_px ni aux objets.
function applyDP2ViewTransform() {
  const zoomContainer = document.getElementById("dp2-zoom-container");
  if (!zoomContainer) return;
  const panX = window.DP2_STATE.viewPanX != null ? window.DP2_STATE.viewPanX : 0;
  const panY = window.DP2_STATE.viewPanY != null ? window.DP2_STATE.viewPanY : 0;
  const zoom = window.DP2_STATE.viewZoom != null ? window.DP2_STATE.viewZoom : 1;
  zoomContainer.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")";
  if (typeof dp2SyncMapAnchoredOverlays === "function") dp2SyncMapAnchoredOverlays();
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

  zoomContainer.style.position = "relative";
  zoomContainer.style.transformOrigin = "50% 50%";
  applyDP2ViewTransform();

  wrap.addEventListener("wheel", (e) => {
    const zoomContainerEl = document.getElementById("dp2-zoom-container");
    if (!zoomContainerEl) return;
    const rect = zoomContainerEl.getBoundingClientRect();
    const currentZoom = window.DP2_STATE.viewZoom || 1;
    const originX = (e.clientX - rect.left) / currentZoom;
    const originY = (e.clientY - rect.top) / currentZoom;
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    const newZoom = Math.max(DP2_VIEW_ZOOM_MIN, Math.min(DP2_VIEW_ZOOM_MAX, currentZoom * factor));
    if (newZoom === currentZoom) return;
    window.DP2_STATE.viewZoom = newZoom;
    zoomContainerEl.style.transformOrigin = originX + "px " + originY + "px";
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
  input.style.left = left + "px";
  input.style.top = top + "px";
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
  const gold = "#C39847";
  if (tier === "hover") {
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.75;
    ctx.shadowColor = "rgba(195, 152, 71, 0.4)";
    ctx.shadowBlur = 8;
  } else if (tier === "active") {
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.75;
  } else if (tier === "editing") {
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3.2;
    ctx.setLineDash([5, 4]);
    ctx.shadowColor = "rgba(195, 152, 71, 0.55)";
    ctx.shadowBlur = 12;
  }
  ctx.stroke();
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
    ctx.shadowColor = "rgba(195, 152, 71, 0.45)";
    ctx.shadowBlur = tier === "editing" ? 10 : 6;
  }
  ctx.fillText(text, midX, midY);
  ctx.restore();
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
    if (e.key === "Escape") {
      const objs = window.DP2_STATE?.objects || [];
      const idx = objs.findIndex(o => o && o.__parcelEdge);
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
      const objs = window.DP2_STATE?.objects || [];
      const obj = objs.find(o => o && o.type === "measure_line" && typeof o.resizeAnchor === "string");
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
  let midX; let midY;
  if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
    const m0x = (cutParts[0].a.x + cutParts[0].b.x) / 2;
    const m0y = (cutParts[0].a.y + cutParts[0].b.y) / 2;
    const m1x = (cutParts[1].a.x + cutParts[1].b.x) / 2;
    const m1y = (cutParts[1].a.y + cutParts[1].b.y) / 2;
    midX = (m0x + m1x) / 2;
    midY = (m0y + m1y) / 2;
  } else {
    midX = (p1.x + p2.x) / 2;
    midY = (p1.y + p2.y) / 2;
  }
  return { x: midX + segOff.x, y: midY + segOff.y };
}

/** Double-clic édition cote parcelle : hit sur le libellé affiché (pas sur l’arête brute). */
const DP2_PARCEL_LABEL_DBLCLICK_HIT_PX = 25;

function dp2HitTestParcelLabelForDblClick(canvasX, canvasY) {
  const contours = dp2GetBuildingContours();
  const objects = window.DP2_STATE?.objects || [];
  let best = null;
  let bestD = Infinity;
  for (let c = 0; c < contours.length; c++) {
    const contour = contours[c];
    if (!contour || !contour.id || !Array.isArray(contour.points) || contour.points.length < 2) continue;
    const pts = contour.points;
    const segments = contour.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segments; i++) {
      const parcelEdgeML = objects.find(
        o => o && o.type === "measure_line" && o.__parcelEdge && o.__parcelEdge.contourId === contour.id && o.__parcelEdge.segmentIndex === i
      );
      if (parcelEdgeML) continue;
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
  const objects = window.DP2_STATE?.objects || [];
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
      const parcelEdgeML = objects.find(
        o => o && o.type === "measure_line" && o.__parcelEdge && o.__parcelEdge.contourId === contour.id && o.__parcelEdge.segmentIndex === i
      );
      if (parcelEdgeML) continue;
      const pt = dp2ComputeParcelSegmentLabelCanvasPoint(contour, i);
      if (!pt) continue;
      if (x >= pt.x - halfW && x <= pt.x + halfW && y >= pt.y - halfH && y <= pt.y + halfH)
        return { contourId: contour.id, segmentIndex: i };
    }
  }
  return null;
}

// DP2 — Hit-test repères A/B (measure_line avec requestedLengthM, sans resizeAnchor). Rayon ~11px. Inclut __parcelEdge (clic A/B sur le plan).
function dp2HitTestMeasureLineAnchor(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const R = 11;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b) continue;
    if (typeof obj.requestedLengthM !== "number" || (obj.resizeAnchor === "A" || obj.resizeAnchor === "B")) continue;
    const dA = Math.hypot(x - obj.a.x, y - obj.a.y);
    const dB = Math.hypot(x - obj.b.x, y - obj.b.y);
    if (dA <= R && dA <= dB) return { objectIndex: i, anchor: "A" };
    if (dB <= R) return { objectIndex: i, anchor: "B" };
  }
  return null;
}

// DP2 — Hit-test étiquette de mesure (label longueur) : zone cliquable pour déplacement visuel uniquement.
// Ne teste pas le segment, uniquement la zone du texte (centre + labelOffset, box ~64×24 px).
// En mode prévisualisation (resizeAnchor A/B) on ne propose pas le drag d’étiquette.
function dp2HitTestMeasureLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 32;
  const halfH = 12;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || obj.__parcelEdge) continue;
    if (getMeasureLinePreviewPoints(obj)) continue;
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
      ? obj.labelOffset
      : { x: 0, y: 0 };
    const lx = midX + offset.x;
    const ly = midY + offset.y;
    if (x >= lx - halfW && x <= lx + halfW && y >= ly - halfH && y <= ly + halfH)
      return { kind: "measure_label", index: i };
  }
  return null;
}

// DP2 — Hit-test étiquette faîtage (label longueur) : même zone 64×24 que mesure, pour drag.
function dp2HitTestRidgeLabel(canvas, x, y) {
  const objects = window.DP2_STATE?.objects || [];
  const halfW = 32;
  const halfH = 12;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || obj.type !== "ridge_line" || !obj.a || !obj.b) continue;
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const offset = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number"
      ? obj.labelOffset
      : { x: 0, y: 0 };
    const lx = midX + offset.x;
    const ly = midY + offset.y;
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
  fill: "rgba(17, 24, 39, 0.92)",      // très sombre (imprimable, lisible)
  stroke: "rgba(17, 24, 39, 0.98)",
  lineWidth: 1.5
};
const DP2_PANEL_PREVIEW_STYLE = {
  fill: "rgba(0, 0, 0, 1)",            // NOIR plein (preview)
  stroke: "rgba(0, 0, 0, 1)",
  lineWidth: 1
};
const DP2_PANEL_GHOST_STYLE = {
  fill: "rgba(200, 200, 200, 0.35)",   // GRIS clair semi-transparent (fantôme)
  stroke: "rgba(160, 160, 160, 0.55)",
  lineWidth: 1
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
  const rotateHandleOffset = 18;
  const hr = 8;
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
  const inside = lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2;
  const rotateHandleOffset = 18;
  const rhX = 0;
  const rhY = -h / 2 - rotateHandleOffset;
  const onRotateHandle = Math.hypot(lx - rhX, ly - rhY) <= 8;
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
  const rotateHandleR = 8;
  const rotateHandleOffset = 18;
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

function dp2IsVectorCreateBusinessType(type) {
  return type === "sens_pente" || type === "voie_acces" || type === "arrow" || type === "angle_vue";
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
function dp2ApplyBusinessResizeFromLocal(inter, g, lx, ly) {
  const sx = inter.startX;
  const sy = inter.startY;
  const minSize = 12;
  g.x = sx;
  g.y = sy;
  g.width = Math.max(minSize, lx - sx);
  g.height = Math.max(minSize, ly - sy);
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
      const rhX = g.x + w / 2;
      const rhY = g.y - rotLine;
      if (Math.hypot(lx - rhX, ly - rhY) <= rotHitR) {
        return { id: obj.id, part: "rotate" };
      }

      const hx = g.x + w;
      const hy = g.y + h;
      if (lx >= hx - hitResizeHalf && lx <= hx + hitResizeHalf && ly >= hy - hitResizeHalf && ly <= hy + hitResizeHalf) {
        return { id: obj.id, part: "resize", handle: "br" };
      }

      if (strictIn) {
        return { id: obj.id, part: "body" };
      }
    }

    if (inside) return { id: obj.id, part: "body" };
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

function initDP2CanvasEvents() {
  const canvas = document.getElementById("dp2-draw-canvas");
  if (!canvas) return;
  // Anti double-binding (si le DOM est re-monté / réutilisé)
  if (canvas.dataset.dp2Bound === "1") return;
  canvas.dataset.dp2Bound = "1";

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

    // 0) Étiquette de mesure (label) : candidat au drag (seuil 4px en pointermove) — uniquement outil Sélection, avant tout autre hit
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

    // 0) DP2 — Drag étiquette de cote (segment jaune) : déplacement visuel uniquement
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

    // 0) DP2 — Bâti : sélection via OpenLayers uniquement (mode Sélection)
    if (tool === "select" && typeof dp2PickDp2BuildingOlFeatureAtCanvasPixel === "function") {
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

    const hitText = dp2HitTestText(coords.x, coords.y);

    // 0) Textes (annotations) : sélection + move/resize/rotate
    if (hitText && hitText.id) {
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

    const hitBiz = dp2HitTestBusiness(coords.x, coords.y);

    // 1) Priorité : objets métier (dessinés au-dessus des objets standards)
    if (hitBiz && hitBiz.id) {
      const obj = getDP2BusinessObjectById(hitBiz.id);
      if (!obj || !obj.geometry) return;
      // Sélection panneaux (simple ou groupée) => désélectionnée si on touche un objet métier
      dp2ClearSelectedPanels();
      dp2ClearSelectedTexts();
      window.DP2_STATE.selectedBuildingContourId = null;
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
        const nx = coords.x - (lvi.offsetX || 0);
        const ny = coords.y - (lvi.offsetY || 0);
        if (Math.abs(nx - (pt.x || 0)) > 1 || Math.abs(ny - (pt.y || 0)) > 1) lvi.hasMoved = true;
        pt.x = nx;
        pt.y = ny;
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
      dp2ApplyBusinessResizeFromLocal(inter, g, local.x, local.y);
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
        applyRidgeLineCutsToBuildingOutline(obj.a, obj.b);
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
      const dx = coords.x - from.x;
      const dy = coords.y - from.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      window.DP2_STATE.drawingPreview = {
        from: { x: from.x, y: from.y },
        to: { x: coords.x, y: coords.y },
        lengthM
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
      const dx = coords.x - from.x;
      const dy = coords.y - from.y;
      const lengthPx = Math.hypot(dx, dy);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      window.DP2_STATE.drawingPreview = {
        from: { x: from.x, y: from.y },
        to: { x: coords.x, y: coords.y },
        lengthM,
        previewType: "ridge_line"
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
      // Choix A/B sur le plan : clic sur repère A ou B = définir resizeAnchor puis prévisualisation
      const hitAnchor = dp2HitTestMeasureLineAnchor(canvas, coords.x, coords.y);
      if (hitAnchor && typeof hitAnchor.objectIndex === "number" && (hitAnchor.anchor === "A" || hitAnchor.anchor === "B")) {
        const objs = window.DP2_STATE?.objects || [];
        const obj = objs[hitAnchor.objectIndex];
        if (obj && obj.type === "measure_line") {
          obj.resizeAnchor = hitAnchor.anchor;
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
          window.DP2_STATE.selectedObjectId = null;
          window.DP2_STATE.selectedBusinessObjectId = hitBizClick.id;
          renderDP2FromState();
          return;
        }
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
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "measure_line",
        a: { x: a.x, y: a.y },
        b: { x: coords.x, y: coords.y }
      });
      window.DP2_STATE.measureLineStart = null;
      window.DP2_STATE.drawingPreview = null;
      dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "measure_line_created" });
      return;
    }

    // Faîtage : clic 1 = point A, clic 2 = point B (faîtage définitif)
    if (tool === "ridge_line") {
      if (window.DP2_STATE.ridgeLineStart == null) {
        window.DP2_STATE.ridgeLineStart = { x: coords.x, y: coords.y };
        window.DP2_STATE.drawingPreview = null;
        renderDP2FromState();
        return;
      }
      const a = window.DP2_STATE.ridgeLineStart;
      const ridgeA = { x: a.x, y: a.y };
      const ridgeB = { x: coords.x, y: coords.y };
      dp2CommitHistoryPoint();
      window.DP2_STATE.objects.push({
        type: "ridge_line",
        a: ridgeA,
        b: ridgeB
      });
      // Application structurante sur les COTES du contour bâti (sans toucher aux points)
      applyRidgeLineCutsToBuildingOutline(ridgeA, ridgeB);

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
      const hit = dp2HitTestPanel(coords.x, coords.y);
      if (hit && hit.id) {
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
      dp2AutoReturnToSelectIfCreationDone({ preserveSelection: true, reason: "panel_placed" });
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
      const scale = window.DP2_STATE?.scale_m_per_px;
      const lengthPx = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y);
      const lengthM = typeof scale === "number" && scale > 0 ? lengthPx * scale : 0;
      const currentStr = lengthM.toFixed(2).replace(".", ",");
      const raw = window.prompt("Longueur (m) :", currentStr);
      if (raw != null) {
        const normalized = String(raw).trim().replace(",", ".");
        const num = parseFloat(normalized);
        if (!Number.isNaN(num) && num >= 0) {
          // __parcelEdge : commit uniquement à la validation, pas à la saisie
          if (!obj.__parcelEdge) dp2CommitHistoryPoint();
          obj.requestedLengthM = num;
          renderDP2FromState();
          return true;
        }
      }
      return false;
    }

    // PRIORITAIRE — double-clic sur le libellé de cote parcelle (chiffre affiché) → champ inline
    const hitParcelLabel = dp2HitTestParcelLabelForDblClick(coords.x, coords.y);
    if (hitParcelLabel && hitParcelLabel.contourId != null && typeof hitParcelLabel.segmentIndex === "number") {
      window.DP2_STATE.objects.push({
        type: "measure_line",
        a: { x: hitParcelLabel.a.x, y: hitParcelLabel.a.y },
        b: { x: hitParcelLabel.b.x, y: hitParcelLabel.b.y },
        requestedLengthM: null,
        resizeAnchor: null,
        __parcelEdge: { contourId: hitParcelLabel.contourId, segmentIndex: hitParcelLabel.segmentIndex }
      });
      const newIdx = window.DP2_STATE.objects.length - 1;
      dp2ShowParcelEdgeInlineInput(canvas, newIdx);
      renderDP2FromState();
      return;
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

    // Double-clic sur l'étiquette de mesure (label) → édition valeur uniquement, puis choix explicite du point (overlay)
    const hitLabel = dp2HitTestMeasureLabel(canvas, coords.x, coords.y);
    if (hitLabel && hitLabel.kind === "measure_label" && typeof hitLabel.index === "number") {
      window.DP2_STATE.measureLabelDrag = null;
      window.DP2_STATE.measureLabelDragCandidate = null;
      const lastDrag = window.DP2_STATE._lastMeasureLabelDragAt || 0;
      if (Date.now() - lastDrag > 300) {
        if (openMeasureLineEdit(hitLabel.index)) {
          dp2ShowMeasureAnchorChoiceOverlay(canvas, hitLabel.index);
        }
        return;
      }
    }

    // Double-clic sur un measure_line existant (segment) → édition longueur puis choix A/B (overlay)
    const hitAny = dp2HitTest(canvas, coords.x, coords.y);
    if (hitAny && hitAny.kind === "object" && typeof hitAny.index === "number") {
      const obj = objs[hitAny.index];
      if (obj && obj.type === "measure_line") {
        if (openMeasureLineEdit(hitAny.index)) {
          dp2ShowMeasureAnchorChoiceOverlay(canvas, hitAny.index);
        }
        return;
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

  if (typeof dp2BuildingRenderUsesFeatures === "function" && dp2BuildingRenderUsesFeatures()) {
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
      ctx.setLineDash([6, 4]);
      // Contraste : mesure = vert clair discret, faîtage = vert plus sombre et plus épais
      ctx.strokeStyle = preview.previewType === "ridge_line" ? "#0b6e4f" : "#2ecc71";
      ctx.lineWidth = preview.previewType === "ridge_line" ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(preview.from.x, preview.from.y);
      ctx.lineTo(preview.to.x, preview.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const midX = (preview.from.x + preview.to.x) / 2;
      const midY = (preview.from.y + preview.to.y) / 2;
      const text = (preview.lengthM != null ? preview.lengthM.toFixed(2) : "0,00").replace(".", ",") + " m";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, midX, midY);
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
function dp2CommitMeasureResize(obj) {
  if (
    !obj ||
    obj.type !== "measure_line" ||
    typeof obj.requestedLengthM !== "number" ||
    (obj.resizeAnchor !== "A" && obj.resizeAnchor !== "B")
  ) return;

  const scale = window.DP2_STATE?.scale_m_per_px;
  if (!scale || scale <= 0) return;

  // Branche __parcelEdge : appliquer la longueur au segment du contour puis supprimer la measure_line temporaire
  const parcelEdge = obj.__parcelEdge;
  if (parcelEdge && parcelEdge.contourId != null && typeof parcelEdge.segmentIndex === "number") {
    const contour = dp2GetBuildingContourById(parcelEdge.contourId);
    if (!contour || !Array.isArray(contour.points) || contour.points.length < 2) return;
    const pts = contour.points;
    const n = pts.length;
    const segIdx = parcelEdge.segmentIndex;
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
    const deltaM = obj.requestedLengthM - lengthM;
    const deltaPx = deltaM / scale;
    const ux = dx / lengthPx;
    const uy = dy / lengthPx;

    dp2CommitHistoryPoint();
    if (obj.resizeAnchor === "A") {
      pts[segIdx].x = ax - ux * deltaPx;
      pts[segIdx].y = ay - uy * deltaPx;
    } else {
      const idx2 = (segIdx + 1) % n;
      pts[idx2].x = bx + ux * deltaPx;
      pts[idx2].y = by + uy * deltaPx;
    }
    const featPe = dp2FindPolygonFeatureById(parcelEdge.contourId);
    if (featPe && Array.isArray(featPe.coordinates)) {
      for (let ii = 0; ii < pts.length && ii < featPe.coordinates.length; ii++) {
        const mc = dp2PixelToMapCoord(pts[ii].x, pts[ii].y);
        if (mc) featPe.coordinates[ii] = mc;
      }
      try {
        delete featPe.cuts;
      } catch (_) {
        featPe.cuts = undefined;
      }
    }
    const objects = window.DP2_STATE?.objects || [];
    const idx = objects.indexOf(obj);
    if (idx >= 0) objects.splice(idx, 1);
    try {
      dp2RebuildContourDisplayCacheFromFeatures();
    } catch (_) {}
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
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj && obj.type === "measure_line" && obj.a && obj.b &&
        typeof obj.requestedLengthM === "number" && (obj.resizeAnchor === "A" || obj.resizeAnchor === "B")) {
      previewObj = obj;
      previewIndex = i;
      break;
    }
  }

  const canvas = document.getElementById("dp2-draw-canvas");
  const container = document.getElementById("dp2-zoom-container");
  if (!canvas || !container) return;

  if (!previewObj || previewIndex < 0) {
    dp2RemoveMeasureResizePreviewOverlay();
    return;
  }

  const midX = (previewObj.a.x + previewObj.b.x) / 2;
  const midY = (previewObj.a.y + previewObj.b.y) / 2;
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
    overlay.style.cssText = "position:absolute;z-index:51;display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(17,24,39,0.95);color:#f3f4f6;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font:13px system-ui,sans-serif;";
    const title = document.createElement("div");
    title.textContent = "Prévisualisation — aucun changement appliqué tant que vous ne validez pas";
    title.style.cssText = "font-weight:600;margin-bottom:2px;";
    overlay.appendChild(title);
    const btnValider = document.createElement("button");
    btnValider.type = "button";
    btnValider.textContent = "Valider la modification";
    btnValider.style.cssText = "padding:6px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;background:#059669;color:#fff;cursor:pointer;font:inherit;";
    overlay.appendChild(btnValider);

    btnValider.onclick = () => {
      const objects = window.DP2_STATE?.objects || [];
      const obj = objects.find(
        o => o && o.type === "measure_line" && typeof o.resizeAnchor === "string"
      );

      if (obj) {
        dp2CommitMeasureResize(obj);
      }

      dp2RemoveMeasureResizePreviewOverlay();
      if (window._dp2MeasureResizePreviewOutsideHandler) {
        document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
        window._dp2MeasureResizePreviewOutsideHandler = null;
      }
      renderDP2FromState();
    };

    overlay.addEventListener("click", (e) => e.stopPropagation());
    container.appendChild(overlay);
  }
  function cancelPreview() {
    const objects = window.DP2_STATE?.objects || [];
    const obj = objects.find(
      o => o && o.type === "measure_line" && typeof o.resizeAnchor === "string"
    );
    if (obj) {
      if (obj.__parcelEdge != null) {
        const idx = objects.indexOf(obj);
        if (idx >= 0) objects.splice(idx, 1);
      } else {
        delete obj.requestedLengthM;
        delete obj.resizeAnchor;
      }
    }
    dp2RemoveMeasureResizePreviewOverlay();
    if (window._dp2MeasureResizePreviewOutsideHandler) {
      document.removeEventListener("click", window._dp2MeasureResizePreviewOutsideHandler);
      window._dp2MeasureResizePreviewOutsideHandler = null;
    }
    renderDP2FromState();
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
  const objs = window.DP2_STATE?.objects || [];
  const ix = objs.findIndex(o => o && o.__parcelEdge);
  const obj = ix >= 0 ? objs[ix] : null;

  let didCommit = false;
  if (obj && obj.type === "measure_line" && obj.__parcelEdge && committedValue !== undefined) {
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

// DP2 — Édition inline cote parcelle : #dp2-overlay-layer sous #dp2-captured-image-wrap (hors zoom transform)
function dp2ShowParcelEdgeInlineInput(canvas, objectIndex) {
  dp2EnsureOverlayLayer();
  const layer = document.getElementById("dp2-overlay-layer");
  const objs = window.DP2_STATE?.objects || [];
  const obj = objs[objectIndex];
  if (!obj || obj.type !== "measure_line" || !obj.a || !obj.b || !obj.__parcelEdge || !layer || !canvas) return;

  if (document.getElementById("dp2-parcel-edge-inline-input")) dp2RemoveParcelEdgeInlineInput();

  const pe = obj.__parcelEdge;
  const scale = window.DP2_STATE?.scale_m_per_px;
  const lengthPx = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y);
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
    const idx = (window.DP2_STATE?.objects || []).indexOf(obj);
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
  // Deux rAF : évite que le pointerdown du double-clic d’ouverture ferme / valide tout de suite
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
    }
    dp2RemoveMeasureAnchorChoiceOverlay();
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

  overlay.style.left = Math.max(4, left) + "px";
  overlay.style.top = Math.max(4, top) + "px";
  container.appendChild(overlay);

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

  // poignée rotation (pas de resize)
  ctx.strokeStyle = "#111827";
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

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const sx = g.displayScaleX ?? g.displayScale ?? 1;
    const sy = g.displayScaleY ?? g.displayScale ?? 1;
    const wEff = w * sx;
    const hEff = h * sy;
    const scaleHandleX = wEff / 2 + 14;
    const scaleHandleY = hEff / 2 + 14;
    ctx.fillStyle = "#C39847";
    ctx.fillRect(scaleHandleX - 4, scaleHandleY - 4, 8, 8);
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
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // poignée rotation unique (haut-centre)
  const hx = aabb.cx;
  const hy = y - rotateHandleOffset;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx, y);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(hx, hy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (typeof dp2IsDP4RoofProfile === "function" && dp2IsDP4RoofProfile()) {
    const scaleHx = aabb.maxX + 14;
    const scaleHy = aabb.maxY + 14;
    ctx.fillStyle = "#C39847";
    ctx.fillRect(scaleHx - 4, scaleHy - 4, 8, 8);
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
    ctx.strokeStyle = "#2ecc71";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(preview.aPreview.x, preview.aPreview.y);
    ctx.lineTo(preview.bPreview.x, preview.bPreview.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const from = anchor === "A" ? obj.a : obj.b;
    const to = anchor === "A" ? preview.aPreview : preview.bPreview;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > 2) {
      const ax = (to.x - from.x) / dist;
      const ay = (to.y - from.y) / dist;
      const headLen = Math.min(12, dist * 0.4);
      const tipX = to.x - ax * headLen;
      const tipY = to.y - ay * headLen;
      const perpX = -ay;
      const perpY = ax;
      ctx.strokeStyle = "#0f0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(tipX + perpX * 4, tipY + perpY * 4);
      ctx.lineTo(tipX - perpX * 4, tipY - perpY * 4);
      ctx.closePath();
      ctx.fillStyle = "#0f0";
      ctx.fill();
      ctx.stroke();
    }

    const fixed = anchor === "A" ? obj.b : obj.a;
    const movedPreview = anchor === "A" ? preview.aPreview : preview.bPreview;
    ctx.fillStyle = "rgba(150, 150, 150, 0.7)";
    ctx.beginPath();
    ctx.arc(fixed.x, fixed.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f0";
    ctx.beginPath();
    ctx.arc(movedPreview.x, movedPreview.y, 6, 0, Math.PI * 2);
    ctx.fill();

    const midX = (preview.aPreview.x + preview.bPreview.x) / 2;
    const midY = (preview.aPreview.y + preview.bPreview.y) / 2;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    const text = (typeof obj.requestedLengthM === "number" ? obj.requestedLengthM : 0).toFixed(2).replace(".", ",") + " m";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, midX + off.x, midY + off.y);
  } else if (typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 && obj.resizeAnchor !== "A" && obj.resizeAnchor !== "B") {
    // Choix du point à déplacer : segment + repères A (vert) et B (bleu) sur le plan, label
    ctx.strokeStyle = "#2ecc71";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(obj.a.x, obj.a.y);
    ctx.lineTo(obj.b.x, obj.b.y);
    ctx.stroke();
    const r = 11;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.arc(obj.a.x, obj.a.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("A", obj.a.x, obj.a.y);
    ctx.fillStyle = "#2563eb";
    ctx.beginPath();
    ctx.arc(obj.b.x, obj.b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("B", obj.b.x, obj.b.y);
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    const text = obj.requestedLengthM.toFixed(2).replace(".", ",") + " m";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.fillText(text, midX + off.x, midY + off.y);
  } else {
    const mfid = typeof objectIndex === "number" ? "measure:" + objectIndex : null;
    const mtier = mfid ? dp2InteractionTierForFeature(mfid) : null;
    // Comportement normal (pas de prévisualisation) — points comme contour de bâti (6px, blanc, stroke)
    ctx.strokeStyle = "#2ecc71";
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
      const midX = (obj.a.x + obj.b.x) / 2;
      const midY = (obj.a.y + obj.b.y) / 2;
      const requested = typeof obj.requestedLengthM === "number" && obj.requestedLengthM >= 0 ? obj.requestedLengthM : null;
      const text = requested != null
        ? requested.toFixed(2).replace(".", ",") + " m"
        : lengthM.toFixed(2).replace(".", ",") + " m";
      const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      dp2FillCoteLabelWithTier(ctx, text, midX + off.x, midY + off.y, mtier);
    }
  }
  ctx.restore();
}

// DP2 — Style des points faitage/mesure (aligné contour de bâti : 6px, blanc, stroke)
const DP2_RIDGE_POINT_STROKE = "#0b6e4f";
const DP2_MEASURE_POINT_STROKE = "#2ecc71";

function dp2DrawLinePoint(ctx, x, y, strokeColor) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = strokeColor || "#C39847";
  ctx.lineWidth = 2;
  ctx.stroke();
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
  ctx.save();
  ctx.strokeStyle = "#0b6e4f";
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(obj.a.x, obj.a.y);
  ctx.lineTo(obj.b.x, obj.b.y);
  ctx.stroke();
  dp2DrawCoteSegmentTier(ctx, obj.a, obj.b, rtier);
  dp2DrawLinePoint(ctx, obj.a.x, obj.a.y, DP2_RIDGE_POINT_STROKE);
  dp2DrawLinePoint(ctx, obj.b.x, obj.b.y, DP2_RIDGE_POINT_STROKE);
  if (typeof scale === "number" && scale > 0) {
    const lengthM = Math.hypot(obj.b.x - obj.a.x, obj.b.y - obj.a.y) * scale;
    const midX = (obj.a.x + obj.b.x) / 2;
    const midY = (obj.a.y + obj.b.y) / 2;
    const off = obj.labelOffset && typeof obj.labelOffset.x === "number" && typeof obj.labelOffset.y === "number" ? obj.labelOffset : { x: 0, y: 0 };
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    dp2FillCoteLabelWithTier(ctx, lengthM.toFixed(2).replace(".", ",") + " m", midX + off.x, midY + off.y, rtier);
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
  ctx.font = 12 * sc + "px system-ui, sans-serif";
  ctx.fillStyle = "#134e4a";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(valStr, labelX, labelY);
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
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillStyle = "#1f2937";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, midX, midY);
        }
        continue;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      const lengthM = lengthPx * scale;
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const text = lengthM.toFixed(2).replace(".", ",") + " m";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, midX, midY);
    }
  }

  ctx.restore();
}

// --------------------------
// DP2 — RENDU CONTOURS DE BÂTI (multi, éditables) — DP2 UNIQUEMENT
// --------------------------
const DP2_BUILDING_CONTOUR_ACTIVE_STROKE = "#C39847";
const DP2_BUILDING_CONTOUR_INACTIVE_STROKE = "#6b7280";

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
    ctx.lineWidth = active ? 2.5 : 2;
    ctx.setLineDash([]);
    ctx.stroke();
    if (contour.closed) {
      ctx.fillStyle = active ? "rgba(195, 152, 71, 0.10)" : "rgba(107, 114, 128, 0.06)";
      ctx.fill();
    }
  }

  // Poignées (sommets) : uniquement sur le contour actif
  if (active) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = DP2_BUILDING_CONTOUR_ACTIVE_STROKE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Mesures : longueur de chaque segment en mètres (mêmes règles que le rendu historique)
  if (pts.length >= 2 && typeof scale === "number" && scale > 0) {
    const segments = contour.closed ? pts.length : pts.length - 1;
    const objects = window.DP2_STATE?.objects || [];
    for (let i = 0; i < segments; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const fidSeg = "parcelSeg:" + contour.id + ":" + i;
      const editingThisSeg =
        window.dp2InteractionState &&
        window.dp2InteractionState.editingFeatureId === fidSeg;
      const tierSeg = dp2InteractionTierForFeature(fidSeg);
      const parcelEdgeML = objects.find(
        o => o && o.type === "measure_line" && o.__parcelEdge && o.__parcelEdge.contourId === contour.id && o.__parcelEdge.segmentIndex === i
      );
      const parcelEdgeEditing = !!parcelEdgeML;

      // __parcelEdge : surcouches A/B + prévisualisation resize. Pendant édition inline (editingFeatureId),
      // le texte des cotes est volontairement omis sur le canvas — seul l’input DOM affiche la valeur.
      if (parcelEdgeEditing) {
        const hasValue = typeof parcelEdgeML.requestedLengthM === "number";
        const noAnchorYet = parcelEdgeML.resizeAnchor !== "A" && parcelEdgeML.resizeAnchor !== "B";
        if (hasValue && noAnchorYet) {
          const R = 11;
          ctx.save();
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, R, 0, Math.PI * 2);
          ctx.fillStyle = "#16a34a";
          ctx.fill();
          ctx.strokeStyle = "#0f766e";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.fillText("A", p1.x, p1.y);
          ctx.beginPath();
          ctx.arc(p2.x, p2.y, R, 0, Math.PI * 2);
          ctx.fillStyle = "#2563eb";
          ctx.fill();
          ctx.strokeStyle = "#1d4ed8";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.fillText("B", p2.x, p2.y);
          ctx.restore();
        }
        const preview =
          parcelEdgeML && typeof parcelEdgeML.requestedLengthM === "number" && (parcelEdgeML.resizeAnchor === "A" || parcelEdgeML.resizeAnchor === "B")
            ? getMeasureLinePreviewPoints(parcelEdgeML)
            : null;
        if (preview) {
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = DP2_BUILDING_CONTOUR_ACTIVE_STROKE;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(preview.aPreview.x, preview.aPreview.y);
          ctx.lineTo(preview.bPreview.x, preview.bPreview.y);
          ctx.stroke();
          ctx.setLineDash([]);
          const anchor = parcelEdgeML.resizeAnchor;
          const from = anchor === "A" ? parcelEdgeML.a : parcelEdgeML.b;
          const to = anchor === "A" ? preview.aPreview : preview.bPreview;
          const dist = Math.hypot(to.x - from.x, to.y - from.y);
          if (dist > 2) {
            const ax = (to.x - from.x) / dist;
            const ay = (to.y - from.y) / dist;
            const headLen = Math.min(12, dist * 0.4);
            const tipX = to.x - ax * headLen;
            const tipY = to.y - ay * headLen;
            const perpX = -ay;
            const perpY = ax;
            ctx.strokeStyle = "#1f2937";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(to.x, to.y);
            ctx.lineTo(tipX + perpX * 4, tipY + perpY * 4);
            ctx.lineTo(tipX - perpX * 4, tipY - perpY * 4);
            ctx.closePath();
            ctx.fillStyle = "#1f2937";
            ctx.fill();
            ctx.stroke();
          }
          const midX = (preview.aPreview.x + preview.bPreview.x) / 2;
          const midY = (preview.aPreview.y + preview.bPreview.y) / 2;
          const text = (typeof parcelEdgeML.requestedLengthM === "number" ? parcelEdgeML.requestedLengthM : 0).toFixed(2).replace(".", ",") + " m";
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillStyle = "#1f2937";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (!editingThisSeg) ctx.fillText(text, midX, midY);
          ctx.restore();
        }
      }

      const offMap = contour.labelOffsets && typeof contour.labelOffsets === "object" ? contour.labelOffsets : {};
      const segOff = offMap[i] && typeof offMap[i].x === "number" && typeof offMap[i].y === "number" ? offMap[i] : { x: 0, y: 0 };
      const cutParts = contour.cuts && contour.cuts[i];
      if (Array.isArray(cutParts) && cutParts.length === 2 && cutParts[0]?.a && cutParts[0]?.b && cutParts[1]?.a && cutParts[1]?.b) {
        const tierDrawCuts = tierSeg || (parcelEdgeEditing ? "editing" : null);
        for (const part of cutParts) {
          const a = part.a;
          const b = part.b;
          let midX = (a.x + b.x) / 2;
          let midY = (a.y + b.y) / 2;
          midX += segOff.x;
          midY += segOff.y;
          const lenM =
            typeof part.lengthM === "number"
              ? part.lengthM
              : Math.hypot(b.x - a.x, b.y - a.y) * scale;
          const text = lenM.toFixed(2).replace(".", ",") + " m";
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillStyle = "#1f2937";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          dp2DrawCoteSegmentTier(ctx, a, b, tierDrawCuts);
          if (!editingThisSeg) dp2FillCoteLabelWithTier(ctx, text, midX, midY, tierDrawCuts);
        }
        continue;
      }

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthPx = Math.sqrt(dx * dx + dy * dy);
      let lengthM = lengthPx * scale;
      if (parcelEdgeML && typeof parcelEdgeML.requestedLengthM === "number") {
        lengthM = parcelEdgeML.requestedLengthM;
      }
      let midX = (p1.x + p2.x) / 2;
      let midY = (p1.y + p2.y) / 2;
      midX += segOff.x;
      midY += segOff.y;
      const text = lengthM.toFixed(2).replace(".", ",") + " m";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#1f2937";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tierDraw = tierSeg || (parcelEdgeEditing ? "editing" : null);
      dp2DrawCoteSegmentTier(ctx, p1, p2, tierDraw);
      if (!editingThisSeg)       dp2FillCoteLabelWithTier(ctx, text, midX, midY, tierDraw);
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
  /* Uniquement en dessin bâti : laisser Draw/Snap recevoir les événements. En « select » le canvas reste prioritaire pour panneaux / textes. */
  const pass = tool === "building_outline";
  zig.classList.toggle("dp2-building-ol-priority", pass);
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
    snap.setActive(isOutline || tool === "select");
  } catch (_) {}
}

// --------------------------
// DP2 — SURVOL SÉLECTION (visuel uniquement)
// --------------------------
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
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.14));
      ctx.setLineDash([]);
      ctx.strokeStyle = blue;
      ctx.fillStyle = blue;
      ctx.lineWidth = 2;
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
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.14));
      const size = Math.max(1, Math.min(w, h) - pad * 2); // carré dans le bbox
      const sx = -size / 2;
      const sy = -size / 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = green;
      ctx.fillStyle = green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(sx, sy, size, size);
      ctx.fill();
      ctx.stroke();
      break;
    }

    // Disjoncteur : symbole "interdiction" vectoriel (sans emoji)
    case "disjoncteur": {
      // Règles : sens interdit ⛔, ROUGE, aucun fond supplémentaire
      const red = "#dc2626";
      const rr = Math.min(w, h) * 0.5;

      ctx.setLineDash([]);
      ctx.strokeStyle = red;
      ctx.fillStyle = "transparent";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-rr * 0.72, rr * 0.72);
      ctx.lineTo(rr * 0.72, -rr * 0.72);
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
      const red = "rgba(220, 38, 38, 0.98)";
      const x1 = -w / 2;
      const x2 = w / 2;
      // Légère diagonale descendante pour évoquer clairement la pente / gravité
      const yOffset = Math.min(12, Math.max(4, h * 0.22));
      const y1 = -yOffset;
      const y2 = yOffset;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.strokeStyle = red;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Pointe : chevron long et étroit (pas un triangle "massif")
      const headLen = Math.max(14, Math.min(26, w / 2.8));
      const headHalfWidth = Math.max(3.5, Math.min(7.5, headLen * 0.22));
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
      // Règles : ligne pointillée VIOLET, sans flèche / sans tête directionnelle
      const violet = "#7c3aed";
      const x1 = -w / 2;
      const x2 = w / 2;
      const yy = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = violet;
      ctx.fillStyle = "transparent";
      ctx.setLineDash([8, 6]);
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
      const a = Math.PI / 6; // ouverture ~30°
      const baseX = 0;
      const baseY = 0;
      // Rayon borné pour rester strictement dans le bbox
      const pad = Math.max(6, Math.min(12, Math.min(w, h) * 0.12));
      const r = Math.max(10, Math.min((Math.min(w, h) / 2) - pad, Math.min(w, h) * 0.45));
      // Règles : NOIR/GRIS FONCÉ, traits fins, aucune icône appareil photo
      const dark = "#111827";
      ctx.lineWidth = 1.6;
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
      // Arc intérieur
      const rArc = r * 0.75;
      ctx.beginPath();
      ctx.arc(baseX, baseY, rArc, -a, a);
      ctx.stroke();
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
// DP2 — SCALE (METERS PER PIXEL)
// --------------------------
function lockDP2Scale() {
  // ⚠️ Si scale_m_per_px est déjà défini, ne pas l'écraser (immutable)
  if (window.DP2_STATE?.scale_m_per_px != null) {
    console.log("[DP2] Échelle déjà verrouillée :", window.DP2_STATE.scale_m_per_px, "m / px");
    return;
  }

  const planCapLock =
    typeof dp2GetCapturePlan === "function" ? dp2GetCapturePlan() : window.DP2_STATE?.capture;
  if (!window.DP2_STATE || !planCapLock) {
    console.warn("[DP2] Impossible de verrouiller l'échelle : capture plan absente");
    return;
  }

  const scale = planCapLock.resolution;

  if (typeof scale !== "number" || scale <= 0) {
    console.warn("[DP2] Échelle invalide :", scale);
    return;
  }

  window.DP2_STATE.scale_m_per_px = scale;

  console.log("[DP2] Échelle verrouillée :", scale, "m / px");
}

// --------------------------
// DP2 — MVT : compteur chargement tuiles + attente idle
// --------------------------
let dp2MvtTilesLoadingCount = 0;
let dp2MvtFeatureLogged = false;

function waitMvtTilesIdle(timeoutMs) {
  return new Promise((resolve) => {
    let resolved = false;
    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    const check = () => {
      if (dp2MvtTilesLoadingCount <= 0) {
        // Attendre un rendu avant de résoudre (2x rAF)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => doResolve());
        });
        return;
      }
      setTimeout(check, 50);
    };
    setTimeout(() => doResolve(), timeoutMs);
    check();
  });
}

// --------------------------
// DP2 — SOURCE MVT CADASTRE FRANCE (openmaptiles.data.gouv.fr, Etalab)
// Schéma TileJSON : layers parcelles (numero, section), batiments, sections. minzoom 11–16.
// Si CORS bloque, utiliser le proxy backend : DP_API_BASE + "/api/mvt/cadastre/{z}/{x}/{y}.pbf"
// --------------------------
const DP2_CADASTRE_MVT_URL = "https://openmaptiles.data.gouv.fr/data/cadastre/{z}/{x}/{y}.pbf";

// --------------------------
// DP2 — STYLE MVT CADASTRE (style bureau d’étude, 100 % côté client — pas de cadastre raster IGN violet)
// Bâtiments : non dessinés en MVT (le plan IGN les porte déjà).
// --------------------------
function dp2MvtParcelLabelText(feature) {
  const p = feature.getProperties ? feature.getProperties() : {};
  const n =
    p.numero != null && String(p.numero).trim()
      ? String(p.numero).trim()
      : p.NUMERO != null && String(p.NUMERO).trim()
        ? String(p.NUMERO).trim()
        : p.parcelle != null && String(p.parcelle).trim()
          ? String(p.parcelle).trim()
          : "";
  const s =
    p.section != null && String(p.section).trim()
      ? String(p.section).trim()
      : p.SECTION != null && String(p.SECTION).trim()
        ? String(p.SECTION).trim()
        : "";
  const joined = [s, n].filter(Boolean).join(" ");
  if (joined) return joined;
  if (p.id != null && String(p.id).trim()) return String(p.id).trim();
  return "";
}

/** Aligne une parcelle MVT avec DP1_STATE.selectedParcel (évite doublon bleu sous la surcouche dorée). */
function dp2MvtFeatureMatchesSelectedParcel(feature) {
  const sel = window.DP1_STATE?.selectedParcel;
  if (!sel) return false;
  const fe = feature.getProperties ? feature.getProperties() : {};
  const fSec = String(fe.section != null ? fe.section : fe.SECTION != null ? fe.SECTION : "")
    .trim()
    .toUpperCase();
  const fNum = String(
    fe.numero != null ? fe.numero : fe.NUMERO != null ? fe.NUMERO : fe.parcelle != null ? fe.parcelle : ""
  ).trim();
  const sSec = String(sel.section != null ? sel.section : "")
    .trim()
    .toUpperCase();
  const sNum = String(sel.numero != null ? sel.numero : "").trim();
  if (fSec && sSec && fNum && sNum) {
    return fSec === sSec && fNum === sNum;
  }
  const parcelField = sel.parcel != null ? String(sel.parcel).trim() : "";
  const mvtLabel = dp2MvtParcelLabelText(feature);
  if (parcelField && mvtLabel) {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    return norm(parcelField) === norm(mvtLabel);
  }
  return false;
}

/** Aire absolue (anneau fermé, coordonnées projetées). */
function dp2PolygonRingAbsArea(ring) {
  if (!ring || ring.length < 3) return 0;
  let n = ring.length;
  if (ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
  if (n < 3) return 0;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  return Math.abs(twice / 2);
}

/** Centroïde 2D d’un anneau polygonal (formule classique, anneau extérieur). */
function dp2PolygonRingCentroidCoords(ring) {
  if (!ring || ring.length < 3) return null;
  let n = ring.length;
  if (ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) n--;
  if (n < 3) return null;
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const cross = xi * yj - xj * yi;
    twice += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  if (Math.abs(twice) < 1e-30) return null;
  const factor = 1 / (3 * twice);
  return [cx * factor, cy * factor];
}

/** Point centroïde pour géométrie parcelle (Polygon / MultiPolygon). */
function dp2OlGeometryCentroidPoint(geom) {
  if (!geom || !geom.getType) return null;
  const typ = geom.getType();
  if (typ === "Polygon") {
    const coords = geom.getCoordinates();
    if (!coords || !coords[0]) return null;
    const c = dp2PolygonRingCentroidCoords(coords[0]);
    return c ? new ol.geom.Point(c) : null;
  }
  if (typ === "MultiPolygon") {
    const mp = geom.getCoordinates();
    if (!mp || !mp.length) return null;
    let bestA = -1;
    let best = null;
    for (let i = 0; i < mp.length; i++) {
      const outer = mp[i] && mp[i][0];
      if (!outer) continue;
      const c = dp2PolygonRingCentroidCoords(outer);
      if (!c) continue;
      const area = dp2PolygonRingAbsArea(outer);
      if (area > bestA) {
        bestA = area;
        best = c;
      }
    }
    return best ? new ol.geom.Point(best) : null;
  }
  return null;
}

function dp2MvtParcelLabelFontCSS(resolution) {
  let px = 13;
  if (resolution != null && Number.isFinite(resolution)) {
    if (resolution > 2.5) px = 12;
    else if (resolution < 0.3) px = 14;
    else px = 13;
  }
  return (
    "500 " +
    px +
    "px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
  );
}

/** Libellé parcelle principale DP2 (plan cadastral propre) — 14–16px, graisse 600. */
function dp2ParcelPrimaryLabelFontCSS(resolution) {
  let px = 15;
  if (resolution != null && Number.isFinite(resolution)) {
    if (resolution > 2.5) px = 14;
    else if (resolution < 0.3) px = 16;
    else px = 15;
  }
  return (
    "600 " +
    px +
    "px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
  );
}

function dp2MvtCentroidPointForLabel(feature) {
  const g = feature.getGeometry && feature.getGeometry();
  return dp2OlGeometryCentroidPoint(g);
}

function styleCadastreMVT(feature, resolution) {
  if (!dp2MvtFeatureLogged && window.__SN_DP_DEV_MODE === true) {
    dp2MvtFeatureLogged = true;
    try {
      const props = feature.getProperties();
      console.log("[DP2 MVT] Première feature — layer:", feature.get("layer"), "keys:", Object.keys(props || {}));
    } catch (_) {}
  }

  const layer = feature.get("layer");
  const type = feature.get("type");
  const kind = feature.get("kind");
  const nature = feature.get("nature");
  const geom = feature.getGeometry();
  if (!geom) return null;

  const isParcelle = layer === "parcelles" || type === "parcelle" || kind === "parcel" || nature === "parcelle";
  const isBatiment = layer === "batiments" || type === "building" || kind === "building" || nature === "batiment";
  const isSection = layer === "sections";

  if (isBatiment) {
    return null;
  }

  if (isSection) {
    return new ol.style.Style({
      fill: new ol.style.Fill({ color: "transparent" }),
      stroke: new ol.style.Stroke({
        color: "rgba(148, 163, 184, 0.45)",
        width: 0.75,
        lineJoin: "round"
      })
    });
  }

  if (isParcelle) {
    if (dp2MvtFeatureMatchesSelectedParcel(feature)) {
      return null;
    }
    const label = dp2MvtParcelLabelText(feature);
    const fillPoly = new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(37, 99, 235, 0.04)" }),
      stroke: new ol.style.Stroke({
        color: "rgba(37, 99, 235, 0.8)",
        width: 1,
        lineJoin: "round",
        lineCap: "round"
      })
    });
    if (!label) return fillPoly;
    return [
      fillPoly,
      new ol.style.Style({
        geometry: function (feat) {
          return dp2MvtCentroidPointForLabel(feat);
        },
        text: new ol.style.Text({
          text: label,
          font: dp2MvtParcelLabelFontCSS(resolution),
          fill: new ol.style.Fill({ color: "#1f2937" }),
          stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.92)", width: 2.5 }),
          overflow: true,
          textAlign: "center",
          textBaseline: "middle"
        })
      })
    ];
  }

  return new ol.style.Style({
    fill: new ol.style.Fill({ color: "transparent" }),
    stroke: new ol.style.Stroke({ color: "rgba(148, 163, 184, 0.5)", width: 0.75, lineJoin: "round" })
  });
}

// Attente tuiles WMTS (fond plan IGN DP2) — même principe que DP1 waitTilesIdle.
async function dp2WaitWmtsSourcesIdle(map, wmtsSources, timeoutMs) {
  const sources = (wmtsSources || []).filter(Boolean);
  if (!map || !sources.length) return;
  let pending = 0;
  let resolved = false;
  const cleanupFns = [];
  function finish(resolve) {
    if (resolved) return;
    resolved = true;
    cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(resolve), timeoutMs != null ? timeoutMs : 2800);
    sources.forEach((src) => {
      const onStart = function () {
        pending++;
      };
      const onEnd = function () {
        pending = Math.max(0, pending - 1);
        if (pending === 0) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(timer);
              finish(resolve);
            })
          );
        }
      };
      src.on("tileloadstart", onStart);
      src.on("tileloadend", onEnd);
      src.on("tileloaderror", onEnd);
      cleanupFns.push(() => src.un("tileloadstart", onStart));
      cleanupFns.push(() => src.un("tileloadend", onEnd));
      cleanupFns.push(() => src.un("tileloaderror", onEnd));
    });
    try {
      map.renderSync();
    } catch (_) {}
    requestAnimationFrame(() => {
      if (pending === 0) {
        clearTimeout(timer);
        finish(resolve);
      }
    });
  });
}

function dp2GetWmtsLayerId(source) {
  if (!source || typeof source.getLayer !== "function") return "";
  try {
    return String(source.getLayer() || "");
  } catch (_) {
    return "";
  }
}

/** DP2 : retire le cadastre parcelles raster IGN (CADASTRALPARCELS) si présent. Fond attendu : PLAN IGN V2 ; parcelle active = vectoriel. */
function dp2SanitizeDp2BaseLayers(map) {
  if (!map || !map.getLayers) return;
  map
    .getLayers()
    .getArray()
    .slice()
    .forEach((layer) => {
      const src = layer.getSource && layer.getSource();
      if (!src) return;
      const lid = dp2GetWmtsLayerId(src);
      let urlStr = "";
      if (typeof src.getUrls === "function") {
        const u = src.getUrls();
        urlStr = u && u[0] != null ? String(u[0]) : "";
      } else if (typeof src.getUrl === "function") {
        urlStr = String(src.getUrl() || "");
      }
      const badCadUrl = urlStr.indexOf("CADASTRALPARCELS") >= 0;
      const badCadLayer = lid.indexOf("CADASTRALPARCELS") >= 0;
      if (badCadUrl || badCadLayer) {
        map.removeLayer(layer);
        console.warn("[DP2] Couche IGN retirée (cadastre raster CADASTRALPARCELS — doublon avec fond plan IGN DP2)");
      }
    });
}

function dp2LogDp2LayerAudit(map) {
  if (!map || !map.getLayers) return;
  try {
    const parts = [];
    map.getLayers().forEach((lyr, i) => {
      const s = lyr.getSource && lyr.getSource();
      const lid = dp2GetWmtsLayerId(s);
      parts.push("[" + i + "] " + (lid || (lyr.constructor && lyr.constructor.name) || "layer"));
    });
    console.info("[DP2] Audit couches carte :", parts.join(" ; "));
  } catch (_) {}
}

// Forcer un premier rendu utile des couches WMTS à l'ouverture des modals DP2/DP4 (évite écran gris jusqu'au micro zoom).
function forceFirstPaintWMTS(map, wmtsSource, wmtsResolutions) {
  try {
    if (!map || !map.getView) return;
    const v = map.getView();
    if (!v) return;

    // 1) resize + render sync (cas modal)
    try { map.updateSize(); } catch (_) {}
    try { map.renderSync(); } catch (_) {}

    // 2) Jiggle resolution (équivalent micro zoom/dézoom, SANS changer le cadrage final)
    const resList = Array.isArray(wmtsResolutions) ? wmtsResolutions : null;
    const cur = v.getResolution ? v.getResolution() : null;
    if (resList && cur) {
      let idx = resList.indexOf(cur);
      if (idx < 0) {
        // si cur n'est pas exactement dans la liste, trouver le plus proche
        let bestI = 0, bestD = Math.abs(resList[0] - cur);
        for (let i = 1; i < resList.length; i++) {
          const d = Math.abs(resList[i] - cur);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        idx = bestI;
      }
      const altIdx = (idx > 0) ? (idx - 1) : Math.min(1, resList.length - 1);
      const alt = resList[altIdx];

      if (alt && alt !== cur && v.setResolution) {
        v.setResolution(alt);
        try { map.renderSync(); } catch (_) {}
        v.setResolution(cur);
        try { map.renderSync(); } catch (_) {}
      }
    }

    // 3) Dernier safety render après un tick
    requestAnimationFrame(() => {
      try { map.updateSize(); } catch (_) {}
      try { map.renderSync(); } catch (_) {}
    });

    setTimeout(() => {
      try { map.updateSize(); } catch (_) {}
      try { map.renderSync(); } catch (_) {}
    }, 150);

  } catch (_) {}
}

// --------------------------
// DP2 — INIT GLOBAL (CAPTURE MODE)
// Source de vérité UNIQUE : window.DP1_STATE.selectedParcel (geometry, section, parcelle).
// Fond : WMTS IGN Plan (GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2). Parcelle sélectionnée + voisines = vectoriel (pas d’orthophoto sur DP2 ; DP4 reste ORTHO).
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
        const planSrc = window.DP2_MAP?.planSource || null;
        forceFirstPaintWMTS(m, planSrc, window.__DP_WMTS_RESOLUTIONS_PM);
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

    // ——— Grille WMTS PM + fond IGN Plan (PLANIGNV2), même grille que DP4 pour cohérence d’échelle ———
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
    window.__DP_WMTS_RESOLUTIONS_PM = WMTS_RESOLUTIONS;

    const centerParis = fromLonLat([2.3488, 48.8534]);
    const view = new ol.View({
      projection: "EPSG:3857",
      center: centerParis,
      resolutions: WMTS_RESOLUTIONS,
      constrainResolution: true,
      enableRotation: false
    });

    const planSource = new ol.source.WMTS({
      url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
      layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
      matrixSet: "PM",
      format: "image/png",
      style: "normal",
      tileGrid: wmtsGridPM,
      wrapX: false,
      crossOrigin: "anonymous"
    });
    const planLayer = new ol.layer.Tile({
      opacity: 1,
      transition: 0,
      preload: 2,
      zIndex: 0,
      source: planSource
    });

    const map = new ol.Map({
      target: mapEl,
      layers: [planLayer],
      view,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      moveTolerance: 2,
      maxTilesLoading: 16
    });

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
                color: active ? "rgba(195, 152, 71, 0.10)" : "rgba(107, 114, 128, 0.06)"
              }),
              stroke: new ol.style.Stroke({
                color: active ? "#C39847" : "#6b7280",
                width: active ? 2.5 : 2
              })
            })
          ];
        }
        if (gt === "LineString") {
          return [
            new ol.style.Style({
              stroke: new ol.style.Stroke({
                color: "#C39847",
                width: 2.5,
                lineDash: [10, 8]
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
          maxZoom: 20
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
      const ok = d1 && dp2CenterMapViewOnLatLon(view, d1.lat, d1.lon, WMTS_RESOLUTIONS);
      if (!ok) {
        console.warn("[DP2] Pas de coordonnées CRM — centre par défaut (Île-de-France).");
      }
    }

    try {
      applySafeInitialResolution(map, view.getResolution(), WMTS_RESOLUTIONS);
    } catch (_) {}

    const dp2NeighborParcelsSource = new ol.source.Vector();
    window.DP2_MAP = {
      map,
      planSource,
      planTileLayer: planLayer,
      mvtSource: null,
      neighborParcelsSource: dp2NeighborParcelsSource,
      dp2BuildingVectorSource,
      dp2BuildingVectorLayer
    };

    if (usedParcelGeometry && geom && selectedParcel) {
      var __dp2ParcelLabel =
        selectedParcel.parcel != null && String(selectedParcel.parcel).trim()
          ? String(selectedParcel.parcel).trim()
          : [selectedParcel.section, selectedParcel.numero].filter(Boolean).join(" ").trim();

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
        style: function (feature, resolution) {
          var styles = [
            new ol.style.Style({
              fill: new ol.style.Fill({ color: "rgba(180, 83, 9, 0.14)" }),
              stroke: new ol.style.Stroke({
                color: "rgba(255,255,255,0.95)",
                width: 4,
                lineJoin: "round",
                lineCap: "round"
              })
            }),
            new ol.style.Style({
              stroke: new ol.style.Stroke({
                color: "#b45309",
                width: 2.5,
                lineJoin: "round",
                lineCap: "round"
              })
            })
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
                  fill: new ol.style.Fill({ color: "#1f2937" }),
                  stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.95)", width: 3 }),
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
      type: "Polygon"
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
          coordinates: ring
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
      pixelTolerance: 10
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
            target.coordinates = coords;
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
              target.coordinates = coords;
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
          renderDP2FromState();
        } catch (_) {}
      } catch (err2) {
        console.warn("[DP2] modifyend", err2);
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
      "[DP2] Mode CAPTURE prêt (IGN Plan PLANIGNV2" +
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
    document.getElementById("dp2-btn-collapse-versions")?.addEventListener("click", function (e) {
      e.preventDefault();
      if (
        !window.confirm(
          "Toutes les versions du menu seront supprimées sauf celle qui correspond au plan actuellement affiché à l’écran. Continuer ?"
        )
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
    if (window.DP2_MAP?.planTileLayer) window.DP2_MAP.planTileLayer.setVisible(false);
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
    if (window.DP2_MAP.planTileLayer) window.DP2_MAP.planTileLayer.setVisible(true);
  } catch (_) {}
  try {
    if (window.DP2_MAP.parcelVectorLayer) window.DP2_MAP.parcelVectorLayer.setVisible(true);
  } catch (_) {}

  const map = window.DP2_MAP.map;
  const view = map.getView();
  const mapEl = map.getTargetElement();

  lockDPView({ map });

  await dp2SyncOpenLayersSizeToContainer(map);

  const planSrc = window.DP2_MAP.planSource;
  if (planSrc) {
    await dp2WaitWmtsSourcesIdle(map, [planSrc], 3200);
  }
  if (window.DP2_MAP.mvtSource) {
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
      alert("DP3 non validée");
      return;
    }
    if (!state.baseImage) {
      alert("Image DP3 manquante");
      return;
    }

    const baseImage = await DP3_imageSrcToDataUrl(state.baseImage);
    if (!baseImage) {
      alert("Image DP3 manquante");
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
          renderRidgeLine(sctx, obj, i);
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
  const src = Array.isArray(window.DP2_STATE?.features) ? window.DP2_STATE.features : [];
  try {
    s.baseFeatures = typeof dp2CloneForHistory === "function" ? dp2CloneForHistory(src) : JSON.parse(JSON.stringify(src));
  } catch (_) {
    s.baseFeatures = [];
  }
  s._dp4BaseFeaturesSealed = true;
}

function dp4GetDp2CapturePreviewForView() {
  const pv = window.DP2_STATE?.capture_preview;
  if (pv && Array.isArray(pv.center) && pv.center.length >= 2) return pv;
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
  if (window.DP2_STATE) window.DP2_STATE.photoCategory = window.DP4_STATE.photoCategory;

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
    alert("Aucun plan Avant travaux à importer.");
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
  const map = window.DP4_OL_MAP;
  if (!map || typeof map.on !== "function") return;
  const handler = function () {
    if (!window.DP4_IMPORT_DP2_ACTIVE) return;
    if (!window.DP4_IMPORT_OVERLAY_CANVAS) return;
    if (!dp4ImportViewSnapshotDiffersFromMap(window.DP4_IMPORT_VIEW_SNAPSHOT, map)) return;
    window.DP4_IMPORT_DP2_ACTIVE = false;
    window.DP4_IMPORT_VIEW_SNAPSHOT = null;
    dp4ClearImportOverlayPixelsOnly();
    dp4ShowImportStaleMessage();
    console.warn("[DP4][IMPORT] aperçu figé invalidé (carte déplacée)");
  };
  window.DP4_IMPORT_STALE_MOVEEND_HANDLER = handler;
  map.on("moveend", handler);
}

function dp4RemoveScreenOverlayCanvas() {
  dp4UnbindImportStaleGuardOnMapMove();
  window.DP4_IMPORT_VIEW_SNAPSHOT = null;
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
    dp4SeedRoofGeometryFromBaseFeatures(catEarly);
  } catch (e) {
    console.warn("[DP4] seed roofGeometry depuis baseFeatures", e);
  }

  window.DP4_IMPORT_DP2_ACTIVE = false;

  try {
    if (typeof dp4ApplyDp4CategoryGeometryToDp2Editor === "function") {
      dp4ApplyDp4CategoryGeometryToDp2Editor(catEarly);
    }
    if (window.DP2_STATE) window.DP2_STATE.editorProfile = "DP4_ROOF";
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
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      let d;
      try {
        d = ctx.getImageData(x, y, 1, 1).data;
      } catch (_) {
        return false;
      }
      lums.push((d[0] + d[1] + d[2]) / 3);
    }
  }
  if (!lums.length) return true;
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const variance = lums.reduce((a, v) => a + (v - mean) * (v - mean), 0) / lums.length;
  return variance < 25 && mean > 90 && mean < 220;
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

  const dp2PlanForMap =
    window.DP2_STATE &&
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

  const orthoLayer = new ol.layer.Tile({
    source: new ol.source.WMTS({
      url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile",
      layer: "ORTHOIMAGERY.ORTHOPHOTOS",
      matrixSet: "PM",
      format: "image/jpeg",
      style: "normal",
      tileGrid: wmtsGridPM,
      wrapX: false,
      crossOrigin: "anonymous"
    })
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
      orthoLayer.getSource(),
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
function dp4DeletePlan(category) {
  const cat = category === "before" || category === "after" ? category : null;
  if (!cat) return;

  if (!confirm("Supprimer définitivement ce plan DP4 ?")) return;

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
  const DP4_MODAL_TITLE_INITIAL = titleEl ? titleEl.textContent : "DP4 — Plan de toiture";
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
    if (importBtn) importBtn.style.display = "none";
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

    window.DP2_STATE = window.DP2_STATE || {};
    window.DP2_STATE.editorProfile = "DP4_ROOF";
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
                dp4SaveActivePlanToSelectedCategory();
              }
            } catch (_) {}
            try {
              console.log("[DP4] plan saved:", cat, "plans.before?", !!window.DP4_STATE?.plans?.before, "plans.after?", !!window.DP4_STATE?.plans?.after);
            } catch (_) {}
            const finalImg = await dp4BuildFinalRenderImageBase64FromCurrentDom();
            if (typeof finalImg === "string" && finalImg.startsWith("data:image")) {
              dp4SetFinalRenderFor(cat, finalImg);
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
  }

  async function dp4CaptureMapContainer() {
    // Capture OpenLayers puis transformation une seule fois (repère pixels = image capturée).
    // Tant que la capture n’est pas valide : ne pas détruire la carte ni passer à l’étape toiture.
    if (!window.DP4_OL_MAP) return;

    dp4SetValidateEnabled(false);

    try {
      const map = window.DP4_OL_MAP;
      const mapEl = map.getTargetElement();
      if (!mapEl) {
        console.error("[DP4] capture: mapEl absent");
        alert("Capture DP4 impossible : carte non affichée.");
        return;
      }

      await new Promise((resolve) => {
        map.once("rendercomplete", resolve);
        map.renderSync();
      });
      await new Promise((r) => setTimeout(r, 300));
      try {
        map.renderSync();
      } catch (_) {}

      const size = map.getSize();
      if (!size || size[0] <= 0 || size[1] <= 0) {
        console.error("[DP4] capture: taille carte invalide", size);
        alert("Capture DP4 impossible : taille de la carte invalide.");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = size[0];
      canvas.height = size[1];
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("[DP4] capture: contexte 2D absent");
        alert("Capture DP4 impossible.");
        return;
      }

      const canvases = mapEl.querySelectorAll(".ol-layer canvas");
      canvases.forEach((c) => {
        if (c.width > 0 && c.height > 0) {
          const opacity = c.parentNode.style.opacity;
          ctx.globalAlpha = opacity === "" ? 1 : Number(opacity);
          const transform = c.style.transform;
          if (transform) {
            const m = transform.match(/^matrix\(([^)]*)\)$/);
            if (m) {
              const matrix = m[1].split(",").map(Number);
              ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
            }
          }
          ctx.drawImage(c, 0, 0);
        }
      });

      if (dp4RasterCompositeProbablyBlank(ctx, size[0], size[1])) {
        console.error("[DP4] capture: image vide ou grise (tuiles non prêtes ?)");
        alert("La capture est vide ou encore grise. Attendez le chargement des images puis réessayez.");
        return;
      }

      const imageBase64 = canvas.toDataURL("image/png");
      const view = map.getView();
      const scale_m_per_px = ol.proj.getPointResolution(
        view.getProjection(),
        view.getResolution(),
        view.getCenter(),
        "m"
      );

      const okGeom = dp4TransformDP2GeometryToMapPixels(null, map);
      if (!okGeom) return;

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

      window.DP4_CAPTURE_IMAGE = imageBase64;
      try {
        syncDP4MetricMarkerOverlayUI();
      } catch (_) {}

      dp4DestroyMap();

      dp4RenderRoofDrawingStep();
    } catch (e) {
      console.error("[DP4] Capture impossible", e);
      alert("Capture DP4 impossible (voir la console).");
    } finally {
      dp4SetValidateEnabled(true);
    }
  }

  function dp4OpenModal() {
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

  /* Import DP2 → overlay : retiré — le contour carte provient de DP2_STATE.features gelé dans baseFeatures. */

  // Capture (validation vue) : retirer l’aperçu → capture carte (tuiles + anti-gris) → transformation → destroy → toiture
  if (validateBtn && validateBtn.dataset.bound !== "1") {
    validateBtn.dataset.bound = "1";
    validateBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        dp4HideMapCursorHint();
      } catch (_) {}
      console.log("DP4_MAP_VALIDATED");
      if (window.DP4_IMPORT_OVERLAY_CANVAS) {
        dp4RemoveScreenOverlayCanvas();
      }

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

    // DP6 UX : suppression totale de la validation/manipulation via boutons de sélection.
    // (Les zones sont créées et modifiées directement par interaction.)
    if (validateSelectionBtn) {
      validateSelectionBtn.style.display = "none";
      validateSelectionBtn.disabled = true;
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
          // Auto-création + auto-validation : une zone dessinée devient immédiatement un patch.
          // Elle devient inactive à la fin (aucun contour).
          try { dp6ValidateActiveSelectionAsPatch(); } catch (_) {}
          render(null);
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

      // PAN (visuel) — actif uniquement si zoom > 1
      // - Ne doit pas casser l'édition (poignées/polygone) ni la sélection de patch en mode EDIT.
      // - Astuce UX : en mode DRAW, maintenir SHIFT pour forcer le dessin même si zoomé.
      if ((dp6View?.scale || 1) > 1.000001 && !isHandle && !(isPoly && pts)) {
        // PAN (visuel) — actif uniquement si zoom > 1.
        // SHIFT = forcer le dessin même si zoomé.
        if (!e.shiftKey) {
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
      alert("Street View n’est pas prêt. Patientez quelques secondes puis réessayez.");
      return;
    }
    const pano = dp6Panorama;
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
      dp6ValidateActiveSelectionAsPatch();
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
        window.DP6_STATE.afterImage = out;
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
      alert("DP6 : images AVANT et APRÈS requises pour l’export PDF");
      return;
    }

    try {
      await window.generateDPDocumentPDF({
        type: "DP6",
        state: st,
      });
    } catch (err) {
      alert("Erreur lors de la génération du PDF DP6 (backend indisponible ou données invalides).");
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
      alert("DP7 : validez d’abord l’implantation (image finale requise) avant l’export PDF.");
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
      alert("Erreur lors de la génération du PDF DP7 (backend indisponible ou données invalides).");
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
      alert("DP8 : validez d’abord l’implantation (image finale requise) avant l’export PDF.");
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
      alert("Erreur lors de la génération du PDF DP8 (backend indisponible ou données invalides).");
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
