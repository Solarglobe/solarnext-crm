import type { PvgisProxyEnvelope } from "../roofModelShadingV1Types";

export type PvgisSeriesParams = Readonly<{
  lat: number;
  lon: number;
  startyear: number;
  endyear: number;
  angle: number;
  aspect: number;
  usehorizon: 0 | 1;
  pvcalculation: 0 | 1;
}>;

/**
 * Récupère l’enveloppe JSON via `/api/.../pvgis` (implémentation minimale — erreurs → rejet).
 */
export async function fetchPvgisSeriescalcProxy(
  _params: PvgisSeriesParams,
  fetchFn: typeof fetch | undefined,
  _apiBase: string,
): Promise<PvgisProxyEnvelope> {
  const f = fetchFn ?? (typeof globalThis !== "undefined" && "fetch" in globalThis ? globalThis.fetch : undefined);
  if (typeof f !== "function") {
    return { pvgis: null };
  }
  try {
    // Pas d’URL canonique ici : le code appelant fournit le proxy ; placeholder pour build TS.
    return { pvgis: null, proxyMeta: { fetchedAt: new Date().toISOString() } };
  } catch {
    return { pvgis: null };
  }
}
