/**
 * IGN Dynamic Tile Loader — Mise à jour de l'index IGN (index.json).
 * Ajout d'une nouvelle tuile avec bboxLambert93. Écriture atomique + backup.
 * Lock global index avant modification (anti-concurrence).
 */

import fs from "fs";
import path from "path";
import { getIgnDataDir, getIgnIndexPath, getIgnLocksRoot } from "./paths.js";
import { acquireLock, releaseLock } from "./lockfile.js";

const LOG_PREFIX = "[IGN Index Updater]";
const INDEX_LOCK_WAIT_MS = 90_000;

/**
 * Sauvegarde l'index actuel avant modification.
 * @param {string} indexPath
 */
function backupIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return;
  const backupPath = `${indexPath}.bak`;
  fs.copyFileSync(indexPath, backupPath);
  console.log(`${LOG_PREFIX} backup: ${backupPath}`);
}

/**
 * Ajoute une tuile à l'index et sauvegarde de façon atomique (écriture .tmp puis rename).
 * Acquiert le lock index avant écriture, libère après.
 * @param {string} tileId - identifiant de la tuile (ex: D077_2023)
 * @param {string} tilePath - chemin absolu ou relatif du fichier .asc (sera stocké en pathRel par rapport à dataDir)
 * @param {{ minX: number, minY: number, maxX: number, maxY: number, [key: string]: unknown }} bbox - bbox Lambert93
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function updateIgnIndexWithTile(tileId, tilePath, bbox) {
  const dataDir = getIgnDataDir();
  const indexPath = getIgnIndexPath();
  const locksRoot = getIgnLocksRoot();
  const indexLockPath = path.join(locksRoot, "index.lock");
  const dataDirForTmp = path.dirname(indexPath);
  const tmpPath = path.join(dataDirForTmp, path.basename(indexPath) + ".tmp");

  const pathRel = path.relative(dataDir, path.isAbsolute(tilePath) ? tilePath : path.join(dataDir, tilePath));
  const normalizedPathRel = pathRel.split(path.sep).join(path.sep);

  const lockHandle = await acquireLock(indexLockPath, 10 * 60 * 1000, { tileId: "index" });
  if (!lockHandle) {
    return { success: false, error: "Could not acquire index lock" };
  }

  const newEntry = {
    pathRel: normalizedPathRel,
    bboxLambert93: {
      minX: bbox.minX,
      minY: bbox.minY,
      maxX: bbox.maxX,
      maxY: bbox.maxY,
      ...(bbox.cellsize_m != null && { cellsize_m: bbox.cellsize_m }),
      ...(bbox.width != null && { width: bbox.width }),
      ...(bbox.height != null && { height: bbox.height }),
      ...(bbox.noDataValue != null && { noDataValue: bbox.noDataValue }),
    },
  };

  try {
    let index;
    if (fs.existsSync(indexPath)) {
      backupIndex(indexPath);
      const raw = fs.readFileSync(indexPath, "utf8");
      index = JSON.parse(raw);
    } else {
      index = { ascFiles: [], tiles: [] };
    }

    if (!index.tiles) index.tiles = [];
    const already = index.tiles.some((t) => t.pathRel === normalizedPathRel || path.basename(t.pathRel, ".asc") === tileId);
    if (!already) {
      index.tiles.push(newEntry);
      if (index.ascFiles && !index.ascFiles.includes(normalizedPathRel)) {
        index.ascFiles.push(normalizedPathRel);
      } else if (!index.ascFiles) {
        index.ascFiles = [normalizedPathRel];
      }
    }
    index.tilesUpdatedAt = new Date().toISOString();

    fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), "utf8");
    fs.renameSync(tmpPath, indexPath);
    console.log(`${LOG_PREFIX} index updated with tile ${tileId}`);
    await releaseLock(lockHandle);
    return { success: true };
  } catch (err) {
    await releaseLock(lockHandle);
    if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
    const msg = err?.message ?? String(err);
    console.warn(`${LOG_PREFIX} error:`, msg);
    return { success: false, error: msg };
  }
}
