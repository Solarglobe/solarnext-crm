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

  const dsmEnable = process.env.DSM_ENABLE === "true";
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const urlTemplate = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();

  if (providerType === "HTTP_GEOTIFF" && urlTemplate && dsmEnable) return true;
  if (providerType === "IGN_RGE_ALTI" && dsmEnable) return true;

  return false;
}

/**
 * Suffixe cache horizon — doit suivre le même critère que le sélecteur (terrain vs relief-only).
 */
export function getHorizonCacheDsmSuffix() {
  if (process.env.HORIZON_DSM_ENABLED !== "true") return ":dsm=0";
  const { provider } = getDsmEnvConfig();
  const dsmEnable = process.env.DSM_ENABLE === "true";
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const urlTemplate = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();
  if (provider === "LOCAL") return ":dsm=real";
  if (providerType === "IGN_RGE_ALTI" && dsmEnable) return ":dsm=ign";
  if (providerType === "HTTP_GEOTIFF" && urlTemplate && dsmEnable) return ":dsm=geotiff";
  return ":dsm=0";
}

/**
 * @returns {string[]}
 */
export function surfaceDsmTerrainNotReadyNotes() {
  const { enabled, provider } = getDsmEnvConfig();
  if (!enabled) return [];
  if (provider === "LOCAL") return [];
  const dsmEnable = process.env.DSM_ENABLE === "true";
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const urlTemplate = (process.env.DSM_GEOTIFF_URL_TEMPLATE || "").trim();
  const parts = [];
  if (providerType === "HTTP_GEOTIFF") {
    if (!dsmEnable) parts.push("DSM_ENABLE=true requis pour HTTP GeoTIFF");
    if (!urlTemplate) parts.push("DSM_GEOTIFF_URL_TEMPLATE requis (ex. https://hôte/{z}/{x}/{y}.tif)");
  } else if (providerType === "IGN_RGE_ALTI") {
    if (!dsmEnable) parts.push("DSM_ENABLE=true requis pour IGN RGE ALTI");
  } else if (providerType === "STUB" || providerType === "") {
    parts.push(
      "DSM_PROVIDER_TYPE=STUB : pas de terrain réel — définir HTTP_GEOTIFF (+ URL) ou IGN_RGE_ALTI ou DSM_PROVIDER=LOCAL"
    );
  } else {
    parts.push("Configuration DSM terrain incomplète pour ce DSM_PROVIDER_TYPE");
  }
  return parts.length ? parts : ["Terrain DSM non prêt (voir DSM_ENABLE, DSM_PROVIDER_TYPE, URL)"];
}
