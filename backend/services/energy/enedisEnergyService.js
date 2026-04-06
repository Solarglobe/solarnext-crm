/**
 * CP-ENERGY-003 — Service Enedis Energy complet
 *
 * Pipeline : Enedis API → normalizeEnedisLoadCurve → buildEnergyProfile → SolarNextEnergyProfile
 */

import { normalizeEnedisLoadCurve } from "./enedisNormalizer.js";
import { buildEnergyProfile } from "./energyProfileBuilder.js";

const API_BASE = process.env.ENEDIS_API_BASE_URL || "https://api.enedis.fr";
const API_PATH = "/metering_data/consumption_load_curve";
const TIMEOUT_MS = 10000;

/**
 * Profil fallback en cas d'erreur (data vide, pas de crash).
 * @param {string} pdl
 * @returns {import("./energyProfileBuilder.js").SolarNextEnergyProfile}
 */
function fallbackProfile(pdl) {
  return buildEnergyProfile({
    pdl: pdl || "",
    source: "enedis",
    interval: "30m",
    data: [],
  });
}

/**
 * Récupère la courbe de charge Enedis et la retourne en SolarNextEnergyProfile.
 * En cas d'erreur (réseau, API, timeout), retourne un profil vide sans faire planter le serveur.
 *
 * @param {Object} params
 * @param {string} params.accessToken - OAuth token Enedis
 * @param {string} [params.usagePointId] - PDL
 * @param {string} params.start - date début (ex. YYYY-MM-DD)
 * @param {string} params.end - date fin
 * @param {{ fetchFn?: typeof fetch }} [opts] - optionnel : fetch à injecter (tests)
 * @returns {Promise<import("./energyProfileBuilder.js").SolarNextEnergyProfile>}
 */
export async function fetchEnedisEnergyProfile(
  { accessToken, usagePointId, start, end },
  opts = {}
) {
  const fetchFn = opts.fetchFn ?? fetch;
  const pdl = usagePointId ?? "";

  const url = new URL(API_PATH, API_BASE);
  url.searchParams.set("usage_point_id", pdl || "");
  url.searchParams.set("start", start ?? "");
  url.searchParams.set("end", end ?? "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("ENEDIS_API_ERROR", res.status, text?.slice(0, 200) || res.statusText);
      return fallbackProfile(pdl);
    }

    const enedisResponse = await res.json().catch(() => null);
    if (enedisResponse == null) {
      console.warn("ENEDIS_API_ERROR", "Invalid JSON response");
      return fallbackProfile(pdl);
    }

    const normalized = normalizeEnedisLoadCurve(enedisResponse);
    const profile = buildEnergyProfile({
      pdl: normalized.pdl || pdl,
      source: "enedis",
      interval: "30m",
      data: normalized.data,
    });
    return profile;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("ENEDIS_API_ERROR", err?.message ?? String(err));
    return fallbackProfile(pdl);
  }
}
