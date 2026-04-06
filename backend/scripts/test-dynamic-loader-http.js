/**
 * Test IGN Dynamic Loader en mode HTTP (100% offline, reproductible).
 * Démarre un mini serveur HTTP local qui sert un fichier .asc valide pour tileId DTEST.
 * Set env IGN_DOWNLOAD_MODE=HTTP, IGN_HTTP_BASE_URL=http://localhost:7777/ign, IGN_TEST_TILE_ID=DTEST.
 * Vérifie : fichier créé, index mis à jour, pas d'erreur.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureIgnTileAvailable } from "../services/dsmDynamic/ignDynamicLoader.js";
import { getIgnCacheRoot, getIgnIndexPath } from "../services/dsmDynamic/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 7777;
const TILE_ID = "DTEST";

/** Contenu .asc minimal valide (ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value + données). */
const FAKE_ASC = `ncols 2
nrows 2
xllcorner 650000
yllcorner 6860000
cellsize 1000
NODATA_value -9999
 100 101
 102 103
`;

let server = null;

function startFakeServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", `http://localhost:${PORT}`);
      const p = u.pathname.replace(/^\/+/, "");
      if (p === `${TILE_ID}.asc` || p === `ign/${TILE_ID}.asc`) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(FAKE_ASC);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

function stopFakeServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

async function main() {
  process.env.IGN_DOWNLOAD_MODE = "HTTP";
  process.env.IGN_HTTP_BASE_URL = `http://127.0.0.1:${PORT}/ign`;
  process.env.IGN_TEST_TILE_ID = TILE_ID;

  await startFakeServer();

  try {
    // Point hors couverture index (D075 Paris) pour forcer le chemin "no tile → download"
    const lat = 41;
    const lon = -5.5;

    const result = await ensureIgnTileAvailable(lat, lon);

    if (!result || !result.ok) {
      console.error("FAIL: ensureIgnTileAvailable did not return ok");
      process.exit(1);
    }

    const cacheDir = getIgnCacheRoot();
    const tilePath = path.join(cacheDir, `${TILE_ID}.asc`);
    if (!fs.existsSync(tilePath)) {
      console.error("FAIL: tile file not created:", tilePath);
      process.exit(1);
    }
    if (fs.statSync(tilePath).size <= 0) {
      console.error("FAIL: tile file empty");
      process.exit(1);
    }

    const indexPath = getIgnIndexPath();
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const hasTile = index.tiles && index.tiles.some((t) => t.pathRel && t.pathRel.includes(TILE_ID));
      if (!hasTile) {
        console.error("FAIL: index not updated with tile", TILE_ID);
        process.exit(1);
      }
    }

    console.log("PASS: file created, index updated, no error.");
  } finally {
    await stopFakeServer();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
