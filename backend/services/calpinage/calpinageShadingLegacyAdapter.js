/**
 * CP-FAR-013 — Adaptateur legacy shading → V2
 * Si schemaVersion absent, adapter vers V2 en lecture.
 */

import { normalizeCalpinageShading } from "./calpinageShadingNormalizer.js";

/**
 * Adapte un shading legacy (sans schemaVersion) vers structure V2.
 * Ne modifie pas les données déjà en V2.
 * @param {object} rawShading - shading depuis geometry (legacy ou V2)
 * @param {string} [schemaVersion] - schemaVersion du calpinage_data
 * @returns {object} Shading normalisé V2
 */
export function adaptLegacyShadingToV2(rawShading, schemaVersion) {
  if (!rawShading || typeof rawShading !== "object") {
    return normalizeCalpinageShading(null);
  }
  if (schemaVersion === "v2") {
    return normalizeCalpinageShading(rawShading);
  }
  const meta = {};
  if (rawShading.far) {
    meta.step_deg = rawShading.far.step_deg;
    meta.resolution_m = rawShading.far.resolution_m ?? rawShading.far.dataCoverage?.gridResolutionMeters;
    meta.algorithm = rawShading.far.algorithm ?? rawShading.far.meta?.algorithm;
  }
  return normalizeCalpinageShading(rawShading, meta);
}

/**
 * Extrait et normalise le shading depuis geometry_json.
 * Gère legacy (sans schemaVersion) et V2.
 * @param {object} geometry - geometry_json
 * @returns {{ shading: object, schemaVersion: string|null }}
 */
export function getNormalizedShadingFromGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return { shading: normalizeCalpinageShading(null), schemaVersion: null };
  }
  const schemaVersion = geometry.schemaVersion ?? null;
  const rawShading = geometry.shading;
  const shading = adaptLegacyShadingToV2(rawShading, schemaVersion);
  return { shading, schemaVersion };
}
