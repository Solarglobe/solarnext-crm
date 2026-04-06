/**
 * IGN Dynamic Tile Loader — Résolution tuile pour un point lat/lon.
 * Utilise l'index existant (bbox Lambert93) pour déterminer si une dalle couvre le point.
 * Aucune écriture disque.
 */

import fs from "fs";
import path from "path";
import { wgs84ToLambert93 } from "../horizon/providers/ign/projection2154.js";
import { getIgnDataDir, getIgnIndexPath, getIgnCacheRoot } from "./paths.js";

/**
 * Charge l'index IGN. Retourne null si absent ou vide.
 * @returns {{ tiles: Array<{ pathRel: string, bboxLambert93: { minX, minY, maxX, maxY } }> } | null}
 */
function loadIgnIndex() {
  const indexPath = getIgnIndexPath();
  if (!fs.existsSync(indexPath)) return null;
  try {
    const raw = fs.readFileSync(indexPath, "utf8");
    const index = JSON.parse(raw);
    if (!index.tiles || !Array.isArray(index.tiles) || index.tiles.length === 0) return null;
    return index;
  } catch {
    return null;
  }
}

/**
 * Trouve une dalle dont la bbox Lambert93 contient le point (x, y).
 * @param {{ x: number, y: number }} lambert93
 * @param {{ tiles: Array<{ pathRel: string, bboxLambert93: object }> }} index
 * @returns {{ pathRel: string, bboxLambert93: object } | null}
 */
function findTileContainingPoint(lambert93, index) {
  const { x, y } = lambert93;
  for (const t of index.tiles) {
    const b = t.bboxLambert93;
    if (!b || b.minX == null || b.minY == null || b.maxX == null || b.maxY == null) continue;
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return t;
  }
  return null;
}

/**
 * Liste les tileIds candidats à télécharger pour un point (bundle minimal autour du point).
 * Hook configurable : par défaut retourne un guess basé sur Lambert93 ; peut être étendu (département, nomenclature).
 * @param {number} lat - latitude WGS84 (degrés)
 * @param {number} lon - longitude WGS84 (degrés)
 * @returns {Promise<string[]>} liste de tileIds à tenter (ordre de priorité)
 */
export async function listCandidateTilesForPoint(lat, lon) {
  if (process.env.IGN_TEST_TILE_ID != null && String(process.env.IGN_TEST_TILE_ID).trim() !== "") {
    return [String(process.env.IGN_TEST_TILE_ID).trim()];
  }
  const lambert93 = wgs84ToLambert93({ lat, lon });
  const tileIdGuess = `L93_${Math.floor(lambert93.x / 1000)}_${Math.floor(lambert93.y / 1000)}`;
  return [tileIdGuess];
}

/**
 * Vérifie présence fichier local + checksum simple (taille > 0).
 */
function existsLocallyWithChecksum(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

export async function resolveIgnTileForLatLon(lat, lon) {
  const dataDir = getIgnDataDir();
  const lambert93 = wgs84ToLambert93({ lat, lon });
  const index = loadIgnIndex();

  if (index) {
    const tile = findTileContainingPoint(lambert93, index);
    if (tile) {
      const pathRel = tile.pathRel.replace(/\//g, path.sep);
      const expectedPath = path.join(dataDir, pathRel);
      const existsLocally = existsLocallyWithChecksum(expectedPath);
      const tileId = path.basename(tile.pathRel, ".asc") || tile.pathRel;
      return {
        tileId,
        existsLocally,
        expectedPath,
        pathRel: tile.pathRel,
        bboxLambert93: tile.bboxLambert93,
      };
    }
  }

  // Aucune dalle dans l'index ne couvre ce point — identifiant attendu (guess ou IGN_TEST_TILE_ID)
  const testTileId = process.env.IGN_TEST_TILE_ID != null && String(process.env.IGN_TEST_TILE_ID).trim() !== ""
    ? String(process.env.IGN_TEST_TILE_ID).trim()
    : null;
  const tileId = testTileId ?? `L93_${Math.floor(lambert93.x / 1000)}_${Math.floor(lambert93.y / 1000)}`;
  const cacheDir = getIgnCacheRoot();
  const expectedPath = path.join(cacheDir, `${tileId}.asc`);
  return {
    tileId,
    existsLocally: existsLocallyWithChecksum(expectedPath),
    expectedPath,
  };
}
