/**
 * IGN Dynamic Tile Loader — Chemins cache / index / locks (multi-tenant opt-in).
 * IGN_SHARED_CACHE_ROOT : si défini → baseDir = IGN_SHARED_CACHE_ROOT/ign (volume partagé).
 */

import path from "path";
import { getIgnDsmDataDir } from "../horizon/providers/ign/ignRgeAltiConfig.js";

const ORG_KEY = process.env.ORG_CACHE_KEY != null && String(process.env.ORG_CACHE_KEY).trim() !== ""
  ? String(process.env.ORG_CACHE_KEY).replace(/[^a-zA-Z0-9_-]/g, "_")
  : null;

/** Base dir IGN : IGN_SHARED_CACHE_ROOT/ign si défini, sinon data/dsm/ign. */
function getIgnBaseDir() {
  const shared = process.env.IGN_SHARED_CACHE_ROOT;
  if (shared != null && String(shared).trim() !== "") {
    return path.join(path.resolve(shared.trim()), "ign");
  }
  return getIgnDsmDataDir();
}

/**
 * Racine du répertoire de cache des tuiles.
 * Avec ORG_CACHE_KEY : .../cache/<ORG_CACHE_KEY>/
 */
export function getIgnCacheRoot() {
  const dataDir = getIgnBaseDir();
  return ORG_KEY ? path.join(dataDir, "cache", ORG_KEY) : path.join(dataDir, "cache");
}

/**
 * Chemin du fichier index des tuiles.
 * Avec ORG_CACHE_KEY : .../index-<ORG_CACHE_KEY>.json
 */
export function getIgnIndexPath() {
  const dataDir = getIgnBaseDir();
  return ORG_KEY ? path.join(dataDir, `index-${ORG_KEY}.json`) : path.join(dataDir, "index.json");
}

/**
 * Racine du répertoire des locks (par tuile + index).
 * Avec ORG_CACHE_KEY : .../locks/<ORG_CACHE_KEY>/
 */
export function getIgnLocksRoot() {
  const dataDir = getIgnBaseDir();
  return ORG_KEY ? path.join(dataDir, "locks", ORG_KEY) : path.join(dataDir, "locks");
}

/** Répertoire de données IGN (pour pathRel / résolution). */
export function getIgnDataDir() {
  return getIgnBaseDir();
}
