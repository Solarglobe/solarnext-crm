/**
 * Charge le moteur legacy DP (dp-app.js) dans un conteneur sans iframe.
 * Contrat window : Lot 2 + __SOLARNEXT_DP_ASSET_BASE__, __SOLARNEXT_DP_EMBED_LOADER__ (interne).
 */

/** Lead fictif : `dp-draft-store.js` simule le PUT (pas de fetch). — garder la même valeur des deux côtés. */
export const SN_DP_DEV_TEST_LEAD_ID = "DEV-TEST-DP2";

export type DpToolHostContext = {
  leadId: string;
  clientId?: string | null;
  context: unknown;
  draft?: unknown | null;
  updatedAt?: string | null;
};

export type DpToolLoaderOptions = {
  container: HTMLElement;
  /** Réponse GET /api/leads/:id/dp ou équivalent */
  hostPayload: DpToolHostContext;
  /** Clé namespace stockage (ex. lead UUID) — obligatoire pour éviter les collisions */
  storageKey: string;
  /**
   * URL absolue du dossier `frontend/dp-tool/` (avec slash final).
   * Défaut : résolu depuis ce module vers `../../../dp-tool/`
   */
  assetBaseUrl?: string;
  /**
   * Origine API CRM sans « /api » final (ex. `https://api.solarnext-crm.fr`).
   * Doit refléter `import.meta.env.VITE_API_URL` au build : `LeadDpPage` transmet `getCrmApiBase()`.
   * Si omis en prod, `dp-app.js` utilise `window.location.origin` → risque d’appeler le front au lieu du backend.
   */
  apiBase?: string;
};

export type DpToolLoaderHandle = {
  destroy: () => void;
};

/** Contexte injecté sur `window.__SOLARNEXT_DP_CONTEXT__` (typage minimal pour accès sûr au bundle legacy). */
export type DpContext = {
  leadId?: string;
  [key: string]: unknown;
};

/** Globaux posés par `loadDpTool` avant chargement des scripts DP. */
type DpLoaderWindowGlobals = {
  __SOLARNEXT_DP_CONTEXT__?: DpContext;
  __SOLARNEXT_API_BASE__?: string;
  __SOLARNEXT_DP_STORAGE_KEY__?: string;
  __SOLARNEXT_DP_ASSET_BASE__?: string;
  __SOLARNEXT_DP_DRAFT_SERVER__?: unknown;
  __SOLARNEXT_DP_EMBED_LOADER__?: boolean;
  __SOLARNEXT_DP_CRM_EMBED?: boolean;
  __SN_DP_INIT_BLOCKED?: boolean;
  __SN_DP_DEV_MODE?: boolean;
  __SOLARNEXT_DP_MOUNT_SHELL__?: () => void;
  __SOLARNEXT_DP_NAV_ABORT__?: () => void;
  __SOLARNEXT_DP_STYLE_DP_MAIN__?: boolean;
};

type DpPostLoadWindow = {
  __solarnextHydrateSmartpitchFromDpContext?: () => void;
  DpDraftStore?: {
    initDraftFromServer?: (d: unknown) => void;
    hydrateFromDraft?: () => void;
    forceSaveDraft?: () => void;
  };
  loadDP1LeadContext?: () => Promise<unknown>;
  __snDpLoadInjectedDp1Context?: () => Promise<unknown>;
  __SN_DP_INIT_BLOCKED?: boolean;
  __snDpForceFlush?: () => unknown;
};

/** Base `/dp-tool/` (copié en dist + servi en dev) — évite import.meta.url cassé depuis assets/*.js bundlés. */
function getDefaultDpAssetBase(): string {
  if (typeof window !== "undefined") {
    const base = new URL(import.meta.env.BASE_URL || "/", window.location.origin);
    return new URL("dp-tool/", base).href;
  }
  return new URL("../../../dp-tool/", /* @vite-ignore */ import.meta.url).href;
}

const CDN = {
  olCss: "https://cdn.jsdelivr.net/npm/ol@10.7.0/ol.css",
  olJs: "https://cdn.jsdelivr.net/npm/ol@10.7.0/dist/ol.js",
  html2canvas: "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  pdfLib: "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js",
} as const;

let loadGeneration = 0;

/** Standalone audit DP2 : http://localhost:5173/dp2.html (ne pas activer sur /crm/… pour ne pas écraser un vrai lead). */
export function isDpLocalStandaloneDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  if (h !== "localhost" && h !== "127.0.0.1") return false;
  const path = (window.location.pathname || "/").replace(/\/$/, "") || "/";
  return path.endsWith("/dp2.html") || path === "/dp2.html";
}

function buildDpLocalDevHostPayload(): DpToolHostContext {
  return {
    leadId: SN_DP_DEV_TEST_LEAD_ID,
    clientId: null,
    context: {
      identity: { nom: "TEST DEV" },
      site: {
        address: "1 rue test",
        postalCode: "75000",
        city: "Paris",
        lat: 48.8566,
        lon: 2.3522,
      },
    },
    draft: null,
    updatedAt: null,
  };
}

function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function resolveFromAssetBase(assetBase: string, relative: string): string {
  return new URL(relative.replace(/^\//, ""), withTrailingSlash(assetBase)).href;
}

/**
 * Supprime les globaux runtime DP (ré-entrée SPA / changement de lead).
 * À appeler avant chargement des scripts et hydratation — évite qu’un état (ex. nom client) d’un lead précédent persiste.
 */
function solarnextDpClearLeakingDpGlobals(win: Window): void {
  const x = win as Window & Record<string, unknown>;
  try {
    delete x.DP1_STATE;
    delete x.DP2_STATE;
    delete x.DP4_STATE;
    delete x.DP1_CONTEXT;
    delete x.SMARTPITCH_CTX;
    delete x.__DP4_LS_LOADED;
    delete x.DP4_IMPORT_VIEW_SNAPSHOT;
    delete x.DP4_CAPTURE_IMAGE;
  } catch {
    /* ignore */
  }
}

function injectShellMarkup(container: HTMLElement): void {
  container.innerHTML = "";
  const root = document.createElement("div");
  root.id = "dp-tool-root";
  root.className = "dp-tool-embed-root";
  root.innerHTML = `
<div class="layout">
  <div id="dp-draft-save-status" class="dp-draft-save-status dp-draft-save-status--bar" aria-live="polite"></div>
  <aside class="sidebar">
    <h3>Dossier DP</h3>
    <nav class="dp-menu">
      <a href="#" data-page="pages/mandat.html">Mandat de représentation</a>
      <hr class="dp-separator" />
      <a href="#" data-page="pages/general.html" class="active">Général</a>
      <a href="#" data-page="pages/dp1.html">DP1 — Situation</a>
      <a href="#" data-page="pages/dp2.html">DP2 — Plan de masse</a>
      <a href="#" data-page="pages/dp3.html">DP3 — Plan de coupe</a>
      <a href="#" data-page="pages/dp4.html">DP4 — Toiture</a>
      <a href="#" data-page="pages/dp6.html">DP6 — Insertion</a>
      <a href="#" data-page="pages/dp7.html">DP7 — Environnement proche</a>
      <a href="#" data-page="pages/dp8.html">DP8 — Environnement lointain</a>
      <a href="#" data-page="pages/cerfa.html">CERFA</a>
    </nav>
  </aside>
  <main class="content">
    <div class="content-card">
      <div id="dp-views-root" class="dp-views-root">
        <div id="view-general" class="dp-view"></div>
        <div id="view-mandat" class="dp-view"></div>
        <div id="view-dp1" class="dp-view"></div>
        <div id="view-dp2" class="dp-view"></div>
        <div id="view-dp3" class="dp-view"></div>
        <div id="view-dp4" class="dp-view"></div>
        <div id="view-dp6" class="dp-view"></div>
        <div id="view-dp7" class="dp-view"></div>
        <div id="view-dp8" class="dp-view"></div>
        <div id="view-cerfa" class="dp-view"></div>
      </div>
    </div>
  </main>
</div>`;
  container.appendChild(root);
}

function linkStylesheetOnce(href: string, id: string): void {
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function scriptAlreadyInDom(src: string): boolean {
  const scripts = document.querySelectorAll("script[src]");
  for (let i = 0; i < scripts.length; i++) {
    const el = scripts[i] as HTMLScriptElement;
    if (el.src === src || el.getAttribute("src") === src) return true;
  }
  return false;
}

function loadScriptSequential(src: string, signal: AbortSignal): Promise<void> {
  if (scriptAlreadyInDom(src)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    const onAbort = () => {
      s.remove();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    s.onload = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    s.onerror = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`Échec chargement script DP : ${src}`));
    };
    document.head.appendChild(s);
  });
}

function removeHeadElementById(id: string): void {
  document.getElementById(id)?.remove();
}

/**
 * Monte le DP dans le conteneur : shell DOM, contexte window, CSS/JS, init navigation.
 */
export async function loadDpTool(options: DpToolLoaderOptions): Promise<DpToolLoaderHandle> {
  const gen = ++loadGeneration;
  const assetBase = withTrailingSlash(options.assetBaseUrl ?? getDefaultDpAssetBase());

  let { container, hostPayload, storageKey, apiBase } = options;
  const devStandalone = isDpLocalStandaloneDevHost();
  if (devStandalone) {
    const wd = window as unknown as { __SN_DP_DP2_AUDIT__?: boolean; __SN_DP_BOOT_PAGE_PATH__?: string };
    wd.__SN_DP_DP2_AUDIT__ = true;
    wd.__SN_DP_BOOT_PAGE_PATH__ = "pages/dp2.html";
    hostPayload = buildDpLocalDevHostPayload();
    if (!String(storageKey ?? "").trim()) {
      storageKey = SN_DP_DEV_TEST_LEAD_ID;
    }
  }

  solarnextDpClearLeakingDpGlobals(window);

  injectShellMarkup(container);

  const w = window as unknown as Window & DpLoaderWindowGlobals;

  const baseCtx = {
    leadId: hostPayload.leadId,
    clientId: hostPayload.clientId ?? null,
    context: hostPayload.context,
    draft: hostPayload.draft ?? null,
    updatedAt: hostPayload.updatedAt ?? null,
  };
  w.__SOLARNEXT_DP_CONTEXT__ = devStandalone
    ? {
        ...baseCtx,
        nom: "TEST DEV",
        adresse: "1 rue test",
        cp: "75000",
        ville: "Paris",
        lat: 48.8566,
        lon: 2.3522,
      }
    : baseCtx;
  w.__SOLARNEXT_DP_CRM_EMBED = true;
  w.__SOLARNEXT_DP_DRAFT_SERVER__ = hostPayload.draft ?? null;
  w.__SOLARNEXT_DP_STORAGE_KEY__ = storageKey;
  if (apiBase && apiBase.trim()) {
    w.__SOLARNEXT_API_BASE__ = apiBase.replace(/\/$/, "");
  } else {
    delete w.__SOLARNEXT_API_BASE__;
  }
  w.__SOLARNEXT_DP_ASSET_BASE__ = assetBase;

  solarnextDpClearLeakingDpGlobals(w);
  const dpCtx = w.__SOLARNEXT_DP_CONTEXT__ as DpContext | undefined;
  console.log("[DP RESET] leadId =", dpCtx?.leadId);

  const ac = new AbortController();

  linkStylesheetOnce(CDN.olCss, "dp-tool-embed-ol-css");
  linkStylesheetOnce(resolveFromAssetBase(assetBase, "style.css"), "dp-tool-embed-main-css");
  linkStylesheetOnce(resolveFromAssetBase(assetBase, "mandat-signature.css"), "dp-tool-embed-mandat-sign-css");

  w.__SOLARNEXT_DP_EMBED_LOADER__ = true;

  try {
    await loadScriptSequential(CDN.olJs, ac.signal);
    await loadScriptSequential(CDN.html2canvas, ac.signal);
    await loadScriptSequential(CDN.pdfLib, ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "../../shared/panel-dimensions.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "../config/vite-public-runtime.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "../config/featureFlags.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-versions-shared.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-super-admin-headers.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp1-image-persist.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-draft-store.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-app.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-versions-register.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "mandat-signature.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp7.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp8.js"), ac.signal);
  } finally {
    delete w.__SOLARNEXT_DP_EMBED_LOADER__;
  }

  const win = w as unknown as DpPostLoadWindow;
  if (!win.__SN_DP_INIT_BLOCKED && typeof win.__solarnextHydrateSmartpitchFromDpContext === "function") {
    win.__solarnextHydrateSmartpitchFromDpContext();
  }
  try {
    const draft = hostPayload.draft ?? null;
    if (win.DpDraftStore?.initDraftFromServer) {
      win.DpDraftStore.initDraftFromServer(draft);
    }
    if (win.DpDraftStore?.hydrateFromDraft) {
      win.DpDraftStore.hydrateFromDraft();
    }
  } catch {
    /* ignore */
  }
  try {
    const loadCtx = win.loadDP1LeadContext ?? win.__snDpLoadInjectedDp1Context;
    if (typeof loadCtx === "function") await loadCtx();
  } catch {
    /* ignore */
  }

  if (gen !== loadGeneration) {
    ac.abort();
    throw new DOMException("loadDpTool obsolète (nouveau montage)", "AbortError");
  }

  w.__SOLARNEXT_DP_MOUNT_SHELL__?.();

  const destroy = () => {
    if (gen !== loadGeneration) return;
    ac.abort();
    try {
      const wl = w as unknown as DpPostLoadWindow;
      const flush = wl.__snDpForceFlush;
      if (typeof flush === "function") flush();
      else if (wl.DpDraftStore?.forceSaveDraft) {
        wl.DpDraftStore.forceSaveDraft();
      }
    } catch {
      /* ignore */
    }
    try {
      w.__SOLARNEXT_DP_NAV_ABORT__?.();
    } catch {
      /* ignore */
    }
    container.innerHTML = "";
    removeHeadElementById("dp-tool-embed-ol-css");
    removeHeadElementById("dp-tool-embed-main-css");
    removeHeadElementById("dp-tool-embed-mandat-sign-css");
  };

  return { destroy };
}
