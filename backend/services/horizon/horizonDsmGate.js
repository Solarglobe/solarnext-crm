/**
 * POINT 6D — Point unique : savoir si le SurfaceDsmProvider peut produire un terrain réel
 * (aligné sur computeMask dans surfaceDsmProvider.js).
 */

import { getDsmEnvConfig } from "./providers/dsm/dsmConfig.js";

/**
 * @returns {boolean} true si surfaceDsmProvider.computeMask peut emprunter une branche terrain réel
 * (LOCAL, HTTP_GEOTIFF+URL+DSM_ENABLE, IGN_RGE_ALTI+DSM_ENABLE) — pas le stub synthétique.
 */
export function isSurfaceDsmTerrainReady() {
  const { enabled, provider } = getDsmEnvConfig();
  if (!enabled) return false;

  if (provider === "LOCAL") return true;

  const dsmEnable    = process.env.DSM_ENABLE === "true";
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const urlTemplate  = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();

  if (providerType === "HTTP_GEOTIFF" && urlTemplate && dsmEnable) return true;
  if (providerType === "IGN_RGE_ALTI" && dsmEnable) return true;

  return false;
}

/**
 * Suffixe cache horizon.
 * Avec la nouvelle architecture (IGN Géoplateforme + PVGIS) :
 *   - HTTP_GEOTIFF configuré → :dsm=geotiff
 *   - Sinon               → :dsm=api  (IGN ou PVGIS — tous deux terrain réel)
 * Les clés existantes :dsm=0 / :dsm=ign / :dsm=real sont naturellement invalidées
 * par ce changement (TTL 30j garantit la cohérence).
 */
export function getHorizonCacheDsmSuffix() {
  const providerType = (process.env.DSM_PROVIDER_TYPE || "").toUpperCase();
  const urlTemplate  = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();
  const dsmEnable    = process.env.DSM_ENABLE === "true";

  // CP-FAR-MNS-01 — Le produit sursol (MNS/MNH) doit entrer dans la clé de cache,
  // sinon un horizon « terrain nu » déjà mémorisé serait resservi après bascule MNS.
  // Défaut MNT → suffixe vide → clés historiques inchangées.
  const product    = (process.env.DSM_PRODUCT || "MNT").toUpperCase();
  const prodSuffix = (dsmEnable && (product === "MNS" || product === "MNH")) ? `:prod=${product}` : "";

  if (providerType === "HTTP_GEOTIFF" && urlTemplate && dsmEnable) {
    return ":dsm=geotiff" + prodSuffix;
  }

  return ":dsm=api" + prodSuffix;   // IGN Géoplateforme ou PVGIS selon disponibilité
}

/**
 * @returns {string[]}
 */
export function surfaceDsmTerrainNotReadyNotes() {
  const { enabled, provider } = getDsmEnvConfig();
  if (!enabled) return [];
  if (provider === "LOCAL") return [];
  const dsmEnable    = process.env.DSM_ENABLE === "true";
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const urlTemplate  = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();
  const parts = [];
  if (providerType === "HTTP_GEOTIFF") {
    if (!dsmEnable)    parts.push("DSM_ENABLE=true requis pour HTTP GeoTIFF");
    if (!urlTemplate)  parts.push("DSM_GEOTIFF_URL_TEMPLATE requis (ex. https://hôte/{z}/{x}/{y}.tif)");
  } else if (providerType === "IGN_RGE_ALTI") {
    if (!dsmEnable)    parts.push("DSM_ENABLE=true requis pour IGN RGE ALTI");
  } else if (providerType === "STUB" || providerType === "") {
    parts.push(
      "DSM_PROVIDER_TYPE=STUB : pas de terrain réel — définir HTTP_GEOTIFF (+ URL) ou IGN_RGE_ALTI ou DSM_PROVIDER=LOCAL"
    );
  } else {
    parts.push("Configuration DSM terrain incomplète pour ce DSM_PROVIDER_TYPE");
  }
  return parts.length ? parts : ["Terrain DSM non prêt (voir DSM_ENABLE, DSM_PROVIDER_TYPE, URL)"];
}
