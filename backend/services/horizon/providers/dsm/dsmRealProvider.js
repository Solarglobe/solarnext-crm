/**
 * CP-FAR-008 — DSM Real Provider (LOCAL fixtures)
 * Fournit une surface d'élévation exploitable par computeHorizonMask*.
 * Si échec (fetch, parse, manque tiles) => throw contrôlé capturé par selector => fallback RELIEF_ONLY.
 */

import { dsmGridToHorizonMask } from "./dsmToHorizonMask.js";
import { getDsmEnvConfig } from "./dsmConfig.js";

const DEBUG = process.env.DSM_DEBUG === "true" || process.env.FAR_DEBUG === "true";

function log(...args) {
  if (DEBUG) console.log("[DSM:Real]", ...args);
}

/**
 * Crée une grille DSM fixture réaliste (64x64) pour tests urbains.
 * Observer au centre (zRef), obstacles autour (bâtiments/relief) → elev > 0.
 * Règle: elev = atan2(zObstacle - zRef, distance) en degrés.
 * @param {{ lat: number, lon: number }} center
 * @param {{ radius_m?: number }} opts - rayon couvert (défaut 1000m)
 * @returns {{ grid: Float32Array, width: number, height: number, origin: { lat: number, lon: number }, stepMeters: number, meta: object }}
 */
function createLocalFixtureGrid(center, opts = {}) {
  const radiusM = opts.radius_m ?? 1000;
  const STEP_METERS = 25;
  const SIZE = Math.max(64, Math.ceil((2 * radiusM) / STEP_METERS));
  const WIDTH = SIZE;
  const HEIGHT = SIZE;
  const M_PER_DEG_LAT = 111320;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  const dLat = (HEIGHT * STEP_METERS) / M_PER_DEG_LAT;
  const dLon = (WIDTH * STEP_METERS) / mPerDegLon;

  const origin = {
    lat: center.lat + dLat / 2,
    lon: center.lon - dLon / 2,
  };

  const grid = new Float32Array(WIDTH * HEIGHT);
  const zRef = 50;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = y * WIDTH + x;
      const cx = x - WIDTH / 2;
      const cy = y - HEIGHT / 2;
      const distPx = Math.sqrt(cx * cx + cy * cy);
      const distM = distPx * STEP_METERS;
      const bumpSouth = 40 * Math.exp(-(Math.pow(cy + 8, 2) + cx * cx) / 200);
      const bumpEast = 30 * Math.exp(-(Math.pow(cx - 10, 2) + cy * cy) / 150);
      const bumpWest = 28 * Math.exp(-(Math.pow(cx + 10, 2) + cy * cy) / 150);
      const ring = distM > 100 && distM < 350 ? 25 * Math.exp(-Math.pow(distM - 200, 2) / 15000) : 0;
      grid[idx] = zRef + bumpSouth + bumpEast + bumpWest + ring;
    }
  }

  return {
    kind: "DSM_REAL",
    grid,
    width: WIDTH,
    height: HEIGHT,
    origin,
    stepMeters: STEP_METERS,
    meta: {
      provider: "LOCAL",
      source: "DSM_REAL",
      fixture: true,
    },
  };
}

/**
 * @param {{ lat: number, lon: number, radius_m: number, step_deg: number }} params
 * @returns {Promise<{ kind: "DSM_REAL", sampler: object, meta: object, dsmResult: object }>}
 * @throws {Error} si DSM indisponible
 */
export async function fetchDsmReal(params) {
  const { enabled, provider } = getDsmEnvConfig();
  if (!enabled) {
    throw new Error("HORIZON_DSM_ENABLED not set");
  }

  if (provider === "LOCAL") {
    const dsmResult = createLocalFixtureGrid(
      { lat: params.lat, lon: params.lon },
      { radius_m: params.radius_m ?? 500 }
    );
    log("LOCAL fixture created for", params.lat, params.lon);

    return {
      kind: "DSM_REAL",
      dsmResult,
      meta: {
        source: "DSM_REAL",
        provider: "LOCAL",
        qualityScore: 0.85,
      },
    };
  }

  if (provider === "IGN" || provider === "AUTO") {
    throw new Error("DSM_PROVIDER IGN/AUTO not implemented, use LOCAL for fixtures");
  }

  throw new Error(`DSM_PROVIDER ${provider} not supported`);
}

export const __testCreateLocalFixtureGrid = createLocalFixtureGrid;
