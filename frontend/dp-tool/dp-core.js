// Extracted shared DP runtime helpers. Keep this classic script loaded before dp-app.js.
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

/** URL du style vectoriel MapTiler (style.json). */
function __snMapTilerStyleUrl() {
  var w = typeof window !== "undefined" ? window : {};
  // Priorité stricte DP2 : override runtime local, puis variable publique injectée par Vite.
  var u = w.__DP2_MAPTILER_STYLE_URL__ || w.__VITE_MAPTILER_STYLE_URL__;
  return u && String(u).trim() ? String(u).trim() : "";
}

/** Clé publique MapTiler (optionnelle si déjà dans style.json). */
function __snMapTilerPublicKey() {
  var w = typeof window !== "undefined" ? window : {};
  var k = w.__DP2_MAPTILER_KEY__ || w.__VITE_MAPTILER_KEY__;
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
    var token = typeof localStorage !== "undefined" && __solarnextDpAuthToken();
    if (token) h.Authorization = "Bearer " + token;
  } catch (e) {}
  __solarnextDpMergeCrmAuthHeaders(h);
  return h;
}

function __solarnextDpAuthHeadersBearerOnly() {
  var h = {};
  try {
    var token = typeof localStorage !== "undefined" && __solarnextDpAuthToken();
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

function __snDpUxEnsureStyles() {
  if (typeof document === "undefined" || document.getElementById("sn-dp-ux-styles")) return;
  var style = document.createElement("style");
  style.id = "sn-dp-ux-styles";
  style.textContent =
    ".sn-dp-toast-stack{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 24px));pointer-events:none}" +
    ".sn-dp-toast{pointer-events:auto;background:#fff;border:1px solid #d1d5db;border-left:4px solid #2563eb;border-radius:8px;box-shadow:0 18px 45px rgba(15,23,42,.16);padding:12px 14px;color:#111827;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}" +
    ".sn-dp-toast[data-type='error']{border-left-color:#dc2626}.sn-dp-toast[data-type='warning']{border-left-color:#d97706}.sn-dp-toast[data-type='success']{border-left-color:#059669}" +
    ".sn-dp-toast-title{font-weight:700;margin:0 22px 2px 0}.sn-dp-toast-message{white-space:pre-wrap;margin:0;color:#374151}.sn-dp-toast-close{position:absolute;top:8px;right:8px;border:0;background:transparent;color:#6b7280;font-size:18px;line-height:1;cursor:pointer}" +
    ".sn-dp-toast details{margin-top:8px;color:#4b5563}.sn-dp-toast summary{cursor:pointer;font-weight:600}.sn-dp-toast pre{white-space:pre-wrap;max-height:180px;overflow:auto;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px}" +
    ".sn-dp-step-message{margin:12px 0;padding:12px 14px;border:1px solid #f3c8c8;border-left:4px solid #dc2626;border-radius:8px;background:#fff7f7;color:#111827;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}" +
    ".sn-dp-step-message[data-type='warning']{border-color:#f5d49a;border-left-color:#d97706;background:#fffbeb}.sn-dp-step-message[data-type='success']{border-color:#a7f3d0;border-left-color:#059669;background:#ecfdf5}.sn-dp-step-message strong{display:block;margin-bottom:2px}.sn-dp-step-message p{margin:0;white-space:pre-wrap;color:#374151}.sn-dp-step-message details{margin-top:8px}.sn-dp-step-message summary{cursor:pointer;font-weight:600}.sn-dp-step-message pre{white-space:pre-wrap;max-height:180px;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px}" +
    ".sn-dp-modal-backdrop{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.48);padding:20px}" +
    ".sn-dp-modal{width:min(520px,100%);background:#fff;color:#111827;border-radius:8px;box-shadow:0 24px 80px rgba(15,23,42,.28);border:1px solid #e5e7eb;padding:18px;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}" +
    ".sn-dp-modal h2{margin:0 0 8px;font-size:18px;line-height:1.25}.sn-dp-modal p{margin:0;white-space:pre-wrap;color:#374151}.sn-dp-modal details{margin-top:12px}.sn-dp-modal summary{cursor:pointer;font-weight:600}.sn-dp-modal pre{white-space:pre-wrap;max-height:220px;overflow:auto;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px}" +
    ".sn-dp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.sn-dp-btn{border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#111827;padding:8px 12px;font-weight:650;cursor:pointer}.sn-dp-btn:hover{background:#f9fafb}.sn-dp-btn-primary{border-color:#111827;background:#111827;color:#fff}.sn-dp-btn-primary:hover{background:#374151}";
  document.head.appendChild(style);
}

function __snDpUxText(value) {
  if (value == null) return "";
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function __snDpToast(options) {
  try {
    if (typeof document === "undefined") return;
    __snDpUxEnsureStyles();
    var o = typeof options === "string" ? { message: options } : options || {};
    var stack = document.getElementById("sn-dp-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "sn-dp-toast-stack";
      stack.className = "sn-dp-toast-stack";
      document.body.appendChild(stack);
    }
    var toast = document.createElement("div");
    toast.className = "sn-dp-toast";
    toast.dataset.type = o.type || "info";
    toast.setAttribute("role", o.type === "error" ? "alert" : "status");
    toast.style.position = "relative";

    var close = document.createElement("button");
    close.type = "button";
    close.className = "sn-dp-toast-close";
    close.setAttribute("aria-label", "Fermer");
    close.textContent = "×";
    close.addEventListener("click", function () { toast.remove(); });
    toast.appendChild(close);

    var title = document.createElement("p");
    title.className = "sn-dp-toast-title";
    title.textContent = o.title || (o.type === "error" ? "Action impossible" : o.type === "success" ? "Action terminée" : "Information");
    toast.appendChild(title);

    var message = document.createElement("p");
    message.className = "sn-dp-toast-message";
    message.textContent = __snDpUxText(o.message);
    toast.appendChild(message);

    if (o.details != null) {
      var details = document.createElement("details");
      var summary = document.createElement("summary");
      summary.textContent = "Détails";
      var pre = document.createElement("pre");
      pre.textContent = __snDpUxText(o.details);
      details.appendChild(summary);
      details.appendChild(pre);
      toast.appendChild(details);
    }

    if (typeof o.onRetry === "function") {
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "sn-dp-btn";
      retry.style.marginTop = "10px";
      retry.textContent = o.retryLabel || "Réessayer";
      retry.addEventListener("click", function () {
        try { o.onRetry(); } catch (e) { console.warn("[DP UX] retry", e); }
      });
      toast.appendChild(retry);
    }

    stack.appendChild(toast);
    if (!o.persistent) {
      setTimeout(function () { toast.remove(); }, Number(o.durationMs || 6500));
    }
  } catch (e) {
    try { console.warn("[DP UX] toast", e); } catch (_) {}
  }
}

function __snDpAlert(message, options) {
  var o = Object.assign({ type: "error" }, options || {}, { message: message });
  __snDpSetStepMessage(o.message, o);
  __snDpToast(o);
}

function __snDpFindActiveStepRoot() {
  if (typeof document === "undefined") return null;
  var candidates = Array.prototype.slice.call(document.querySelectorAll("[id^='dp'][id$='-page'], #cerfa-page"));
  for (var i = 0; i < candidates.length; i += 1) {
    var el = candidates[i];
    if (!el || el.hidden || el.offsetParent === null) continue;
    return el;
  }
  return document.querySelector(".dp-page") || document.body || null;
}

function __snDpSetStepMessage(message, options) {
  try {
    if (typeof document === "undefined") return;
    __snDpUxEnsureStyles();
    var root = __snDpFindActiveStepRoot();
    if (!root) return;
    var box = root.querySelector(":scope > .sn-dp-step-message");
    if (!box) {
      box = document.createElement("div");
      box.className = "sn-dp-step-message";
      var anchor = root.querySelector(".dp-page-head, .dp-step-head, h1, h2");
      if (anchor && anchor.parentNode === root) anchor.insertAdjacentElement("afterend", box);
      else root.insertBefore(box, root.firstChild);
    }
    var o = options || {};
    box.dataset.type = o.type || "error";
    box.innerHTML = "";
    var title = document.createElement("strong");
    title.textContent = o.title || (o.type === "warning" ? "À vérifier" : o.type === "success" ? "Action terminée" : "Action impossible");
    var body = document.createElement("p");
    body.textContent = __snDpUxText(message);
    box.appendChild(title);
    box.appendChild(body);
    if (o.details != null) {
      var details = document.createElement("details");
      var summary = document.createElement("summary");
      summary.textContent = "Détails";
      var pre = document.createElement("pre");
      pre.textContent = __snDpUxText(o.details);
      details.appendChild(summary);
      details.appendChild(pre);
      box.appendChild(details);
    }
  } catch (e) {
    try { console.warn("[DP UX] step message", e); } catch (_) {}
  }
}

function __snDpConfirm(message, options) {
  return new Promise(function (resolve) {
    try {
      if (typeof document === "undefined" || !document.body) {
        resolve(false);
        return;
      }
      __snDpUxEnsureStyles();
      var o = options || {};
      var backdrop = document.createElement("div");
      backdrop.className = "sn-dp-modal-backdrop";
      backdrop.setAttribute("role", "presentation");
      var modal = document.createElement("div");
      modal.className = "sn-dp-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");

      var title = document.createElement("h2");
      title.textContent = o.title || "Confirmation requise";
      modal.appendChild(title);
      var body = document.createElement("p");
      body.textContent = __snDpUxText(message);
      modal.appendChild(body);
      if (o.details != null) {
        var details = document.createElement("details");
        var summary = document.createElement("summary");
        summary.textContent = "Détails";
        var pre = document.createElement("pre");
        pre.textContent = __snDpUxText(o.details);
        details.appendChild(summary);
        details.appendChild(pre);
        modal.appendChild(details);
      }
      var actions = document.createElement("div");
      actions.className = "sn-dp-modal-actions";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "sn-dp-btn";
      cancel.textContent = o.cancelLabel || "Annuler";
      var ok = document.createElement("button");
      ok.type = "button";
      ok.className = "sn-dp-btn sn-dp-btn-primary";
      ok.textContent = o.confirmLabel || "Confirmer";
      actions.appendChild(cancel);
      actions.appendChild(ok);
      modal.appendChild(actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      function done(value) {
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === "Escape") done(false);
      }
      cancel.addEventListener("click", function () { done(false); });
      ok.addEventListener("click", function () { done(true); });
      document.addEventListener("keydown", onKey);
      setTimeout(function () { ok.focus(); }, 0);
    } catch (e) {
      try { console.warn("[DP UX] confirm", e); } catch (_) {}
      resolve(false);
    }
  });
}

try {
  window.__snDpToast = __snDpToast;
  window.__snDpAlert = __snDpAlert;
  window.__snDpConfirm = __snDpConfirm;
  window.__snDpSetStepMessage = __snDpSetStepMessage;
  window.__snDpNativeAlert = window.__snDpNativeAlert || window.alert;
  window.alert = function (message) {
    __snDpAlert(message, { type: "error" });
  };
} catch (_) {}

async function __solarnextDpOpenSavedPdfFromJson(j, defaultDownloadName) {
  var docId = j.documentId || j.document_id;
  if (!docId) {
    window.__snDpAlert("Réponse serveur invalide (documentId manquant).");
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
        window.__snDpAlert(errJ.error);
        return;
      }
    } catch (e2) {}
    window.__snDpAlert("Impossible de télécharger le document enregistré.");
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
  function showPdfError(message, details) {
    window.__snDpAlert(message, {
      title: "Export PDF impossible",
      details: details || null,
      onRetry: function () {
        void __solarnextDpFetchPdfWithReplace(urlPath, getPayload, pieceKey, getFallbackName);
      },
    });
  }

  var res = await post(false);
  var ct = (res.headers.get("content-type") || "").toLowerCase();

  if (ct.indexOf("application/json") >= 0) {
    var j = await res.json();
    function jsonPdfDetails(obj) {
      if (!obj || typeof obj !== "object") return null;
      if (Array.isArray(obj.missingPieces) && obj.missingPieces.length) {
        return "Pièces manquantes : " + obj.missingPieces.map(function (p) {
          return p && (p.label || p.key) ? String(p.label || p.key) : String(p);
        }).join(", ");
      }
      if (obj.source && (obj.source.fileName || obj.source.piece)) {
        return "Document source : " + (obj.source.fileName || obj.source.piece);
      }
      return obj.details || null;
    }
    if (j.alreadyExists === true) {
      if (
        !(await __snDpConfirm("Ce document existe déjà pour ce dossier. Voulez-vous le remplacer ?", {
          title: "Document déjà existant",
          confirmLabel: "Remplacer",
          cancelLabel: "Conserver",
          details: j.fileName ? "Fichier actuel : " + j.fileName : null,
        }))
      ) {
        return;
      }
      res = await post(true);
      ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") >= 0) {
        j = await res.json();
        if (j.error) {
          showPdfError(j.error, jsonPdfDetails(j));
          return;
        }
        if (j.alreadyExists === true) {
          showPdfError("Impossible de finaliser le remplacement.");
          return;
        }
        if (j.documentId || j.document_id) {
          await __solarnextDpOpenSavedPdfFromJson(j, fallback());
          return;
        }
        showPdfError("Réponse serveur inattendue après remplacement.", j);
        return;
      }
    } else if (j.error) {
      showPdfError(j.error, jsonPdfDetails(j));
      return;
    } else if (j.documentId || j.document_id) {
      await __solarnextDpOpenSavedPdfFromJson(j, fallback());
      return;
    } else {
      showPdfError("Réponse serveur inattendue.", j);
      return;
    }
  }

  await __solarnextDpFetchPdfThenOpenOrDownload(res, fallback(), function () {
    void __solarnextDpFetchPdfWithReplace(urlPath, getPayload, pieceKey, getFallbackName);
  });
}

async function __solarnextDpFetchPdfThenOpenOrDownload(res, defaultDownloadName, retryFn) {
  function showPdfError(message, details) {
    window.__snDpAlert(message, {
      title: "Export PDF impossible",
      details: details || null,
      onRetry: typeof retryFn === "function" ? retryFn : null,
    });
  }
  var ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.indexOf("application/json") >= 0) {
    var j = await res.json();
    if (j.error) {
      var details = null;
      if (Array.isArray(j.missingPieces) && j.missingPieces.length) {
        details = "Pièces manquantes : " + j.missingPieces.map(function (p) {
          return p && (p.label || p.key) ? String(p.label || p.key) : String(p);
        }).join(", ");
      } else if (j.source && (j.source.fileName || j.source.piece)) {
        details = "Document source : " + (j.source.fileName || j.source.piece);
      } else {
        details = j.details || null;
      }
      showPdfError(j.error, details);
      return;
    }
    if (j.alreadyExists === true) {
      showPdfError("Un document du même type existe déjà — utilisez l’export depuis le CRM avec confirmation.");
      return;
    }
    await __solarnextDpOpenSavedPdfFromJson(j, defaultDownloadName);
    return;
  }
  if (!res.ok) {
    try {
      var ej = await res.json();
      if (ej && ej.error) {
        showPdfError(ej.error);
        return;
      }
    } catch (e3) {}
    showPdfError("Erreur lors de la génération du PDF.", "Statut HTTP : " + res.status);
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
  var token = typeof localStorage !== "undefined" && __solarnextDpAuthToken();
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
