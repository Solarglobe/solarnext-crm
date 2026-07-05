/**
 * CP-FAR-008 — Configuration DSM centralisée
 * HORIZON_DSM_ENABLED (default false) — Feature flag OFF par défaut.
 * DSM_PROVIDER = "AUTO" | "IGN" | "LOCAL" (default AUTO) — sans effet si flag OFF.
 * DSM_MAX_TILES, DSM_TILE_CACHE_TTL — limites cache tuilé.
 *
 * CP-FAR-MNS-01 — Produit altimétrique sursol (arbres + bâti) :
 *   DSM_PRODUCT = "MNT" | "MNS" | "MNH" (default "MNT" = comportement historique, sol nu).
 *     - MNT : Modèle Numérique de Terrain (sol nu) — RGE ALTI / LiDAR HD MNT.
 *     - MNS : Modèle Numérique de Surface (sol + arbres + bâti) — LiDAR HD MNS.
 *     - MNH : Modèle Numérique de Hauteur (hauteur des objets = MNS − MNT).
 *   DSM_LIDAR_DATA_DIR — répertoire des dalles GeoTIFF Lambert-93 (+ index.json).
 *     À défaut, réutilise IGN_DSM_DATA_DIR / le répertoire IGN standard.
 *
 * ⚠️ DSM_PRODUCT=MNT (défaut) ⇒ aucun changement de comportement : le sursol
 *    n'est pris en compte que si l'exploitant bascule explicitement sur MNS/MNH
 *    ET provisionne les dalles correspondantes.
 */

const VALID_DSM_PRODUCTS = ["MNT", "MNS", "MNH"];

/**
 * @returns {"MNT"|"MNS"|"MNH"} produit altimétrique demandé (défaut MNT = sol nu).
 */
export function getDsmProduct() {
  const raw = (process.env.DSM_PRODUCT || "MNT").toUpperCase();
  return VALID_DSM_PRODUCTS.includes(raw) ? raw : "MNT";
}

/**
 * @returns {boolean} true si le produit demandé inclut le sursol (arbres + bâti).
 */
export function isSurfaceProductEnabled() {
  const p = getDsmProduct();
  return p === "MNS" || p === "MNH";
}

/**
 * Répertoire des dalles GeoTIFF Lambert-93 (MNS/MNH). Priorité :
 *   DSM_LIDAR_DATA_DIR → IGN_DSM_DATA_DIR → null (résolu par le provider).
 * @returns {string|null}
 */
export function getLidarSurfaceDataDir() {
  const dir = process.env.DSM_LIDAR_DATA_DIR || process.env.IGN_DSM_DATA_DIR;
  return dir && dir.trim() !== "" ? dir.trim() : null;
}

/**
 * Étiquette honnête de source pour le produit courant, à exposer dans meta.source.
 * Évite le mensonge historique « SURFACE_DSM » alors qu'un MNT (sol nu) est servi.
 * @returns {"SURFACE_DSM"|"TERRAIN_MNT"}
 */
export function getHonestSourceLabel() {
  return isSurfaceProductEnabled() ? "SURFACE_DSM" : "TERRAIN_MNT";
}

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
