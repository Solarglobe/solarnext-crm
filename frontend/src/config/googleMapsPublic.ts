/**
 * Clé publique Google Maps (restreindre par référent HTTP dans Google Cloud Console).
 * Ne jamais y mettre de secret serveur : uniquement `VITE_*` exposée au bundle.
 */
export const GOOGLE_MAPS_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || "";

let googleMapsKeyStartupLogged = false;
function logGoogleMapsKeyStatusOnce() {
  if (googleMapsKeyStartupLogged) return;
  googleMapsKeyStartupLogged = true;
  const ok = String(GOOGLE_MAPS_KEY).trim().length > 0;
  console.log("GOOGLE MAPS KEY:", ok ? "OK" : "MISSING");
}
logGoogleMapsKeyStatusOnce();

/**
 * Résolution de la clé : `import.meta.env` (build Vite) puis repli `window` si injectée (ex. `vite-public-runtime.js`).
 */
export function getGoogleMapsApiKey(): string {
  if (String(GOOGLE_MAPS_KEY).trim()) {
    return String(GOOGLE_MAPS_KEY).trim();
  }
  if (typeof window !== "undefined") {
    const w = window as unknown as { __VITE_GOOGLE_MAPS_API_KEY__?: string };
    const k = w.__VITE_GOOGLE_MAPS_API_KEY__;
    if (k && String(k).trim()) return String(k).trim();
  }
  return "";
}
