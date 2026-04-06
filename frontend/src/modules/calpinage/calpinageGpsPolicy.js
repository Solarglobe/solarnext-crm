/**
 * Politique centrage / zoom initial calpinage — GPS officiel lead vs reprise géométrie existante
 */

/**
 * @param {{ is_geo_verified?: boolean, geo_precision_level?: string|null, geo_source?: string|null }|null|undefined} meta
 * @returns {number} niveau de zoom Google Maps (0–22)
 */
export function computeInitialZoomFromLeadMeta(meta) {
  if (!meta || typeof meta !== "object") return 19;
  if (meta.is_geo_verified === true && meta.geo_precision_level === "MANUAL_PIN_BUILDING") return 21;
  if (meta.is_geo_verified === true) return 20;
  var pl = meta.geo_precision_level || "";
  if (pl === "HOUSE_NUMBER_INTERPOLATED") return 20;
  if (pl === "STREET" || meta.geo_source === "autocomplete_fallback_street") return 18;
  if (
    pl === "CITY" ||
    pl === "POSTAL_CODE" ||
    pl === "COUNTRY" ||
    pl === "UNKNOWN" ||
    meta.geo_source === "autocomplete_fallback_city"
  ) {
    return 16;
  }
  return 19;
}

/**
 * Vrai travail calpinage déjà présent → on ne doit pas écraser avec le GPS lead.
 * @param {Record<string, unknown>|null|undefined} state — typiquement window.CALPINAGE_STATE
 */
export function hasSeriousCalpinageGeometry(state) {
  if (!state || typeof state !== "object") return false;
  var roof = state.roof;
  if (roof && roof.image && typeof roof.image.dataUrl === "string" && roof.image.dataUrl.length > 32) return true;
  if (state.roofSurveyLocked === true) return true;
  var vrd = state.validatedRoofData;
  if (vrd && vrd.pans && Array.isArray(vrd.pans) && vrd.pans.length > 0) return true;
  var fb = state.frozenBlocks;
  if (Array.isArray(fb) && fb.some(function (b) { return b && b.panels && Array.isArray(b.panels) && b.panels.length > 0; })) return true;
  var contours = state.contours;
  if (Array.isArray(contours) && contours.some(function (c) { return c && c.points && c.points.length >= 3; })) return true;
  var ridges = state.ridges;
  if (Array.isArray(ridges) && ridges.length > 0) return true;
  var obstacles = state.obstacles;
  if (Array.isArray(obstacles) && obstacles.length > 0) return true;
  var pans = state.pans;
  if (Array.isArray(pans) && pans.length > 0) return true;
  return false;
}

/**
 * Centre carte depuis état / géométrie déjà sauvegardée (roof.map, roofState, mapCenter).
 * @param {Record<string, unknown>|null|undefined} stateOrGeom
 * @returns {[number, number]|null}
 */
export function getCenterFromSavedGeometry(stateOrGeom) {
  if (!stateOrGeom || typeof stateOrGeom !== "object") return null;
  var mapCenter =
    (stateOrGeom.roofState &&
      stateOrGeom.roofState.map &&
      stateOrGeom.roofState.map.centerLatLng) ||
    stateOrGeom.mapCenter ||
    (stateOrGeom.roof && stateOrGeom.roof.map && stateOrGeom.roof.map.centerLatLng);
  if (
    mapCenter &&
    typeof mapCenter.lat === "number" &&
    typeof mapCenter.lng === "number" &&
    !Number.isNaN(mapCenter.lat) &&
    !Number.isNaN(mapCenter.lng)
  ) {
    return [mapCenter.lat, mapCenter.lng];
  }
  return null;
}

/**
 * @param {{ is_geo_verified?: boolean, geo_precision_level?: string|null, geo_source?: string|null }|null} meta
 */
export function getGpsPrecisionHintMessage(meta) {
  if (!meta) return null;
  if (meta.is_geo_verified === true && meta.geo_precision_level === "MANUAL_PIN_BUILDING") return null;
  var pl = meta.geo_precision_level || "";
  if (pl === "CITY" || pl === "POSTAL_CODE" || pl === "COUNTRY" || meta.geo_source === "autocomplete_fallback_city") {
    return "Position issue de la commune / zone large — vérifiez que vous êtes sur le bon bâtiment avant de dessiner.";
  }
  if (pl === "STREET" || meta.geo_source === "autocomplete_fallback_street") {
    return "Position initiale approximative (rue) — ajustez si nécessaire avant de dessiner.";
  }
  if (!meta.is_geo_verified && (pl === "HOUSE_NUMBER_INTERPOLATED" || pl === "")) {
    return "Position initiale à confirmer — cadrez précisément la bonne toiture avant capture.";
  }
  return null;
}

/**
 * GPS de travail confirmé avant capture : priorité marqueur carte > dernier point connu > centre vue (cadre).
 * @param {{ lat: number, lng: number }|null|undefined} markerPos
 * @param {{ lat: number, lon: number }|null|undefined} lastFallback
 * @param {{ lat: number, lng: number }|null|undefined} mapCenter
 * @returns {{ lat: number, lon: number }|null}
 */
export function pickConfirmedBuildingGps(markerPos, lastFallback, mapCenter) {
  if (
    markerPos &&
    typeof markerPos.lat === "number" &&
    typeof markerPos.lng === "number" &&
    !Number.isNaN(markerPos.lat) &&
    !Number.isNaN(markerPos.lng)
  ) {
    return { lat: markerPos.lat, lon: markerPos.lng };
  }
  if (
    lastFallback &&
    typeof lastFallback.lat === "number" &&
    typeof lastFallback.lon === "number" &&
    !Number.isNaN(lastFallback.lat) &&
    !Number.isNaN(lastFallback.lon)
  ) {
    return { lat: lastFallback.lat, lon: lastFallback.lon };
  }
  if (
    mapCenter &&
    typeof mapCenter.lat === "number" &&
    typeof mapCenter.lng === "number" &&
    !Number.isNaN(mapCenter.lat) &&
    !Number.isNaN(mapCenter.lng)
  ) {
    return { lat: mapCenter.lat, lon: mapCenter.lng };
  }
  return null;
}
