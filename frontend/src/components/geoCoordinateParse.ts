/**
 * Parse lat/lon issus de l’API (JSON) — souvent des nombres, parfois des chaînes
 * (ex. PostgreSQL numeric via node-pg).
 */

import { FR_MAP_DEFAULT } from "../modules/leads/LeadDetail/addressFallback";

function parseNumericInRange(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;

  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return null;
    n = Number(t);
  } else {
    return null;
  }

  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/** Latitude WGS84 en degrés, ou null si absent / invalide / hors bornes. */
export function parseGeoLatitude(value: unknown): number | null {
  return parseNumericInRange(value, -90, 90);
}

/** Longitude WGS84 en degrés, ou null si absent / invalide / hors bornes. */
export function parseGeoLongitude(value: unknown): number | null {
  return parseNumericInRange(value, -180, 180);
}

/** Centre carte Géoportail : coords parsées ou repli France métropolitaine. */
export function resolveCoordOrFrance(lat: unknown, lon: unknown): { lat: number; lon: number } {
  const la = parseGeoLatitude(lat);
  const lo = parseGeoLongitude(lon);
  return {
    lat: la ?? FR_MAP_DEFAULT.lat,
    lon: lo ?? FR_MAP_DEFAULT.lon,
  };
}
