/**
 * Clé publique Google Maps (restreindre par référent HTTP dans Google Cloud Console).
 * Ne jamais y mettre de secret serveur : uniquement `VITE_*` exposée au bundle.
 */
export function getGoogleMapsApiKey(): string {
  const v = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return v && String(v).trim() ? String(v).trim() : "";
}
