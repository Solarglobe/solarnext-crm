/**
 * useHorizonMaskFetch — Fetch du masque d'horizon lointain après validation GPS.
 *
 * Stratégie :
 *   1. Lit le GPS depuis CALPINAGE_STATE.roof.gps (legacy, source de vérité).
 *   2. Dès qu'un GPS valide est disponible ET que le flag FAR_SHADING est ON,
 *      appelle GET /api/horizon-mask?lat=&lon=&radius=500&step=2.
 *   3. Stocke le résultat dans useCalpinageStore.horizonMask via setHorizonMask.
 *   4. Invalide (clearHorizonMask) si le GPS change de plus de GPS_INVALIDATION_THRESHOLD_DEG.
 *
 * Usage :
 *   // Dans Phase2Sidebar.tsx (appelé une seule fois au montage) :
 *   useHorizonMaskFetch();
 *
 * Guards :
 *   - No-op si VITE_CALPINAGE_FAR_SHADING n'est pas "true" / "1" / "on".
 *   - No-op si GPS absent ou invalide (lat hors [-90,90] ou lon hors [-180,180]).
 *   - Timeout 30 s, AbortController pour cleanup sur démontage.
 *   - Un seul fetch en vol à la fois (guard inFlight).
 */

import { useEffect, useRef } from "react";
import { isEnabled } from "../config/featureFlags";
import { useCalpinageStore } from "../store/calpinageStore";
import { apiFetch } from "../../../services/api";
import { getCrmApiBase } from "../../../config/crmApiBase";
import type { HorizonMaskData } from "../store/storeTypes";

/** Tolérance en degrés pour l'invalidation du masque quand le GPS change. */
const GPS_INVALIDATION_THRESHOLD_DEG = 0.0005; // ~50 m

/** Intervalle du polling GPS (ms) — léger, ne s'arrête que sur cleanup. */
const GPS_POLL_INTERVAL_MS = 2000;

/** Timeout fetch (ms). */
const FETCH_TIMEOUT_MS = 30_000;

/** Rayon horizon (m). */
const HORIZON_RADIUS_M = 500;

/** Pas angulaire (°). */
const HORIZON_STEP_DEG = 2;

type GpsCoords = { lat: number; lon: number };

function readGpsFromLegacy(): GpsCoords | null {
  try {
    const state = (window as unknown as { CALPINAGE_STATE?: { roof?: { gps?: GpsCoords; map?: { centerLatLng?: { lat: number; lng: number } } } } }).CALPINAGE_STATE;
    const roof = state?.roof;
    if (!roof) return null;

    const g = roof.gps;
    if (g && typeof g.lat === "number" && typeof g.lon === "number" && !Number.isNaN(g.lat) && !Number.isNaN(g.lon)) {
      if (g.lat >= -90 && g.lat <= 90 && g.lon >= -180 && g.lon <= 180) return g;
    }

    // Fallback : centre carte
    const c = roof.map?.centerLatLng;
    if (c && typeof c.lat === "number" && typeof c.lng === "number" && !Number.isNaN(c.lat) && !Number.isNaN(c.lng)) {
      if (c.lat >= -90 && c.lat <= 90 && c.lng >= -180 && c.lng <= 180) {
        return { lat: c.lat, lon: c.lng };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function gpsDistance(a: GpsCoords, b: GpsCoords): number {
  return Math.max(Math.abs(a.lat - b.lat), Math.abs(a.lon - b.lon));
}

export function useHorizonMaskFetch(): void {
  const setHorizonMask = useCalpinageStore((s) => s.setHorizonMask);
  const clearHorizonMask = useCalpinageStore((s) => s.clearHorizonMask);
  const currentMask = useCalpinageStore((s) => s.horizonMask);

  const inFlightRef = useRef(false);
  const lastFetchedGpsRef = useRef<GpsCoords | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isEnabled("FAR_SHADING")) return;

    let cancelled = false;

    async function doFetch(gps: GpsCoords): Promise<void> {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const apiBase = getCrmApiBase() || window.location.origin;
        const url = `${apiBase}/api/horizon-mask?lat=${encodeURIComponent(gps.lat)}&lon=${encodeURIComponent(gps.lon)}&radius=${HORIZON_RADIUS_M}&step=${HORIZON_STEP_DEG}`;

        const res = await apiFetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (!res.ok) return;

        const json = await res.json();
        if (cancelled) return;

        const mask = json?.mask;
        if (!Array.isArray(mask) || mask.length === 0) return;

        const data: HorizonMaskData = {
          mask,
          step_deg: json.step_deg ?? HORIZON_STEP_DEG,
          source: json.source ?? json?.meta?.source ?? "RELIEF_ONLY",
          confidence: json.confidence,
          meta: json.meta,
          dataCoverage: json.dataCoverage,
          computedForGps: { lat: gps.lat, lon: gps.lon },
          fetchedAt: Date.now(),
        };

        lastFetchedGpsRef.current = gps;
        setHorizonMask(data);
      } catch {
        // timeout / réseau : silencieux, le calcul se fait sans far shading
      } finally {
        clearTimeout(timeoutId);
        inFlightRef.current = false;
      }
    }

    const intervalId = setInterval(() => {
      if (cancelled) return;
      const gps = readGpsFromLegacy();
      if (!gps) return;

      const prev = lastFetchedGpsRef.current;

      // GPS a changé → invalider le masque stocké
      if (prev && gpsDistance(gps, prev) > GPS_INVALIDATION_THRESHOLD_DEG) {
        clearHorizonMask();
        lastFetchedGpsRef.current = null;
      }

      // Si masque déjà dans le store pour ce GPS → pas de re-fetch
      if (currentMask && lastFetchedGpsRef.current && gpsDistance(gps, lastFetchedGpsRef.current) <= GPS_INVALIDATION_THRESHOLD_DEG) {
        return;
      }

      doFetch(gps);
    }, GPS_POLL_INTERVAL_MS);

    // Premier essai immédiat
    const gps = readGpsFromLegacy();
    if (gps) doFetch(gps);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
