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
import { getCrmApiBase } from "../../../config/crmApiBase";
import { apiFetch, getAuthToken } from "../../../services/api";

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
 * URL vers un fichier sous /calpinage/ sur le backend (JWT ou renderToken).
 * En dev : toujours URL relative `/calpinage/...` (même origine que Vite) pour que les bundles
 * présents dans `frontend/calpinage/**` soient servis par le bypass Vite (sans 404 si l’API
 * n’expose pas `/calpinage` ou CALPINAGE désactivé). En prod : `VITE_API_URL` si défini.
 */
function calpinageLegacyAssetUrl(relativeUnderCalpinage: string): string {
  const pathPart = relativeUnderCalpinage.replace(/^calpinage\//, "");
  const apiBase = getCrmApiBase();
  const isDev =
    typeof import.meta !== "undefined" && import.meta.env?.DEV === true;
  let url =
    (isDev ? `/calpinage` : apiBase ? `${apiBase}/calpinage` : `/calpinage`) +
    `/${pathPart}`;
  if (getAuthToken()) {
    return url;
  }
  if (typeof window === "undefined") {
    return url;
  }
  const params = new URLSearchParams(window.location.search);
  const rt = params.get("renderToken");
  const sid = params.get("studyId");
  const vid = params.get("versionId");
  if (rt && sid && vid) {
    url += `?${new URLSearchParams({ renderToken: rt, studyId: sid, versionId: vid }).toString()}`;
  }
  return url;
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
 * Charge un script servi sur /calpinage/* (protégé) via fetch + blob (Bearer ou renderToken en query).
 */
export function loadProtectedCalpinageScriptOnce(relativeCalpinagePath: string): Promise<void> {
  const url = calpinageLegacyAssetUrl(relativeCalpinagePath);
  let p = scriptCache.get(url);
  if (p) return p;

  p = (async () => {
    const token = getAuthToken();
    const hasRender =
      typeof window !== "undefined" &&
      (() => {
        const q = new URLSearchParams(window.location.search);
        return !!(q.get("renderToken") && q.get("studyId") && q.get("versionId"));
      })();
    if (!token && !hasRender) {
      throw new Error(
        `[CALPINAGE] Connexion requise pour charger les moteurs (ou page calpinage-render avec renderToken). URL=${url.split("?")[0]}`
      );
    }

    if (import.meta.env?.DEV) {
      console.debug("[CalpinageDeps] fetch bundle", { url: url.split("?")[0], hasBearer: !!token, hasRender: hasRender });
    }

    const res = token
      ? await apiFetch(url)
      : await fetch(url, { credentials: "include" });

    if (import.meta.env?.DEV) {
      console.debug("[CalpinageDeps] bundle response", { path: relativeCalpinagePath, status: res.status, ok: res.ok });
    }

    if (!res.ok) {
      throw new Error(
        `[CALPINAGE] Bundle refusé ${res.status}: ${url.split("?")[0]}`
      );
    }

    const blobUrl = URL.createObjectURL(await res.blob());
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = blobUrl;
      script.onload = () => {
        URL.revokeObjectURL(blobUrl);
        resolve();
      };
      script.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`[CALPINAGE] Échec exécution script (blob): ${relativeCalpinagePath}`));
      };
      document.head.appendChild(script);
    });
  })();

  scriptCache.set(url, p);
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
const LEGACY_SCRIPTS_RELATIVE = [
  "calpinage/canvas-bundle.js",
  "calpinage/map-selector-bundle.js",
  "calpinage/pans-bundle.js",
  "calpinage/panelProjection.js",
  "calpinage/state/activePlacementBlock.js",
  "calpinage/engine/pvPlacementEngine.js",
  "calpinage/shading/horizonMaskEngine.js",
  "calpinage/shading/nearShadingCore.cjs",
  "calpinage/shading/solarPosition.js",
  "calpinage/shading/horizonMaskSampler.js",
  "calpinage/shading/shadingEngine.js",
  "calpinage/tools/calpinage-panels-adapter.js",
  "calpinage/tools/calpinage-dp2-behavior.js",
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

    // 4. Bundles legacy (ordre calpinage.html) — backend /calpinage/* + JWT ou renderToken
    for (const rel of LEGACY_SCRIPTS_RELATIVE) {
      await loadProtectedCalpinageScriptOnce(rel);
    }

    // 5. Diagnostic et vérification des globals (+ moteurs ombrage : sinon computeCalpinageShading → NO_DEPENDENCIES)
    const win = window as unknown as {
      CalpinageCanvas?: unknown;
      CalpinageMap?: unknown;
      CalpinagePans?: unknown;
      L?: unknown;
      html2canvas?: unknown;
      computeAnnualShadingLoss?: unknown;
      getAnnualSunVectors?: unknown;
      nearShadingCore?: { computeNearShading?: unknown };
    };
    const status = {
      CalpinageCanvas: !!win.CalpinageCanvas,
      CalpinageMap: !!win.CalpinageMap,
      CalpinagePans: !!win.CalpinagePans,
      Leaflet: !!win.L,
      html2canvas: !!win.html2canvas,
      shadingEngine:
        typeof win.computeAnnualShadingLoss === "function" &&
        typeof win.getAnnualSunVectors === "function",
      nearShadingCore:
        !!win.nearShadingCore && typeof win.nearShadingCore.computeNearShading === "function",
    };

    console.info("[CalpinageDeps] OK", status);

    const missing = Object.entries(status)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      const msg = `[CALPINAGE] Dépendances manquantes: ${missing.join(", ")}. Vérifiez que le backend sert /calpinage/* (JWT ou renderToken), CALPINAGE_ENABLED, et en dev Vite : ne pas servir le stub Node shading/nearShadingCore.cjs (proxy backend).`;
      console.error(msg, { missing, status });
      throw new Error(msg);
    }
  })();

  return ensureCalpinageDepsPromise;
}
