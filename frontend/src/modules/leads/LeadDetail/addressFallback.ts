/**
 * Secours progressif adresse fiche lead — parsing FR léger + classification précision
 */

export const FR_MAP_DEFAULT = { lat: 46.5, lon: 2.5 } as const;

export type AddressFallbackTier = "none" | "street_city" | "city_only";

/** Origine de la sélection dans la liste (secours B/C ou recherche normale) */
export type AddressPickTier = "normal" | "fallback_street" | "fallback_city";

export type AddressQualityUi =
  | "exact"
  | "approx_street"
  | "approx_city"
  | "pending_manual"
  | "validated";

/** Suggestions IGN/BAN avec géométrie exploitable */
export function filterExploitableSuggestions<T extends { lat: number | null; lon: number | null }>(
  list: T[]
): T[] {
  return (list || []).filter(
    (s) =>
      typeof s.lat === "number" &&
      typeof s.lon === "number" &&
      !Number.isNaN(s.lat) &&
      !Number.isNaN(s.lon)
  );
}

/**
 * Extrait CP, rue et ville probable depuis une ligne libre (heuristique FR).
 * Ex. "12 impasse des lilas 77500 chelles" → rue + Chelles
 */
export function parseFrenchAddressParts(raw: string): {
  postalCode: string | null;
  cityGuess: string | null;
  streetPart: string | null;
  /** Requête "rue + ville" pour niveau B */
  queryStreetCity: string | null;
  /** Requête ville seule (niveau C) */
  queryCityOnly: string | null;
} {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 3) {
    return {
      postalCode: null,
      cityGuess: null,
      streetPart: null,
      queryStreetCity: null,
      queryCityOnly: null,
    };
  }

  const cpMatch = trimmed.match(/\b(\d{5})\b/);
  const postalCode = cpMatch ? cpMatch[1] : null;

  let restAfterCp = trimmed;
  if (postalCode) {
    const idx = trimmed.indexOf(postalCode);
    restAfterCp = trimmed.slice(idx + 5).trim().replace(/^[,;]\s*/, "");
  }

  const cityGuess =
    restAfterCp.length >= 2
      ? restAfterCp
          .split(/[,;]/)
          .map((p) => p.trim())
          .filter(Boolean)
          .pop() || null
      : null;

  let streetPart: string | null = trimmed;
  if (postalCode) {
    const before = trimmed.slice(0, trimmed.indexOf(postalCode)).trim();
    streetPart = before.replace(/[,;]\s*$/, "").trim() || null;
  }

  let queryStreetCity: string | null = null;
  if (cityGuess && streetPart) {
    if (streetPart.toLowerCase() === cityGuess.toLowerCase()) {
      queryStreetCity = cityGuess;
    } else {
      const streetNoNum = streetPart.replace(/^\d+\s*/, "").trim();
      const core = streetNoNum.length >= 3 ? streetNoNum : streetPart;
      queryStreetCity = `${core} ${cityGuess}`.trim();
    }
  } else if (cityGuess && !streetPart) {
    queryStreetCity = cityGuess;
  }

  const queryCityOnly = cityGuess || postalCode;

  return {
    postalCode,
    cityGuess,
    streetPart,
    queryStreetCity,
    queryCityOnly,
  };
}

const LOW_PRECISION_LEVELS = new Set([
  "STREET",
  "CITY",
  "POSTAL_CODE",
  "COUNTRY",
  "UNKNOWN",
]);

/** Rue/ville/code sans numéro précis au bâtiment → confiance basse côté produit */
export function isLowConfidencePrecision(precisionLevel?: string | null): boolean {
  if (!precisionLevel) return false;
  return LOW_PRECISION_LEVELS.has(precisionLevel);
}

export function isHouseNumberPrecision(precisionLevel?: string | null): boolean {
  return precisionLevel === "HOUSE_NUMBER_INTERPOLATED";
}

export function qualityUiFromSite(opts: {
  isGeoVerified: boolean;
  geoPrecisionLevel?: string | null;
  hasLatLon: boolean;
  geoSource?: string | null;
}): AddressQualityUi {
  if (opts.isGeoVerified) return "validated";
  if (!opts.hasLatLon || opts.geoSource === "manual_map_pending") return "pending_manual";
  if (opts.geoSource === "autocomplete_fallback_city") return "approx_city";
  if (opts.geoSource === "autocomplete_fallback_street") return "approx_street";
  if (opts.geoPrecisionLevel && isLowConfidencePrecision(opts.geoPrecisionLevel)) {
    return opts.geoPrecisionLevel === "CITY" || opts.geoPrecisionLevel === "POSTAL_CODE"
      ? "approx_city"
      : "approx_street";
  }
  if (opts.geoPrecisionLevel && isHouseNumberPrecision(opts.geoPrecisionLevel)) return "exact";
  return "exact";
}
