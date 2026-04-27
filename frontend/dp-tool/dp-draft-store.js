/**
 * Brouillon DP — source de vérité unique : lead_dp.state_json (backend).
 * Schéma plat : general, mandat, dp1…dp8, cerfa, generatedPieces, progression (+ meta, timestamps).
 * Ancien format imbriqué sous `dp.dp1`… est migré à la volée.
 *
 * Logs : détail via devLog/devWarn uniquement si window.__SN_DP_DEV_MODE === true.
 * En prod : console.warn réservé aux échecs persistants de sauvegarde et à l’arrêt d’accès (403).
 *
 * Images DP1 : voir dp1-image-persist.js (compression + conversion blob → JPEG avant PUT).
 * Échec sérialisation / préparation images : sauvegarde bloquée (jamais brouillon minimal envoyé au serveur).
 */
(function (global) {
  /** @type {object | null} */
  var DP_DRAFT = null;

  /** Un seul timer : dernier événement (normal vs rapide) gagne. */
  var persistTimer = null;
  var DEBOUNCE_MS = 1000;
  var INPUT_DEBOUNCE_MS = 350;
  var saveState = "idle";

  var isSaving = false;
  var pendingSave = false;
  var MAX_RETRIES = 2;
  /** Timeout réseau PUT (ms) — pas de blocage UI : fetch async + AbortController. */
  var PUT_TIMEOUT_MS = 8000;
  function isDevMode() {
    return global.__SN_DP_DEV_MODE === true;
  }

  /** Trace exécutable PUT DP : activer `window.__SN_DP_PUT_TRACE__ = true` ou `window.__SN_DP_TRACE__ = true` puis reproduire. */
  function dpPutTraceEnabled() {
    return global.__SN_DP_PUT_TRACE__ === true || global.__SN_DP_TRACE__ === true;
  }

  function emitDpPutTrace(event, payload) {
    if (!dpPutTraceEnabled()) return;
    try {
      var row = { ts: new Date().toISOString(), event: String(event || "") };
      if (payload && typeof payload === "object") {
        var k;
        for (k in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, k)) row[k] = payload[k];
        }
      }
      console.warn("[SN-DP-PUT-TRACE]", JSON.stringify(row));
      global.__SN_DP_PUT_TRACE_LOG__ = global.__SN_DP_PUT_TRACE_LOG__ || [];
      global.__SN_DP_PUT_TRACE_LOG__.push(row);
      if (global.__SN_DP_PUT_TRACE_LOG__.length > 100) global.__SN_DP_PUT_TRACE_LOG__.shift();
    } catch (_) {}
  }

  function summarizeDraftForTrace(d) {
    try {
      if (!d || typeof d !== "object") return { draftType: typeof d };
      var d1 = d.dp1;
      var im = d1 && d1.images;
      return {
        schemaVersion: d.schemaVersion,
        sectionKeys: Object.keys(d).filter(function (x) {
          return x !== "meta" && x !== "timestamps" && x !== "progression";
        }),
        dp1HasImages: !!(
          im &&
          (im.view_20000 || im.view_5000 || im.view_650)
        ),
        dp1ImageLens: im
          ? {
              view_20000: im.view_20000 ? String(im.view_20000).length : 0,
              view_5000: im.view_5000 ? String(im.view_5000).length : 0,
              view_650: im.view_650 ? String(im.view_650).length : 0,
            }
          : null,
      };
    } catch (e) {
      return { summarizeError: String(e && e.message) };
    }
  }

  function devLog() {
    if (!isDevMode()) return;
    try {
      console.log.apply(console, arguments);
    } catch (_) {}
  }

  function devWarn() {
    if (!isDevMode()) return;
    try {
      console.warn.apply(console, arguments);
    } catch (_) {}
  }

  function isDraftStoreFrozen() {
    return !!global.__SN_DP_INIT_BLOCKED;
  }

  /** CRM embed + contexte lead requis (sauf __SN_DP_DEV_MODE). */
  function crmGateOk() {
    if (global.__SN_DP_DEV_MODE === true) return true;
    var c = global.__SOLARNEXT_DP_CONTEXT__;
    if (!c || !c.leadId) return false;
    return global.__SOLARNEXT_DP_CRM_EMBED === true;
  }

  /** Persistance API coupée (403 métier, etc.) — autosave = no-op. */
  function isPersistenceDisabled() {
    return !!global.__SN_DP_PERSISTENCE_DISABLED;
  }

  /**
   * Arrêt définitif des PUT / autosave (règle métier ou accès refusé).
   */
  function disablePersistence(reason, code) {
    if (global.__SN_DP_PERSISTENCE_DISABLED) return;
    global.__SN_DP_PERSISTENCE_DISABLED = true;
    clearPersistTimer();
    isSaving = false;
    pendingSave = false;
    try {
      global.__SN_DP_TRACE_LAST_DISABLE__ = {
        at: new Date().toISOString(),
        reason: reason != null ? String(reason) : null,
        code: code != null ? String(code) : null,
      };
    } catch (_) {}
    emitDpPutTrace("persistence_disabled", {
      reason: reason != null ? String(reason) : null,
      code: code != null ? String(code) : null,
      leadId: global.__SOLARNEXT_DP_CONTEXT__ && global.__SOLARNEXT_DP_CONTEXT__.leadId,
      source: "disablePersistence",
    });
    var codeStr = code != null ? String(code) : "";
    var reasonStr = reason != null ? String(reason) : "";
    console.warn(
      "[DP ACCESS BLOCKED] Persistance arrêtée" + (codeStr ? " — " + codeStr : "") + (reasonStr ? " — " + reasonStr : "")
    );
    if (
      codeStr === "HTTP_403" ||
      codeStr === "DP_LEAD_NOT_CLIENT" ||
      codeStr === "SUPER_ADMIN_READ_ONLY"
    ) {
      console.warn(
        "[DP] Sauvegarde brouillon désactivée jusqu’au rechargement de la page. Un PUT /api/leads/:id/dp a été refusé (403). Vérifier l’onglet Réseau → réponse JSON (error, code). Si code « DP_LEAD_NOT_CLIENT » : le lead n’est pas éligible au dossier DP (backend : status CLIENT ou project_status SIGNE | DP_A_DEPOSER). Sinon : auth, organisation, ou en-têtes super-admin."
      );
    }
    setSaveUi(
      "blocked",
      "Sauvegarde désactivée — rechargez la page ou vérifiez les droits."
    );
    try {
      var root = document.getElementById("dp-tool-root");
      if (root) root.setAttribute("data-dp-persistence", "blocked");
    } catch (_) {}
  }

  var SCHEMA_VERSION = 2;

  var SECTION_KEYS = [
    "general",
    "mandat",
    "dp1",
    "dp2",
    "dp3",
    "dp4",
    "dp5",
    "dp6",
    "dp7",
    "dp8",
    "cerfa",
  ];

  function getAuthHeaders() {
    var token =
      typeof localStorage !== "undefined" ? localStorage.getItem("solarnext_token") : null;
    var h = { "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    if (typeof global.__solarnextDpApplySuperAdminContextHeaders === "function") {
      global.__solarnextDpApplySuperAdminContextHeaders(h);
    }
    return h;
  }

  function resolvePutUrl() {
    var ctx = global.__SOLARNEXT_DP_CONTEXT__;
    if (!ctx || !ctx.leadId) return null;
    var origin = "";
    if (global.__SOLARNEXT_API_BASE__ != null && String(global.__SOLARNEXT_API_BASE__).trim()) {
      origin = String(global.__SOLARNEXT_API_BASE__).replace(/\/$/, "");
    } else if (global.location && global.location.origin) {
      origin = global.location.origin;
    }
    if (!origin) return null;
    var base = /\/api$/i.test(origin) ? origin : origin + "/api";
    return base + "/leads/" + encodeURIComponent(String(ctx.leadId)) + "/dp";
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /** Retire les clés préfixées _ (états éphémères) pour sérialisation JSON. */
  function cloneStateForDraft(obj) {
    if (obj == null || typeof obj !== "object") return obj;
    try {
      var s = JSON.stringify(obj, function (key, val) {
        if (key.indexOf("_") === 0) return undefined;
        if (val === undefined) return undefined;
        if (typeof val === "function") return undefined;
        return val;
      });
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  function isPlainObjectForMerge(x) {
    return x != null && typeof x === "object" && !Array.isArray(x);
  }

  /** Valeur « absente » côté brouillon : ne doit pas écraser le CRM (client, identity, etc.). */
  function isDraftMergeMissing(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === "string" && String(v).trim() === "") return true;
    return false;
  }

  /**
   * Fusion profonde CRM ← brouillon : une clé du draft n’écrase le CRM que si sa valeur est présente.
   * Évite de remplacer tout `client` par un objet partiel (perte nom, naissance, adresse…).
   */
  function mergeSafeDeep(crm, draft, depth) {
    var d = depth == null ? 0 : depth;
    if (d > 25) return cloneStateForDraft(crm) || {};
    if (draft == null || typeof draft !== "object" || Array.isArray(draft)) {
      if (isDraftMergeMissing(draft)) return cloneStateForDraft(crm) || {};
      return draft;
    }
    var base = cloneStateForDraft(crm);
    if (base == null || typeof base !== "object" || Array.isArray(base)) {
      if (isDraftMergeMissing(draft)) return Array.isArray(base) ? base : base != null ? base : {};
      return draft;
    }
    var out = {};
    var kb;
    for (kb in base) {
      if (Object.prototype.hasOwnProperty.call(base, kb)) out[kb] = base[kb];
    }
    var kd;
    for (kd in draft) {
      if (!Object.prototype.hasOwnProperty.call(draft, kd)) continue;
      var dv = draft[kd];
      if (isDraftMergeMissing(dv)) continue;
      var bv = out[kd];
      if (isPlainObjectForMerge(dv) && isPlainObjectForMerge(bv)) {
        out[kd] = mergeSafeDeep(bv, dv, d + 1);
      } else {
        out[kd] = dv;
      }
    }
    return out;
  }

  /**
   * Clone JSON pour PUT : pas de undefined, pas de fonctions, pas de clés _.
   * Ne renvoie jamais un brouillon minimal en cas d’erreur (bloquer la sauvegarde à la place).
   * @returns {{ ok: true, draft: object } | { ok: false, error: string, code: string }}
   */
  function sanitizeDraftForPersist(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {
        ok: false,
        error: "Brouillon absent ou invalide — impossible d’enregistrer.",
        code: "DP_DRAFT_MISSING",
      };
    }
    try {
      var cleaned = JSON.parse(
        JSON.stringify(input, function (key, val) {
          if (String(key).indexOf("_") === 0) return undefined;
          if (val === undefined) return undefined;
          if (typeof val === "function") return undefined;
          return val;
        })
      );
      ensureDraftShape(cleaned);
      var blobCheck = rejectBlobUrlsInDraftForPut(cleaned);
      if (!blobCheck.ok) return blobCheck;
      return { ok: true, draft: cleaned };
    } catch (e) {
      devWarn("[dp-draft] sanitizeDraftForPersist — échec sérialisation", e);
      return {
        ok: false,
        error:
          "Impossible de préparer le brouillon pour le serveur (données non sérialisables). Vérifiez les pièces jointes ou rechargez la page.",
        code: "DP_DRAFT_SERIALIZE_FAILED",
      };
    }
  }

  /**
   * blob: ne doit jamais être envoyé au backend (URLs invalides après reload).
   */
  function rejectBlobUrlsInDraftForPut(d) {
    try {
      var d1 = d && d.dp1;
      if (!d1 || typeof d1 !== "object" || !d1.images || typeof d1.images !== "object") {
        return { ok: true };
      }
      var im = d1.images;
      var keys = ["view_20000", "view_5000", "view_650"];
      for (var ki = 0; ki < keys.length; ki++) {
        var u = im[keys[ki]];
        if (typeof u === "string" && u.indexOf("blob:") === 0) {
          return {
            ok: false,
            error:
              "Une image DP1 est encore une URL temporaire (blob). Patientez la fin de la préparation ou ouvrez l’étape DP1 puis enregistrez à nouveau.",
            code: "DP1_BLOB_IN_DRAFT",
          };
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), code: "DP1_BLOB_CHECK_FAILED" };
    }
  }

  function createEmptySections() {
    var o = {};
    for (var i = 0; i < SECTION_KEYS.length; i++) {
      o[SECTION_KEYS[i]] = {};
    }
    return o;
  }

  function createMinimalDraft() {
    var ctx = global.__SOLARNEXT_DP_CONTEXT__ || {};
    var t = nowIso();
    var sections = createEmptySections();
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        leadId: ctx.leadId || null,
        organizationId: null,
        clientId: ctx.clientId != null ? ctx.clientId : null,
        createdAt: t,
        updatedAt: t,
        lastSavedByUserId: null,
        source: "dp-tool",
      },
      progression: {
        currentPageId: "general",
        visitedPageIds: [],
        completionHints: {},
      },
      timestamps: {
        lastAutosaveAt: null,
        lastFullRestoreAt: null,
      },
      general: sections.general,
      mandat: sections.mandat,
      dp1: null,
      dp2: null,
      dp3: null,
      dp4: null,
      dp5: sections.dp5,
      dp6: null,
      dp7: null,
      dp8: null,
      cerfa: sections.cerfa,
      generatedPieces: {},
    };
  }

  /**
   * Migre draft.dp.* vers clés plates ; normalise generatedPieces ; conserve compat GET anciens enregistrements.
   */
  function migrateLegacyDraftShape(d) {
    if (!d || typeof d !== "object") return;
    var legacy = d.dp;
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      if (legacy.dp1 != null && d.dp1 == null) d.dp1 = legacy.dp1;
      if (legacy.dp2 != null && d.dp2 == null) d.dp2 = legacy.dp2;
      if (legacy.dp3 != null && d.dp3 == null) d.dp3 = legacy.dp3;
      if (legacy.dp4 != null && d.dp4 == null) d.dp4 = legacy.dp4;
      if (legacy.dp5 != null && (d.dp5 == null || Object.keys(d.dp5 || {}).length === 0)) d.dp5 = legacy.dp5;
      if (legacy.dp6 != null && d.dp6 == null) d.dp6 = legacy.dp6;
      if (legacy.dp7 != null && d.dp7 == null) d.dp7 = legacy.dp7;
      if (legacy.dp8 != null && d.dp8 == null) d.dp8 = legacy.dp8;
      try {
        delete d.dp;
      } catch (_) {
        d.dp = undefined;
      }
    }
    if (Array.isArray(d.generatedPieces)) {
      d.generatedPieces = { items: d.generatedPieces.slice() };
    }
    if (d.generatedPieces == null || typeof d.generatedPieces !== "object" || Array.isArray(d.generatedPieces)) {
      d.generatedPieces = {};
    }
  }

  function ensureDraftShape(d) {
    if (!d || typeof d !== "object") return;
    migrateLegacyDraftShape(d);
    if (typeof d.schemaVersion !== "number") d.schemaVersion = SCHEMA_VERSION;
    d.meta = d.meta && typeof d.meta === "object" ? d.meta : {};
    d.progression = d.progression && typeof d.progression === "object" ? d.progression : {};
    if (typeof d.progression.currentPageId !== "string") d.progression.currentPageId = "general";
    if (!Array.isArray(d.progression.visitedPageIds)) d.progression.visitedPageIds = [];
    if (!d.progression.completionHints || typeof d.progression.completionHints !== "object") {
      d.progression.completionHints = {};
    }
    d.timestamps = d.timestamps && typeof d.timestamps === "object" ? d.timestamps : {};
    if (!d.general || typeof d.general !== "object" || Array.isArray(d.general)) d.general = {};
    if (!d.mandat || typeof d.mandat !== "object" || Array.isArray(d.mandat)) d.mandat = {};
    if (!d.dp5 || typeof d.dp5 !== "object" || Array.isArray(d.dp5)) d.dp5 = {};
    if (!d.cerfa || typeof d.cerfa !== "object" || Array.isArray(d.cerfa)) d.cerfa = {};
    if (d.generatedPieces == null || typeof d.generatedPieces !== "object" || Array.isArray(d.generatedPieces)) {
      d.generatedPieces = {};
    }
    repairNullableDpSections(d);
  }

  /** dp1–dp8 : null ou objet plain ; invalide → null (intégrité après GET ou merge). */
  function repairNullableDpSections(d) {
    if (!d || typeof d !== "object") return;
    var nullable = ["dp1", "dp2", "dp3", "dp4", "dp6", "dp7", "dp8"];
    for (var i = 0; i < nullable.length; i++) {
      var k = nullable[i];
      var v = d[k];
      if (v == null) continue;
      if (typeof v !== "object" || Array.isArray(v)) d[k] = null;
    }
  }

  function writeDraftMirrorLocal() {
    try {
      if (typeof global.__solarnextWriteScopedStorage === "function" && DP_DRAFT) {
        global.__solarnextWriteScopedStorage("draft_snapshot", JSON.stringify(DP_DRAFT));
      }
    } catch (_) {}
  }

  function syncContextWindowDraft() {
    try {
      if (global.__SOLARNEXT_DP_CONTEXT__ && DP_DRAFT) {
        global.__SOLARNEXT_DP_CONTEXT__.draft = DP_DRAFT;
      }
    } catch (_) {}
  }

  function setSaveUi(kind, message) {
    var el = document.getElementById("dp-draft-save-status");
    if (!el) return;
    el.classList.remove(
      "dp-draft-save-status--saving",
      "dp-draft-save-status--saved",
      "dp-draft-save-status--error",
      "dp-draft-save-status--blocked"
    );
    var msg = message != null && String(message).trim() ? String(message).trim() : "";
    if (kind === "saving") {
      el.textContent = "Enregistrement…";
      el.classList.add("dp-draft-save-status--saving");
    } else if (kind === "saved") {
      el.textContent = "Enregistré";
      el.classList.add("dp-draft-save-status--saved");
    } else if (kind === "error") {
      el.textContent = msg || "Erreur d’enregistrement";
      el.classList.add("dp-draft-save-status--error");
    } else if (kind === "blocked") {
      el.textContent =
        msg ||
        "Sauvegarde désactivée — rechargez la page ou vérifiez les droits.";
      el.classList.add("dp-draft-save-status--blocked");
    } else {
      el.textContent = "";
    }
  }

  function isDp1ImageSrcStorable(src) {
    if (!src || typeof src !== "string") return false;
    var s = src.trim();
    if (s.indexOf("data:image") === 0) return true;
    if (/^https?:\/\//i.test(s)) return true;
    if (/^blob:/i.test(s)) return true;
    return false;
  }

  function collectDp1ImagesFromDom() {
    var out = {};
    try {
      if (!global.document || !global.document.querySelector) return out;
      var s1 = global.document.querySelector('[data-slot="dp1-view-1"] img');
      var s2 = global.document.querySelector('[data-slot="dp1-view-2"] img');
      var s3 = global.document.querySelector('[data-slot="dp1-view-3"] img');
      if (s1 && s1.src && isDp1ImageSrcStorable(s1.src)) out.view_20000 = s1.src;
      if (s2 && s2.src && isDp1ImageSrcStorable(s2.src)) out.view_5000 = s2.src;
      if (s3 && s3.src && isDp1ImageSrcStorable(s3.src)) out.view_650 = s3.src;
    } catch (_) {}
    return out;
  }

  function snapshotDp1StateForDraft() {
    var s = global.DP1_STATE;
    if (!s || typeof s !== "object") return {};
    var out = {
      currentMode: s.currentMode != null ? s.currentMode : "strict",
      isValidated: !!s.isValidated,
      selectedParcel: null,
      lastCentroid: s.lastCentroid || null,
      currentPoint: s.currentPoint || null,
    };
    try {
      if (Array.isArray(s.dp1Versions)) {
        out.dp1Versions = JSON.parse(JSON.stringify(s.dp1Versions));
      }
      if (s.dp1ActiveVersionId != null && s.dp1ActiveVersionId !== "") {
        out.dp1ActiveVersionId = s.dp1ActiveVersionId;
      }
      if (s.dp1SnapshotImages && typeof s.dp1SnapshotImages === "object") {
        out.dp1SnapshotImages = JSON.parse(JSON.stringify(s.dp1SnapshotImages));
      }
    } catch (_) {}
    if (s.selectedParcel != null && typeof s.selectedParcel === "object") {
      try {
        out.selectedParcel = JSON.parse(JSON.stringify(s.selectedParcel));
      } catch (e) {
        try {
          var p = s.selectedParcel;
          var fallback = {
            section: p.section,
            numero: p.numero != null ? String(p.numero) : undefined,
            parcelle: p.parcelle != null ? String(p.parcelle) : undefined,
            parcel: p.parcel != null ? String(p.parcel) : undefined,
            commune: p.commune,
            surface_m2: p.surface_m2 != null ? Number(p.surface_m2) : null,
            surface: p.surface != null ? p.surface : null,
          };
          if (p.geometry != null) {
            fallback.geometry = JSON.parse(JSON.stringify(p.geometry));
          }
          out.selectedParcel = fallback;
        } catch (e2) {
          devWarn("[dp-draft] snapshotDp1StateForDraft parcelle", e2);
        }
      }
    }
    return out;
  }

  function getDraftDp1Fragment() {
    if (!DP_DRAFT) return {};
    return DP_DRAFT.dp1 || (DP_DRAFT.dp && DP_DRAFT.dp.dp1) || {};
  }

  /**
   * Fusionne l’état runtime dans DP_DRAFT (toutes sections métier).
   */
  function syncRuntimeIntoDraft() {
    if (isDraftStoreFrozen()) return;
    if (!DP_DRAFT) initDraftFromServer(null);
    ensureDraftShape(DP_DRAFT);

    try {
      DP_DRAFT.general = cloneStateForDraft(global.DP_GENERAL_STATE || {}) || {};
    } catch (e) {
      devWarn("[dp-draft] snapshot general", e);
    }

    try {
      var mandatPayload = Object.assign({}, DP_DRAFT.mandat || {});
      if (global.SMARTPITCH_CTX && typeof global.SMARTPITCH_CTX === "object") {
        mandatPayload.smartpitchCtx = cloneStateForDraft(global.SMARTPITCH_CTX);
      }
      if (global.__MANDAT_SIGNATURE__ && typeof global.__MANDAT_SIGNATURE__ === "object") {
        mandatPayload.mandatSignature = cloneStateForDraft(global.__MANDAT_SIGNATURE__);
      }
      DP_DRAFT.mandat = mandatPayload;
    } catch (e) {
      devWarn("[dp-draft] snapshot mandat", e);
    }

    try {
      if (global.DP1_STATE) {
        var prevD1 = getDraftDp1Fragment();
        var prevImgs = prevD1.images && typeof prevD1.images === "object" ? prevD1.images : {};
        var imgsDom = collectDp1ImagesFromDom();
        var imgs = {
          view_20000: imgsDom.view_20000 || prevImgs.view_20000,
          view_5000: imgsDom.view_5000 || prevImgs.view_5000,
          view_650: imgsDom.view_650 || prevImgs.view_650,
        };
        try {
          global.DP1_STATE.dp1SnapshotImages = {
            view_20000: imgs.view_20000 || null,
            view_5000: imgs.view_5000 || null,
            view_650: imgs.view_650 || null,
          };
        } catch (_) {}
        var newState = snapshotDp1StateForDraft();
        var prevState = prevD1.state && typeof prevD1.state === "object" ? prevD1.state : {};
        var mergedState = Object.assign({}, prevState, newState);
        if (
          (!newState.selectedParcel ||
            (!newState.selectedParcel.section &&
              !newState.selectedParcel.numero &&
              !newState.selectedParcel.parcel)) &&
          prevState.selectedParcel
        ) {
          mergedState.selectedParcel = prevState.selectedParcel;
        }
        if ((newState.lastCentroid == null || newState.currentPoint == null) && prevState.lastCentroid) {
          if (newState.lastCentroid == null) mergedState.lastCentroid = prevState.lastCentroid;
          if (newState.currentPoint == null) mergedState.currentPoint = prevState.currentPoint;
        }
        if (
          (!newState.dp1Versions || !newState.dp1Versions.length) &&
          prevState.dp1Versions &&
          prevState.dp1Versions.length
        ) {
          mergedState.dp1Versions = prevState.dp1Versions;
          if (newState.dp1ActiveVersionId == null && prevState.dp1ActiveVersionId != null) {
            mergedState.dp1ActiveVersionId = prevState.dp1ActiveVersionId;
          }
        }
        try {
          if (global.DP1_STATE && Object.prototype.hasOwnProperty.call(global.DP1_STATE, "selectedParcel")) {
            var liveSp = global.DP1_STATE.selectedParcel;
            if (liveSp === null) {
              mergedState.selectedParcel = null;
            } else if (liveSp != null && typeof liveSp === "object") {
              mergedState.selectedParcel = JSON.parse(JSON.stringify(liveSp));
            }
          }
        } catch (spE) {
          devWarn("[dp-draft] snapshot dp1 selectedParcel runtime", spE);
        }
        DP_DRAFT.dp1 = {
          state: mergedState,
          context: global.DP1_CONTEXT ? JSON.parse(JSON.stringify(global.DP1_CONTEXT)) : null,
          images: imgs,
        };
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp1", e);
    }

    try {
      if (typeof global.dp2SyncActiveVersionBeforeDraft === "function") {
        try {
          global.dp2SyncActiveVersionBeforeDraft();
        } catch (e2) {
          devWarn("[dp-draft] dp2SyncActiveVersionBeforeDraft", e2);
        }
      }
      if (global.DP2_STATE) {
        DP_DRAFT.dp2 = cloneStateForDraft(global.DP2_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp2", e);
    }

    try {
      if (global.snDpV && typeof global.snDpV.syncAllForDraft === "function") {
        global.snDpV.syncAllForDraft();
      }
    } catch (e) {
      devWarn("[dp-draft] snDpV.syncAllForDraft", e);
    }

    try {
      if (global.DP3_STATE) {
        DP_DRAFT.dp3 = cloneStateForDraft(global.DP3_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp3", e);
    }

    try {
      if (typeof global.__snDpGetDp4SnapshotForDraft === "function") {
        DP_DRAFT.dp4 = global.__snDpGetDp4SnapshotForDraft();
      } else if (global.DP4_STATE) {
        DP_DRAFT.dp4 = { state: cloneStateForDraft(global.DP4_STATE), finalRenders: null };
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp4", e);
    }

    try {
      if (global.DP5_STATE && typeof global.DP5_STATE === "object") {
        var c5 = cloneStateForDraft(global.DP5_STATE);
        if (c5 && typeof c5 === "object") DP_DRAFT.dp5 = c5;
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp5", e);
    }

    try {
      if (global.DP6_STATE) {
        DP_DRAFT.dp6 = cloneStateForDraft(global.DP6_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp6", e);
    }

    try {
      if (global.DP7_STATE) {
        DP_DRAFT.dp7 = cloneStateForDraft(global.DP7_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp7", e);
    }

    try {
      if (global.DP8_STATE) {
        DP_DRAFT.dp8 = cloneStateForDraft(global.DP8_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dp8", e);
    }

    try {
      if (global.CERFA_STATE && typeof global.CERFA_STATE === "object") {
        DP_DRAFT.cerfa = cloneStateForDraft(global.CERFA_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot cerfa", e);
    }

    try {
      if (global.DP_VIEW_LOCK && typeof global.DP_VIEW_LOCK === "object") {
        DP_DRAFT.dpViewLock = cloneStateForDraft(global.DP_VIEW_LOCK);
      }
    } catch (e) {
      devWarn("[dp-draft] snapshot dpViewLock", e);
    }

    DP_DRAFT.schemaVersion = SCHEMA_VERSION;
    DP_DRAFT.meta.updatedAt = nowIso();
    DP_DRAFT.timestamps.lastAutosaveAt = nowIso();
    try {
      syncContextWindowDraft();
      writeDraftMirrorLocal();
    } catch (_) {}
  }

  function draftFragmentDp1(d) {
    if (!d || typeof d !== "object") return null;
    return d.dp1 || (d.dp && d.dp.dp1) || null;
  }

  function draftHasDp1Content(d) {
    try {
      var d1 = draftFragmentDp1(d);
      if (!d1) return false;
      if (
        d1.state &&
        d1.state.selectedParcel &&
        (d1.state.selectedParcel.section || d1.state.selectedParcel.numero || d1.state.selectedParcel.parcel)
      )
        return true;
      if (d1.images && (d1.images.view_20000 || d1.images.view_5000 || d1.images.view_650)) return true;
    } catch (_) {}
    return false;
  }

  /** Complète le brouillon serveur depuis le cache local (secondaire), sans remplacer la source de vérité backend. */
  function mergeLocalDraftSnapshotIfNeeded() {
    try {
      if (global.__SN_DP_SERVER_DRAFT_ACTIVE) return;
      if (typeof global.__solarnextReadScopedStorage !== "function" || !DP_DRAFT) return;
      var raw = global.__solarnextReadScopedStorage("draft_snapshot");
      if (!raw) return;
      var loc = JSON.parse(raw);
      if (!loc || typeof loc !== "object") return;
      ensureDraftShape(loc);
      if (!draftHasDp1Content(loc)) return;
      if (draftHasDp1Content(DP_DRAFT)) return;
      if (loc.dp1) DP_DRAFT.dp1 = loc.dp1;
      else if (loc.dp && loc.dp.dp1) DP_DRAFT.dp1 = loc.dp.dp1;
      ensureDraftShape(DP_DRAFT);
      syncContextWindowDraft();
      writeDraftMirrorLocal();
      try {
        schedulePersist(false);
      } catch (_) {}
    } catch (e) {
      devWarn("[dp-draft] mergeLocalDraftSnapshotIfNeeded", e);
    }
  }

  function initDraftFromServer(serverDraft) {
    if (isDraftStoreFrozen()) return;
    global.__SN_DP_SERVER_DRAFT_ACTIVE =
      serverDraft != null && typeof serverDraft === "object" && !Array.isArray(serverDraft);
    var base = createMinimalDraft();
    if (serverDraft && typeof serverDraft === "object" && !Array.isArray(serverDraft)) {
      DP_DRAFT = Object.assign({}, base, serverDraft);
      DP_DRAFT.meta = Object.assign({}, base.meta, serverDraft.meta || {}, {
        leadId: base.meta.leadId,
        clientId: base.meta.clientId,
      });
      DP_DRAFT.progression = Object.assign({}, base.progression, serverDraft.progression || {});
      DP_DRAFT.timestamps = Object.assign({}, base.timestamps, serverDraft.timestamps || {});
    } else {
      DP_DRAFT = base;
    }
    ensureDraftShape(DP_DRAFT);
    mergeLocalDraftSnapshotIfNeeded();
    syncContextWindowDraft();
    writeDraftMirrorLocal();
    if (isPersistenceDisabled()) {
      setSaveUi(
        "blocked",
        "Sauvegarde désactivée — rechargez la page ou vérifiez les droits."
      );
    } else {
      setSaveUi("idle");
    }
  }

  function getDraft() {
    return DP_DRAFT;
  }

  function updateDraft(partial) {
    if (isDraftStoreFrozen()) return;
    if (!DP_DRAFT) initDraftFromServer(null);
    if (!partial || typeof partial !== "object") return;
    if (partial.meta && typeof partial.meta === "object") {
      Object.assign(DP_DRAFT.meta, partial.meta);
    }
    if (partial.progression && typeof partial.progression === "object") {
      Object.assign(DP_DRAFT.progression, partial.progression);
    }
    var pk;
    for (pk in partial) {
      if (!Object.prototype.hasOwnProperty.call(partial, pk)) continue;
      if (
        pk === "meta" ||
        pk === "progression" ||
        pk === "timestamps" ||
        pk === "schemaVersion"
      )
        continue;
      if (pk === "dp" && partial.dp && typeof partial.dp === "object") {
        var legacy = partial.dp;
        var k;
        for (k in legacy) {
          if (Object.prototype.hasOwnProperty.call(legacy, k) && legacy[k] !== undefined) {
            DP_DRAFT[k] = legacy[k];
          }
        }
        continue;
      }
      if (SECTION_KEYS.indexOf(pk) !== -1 || pk.indexOf("dp") === 0 || pk === "cerfa" || pk === "generatedPieces") {
        if (partial[pk] !== undefined) DP_DRAFT[pk] = partial[pk];
      }
    }
    if (partial.timestamps && typeof partial.timestamps === "object") {
      Object.assign(DP_DRAFT.timestamps, partial.timestamps);
    }
    ensureDraftShape(DP_DRAFT);
    syncContextWindowDraft();
    writeDraftMirrorLocal();
  }

  function mapPathToPageId(pagePath) {
    var p = String(pagePath || "");
    var map = {
      "pages/general.html": "general",
      "pages/mandat.html": "mandat",
      "pages/dp1.html": "dp1",
      "pages/dp2.html": "dp2",
      "pages/dp3.html": "dp3",
      "pages/dp4.html": "dp4",
      "pages/dp6.html": "dp6",
      "pages/dp7.html": "dp7",
      "pages/dp8.html": "dp8",
      "pages/cerfa.html": "cerfa",
    };
    return map[p] || "general";
  }

  function setCurrentPage(pageId) {
    if (isDraftStoreFrozen()) return;
    if (!DP_DRAFT) initDraftFromServer(null);
    DP_DRAFT.progression.currentPageId = pageId;
    syncContextWindowDraft();
    writeDraftMirrorLocal();
  }

  function markVisited(pageId) {
    if (isDraftStoreFrozen()) return;
    if (!DP_DRAFT) initDraftFromServer(null);
    var arr = DP_DRAFT.progression.visitedPageIds || [];
    if (arr.indexOf(pageId) === -1) {
      arr.push(pageId);
      DP_DRAFT.progression.visitedPageIds = arr;
    }
    syncContextWindowDraft();
    writeDraftMirrorLocal();
  }

  function clearPersistTimer() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  }

  /**
   * Entrée unique d’autosave (debounce) — même pipeline que le calpinage.
   * @param {boolean|string} [fast] — true / "fast" : délai court (saisie texte).
   */
  function schedulePersist(fast) {
    if (isDraftStoreFrozen()) return;
    if (isPersistenceDisabled()) return;
    if (!resolvePutUrl()) return;
    var useFast = fast === true || fast === "fast";
    var ms = useFast ? INPUT_DEBOUNCE_MS : DEBOUNCE_MS;
    clearPersistTimer();
    persistTimer = setTimeout(function () {
      persistTimer = null;
      saveDraft();
    }, ms);
  }

  function saveDraftDebounced() {
    schedulePersist(false);
  }

  function forceSaveDraft() {
    if (isDraftStoreFrozen()) return Promise.resolve(null);
    if (isPersistenceDisabled()) return Promise.resolve(null);
    clearPersistTimer();
    return saveDraft();
  }

  function applyServerDraftResponse(data) {
    if (data && data.draft && typeof data.draft === "object") {
      DP_DRAFT = data.draft;
      ensureDraftShape(DP_DRAFT);
    }
    if (data && data.updatedAt && DP_DRAFT && DP_DRAFT.meta) {
      DP_DRAFT.meta.updatedAt = data.updatedAt;
    }
    /**
     * Après PUT, le JSON renvoyé doit refléter la sauvegarde ; en cas d'écart ou merge client/serveur,
     * on réaligne dp2 depuis le runtime pour éviter que d'anciennes lignes dp2Versions ne « reviennent » dans DP_DRAFT.
     */
    try {
      if (global.DP2_STATE && typeof global.DP2_STATE === "object") {
        if (typeof global.dp2SyncActiveVersionBeforeDraft === "function") {
          global.dp2SyncActiveVersionBeforeDraft();
        }
        DP_DRAFT.dp2 = cloneStateForDraft(global.DP2_STATE);
      }
    } catch (e) {
      devWarn("[dp-draft] resync dp2 depuis DP2_STATE après réponse serveur", e);
    }
    syncContextWindowDraft();
    if (global.__SOLARNEXT_DP_CONTEXT__) {
      global.__SOLARNEXT_DP_CONTEXT__.updatedAt = data.updatedAt || null;
    }
    writeDraftMirrorLocal();
    saveState = "saved";
    setSaveUi("saved");
  }

  function shouldRetryPut(err, attempt) {
    if (attempt >= MAX_RETRIES) return false;
    var st = err && err.status;
    var code = err && err.code;
    if (st === 403 || code === "DP_LEAD_NOT_CLIENT") return false;
    if (
      code === "DP1_IMAGE_PREP_FAILED" ||
      code === "DP_DRAFT_SERIALIZE_FAILED" ||
      code === "DP1_BLOB_IN_DRAFT" ||
      code === "DP1_BLOB_CHECK_FAILED"
    ) {
      return false;
    }
    if (err && err.name === "AbortError") return true;
    if (st >= 400 && st < 500 && st !== 408 && st !== 429) return false;
    return true;
  }

  function runPutAttempt(attempt) {
    var url = resolvePutUrl();
    if (!url) {
      return Promise.reject(new Error("no_url"));
    }
    syncRuntimeIntoDraft();
    var persistPrep =
      global.__solarnextDp1ImagePersist &&
      typeof global.__solarnextDp1ImagePersist.normalizeDraftImagesAsync === "function"
        ? global.__solarnextDp1ImagePersist.normalizeDraftImagesAsync(DP_DRAFT)
        : Promise.resolve({ ok: true });
    return persistPrep.then(function (norm) {
      if (!norm || !norm.ok) {
        var ex = new Error(
          (norm && norm.error) || "Impossible de préparer les images DP1 pour la sauvegarde."
        );
        ex.code = "DP1_IMAGE_PREP_FAILED";
        throw ex;
      }
      var san = sanitizeDraftForPersist(DP_DRAFT);
      if (!san.ok) {
        var ex2 = new Error(san.error || "Brouillon invalide.");
        ex2.code = san.code || "DP_DRAFT_SERIALIZE_FAILED";
        throw ex2;
      }
      var safeDraft = san.draft;
      if (global.__SN_DP_DP2_AUDIT__ === true) {
        try {
          var d2put = safeDraft && safeDraft.dp2;
          var d2s = d2put && typeof d2put === "object" ? JSON.stringify(d2put).length : 0;
          console.warn("[DP2-AUDIT] PUT bodyBytes", JSON.stringify({ draft: safeDraft }).length, "dp2.json.length", d2s);
          console.warn(
            "[DP2-AUDIT] PUT dp2 keys",
            d2put && typeof d2put === "object" ? Object.keys(d2put).slice(0, 40) : d2put
          );
          if (d2put && typeof d2put === "object") {
            console.warn("[DP2-AUDIT] PUT dp2.capture_plan?", !!(d2put.capture_plan && d2put.capture_plan.imageBase64));
            console.warn("[DP2-AUDIT] PUT dp2.dp2Versions len", Array.isArray(d2put.dp2Versions) ? d2put.dp2Versions.length : null);
          }
        } catch (e2) {
          console.warn("[DP2-AUDIT] log error", e2);
        }
      }
      var body = JSON.stringify({ draft: safeDraft });
      var ctx = global.__SOLARNEXT_DP_CONTEXT__ || {};
      emitDpPutTrace("put_request", {
        attempt: attempt,
        leadId: ctx.leadId || null,
        url: url,
        bodyBytes: body.length,
        draftSummary: summarizeDraftForTrace(safeDraft),
        persistenceDisabledBefore: !!global.__SN_DP_PERSISTENCE_DISABLED,
      });
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var tid = null;
      if (ctrl) {
        tid = setTimeout(function () {
          try {
            ctrl.abort();
          } catch (_) {}
        }, PUT_TIMEOUT_MS);
      }
      return fetch(url, {
        method: "PUT",
        headers: getAuthHeaders(),
        credentials: "include",
        body: body,
        signal: ctrl ? ctrl.signal : undefined,
      })
        .finally(function () {
          if (tid) clearTimeout(tid);
        })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (txt) {
              var j = {};
              try {
                j = JSON.parse(txt);
              } catch (_) {}
              emitDpPutTrace("put_response_error", {
                leadId: ctx.leadId || null,
                url: url,
                httpStatus: res.status,
                bodyError: j && j.error != null ? String(j.error) : null,
                bodyCode: j && j.code != null ? String(j.code) : null,
                responseTextHead: txt ? String(txt).slice(0, 400) : "",
              });
              var err = new Error((j && j.error) || "PUT " + res.status);
              err.status = res.status;
              err.code = j && j.code;
              throw err;
            });
          }
          emitDpPutTrace("put_response_ok", {
            leadId: ctx.leadId || null,
            url: url,
            httpStatus: res.status,
          });
          return res.json();
        });
    });
  }

  function saveDraft() {
    if (isPersistenceDisabled()) {
      return Promise.resolve(null);
    }
    if (isDraftStoreFrozen()) {
      return Promise.resolve(null);
    }
    var url = resolvePutUrl();
    if (!url) {
      devWarn("[dp-draft] Pas de leadId / API — sauvegarde ignorée");
      return Promise.resolve(null);
    }

    if (isSaving) {
      pendingSave = true;
      return Promise.resolve(null);
    }

    isSaving = true;
    pendingSave = false;
    saveState = "saving";
    setSaveUi("saving");

    return runPutWithRetries(0);
  }

  function runPutWithRetries(attempt) {
    return runPutAttempt(attempt)
      .then(function (data) {
        devLog("[DP SAVE OK]");
        applyServerDraftResponse(data);
        isSaving = false;
        if (pendingSave) {
          pendingSave = false;
          return saveDraft();
        }
        return data;
      })
      .catch(function (err) {
        var st = err && err.status;
        var code = err && err.code;
        if (st === 403 || code === "DP_LEAD_NOT_CLIENT") {
          disablePersistence(err && err.message, code || "HTTP_403");
          isSaving = false;
          pendingSave = false;
          return Promise.resolve(null);
        }
        if (shouldRetryPut(err, attempt)) {
          devLog("[DP SAVE RETRY]", attempt + 1, err && err.name, st);
          var delayMs = 400 * (attempt + 1);
          return new Promise(function (resolve) {
            setTimeout(resolve, delayMs);
          }).then(function () {
            return runPutWithRetries(attempt + 1);
          });
        }
        if (
          code === "DP1_IMAGE_PREP_FAILED" ||
          code === "DP_DRAFT_SERIALIZE_FAILED" ||
          code === "DP1_BLOB_IN_DRAFT" ||
          code === "DP1_BLOB_CHECK_FAILED"
        ) {
          console.warn("[DP SAVE FAILED]", err && err.message ? err.message : err);
          saveState = "error";
          setSaveUi("error", err && err.message ? String(err.message) : "Enregistrement impossible.");
          isSaving = false;
          if (pendingSave) {
            pendingSave = false;
            schedulePersist(false);
          }
          return Promise.resolve(null);
        }
        console.warn("[DP SAVE FAILED]", err);
        saveState = "error";
        setSaveUi("error", err && err.message ? String(err.message) : "");
        isSaving = false;
        if (pendingSave) {
          pendingSave = false;
          schedulePersist(false);
        }
        throw err;
      });
  }

  /**
   * Dernier recours : fermeture onglet / navigation (XHR synchrone, best-effort).
   */
  function saveDraftUnloadSync() {
    if (isDraftStoreFrozen()) return;
    if (isPersistenceDisabled()) return;
    var url = resolvePutUrl();
    if (!url || !DP_DRAFT) return;
    try {
      syncRuntimeIntoDraft();
    } catch (_) {}
    var token =
      typeof localStorage !== "undefined" ? localStorage.getItem("solarnext_token") : null;
    var body;
    try {
      if (
        global.__solarnextDp1ImagePersist &&
        typeof global.__solarnextDp1ImagePersist.syncNormalizeFromDom === "function"
      ) {
        var sn = global.__solarnextDp1ImagePersist.syncNormalizeFromDom(DP_DRAFT);
        if (!sn.ok) {
          console.warn("[DP SAVE unload skipped]", sn.error || "");
          devWarn("[DP SAVE unload skipped]", sn.error);
          return;
        }
      }
      var sanu = sanitizeDraftForPersist(DP_DRAFT);
      if (!sanu.ok) {
        console.warn("[DP SAVE unload skipped]", sanu.error || "");
        devWarn("[DP SAVE unload skipped]", sanu.error);
        return;
      }
      body = JSON.stringify({ draft: sanu.draft });
    } catch (prep) {
      devWarn("[DP SAVE unload prep failed]", prep);
      return;
    }
    try {
      var hdrs = { "Content-Type": "application/json" };
      if (token) hdrs.Authorization = "Bearer " + token;
      if (typeof global.__solarnextDpApplySuperAdminContextHeaders === "function") {
        global.__solarnextDpApplySuperAdminContextHeaders(hdrs);
      }
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url, false);
      if (hdrs["Content-Type"]) xhr.setRequestHeader("Content-Type", hdrs["Content-Type"]);
      if (hdrs.Authorization) xhr.setRequestHeader("Authorization", hdrs.Authorization);
      if (hdrs["x-organization-id"]) xhr.setRequestHeader("x-organization-id", hdrs["x-organization-id"]);
      if (hdrs["x-super-admin-edit"]) xhr.setRequestHeader("x-super-admin-edit", hdrs["x-super-admin-edit"]);
      xhr.send(body);
      if (xhr.status >= 200 && xhr.status < 300) {
        devLog("[DP SAVE OK] unload");
      } else if (xhr.status === 403) {
        var ju = {};
        try {
          ju = JSON.parse(xhr.responseText || "{}");
        } catch (_) {}
        disablePersistence(ju && ju.error, (ju && ju.code) || "HTTP_403");
        devWarn("[DP SAVE FAILED] unload", xhr.status);
      } else {
        devWarn("[DP SAVE FAILED] unload", xhr.status);
      }
    } catch (e) {
      devWarn("[DP SAVE FAILED] unload", e);
    }
  }

  var unloadFlushDone = false;
  function onUnloadFlush() {
    if (unloadFlushDone) return;
    unloadFlushDone = true;
    try {
      saveDraftUnloadSync();
    } catch (e) {
      devWarn("[DP SAVE FAILED] onUnloadFlush", e);
    }
  }

  function bindAutosaveListeners() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    if (!resolvePutUrl()) return;
    if (global.__SN_DP_AUTOSAVE_BOUND) return;
    global.__SN_DP_AUTOSAVE_BOUND = true;

    var rootSel = "#dp-tool-root, .dp-tool-embed-root";
    function inRoot(el) {
      try {
        return el && el.closest && el.closest(rootSel);
      } catch (_) {
        return false;
      }
    }

    document.addEventListener(
      "input",
      function (e) {
        if (isPersistenceDisabled()) return;
        if (!inRoot(e.target)) return;
        var t = e.target;
        if (
          !t ||
          (t.tagName === "INPUT" &&
            /^(button|submit|file|reset|image|radio|checkbox|range|color)$/i.test(t.type))
        )
          return;
        schedulePersist(true);
      },
      true
    );

    document.addEventListener(
      "change",
      function (e) {
        if (isPersistenceDisabled()) return;
        if (!inRoot(e.target)) return;
        schedulePersist(true);
      },
      true
    );

    document.addEventListener(
      "pointerup",
      function (e) {
        if (isPersistenceDisabled()) return;
        if (!inRoot(e.target)) return;
        schedulePersist(false);
      },
      true
    );

    window.addEventListener("beforeunload", onUnloadFlush);
    window.addEventListener("pagehide", function (e) {
      if (e && e.persisted) return;
      onUnloadFlush();
    });
  }

  function notifyMenuNavigate(pagePath) {
    if (isDraftStoreFrozen()) return;
    var id = mapPathToPageId(pagePath);
    setCurrentPage(id);
    markVisited(id);
    saveDraftDebounced();
  }

  function pageIdToPath(pageId) {
    var map = {
      general: "pages/general.html",
      mandat: "pages/mandat.html",
      dp1: "pages/dp1.html",
      dp2: "pages/dp2.html",
      dp3: "pages/dp3.html",
      dp4: "pages/dp4.html",
      dp6: "pages/dp6.html",
      dp7: "pages/dp7.html",
      dp8: "pages/dp8.html",
      cerfa: "pages/cerfa.html",
    };
    var k = String(pageId || "");
    return map[k] || "pages/general.html";
  }

  function hydrateFromDraft() {
    if (isDraftStoreFrozen()) return;
    if (!DP_DRAFT) return;
    ensureDraftShape(DP_DRAFT);
    DP_DRAFT.timestamps = DP_DRAFT.timestamps || {};
    DP_DRAFT.timestamps.lastFullRestoreAt = nowIso();
    var D = DP_DRAFT;

    var d1 = D.dp1 || (D.dp && D.dp.dp1);
    if (typeof global.hydrateDP1 === "function") {
      try {
        global.hydrateDP1(d1 || {});
      } catch (e) {
        devWarn("[dp-draft] hydrateDP1", e);
      }
    }

    var d2 = D.dp2 || (D.dp && D.dp.dp2);
    if (typeof global.hydrateDP2 === "function") {
      try {
        if (global.__SN_DP_DP2_AUDIT__ === true) {
          try {
            console.warn(
              "[DP2-AUDIT] hydrate d2",
              d2 == null ? "null/undefined" : typeof d2,
              d2 && typeof d2 === "object" ? "keys:" + Object.keys(d2).slice(0, 30).join(",") : ""
            );
          } catch (_) {}
        }
        global.hydrateDP2(d2 || {});
      } catch (e) {
        devWarn("[dp-draft] hydrateDP2", e);
      }
    }

    var d3 = D.dp3 || (D.dp && D.dp.dp3);
    if (d3 && typeof global.hydrateDP3 === "function") {
      try {
        global.hydrateDP3(d3);
      } catch (e) {
        devWarn("[dp-draft] hydrateDP3", e);
      }
    }

    var d4 = D.dp4 || (D.dp && D.dp.dp4);
    if (typeof global.__snHydrateDp4FromDraft === "function") {
      try {
        global.__snHydrateDp4FromDraft(d4 || {});
      } catch (e) {
        devWarn("[dp-draft] hydrate dp4", e);
      }
    }

    if (D.dp5 && typeof D.dp5 === "object") {
      try {
        global.DP5_STATE = global.DP5_STATE || {};
        Object.assign(global.DP5_STATE, cloneStateForDraft(D.dp5) || {});
      } catch (e) {
        devWarn("[dp-draft] hydrate dp5", e);
      }
    }

    if (D.dp6 && typeof D.dp6 === "object") {
      try {
        global.DP6_STATE = global.DP6_STATE || {};
        Object.assign(global.DP6_STATE, cloneStateForDraft(D.dp6) || {});
      } catch (e) {
        devWarn("[dp-draft] hydrate dp6", e);
      }
    }

    if (D.dp7 && typeof D.dp7 === "object") {
      try {
        global.DP7_STATE = global.DP7_STATE || {};
        Object.assign(global.DP7_STATE, cloneStateForDraft(D.dp7) || {});
      } catch (e) {
        devWarn("[dp-draft] hydrate dp7", e);
      }
    }

    if (D.dp8 && typeof D.dp8 === "object") {
      try {
        global.DP8_STATE = global.DP8_STATE || {};
        Object.assign(global.DP8_STATE, cloneStateForDraft(D.dp8) || {});
      } catch (e) {
        devWarn("[dp-draft] hydrate dp8", e);
      }
    }

    if (D.cerfa && typeof D.cerfa === "object" && global.CERFA_STATE) {
      try {
        Object.assign(global.CERFA_STATE, cloneStateForDraft(D.cerfa));
      } catch (e) {
        devWarn("[dp-draft] hydrate cerfa", e);
      }
    }

    if (D.mandat && D.mandat.smartpitchCtx && typeof D.mandat.smartpitchCtx === "object" && global.SMARTPITCH_CTX) {
      try {
        var draftSp = cloneStateForDraft(D.mandat.smartpitchCtx) || {};
        var mergedSp = mergeSafeDeep(global.SMARTPITCH_CTX, draftSp, 0);
        Object.assign(global.SMARTPITCH_CTX, mergedSp);
      } catch (e) {
        devWarn("[dp-draft] hydrate mandat", e);
      }
    }

    if (D.mandat && D.mandat.mandatSignature && typeof D.mandat.mandatSignature === "object") {
      try {
        global.__MANDAT_SIGNATURE__ = Object.assign(
          {
            signed: false,
            name: "",
            signatureDataUrl: "",
            signedAt: "",
            signedAtServer: "",
            accepted: false,
            acceptedLabel: "",
          },
          cloneStateForDraft(D.mandat.mandatSignature) || {}
        );
      } catch (e) {
        devWarn("[dp-draft] hydrate mandatSignature", e);
      }
    }

    if (D.general && typeof D.general === "object" && typeof global.DP_GENERAL_STATE === "object") {
      try {
        Object.assign(global.DP_GENERAL_STATE, cloneStateForDraft(D.general));
      } catch (e) {
        devWarn("[dp-draft] hydrate general", e);
      }
    }

    if (D.dpViewLock && global.DP_VIEW_LOCK) {
      try {
        Object.assign(global.DP_VIEW_LOCK, cloneStateForDraft(D.dpViewLock));
      } catch (e) {
        devWarn("[dp-draft] hydrate dpViewLock", e);
      }
    }

    try {
      if (global.snDpV && typeof global.snDpV.runAfterHydrate === "function") {
        global.snDpV.runAfterHydrate();
      }
    } catch (e) {
      devWarn("[dp-draft] snDpV.runAfterHydrate", e);
    }

    syncContextWindowDraft();
    writeDraftMirrorLocal();
  }

  function wireDraftStoreStubs() {
    function stubMapPathToPageId(pagePath) {
      var p = String(pagePath || "");
      var map = {
        "pages/general.html": "general",
        "pages/mandat.html": "mandat",
        "pages/dp1.html": "dp1",
        "pages/dp2.html": "dp2",
        "pages/dp3.html": "dp3",
        "pages/dp4.html": "dp4",
        "pages/dp6.html": "dp6",
        "pages/dp7.html": "dp7",
        "pages/dp8.html": "dp8",
        "pages/cerfa.html": "cerfa",
      };
      return map[p] || "general";
    }
    function stubPageIdToPath(pageId) {
      var map = {
        general: "pages/general.html",
        mandat: "pages/mandat.html",
        dp1: "pages/dp1.html",
        dp2: "pages/dp2.html",
        dp3: "pages/dp3.html",
        dp4: "pages/dp4.html",
        dp6: "pages/dp6.html",
        dp7: "pages/dp7.html",
        dp8: "pages/dp8.html",
        cerfa: "pages/cerfa.html",
      };
      var k = String(pageId || "");
      return map[k] || "pages/general.html";
    }
    global.DpDraftStore = {
      initDraftFromServer: function () {},
      getDraft: function () {
        return null;
      },
      updateDraft: function () {},
      setCurrentPage: function () {},
      markVisited: function () {},
      saveDraftDebounced: function () {},
      forceSaveDraft: function () {
        return Promise.resolve(null);
      },
      saveDraft: function () {
        return Promise.resolve(null);
      },
      mapPathToPageId: stubMapPathToPageId,
      pageIdToPath: stubPageIdToPath,
      hydrateFromDraft: function () {},
    };
    global.__snDpNotifyMenuNavigate = function () {};
    global.__snDpPersistDebounced = function () {};
    global.__snDpForceFlush = function () {
      return Promise.resolve(null);
    };
    global.__snDpAfterDp1Validated = function () {};
    global.__snDpAfterCaptureDp2 = function () {};
    global.__snDpAfterDp3Validated = function () {};
  }

  global.DpDraftStore = {
    initDraftFromServer: initDraftFromServer,
    getDraft: getDraft,
    updateDraft: updateDraft,
    setCurrentPage: setCurrentPage,
    markVisited: markVisited,
    saveDraftDebounced: saveDraftDebounced,
    forceSaveDraft: forceSaveDraft,
    saveDraft: saveDraft,
    mapPathToPageId: mapPathToPageId,
    pageIdToPath: pageIdToPath,
    hydrateFromDraft: hydrateFromDraft,
  };

  global.__snDpNotifyMenuNavigate = notifyMenuNavigate;
  /** Entrée unique autosave (debounce) — voir schedulePersist. */
  global.__snDpPersistDebounced = schedulePersist;
  /** Flush immédiat (fermeture overlay, tests) — contourne le debounce. */
  global.__snDpForceFlush = forceSaveDraft;
  global.__snDpAfterDp1Validated = function () {
    schedulePersist(false);
  };
  global.__snDpAfterCaptureDp2 = function () {
    try {
      if (typeof global.__snDpForceFlush === "function") {
        global.__snDpForceFlush();
      } else if (global.DpDraftStore && typeof global.DpDraftStore.forceSaveDraft === "function") {
        global.DpDraftStore.forceSaveDraft();
      } else {
        schedulePersist("fast");
      }
      if (global.__SN_DP_DP2_AUDIT__ === true) {
        var d2a = DP_DRAFT && DP_DRAFT.dp2;
        console.warn("[DP2-AUDIT] afterCapture flush; draft.dp2 keys", d2a && typeof d2a === "object" ? Object.keys(d2a) : d2a);
      }
    } catch (_) {}
  };
  global.__snDpAfterDp3Validated = function () {
    schedulePersist(false);
  };

  if (!crmGateOk()) {
    if (global.__SN_DP_DEV_MODE !== true) {
      if (!global.__SOLARNEXT_DP_CONTEXT__ || !global.__SOLARNEXT_DP_CONTEXT__.leadId) {
        console.error("[DP INIT BLOCKED — NO CRM CONTEXT]");
      } else {
        console.error("[DP INIT BLOCKED — NOT CRM EMBED]");
      }
    }
    global.__SN_DP_INIT_BLOCKED = true;
    global.__SN_DP_PERSISTENCE_DISABLED = true;
    emitDpPutTrace("persistence_disabled_init", {
      source: "dp-draft-store.js crmGateOk",
      reason: !global.__SOLARNEXT_DP_CONTEXT__ || !global.__SOLARNEXT_DP_CONTEXT__.leadId ? "NO_LEAD_CONTEXT" : "NOT_CRM_EMBED",
      leadId: global.__SOLARNEXT_DP_CONTEXT__ && global.__SOLARNEXT_DP_CONTEXT__.leadId,
    });
    try {
      global.__SN_DP_TRACE_LAST_DISABLE__ = {
        at: new Date().toISOString(),
        reason: !global.__SOLARNEXT_DP_CONTEXT__ || !global.__SOLARNEXT_DP_CONTEXT__.leadId ? "NO_LEAD_CONTEXT" : "NOT_CRM_EMBED",
        code: "INIT_GATE_DRAFT_STORE",
      };
    } catch (_) {}
    wireDraftStoreStubs();
  } else if (global.__SOLARNEXT_DP_CONTEXT__ && global.__SOLARNEXT_DP_CONTEXT__.leadId) {
    initDraftFromServer(global.__SOLARNEXT_DP_CONTEXT__.draft);
    bindAutosaveListeners();
  } else if (global.__SN_DP_DEV_MODE === true) {
    initDraftFromServer(null);
    bindAutosaveListeners();
  } else {
    console.error("[DP INIT BLOCKED — NO CRM CONTEXT]");
    global.__SN_DP_INIT_BLOCKED = true;
    global.__SN_DP_PERSISTENCE_DISABLED = true;
    emitDpPutTrace("persistence_disabled_init", {
      source: "dp-draft-store.js final branch",
      reason: "NO_CRM_CONTEXT_FINAL",
      leadId: null,
    });
    try {
      global.__SN_DP_TRACE_LAST_DISABLE__ = {
        at: new Date().toISOString(),
        reason: "NO_CRM_CONTEXT_FINAL",
        code: "INIT_GATE_DRAFT_STORE",
      };
    } catch (_) {}
    wireDraftStoreStubs();
  }
})(typeof window !== "undefined" ? window : globalThis);
