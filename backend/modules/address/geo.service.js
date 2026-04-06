/**
 * CP-028 — Service Geo provider-agnostic
 * Default: IGN Geoplateforme (data.geopf.fr)
 * api-adresse.data.gouv.fr décommissionnée fin janv 2026
 */

import fetch from "node-fetch";

const GEO_PROVIDER = process.env.GEO_PROVIDER || "IGN_GPF";
const GEO_BASE_URL = process.env.GEO_BASE_URL || "https://data.geopf.fr/geocodage";

// Fallback BAN si IGN indisponible (transition)
const BAN_URL = "https://api-adresse.data.gouv.fr/search";

const PRECISION_LEVELS = [
  "UNKNOWN",
  "COUNTRY",
  "CITY",
  "POSTAL_CODE",
  "STREET",
  "HOUSE_NUMBER_INTERPOLATED",
  "ROOFTOP_BUILDING",
  "MANUAL_PIN_BUILDING"
];

/**
 * Mapping robuste type provider → precision_level SolarGlobe
 * Ne jamais inventer ROOFTOP_BUILDING si l'API ne le garantit pas
 */
function mapPrecisionLevel(feature, provider) {
  if (!feature?.properties) return "STREET";

  const props = feature.properties;
  const type = (props.type || props.kind || "").toLowerCase();
  const coords = feature.geometry?.coordinates;

  // Règle métier : autocomplete = provisoire, jamais ROOFTOP_BUILDING.
  // La seule façon d'obtenir MANUAL_PIN_BUILDING = validation via overlay Géoportail.
  if (coords && (type === "housenumber" || type === "house")) {
    return "HOUSE_NUMBER_INTERPOLATED";
  }

  // Sinon selon granularité
  if (type === "street" || type === "road") return "STREET";
  if (type === "municipality" || type === "city") return "CITY";
  if (type === "postcode" || type === "postal_code") return "POSTAL_CODE";
  if (type === "country") return "COUNTRY";

  return "STREET";
}

/**
 * Transforme score provider en 0-100
 */
function mapConfidence(props) {
  const score = props?.score ?? props?.importance ?? props?.relevance;
  if (score == null) return null;
  const n = Number(score);
  if (Number.isNaN(n)) return null;
  if (n <= 1) return Math.round(n * 100);
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Fabrique un place_id stable si absent
 */
function makePlaceId(label, lon, lat) {
  const str = `${label || ""}_${lon}_${lat}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return `ign_${Math.abs(h).toString(36)}`;
}

/**
 * Parse une feature GeoJSON (BAN/IGN compatible) en suggestion SolarGlobe
 */
function featureToSuggestion(feature, provider) {
  const coords = feature.geometry?.coordinates;
  const [lon, lat] = Array.isArray(coords) ? coords : [null, null];

  const props = feature.properties || {};
  const label =
    props.label ||
    props.name ||
    [props.address_line1, props.postal_code, props.city].filter(Boolean).join(", ") ||
    "";

  const placeId = props.id || props.place_id || makePlaceId(label, lon, lat);

  const addressLine1 =
    props.address_line1 ||
    props.street ||
    (props.housenumber && props.street ? `${props.housenumber} ${props.street}` : props.name);

  const components = {
    address_line1: addressLine1 || null,
    postal_code: props.postal_code || props.postcode || null,
    city: props.city || props.municipality || null,
    country_code: props.country_code || props.country || "FR"
  };

  return {
    place_id: placeId,
    label,
    provider: provider,
    precision_level: mapPrecisionLevel(feature, provider),
    confidence: mapConfidence(props),
    lat: lat != null ? Number(lat) : null,
    lon: lon != null ? Number(lon) : null,
    components
  };
}

/**
 * GET /geo/autocomplete
 * Appel search IGN ou BAN
 */
export async function autocomplete(q, options = {}) {
  const limit = Math.min(Number(options.limit) || 10, 20);
  const country = options.country || "FR";

  let features = [];
  let provider = GEO_PROVIDER;

  try {
    if (GEO_PROVIDER === "IGN_GPF") {
      const url = `${GEO_BASE_URL}/search?q=${encodeURIComponent(q)}&limit=${limit}&autocomplete=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = await res.json();
        features = json.features || json.results || [];
      }
    }
  } catch (e) {
    console.warn("[geo] IGN GPF error:", e.message);
  }

  // Fallback BAN si IGN vide ou erreur
  if (features.length === 0) {
    try {
      const url = `${BAN_URL}?q=${encodeURIComponent(q)}&limit=${limit}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = await res.json();
        features = json.features || [];
        provider = "BAN";
      }
    } catch (e) {
      console.warn("[geo] BAN fallback error:", e.message);
    }
  }

  const suggestions = features.map((f) => featureToSuggestion(f, provider));
  return { suggestions };
}

/**
 * POST /geo/resolve
 * Resolve par place_id — IGN ne permet pas resolve direct par place_id.
 * Stratégie : on accepte resolve, mais place_id inconnu → 404.
 * Option : cache LRU court (non implémenté pour rester simple).
 * Pour l'instant : resolve = no-op si autocomplete fournit déjà tout.
 * On retourne 404 car on n'a pas de cache.
 */
export async function resolve(placeId, provider) {
  // Pas de resolve direct IGN par place_id
  // Retourner 404 — le client doit utiliser autocomplete comme source unique
  return null;
}
