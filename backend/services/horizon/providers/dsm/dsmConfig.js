/**
 * CP-FAR-008 — Configuration DSM centralisée
 * HORIZON_DSM_ENABLED (default false) — Feature flag OFF par défaut.
 * DSM_PROVIDER = "AUTO" | "IGN" | "LOCAL" (default AUTO) — sans effet si flag OFF.
 * DSM_MAX_TILES, DSM_TILE_CACHE_TTL — limites cache tuilé.
 */

export function getDsmEnvConfig() {
  const enabled = process.env.HORIZON_DSM_ENABLED === "true";
  const provider = (process.env.DSM_PROVIDER || "AUTO").toUpperCase();
  const maxTilesRaw = process.env.DSM_MAX_TILES;
  const tileCacheTtlRaw = process.env.DSM_TILE_CACHE_TTL;
  const ttlMsRaw = process.env.DSM_CACHE_TTL_MS;

  return {
    enabled,
    provider: provider === "AUTO" || provider === "IGN" || provider === "LOCAL" ? provider : "AUTO",
    maxTiles: maxTilesRaw != null && maxTilesRaw !== "" ? parseInt(maxTilesRaw, 10) : 500,
    tileCacheTtlMs:
      tileCacheTtlRaw != null && tileCacheTtlRaw !== ""
        ? parseInt(tileCacheTtlRaw, 10) * 1000
        : ttlMsRaw != null && ttlMsRaw !== ""
          ? parseInt(ttlMsRaw, 10)
          : 30 * 24 * 60 * 60 * 1000,
  };
}

if (typeof process !== "undefined" && process.env) {
  const c = getDsmEnvConfig();
  console.log("[DSM CONFIG]", {
    enabled: c.enabled,
    provider: c.provider,
  });
}
