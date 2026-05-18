/**
 * Calcul du metersPerPixel (mpp) Web Mercator.
 *
 * Formule identique à `metersPerPixelDP4(lat, zoom)` dans calpinage.module.js.
 * INITIAL_RES = 2π * EARTH_RADIUS / 256 = 156543.03392804097 m/px à zoom 0.
 *
 * Référence : OpenStreetMap wiki / Mapbox — Web Mercator tile resolution.
 * Ne pas modifier sans aligner avec frontend/dp-tool/dp-app.js.
 *
 * @param zoom    Niveau de zoom Google Maps / Leaflet (entier ≥ 0)
 * @param latDeg  Latitude du centre (degrés décimaux)
 * @returns       mpp en mètres par pixel image — null si paramètres invalides
 */

/** Résolution initiale Web Mercator au zoom 0 (tuiles 256 px). */
export const MERCATOR_INITIAL_RES = 156543.03392804097;

export function computeMpp(zoom: number, latDeg: number): number | null {
  if (
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    typeof latDeg !== "number" ||
    !Number.isFinite(latDeg)
  ) {
    return null;
  }
  return (MERCATOR_INITIAL_RES * Math.cos((latDeg * Math.PI) / 180)) / Math.pow(2, zoom);
}
