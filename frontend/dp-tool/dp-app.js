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
/** Snapshot vue au moment « Importer DP2 » (aperçu figé ; la carte peut bouger dessous). */
window.DP4_IMPORT_VIEW_SNAPSHOT = null;
/** Matrix DP2 image pixels -> DP4 screen pixels, figée au clic "Importer DP2". */
window.DP4_IMPORT_DP2_FROZEN_TRANSFORM = null;
/** Ancien moveend guard conservé pour compat runtime, non utilisé par le nouveau garde-fou figé. */
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

function snDpText(value, fallback) {
  const s = value == null ? "" : String(value).trim();
  return s || fallback || "Non renseigné";
}

function snDpPortalHref(value) {
  const s = value == null ? "" : String(value).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return "https://" + s.replace(/^\/+/, "");
}

function snDpAppendMairieField(host, label, value, opts) {
  if (!host) return;
  const wrap = document.createElement("div");
  wrap.style.border = "1px solid #e5e7eb";
  wrap.style.borderRadius = "8px";
  wrap.style.padding = "10px 12px";
  wrap.style.background = "#fff";

  const title = document.createElement("div");
  title.textContent = label;
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";
  title.style.color = "#6b7280";
  title.style.marginBottom = "4px";
  wrap.appendChild(title);

  const body = document.createElement(opts?.href ? "a" : "div");
  body.textContent = snDpText(value);
  body.style.fontWeight = "700";
  body.style.color = opts?.href ? "#1d4ed8" : "#111827";
  body.style.overflowWrap = "anywhere";
  if (opts?.href) {
    body.href = opts.href;
    body.target = opts.target || "_blank";
    body.rel = "noopener noreferrer";
  }
  wrap.appendChild(body);
  host.appendChild(wrap);
}

function renderDPMairiePanel() {
  const status = document.getElementById("dp-mairie-status");
  const summary = document.getElementById("dp-mairie-summary");
  const details = document.getElementById("dp-mairie-details");
  const docs = document.getElementById("dp-mairie-documents");
  if (!summary || !details || !docs) return;

  const mairie = window.__SOLARNEXT_DP_CONTEXT__?.context?.mairie || {};
  const hasMairie = !!mairie.id;
  const accountLabels = {
    created: "Compte créé",
    to_create: "Compte à créer",
    none: "Pas de compte portail",
  };
  const portalLabels = {
    online: "Portail en ligne",
    email: "Dépôt par email",
    paper: "Dépôt papier",
  };

  details.textContent = "";
  docs.textContent = "";

  if (!hasMairie) {
    if (status) {
      status.textContent = "Aucune mairie liée";
      status.style.background = "#fef3c7";
      status.style.color = "#92400e";
    }
    summary.textContent = "Aucune mairie n'est encore associée à ce lead. Le dossier peut être préparé, mais les consignes de dépôt restent à vérifier dans le module Mairies.";
    snDpAppendMairieField(details, "Action", "Lier une mairie depuis la fiche lead ou le module Mairies");
    snDpAppendMairieField(details, "Documents mairie", "À vérifier après association");
    return;
  }

  const name = snDpText(mairie.name, "Mairie liée");
  const cityLine = [mairie.postalCode, mairie.city].filter(Boolean).join(" ").trim();
  const portalType = portalLabels[mairie.portalType] || snDpText(mairie.portalType, "Mode de dépôt non renseigné");
  const accountStatus = accountLabels[mairie.accountStatus] || snDpText(mairie.accountStatus, "Statut compte non renseigné");
  const portalUrl = snDpText(mairie.portalUrl, "");
  const portalHref = snDpPortalHref(portalUrl);
  const email = snDpText(mairie.accountEmail, "");

  if (status) {
    status.textContent = accountStatus;
    status.style.background = mairie.accountStatus === "created" ? "#dcfce7" : "#fef3c7";
    status.style.color = mairie.accountStatus === "created" ? "#166534" : "#92400e";
  }
  summary.textContent = `${name}${cityLine ? " - " + cityLine : ""} · ${portalType}`;

  snDpAppendMairieField(details, "Mairie", name);
  snDpAppendMairieField(details, "Commune", cityLine || null);
  snDpAppendMairieField(details, "Mode de dépôt", portalType);
  snDpAppendMairieField(details, "Statut compte", accountStatus);
  snDpAppendMairieField(details, "URL portail", portalUrl || null, portalHref ? { href: portalHref } : null);
  snDpAppendMairieField(details, "Email portail", email || null, email ? { href: "mailto:" + email, target: "_self" } : null);
  snDpAppendMairieField(details, "Notes", mairie.notes || null);

  const expected = Array.isArray(mairie.expectedDocuments) ? mairie.expectedDocuments : [];
  if (!expected.length) {
    snDpAppendMairieField(docs, "Liste", "Aucun document attendu renseigné");
    return;
  }
  expected.forEach(function (doc) {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "auto 1fr auto";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.border = "1px solid #e5e7eb";
    row.style.borderRadius = "8px";
    row.style.padding = "8px 10px";
    row.style.background = "#fff";

    const mark = document.createElement("span");
    mark.textContent = doc.required === false ? "Optionnel" : "Requis";
    mark.style.fontSize = "12px";
    mark.style.fontWeight = "800";
    mark.style.color = doc.required === false ? "#4b5563" : "#991b1b";

    const label = document.createElement("span");
    label.textContent = snDpText(doc.label, doc.id || "Document mairie");
    label.style.color = "#111827";
    label.style.fontWeight = "650";

    const badge = document.createElement("span");
    badge.textContent = doc.id || "";
    badge.style.fontSize = "11px";
    badge.style.color = "#6b7280";

    row.appendChild(mark);
    row.appendChild(label);
    row.appendChild(badge);
    docs.appendChild(row);
  });
}

function bindDPCompleteAssemblyButton() {
  const btn = document.getElementById("dp-complete-assemble");
  if (!btn || btn.dataset.snDpCompleteBound === "1") return;
  btn.dataset.snDpCompleteBound = "1";
  btn.addEventListener("click", async function () {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Assemblage en cours...";
    try {
      if (typeof __solarnextDpFetchPdfWithReplace !== "function") {
        throw new Error("Module d'export PDF indisponible.");
      }
      await __solarnextDpFetchPdfWithReplace(
        "/pdf/render/dp-complet/pdf",
        function () {
          return {};
        },
        "dp_complet",
        function () {
          return __solarnextDpFallbackPdfName("dp_complet");
        }
      );
    } catch (e) {
      if (typeof window.__snDpAlert === "function") {
        window.__snDpAlert(e.message || "Impossible d'assembler le dossier DP complet.", {
          title: "Assemblage impossible",
          onRetry: function () {
            btn.click();
          },
        });
      }
    } finally {
      btn.disabled = false;
      btn.textContent = original || "Assembler dossier DP complet";
    }
  });
}

async function initDPGeneralOverview() {
  const list = document.getElementById("dp-completion-list");
  const count = document.getElementById("dp-completion-count");
  const summary = document.getElementById("dp-readiness-summary");
  const updatedAt = document.getElementById("dp-readiness-updated-at");
  const refresh = document.getElementById("dp-readiness-refresh");
  if (!list) return;
  renderDPMairiePanel();
  bindDPCompleteAssemblyButton();

  if (refresh && refresh.dataset.snDpReadinessBound !== "1") {
    refresh.dataset.snDpReadinessBound = "1";
    refresh.addEventListener("click", function () {
      void initDPGeneralOverview();
    });
  }

  function draft() {
    try {
      return window.DpDraftStore && typeof window.DpDraftStore.getDraft === "function"
        ? window.DpDraftStore.getDraft()
        : {};
    } catch (_) {
      return {};
    }
  }
  function dataUrl(v) {
    return typeof v === "string" && /^data:image\//i.test(v);
  }
  function anyDataUrl(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (Array.isArray(obj)) return obj.some(anyDataUrl);
    return Object.keys(obj).some(function (k) {
      const v = obj[k];
      if (dataUrl(v)) return true;
      return v && typeof v === "object" && anyDataUrl(v);
    });
  }
  function pickState(runtimeName, draftKey) {
    const d = draft();
    const runtime = window[runtimeName];
    if (runtime && typeof runtime === "object") return runtime;
    if (d && d[draftKey] && typeof d[draftKey] === "object") {
      return d[draftKey].state && typeof d[draftKey].state === "object" ? d[draftKey].state : d[draftKey];
    }
    return {};
  }
  function dp2HasCapture(s) {
    if (!s || typeof s !== "object") return false;
    if (dataUrl(s.capture_plan?.imageBase64) || dataUrl(s.capture?.imageBase64)) return true;
    const versions = Array.isArray(s.dp2Versions) ? s.dp2Versions : [];
    return versions.some(function (v) {
      const sj = v && v.state_json && typeof v.state_json === "object" ? v.state_json : {};
      return dataUrl(v?.snapshot_image) || dataUrl(sj.capture_plan?.imageBase64) || dataUrl(sj.capture?.imageBase64);
    });
  }
  function dp4HasPlan(plan) {
    return !!(
      plan &&
      typeof plan === "object" &&
      (
        anyDataUrl(plan.finalRender) ||
        anyDataUrl(plan.thumbnailBase64) ||
        anyDataUrl(plan.capture) ||
        (Array.isArray(plan.roofGeometry) && plan.roofGeometry.length > 0)
      )
    );
  }
  function status(id, label, ok, detail, opts) {
    const state = ok ? "ok" : opts?.unknown ? "unknown" : "todo";
    return {
      id,
      label,
      ok: !!ok,
      state,
      detail: detail || (ok ? "Complet" : opts?.unknown ? "À vérifier" : "À compléter"),
      action: opts?.action || null,
    };
  }
  function cerfaStatus() {
    const d = draft();
    const st = pickState("CERFA_STATE", "cerfa");
    const ctx = window.__SOLARNEXT_DP_CONTEXT__?.context || {};
    const identity = ctx.identity || {};
    const site = ctx.site || {};
    const dp1 = pickState("DP1_STATE", "dp1");
    const panelCount = st.panelCount;
    const panelPower = st.panelPower;
    const hasPanels = Number(panelCount) > 0 && Number(panelPower) > 0;
    const descriptionText =
      typeof window.__solarnextCerfaApi?.buildCerfaDescriptionText === "function"
        ? window.__solarnextCerfaApi.buildCerfaDescriptionText(st)
        : "";
    const city = site.city || identity.city || ctx.ville || "";
    const cp = site.postalCode || site.cp || ctx.cp || "";
    const name = identity.fullName || [identity.firstName, identity.lastName].filter(Boolean).join(" ") || ctx.nom || "";
    const destinationEnergie = st.energyManagement || "";
    let valid = !!(name && cp && city && hasPanels && descriptionText && destinationEnergie);
    let detail = valid ? "CERFA prêt à générer" : "Champs CERFA/projet encore incomplets";
    try {
      if (typeof window.__solarnextCerfaApi?.validateCerfaPreExport === "function") {
        const pre = window.__solarnextCerfaApi.validateCerfaPreExport({
          nom: name,
          cp,
          ville: city,
          descriptionText,
          puissanceKwc: hasPanels ? String((Number(panelCount) * Number(panelPower)) / 1000) : "",
          destinationEnergie,
          panelCount,
          panelPower,
          dp1State: dp1,
          phoneFormat: { warnings: [] },
        });
        valid = pre.errors.length === 0;
        if (!valid) detail = pre.errors.map((e) => e.message).join(" ; ");
        else if (pre.warnings.length) detail = "Prêt avec points à vérifier : " + pre.warnings.length;
      }
    } catch (_) {}
    if (d.cerfa && typeof d.cerfa === "object" && Object.keys(d.cerfa).length > 0 && valid) {
      detail = "CERFA renseigné et cohérent";
    }
    return status("cerfa", "CERFA OK", valid, detail, { action: "pages/cerfa.html" });
  }
  async function fetchLeadDocuments() {
    try {
      const ctx = window.__SOLARNEXT_DP_CONTEXT__ || {};
      const leadId = ctx.leadId;
      if (!leadId || typeof __solarnextDpAbsApiUrl !== "function") return { docs: [], checked: false };
      const res = await fetch(__solarnextDpAbsApiUrl("documents/lead/" + encodeURIComponent(leadId)), {
        method: "GET",
        headers: typeof __solarnextDpAuthHeadersBearerOnly === "function" ? __solarnextDpAuthHeadersBearerOnly() : {},
      });
      if (!res.ok) return { docs: [], checked: false };
      const data = await res.json();
      return { docs: Array.isArray(data) ? data : Array.isArray(data.documents) ? data.documents : [], checked: true };
    } catch (e) {
      console.warn("[DP readiness] documents mairie", e);
      return { docs: [], checked: false };
    }
  }
  function hasMairieDocFromContext() {
    const ctx = window.__SOLARNEXT_DP_CONTEXT__?.context || {};
    const d = draft();
    const pools = [ctx.documents, ctx.leadDocuments, d.documents, d.generatedPieces?.documents].filter(Array.isArray);
    return pools.some(function (arr) {
      return arr.some(function (doc) {
        const cat = String(doc.document_category || doc.documentCategory || "").toUpperCase();
        const type = String(doc.document_type || doc.documentType || "").toLowerCase();
        return cat === "DP_MAIRIE" || type === "dp_mairie";
      });
    });
  }

  list.innerHTML = "<div style=\"color:#6b7280\">Contrôle du dossier en cours...</div>";
  const d = draft();
  const docsResult = await fetchLeadDocuments();
  const mairieDocs =
    hasMairieDocFromContext() ||
    docsResult.docs.some(function (doc) {
      const cat = String(doc.document_category || doc.documentCategory || "").toUpperCase();
      const type = String(doc.document_type || doc.documentType || "").toLowerCase();
      return cat === "DP_MAIRIE" || type === "dp_mairie";
    });

  const mandat = (window.__MANDAT_SIGNATURE__ || d.mandat?.mandatSignature || {});
  const dp1 = pickState("DP1_STATE", "dp1");
  const dp2 = pickState("DP2_STATE", "dp2");
  const dp3 = pickState("DP3_STATE", "dp3");
  const dp4 = pickState("DP4_STATE", "dp4");
  const dp6 = pickState("DP6_STATE", "dp6");
  const dp7 = pickState("DP7_STATE", "dp7");
  const dp8 = pickState("DP8_STATE", "dp8");
  const dp1Images = d.dp1?.images || dp1.dp1SnapshotImages || {};
  const dp4Plans = dp4.plans || d.dp4?.state?.plans || {};

  const items = [
    status("mandat", "Mandat signé", !!(mandat.signed && mandat.signatureDataUrl), "Signature mandat requise avant dépôt", { action: "pages/mandat.html" }),
    status(
      "dp1",
      "DP1 OK",
      !!(dp1.isValidated && dp1.selectedParcel && (anyDataUrl(dp1Images) || anyDataUrl(dp1))),
      "Parcelle validée + plans DP1 générés",
      { action: "pages/dp1.html" }
    ),
    status("dp2", "DP2 OK", dp2HasCapture(dp2), "Plan de masse capturé/validé", { action: "pages/dp2.html" }),
    status("dp3", "DP3 OK", !!(dp3.hasDP3 && dataUrl(dp3.baseImage)), "Coupe DP3 validée", { action: "pages/dp3.html" }),
    status("dp4", "DP4 OK", dp4HasPlan(dp4Plans.before) && dp4HasPlan(dp4Plans.after), "Plans DP4 avant et après enregistrés", { action: "pages/dp4.html" }),
    status(
      "dp678",
      "DP6/7/8 OK",
      !!(
        dataUrl(dp6.beforeImage) &&
        dataUrl(dp6.afterImage) &&
        dp6.beforeImage !== dp6.afterImage &&
        dataUrl(dp7.finalImage) &&
        dataUrl(dp8.finalImage)
      ),
      "DP6 photomontage + DP7/DP8 vues validées",
      { action: "pages/dp6.html" }
    ),
    cerfaStatus(),
    status(
      "mairie-docs",
      "Documents mairie ajoutés",
      mairieDocs,
      mairieDocs ? "Au moins un document classé Dossier mairie" : docsResult.checked ? "Aucun document mairie trouvé sur ce lead" : "Documents CRM non vérifiables depuis cette session",
      { action: null, unknown: !docsResult.checked && !mairieDocs }
    ),
  ];

  const done = items.filter((it) => it.ok).length;
  const blocking = items.filter((it) => !it.ok && it.state !== "unknown").length;
  const allReady = done === items.length;
  window.__SN_DP_READINESS_REPORT__ = {
    ready: allReady,
    done,
    total: items.length,
    blocking,
    checkedAt: new Date().toISOString(),
    items,
  };

  list.innerHTML = items
    .map(function (it) {
      const color = it.state === "ok" ? "#166534" : it.state === "unknown" ? "#92400e" : "#991b1b";
      const bg = it.state === "ok" ? "#f0fdf4" : it.state === "unknown" ? "#fffbeb" : "#fef2f2";
      const border = it.state === "ok" ? "#bbf7d0" : it.state === "unknown" ? "#fde68a" : "#fecaca";
      const label = it.state === "ok" ? "OK" : it.state === "unknown" ? "À vérifier" : "À faire";
      return `
        <div class="dp-readiness-row" data-status="${it.state}" style="display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:flex-start;border:1px solid ${border};background:${bg};border-radius:8px;padding:10px 12px;">
          <span style="font-weight:800;color:${color};min-width:72px;">${label}</span>
          <div>
            <div style="font-weight:700;color:#111827;">${it.label}</div>
            <div style="font-size:13px;color:#4b5563;white-space:pre-wrap;">${it.detail}</div>
          </div>
        </div>`;
    })
    .join("");

  if (count) {
    count.textContent = allReady ? "Prêt à déposer" : `${done}/${items.length} OK`;
    count.style.background = allReady ? "#dcfce7" : "#fef3c7";
    count.style.color = allReady ? "#166534" : "#92400e";
  }
  if (summary) {
    summary.textContent = allReady
      ? "Toutes les pièces obligatoires sont prêtes pour le dépôt."
      : `${blocking} point${blocking > 1 ? "s" : ""} bloquant${blocking > 1 ? "s" : ""} avant dépôt.`;
  }
  if (updatedAt) {
    updatedAt.textContent = "Dernière vérification : " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
}

function initInjectedPage(page) {
  if (page.endsWith("general.html")) {
    initDPGeneralOverview();
  } else
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
    if (pagePath && pagePath.endsWith("general.html")) {
      try { initDPGeneralOverview(); } catch (_) {}
    }
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

// DP feature blocks are loaded after this shell in their historical order.
