/**
 * CP-FAR-007 — Sélecteur de provider horizon
 * SURFACE_DSM si disponible (DSM_REAL ou stub), sinon RELIEF_ONLY.
 * Si HORIZON_DSM_ENABLED true => essayer SURFACE_DSM d'abord, fallback RELIEF_ONLY si échec.
 */

import * as reliefOnlyProvider from "./reliefOnlyProvider.js";
import * as surfaceDsmProvider from "./surfaceDsmProvider.js";

/**
 * @param {{ lat: number, lon: number, radius_m: number }} params
 * @returns {import("./reliefOnlyProvider.js") | import("./surfaceDsmProvider.js")}
 */
export function selectBestProvider(params) {
  const dsmAvail = surfaceDsmProvider.isAvailable(params);
  if (dsmAvail.available) {
    return surfaceDsmProvider;
  }
  return reliefOnlyProvider;
}

/**
 * @param {{ lat: number, lon: number, radius_m: number, step_deg: number }} params
 * @returns {Promise<{ source, radius_m, step_deg, resolution_m, mask, confidence, dataCoverage, meta? }>}
 */
export async function computeHorizonMaskAuto(params) {
  const dsmAvail = surfaceDsmProvider.isAvailable(params);
  const provider = selectBestProvider(params);
  const providerName = provider?.getMode ? provider.getMode() : "unknown";
  console.log("[DSM SELECTOR] using:", providerName);

  let result;
  try {
    result = await Promise.resolve(provider.computeMask({ ...params }));
  } catch (err) {
    result = await reliefOnlyProvider.computeMask({ ...params });
    result.dataCoverage = {
      ...result.dataCoverage,
      notes: [...(result.dataCoverage.notes || []), "DSM failed: " + (err?.message || "unknown")],
    };
    if (!result.meta) result.meta = {};
    result.meta.fallbackReason = "SURFACE_DSM_EXCEPTION";
    result.meta.fallbackDetail = String(err?.message || "unknown").slice(0, 500);
  }

  const dcProv = result?.dataCoverage?.provider;
  const fb = result?.meta?.fallbackReason;
  if (fb || dcProv === "RELIEF_ONLY") {
    console.log(
      "[HORIZON] mask outcome dataCoverage.provider=" +
        (dcProv ?? "n/a") +
        (fb ? " meta.fallbackReason=" + fb : "")
    );
  }

  if (provider === reliefOnlyProvider && !dsmAvail.available) {
    result.dataCoverage = {
      ...result.dataCoverage,
      notes: [...(result.dataCoverage.notes || []), ...dsmAvail.notes],
    };
  }

  if (!result.meta) result.meta = {};
  if (result.meta.source == null) {
    result.meta.source = result.source === "SURFACE_DSM" ? "SURFACE_DSM" : "RELIEF_ONLY";
  }

  return result;
}
