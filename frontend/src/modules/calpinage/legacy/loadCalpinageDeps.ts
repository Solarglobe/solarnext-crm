/**
 * Loader unique pour les dépendances legacy du Calpinage.
 * Cache global (Promise) pour éviter double chargement si overlay réouvert.
 * Tous les scripts locaux utilisent withBase() pour éviter les chemins relatifs
 * cassés par crm.html#/leads/...
 *
 * html2canvas : requis pour la capture Phase 1/2 (toiture satellite) — map-selector-bundle.js.
 * Non utilisé pour le snapshot PDF (Playwright côté serveur).
 */

import html2canvas from "html2canvas";

const scriptCache = new Map<string, Promise<void>>();
const cssCache = new Map<string, Promise<void>>();

let ensureCalpinageDepsPromise: Promise<void> | null = null;
let googleMapsPromise: Promise<void> | null = null;

/**
 * Garantit que window.google et window.google.maps sont disponibles.
 * Singleton : pas de double injection, compatible réouverture overlay et localhost.
 */
function ensureGoogleMapsLoaded(): Promise<void> {
  const win = window as unknown as { google?: { maps?: unknown }; __CALPINAGE_GOOGLE_READY__?: boolean };
  if (win.google && win.google.maps) {
    win.__CALPINAGE_GOOGLE_READY__ = true;
    return Promise.resolve();
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript =
      document.querySelector('script[data-google-maps="true"]') ??
      document.querySelector('script[src*="maps.googleapis.com"]');

    if (existingScript) {
      if ((win as unknown as { __CALPINAGE_GOOGLE_READY__?: boolean }).__CALPINAGE_GOOGLE_READY__ || (win.google && win.google.maps)) {
        (win as unknown as { __CALPINAGE_GOOGLE_READY__?: boolean }).__CALPINAGE_GOOGLE_READY__ = true;
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => {
        if (win.google && win.google.maps) {
          (win as unknown as { __CALPINAGE_GOOGLE_READY__?: boolean }).__CALPINAGE_GOOGLE_READY__ = true;
          resolve();
        } else reject(new Error("Google Maps loaded but window.google undefined"));
      });
      return;
    }

    const apiKey =
      import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ||
      "AIzaSyDQMAe4zNsipMna3Ph1ANhJLMpZcdAWC1M";

    (win as unknown as { __calpinageGoogleInit?: () => void }).__calpinageGoogleInit = function () {
      (win as unknown as { __CALPINAGE_GOOGLE_READY__?: boolean }).__CALPINAGE_GOOGLE_READY__ = true;
      resolve();
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&callback=__calpinageGoogleInit`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";

    script.onerror = () => reject(new Error("Google Maps script failed to load"));

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

/**
 * Réinitialise le cache des dépendances (pour permettre un "Réessayer" après erreur).
 */
export function resetCalpinageDepsCache(): void {
  ensureCalpinageDepsPromise = null;
  googleMapsPromise = null;
}

/**
 * Construit une URL absolue à partir du BASE_URL Vite.
 * Garantit qu'aucun chemin relatif ne soit utilisé (évite /crm.html/leads/calpinage/...).
 */
function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const b = base.endsWith("/") ? base : base + "/";
  const p = path.startsWith("/") ? path.slice(1) : path;
  return b + p; // ex: "/calpinage/canvas-bundle.js" ou "/app/calpinage/canvas-bundle.js"
}

/**
 * Charge un script une seule fois (cache par src).
 */
export function loadScriptOnce(src: string): Promise<void> {
  let p = scriptCache.get(src);
  if (p) return p;

  p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`[CALPINAGE] Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  scriptCache.set(src, p);
  return p;
}

/**
 * Charge une feuille CSS une seule fois (cache par href).
 */
export function loadCssOnce(href: string): Promise<void> {
  let p = cssCache.get(href);
  if (p) return p;

  p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[href="${href}"]`);
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`[CALPINAGE] Failed to load CSS: ${href}`));
    document.head.appendChild(link);
  });

  cssCache.set(href, p);
  return p;
}

/** URLs Leaflet (obligatoire pour Geoportail) */
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

/** Scripts legacy à charger (ordre calpinage.html). Leaflet doit être chargé avant map-selector-bundle. */
const LEGACY_SCRIPTS = [
  withBase("calpinage/canvas-bundle.js"),
  withBase("calpinage/map-selector-bundle.js"),
  withBase("calpinage/pans-bundle.js"),
  withBase("calpinage/panelProjection.js"),
  withBase("calpinage/state/activePlacementBlock.js"),
  withBase("calpinage/engine/pvPlacementEngine.js"),
  withBase("calpinage/shading/horizonMaskEngine.js"),
  withBase("calpinage/shading/nearShadingCore.cjs"),
  withBase("calpinage/shading/solarPosition.js"),
  withBase("calpinage/shading/horizonMaskSampler.js"),
  withBase("calpinage/shading/shadingEngine.js"),
  withBase("calpinage/tools/calpinage-panels-adapter.js"),
  withBase("calpinage/tools/calpinage-dp2-behavior.js"),
];

/**
 * Charge toutes les dépendances Calpinage (Leaflet + bundles legacy)
 * et vérifie que window.CalpinageCanvas, CalpinageMap, CalpinagePans existent.
 * @throws Error si les globals sont absents après chargement
 */
export async function ensureCalpinageDeps(): Promise<void> {
  if (ensureCalpinageDepsPromise) {
    return ensureCalpinageDepsPromise;
  }

  ensureCalpinageDepsPromise = (async () => {
    // 0. Google Maps (garantir window.google avant initCalpinage)
    await ensureGoogleMapsLoaded();
    console.log("[GoogleMaps] ready =", !!(window as unknown as { google?: { maps?: unknown } }).google?.maps);

    // 1. html2canvas (capture Phase 1/2 — map-selector-bundle attend window.html2canvas)
    (window as unknown as { html2canvas?: typeof html2canvas }).html2canvas = html2canvas;

    // 2. Leaflet CSS
    await loadCssOnce(LEAFLET_CSS);

    // 3. Leaflet JS (avant map-selector-bundle, requis pour initGeoportailMap)
    await loadScriptOnce(LEAFLET_JS);

    // 4. Bundles legacy (ordre calpinage.html)
    for (const src of LEGACY_SCRIPTS) {
      await loadScriptOnce(src);
    }

    // 5. Diagnostic et vérification des globals
    const win = window as unknown as {
      CalpinageCanvas?: unknown;
      CalpinageMap?: unknown;
      CalpinagePans?: unknown;
      L?: unknown;
      html2canvas?: unknown;
    };
    const status = {
      CalpinageCanvas: !!win.CalpinageCanvas,
      CalpinageMap: !!win.CalpinageMap,
      CalpinagePans: !!win.CalpinagePans,
      Leaflet: !!win.L,
      html2canvas: !!win.html2canvas,
    };

    console.info("[CalpinageDeps] OK", status);

    const missing = Object.entries(status)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      const msg = `[CALPINAGE] Dépendances manquantes: ${missing.join(", ")}. Vérifiez que les bundles ${LEGACY_SCRIPTS.join(", ")} sont servis (status 200). Aucune requête vers /crm.html/leads/calpinage/...`;
      console.error(msg, { missing, status });
      throw new Error(msg);
    }
  })();

  return ensureCalpinageDepsPromise;
}
