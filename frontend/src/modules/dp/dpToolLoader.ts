/**
 * Charge le moteur legacy DP (dp-app.js) dans un conteneur sans iframe.
 * Contrat window : Lot 2 + __SOLARNEXT_DP_ASSET_BASE__, __SOLARNEXT_DP_EMBED_LOADER__ (interne).
 */

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
  /** Base API CRM optionnelle (JWT, PDF, cadastre) */
  apiBase?: string;
};

export type DpToolLoaderHandle = {
  destroy: () => void;
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

function withTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

function resolveFromAssetBase(assetBase: string, relative: string): string {
  return new URL(relative.replace(/^\//, ""), withTrailingSlash(assetBase)).href;
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

  const { container, hostPayload, storageKey, apiBase } = options;

  injectShellMarkup(container);

  const w = window as Window &
    typeof globalThis & {
      __SOLARNEXT_DP_CONTEXT__?: unknown;
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

  w.__SOLARNEXT_DP_CONTEXT__ = {
    leadId: hostPayload.leadId,
    clientId: hostPayload.clientId ?? null,
    context: hostPayload.context,
    draft: hostPayload.draft ?? null,
    updatedAt: hostPayload.updatedAt ?? null,
  };
  w.__SOLARNEXT_DP_CRM_EMBED = true;
  w.__SOLARNEXT_DP_DRAFT_SERVER__ = hostPayload.draft ?? null;
  w.__SOLARNEXT_DP_STORAGE_KEY__ = storageKey;
  if (apiBase && apiBase.trim()) {
    w.__SOLARNEXT_API_BASE__ = apiBase.replace(/\/$/, "");
  } else {
    delete w.__SOLARNEXT_API_BASE__;
  }
  w.__SOLARNEXT_DP_ASSET_BASE__ = assetBase;

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
    await loadScriptSequential(resolveFromAssetBase(assetBase, "../config/featureFlags.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-versions-shared.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-draft-store.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-app.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp-versions-register.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "mandat-signature.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp7.js"), ac.signal);
    await loadScriptSequential(resolveFromAssetBase(assetBase, "dp8.js"), ac.signal);
  } finally {
    delete w.__SOLARNEXT_DP_EMBED_LOADER__;
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
      const flush = (w as Window & { __snDpForceFlush?: () => unknown }).__snDpForceFlush;
      if (typeof flush === "function") flush();
      else (w as Window & { DpDraftStore?: { forceSaveDraft?: () => void } }).DpDraftStore?.forceSaveDraft?.();
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
