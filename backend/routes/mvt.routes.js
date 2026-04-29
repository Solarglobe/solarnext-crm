// ======================================================================
// Proxy MVT cadastre — évite CORS en faisant transiter les tuiles par le backend.
// Structure tileserver-gl (doc) : /data/{id}/{z}/{x}/{y}.{format} (format = pbf pour MVT).
// GET /api/mvt/cadastre/:z/:x/:y  →  http://localhost:8080/data/{TILESET}/{z}/{x}/{y}.pbf
// ======================================================================

import express from "express";
import fetch from "node-fetch";
import logger from "../app/core/logger.js";

const router = express.Router();
// Upstream configurable :
// - cas "tileserver-gl" : TILESERVER_URL + MVT_PATH + extension .pbf
// - cas "TMS IGN Géoplateforme" : MVT_UPSTREAM_PBF_TEMPLATE avec {z}/{x}/{y} dans l’URL
//
// Ex. IGN (si vous avez une clé wxs.ign.fr) :
// MVT_UPSTREAM_PBF_TEMPLATE=https://wxs.ign.fr/<KEY>/geoportail/tms/1.0.0/PCI/<LAYER>/{z}/{x}/{y}.pbf
const MVT_UPSTREAM_PBF_TEMPLATE = process.env.MVT_UPSTREAM_PBF_TEMPLATE || "";
const MVT_UPSTREAM_BASE =
  process.env.TILESERVER_URL || "https://openmaptiles.data.gouv.fr";
const MVT_PATH = process.env.MVT_PATH || "/data/cadastre";
const MVT_MAX_Z = Number.isFinite(Number(process.env.MVT_MAX_Z))
  ? Number(process.env.MVT_MAX_Z)
  : 16;

function resolveCadastreTileForUpstream(zRaw, xRaw, yRaw) {
  let z = Number.parseInt(String(zRaw), 10);
  let x = Number.parseInt(String(xRaw), 10);
  let y = Number.parseInt(String(yRaw), 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  // Le tileset cadastre upstream s'arrête à z=16.
  // Pour éviter les 404 à fort zoom, on remonte vers la tuile parente z=16.
  if (z > MVT_MAX_Z) {
    const delta = z - MVT_MAX_Z;
    const factor = 2 ** delta;
    x = Math.floor(x / factor);
    y = Math.floor(y / factor);
    z = MVT_MAX_Z;
  }
  return { z, x, y };
}

function buildConfiguredUpstreamUrl(z, x, y) {
  if (!MVT_UPSTREAM_PBF_TEMPLATE) return null;
  const tpl = String(MVT_UPSTREAM_PBF_TEMPLATE).trim();
  if (!tpl) return null;
  // Ignore template exemple non configuré (<KEY>/<LAYER>), et retombe sur l'upstream par défaut.
  if (tpl.includes("<KEY>") || tpl.includes("<LAYER>")) return null;
  return tpl
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
// Nom du tileset exposé par tileserver-gl (doit correspondre à l’id dans config / mbtiles).
// GET /api/mvt/cadastre/:z/:x/:y  (ex: .../14/12345/6789 ou .../14/12345/6789.pbf)
router.get("/cadastre/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  const yClean = y.endsWith(".pbf") ? y.replace(/\.pbf$/, "") : y;
  const tile = resolveCadastreTileForUpstream(z, x, yClean);
  if (!tile) {
    return res.status(400).json({ error: "Invalid tile coordinates" });
  }
  const configuredUrl = buildConfiguredUpstreamUrl(tile.z, tile.x, tile.y);
  const fallbackUrl = `${MVT_UPSTREAM_BASE}${MVT_PATH}/${tile.z}/${tile.x}/${tile.y}.pbf`;
  const url = configuredUrl || fallbackUrl;

  logger.info("MVT_GET_TILE", {
    requested: { z, x, y: yClean },
    upstreamTile: tile,
    url,
    usedTemplate: Boolean(configuredUrl),
  });

  try {
    let upstream = await fetch(url, { method: "GET" });
    // Si template configuré mais non fonctionnel, retomber sur l'upstream par défaut.
    if (configuredUrl && upstream.status === 404) {
      logger.warn("MVT_TEMPLATE_404_FALLBACK", { configuredUrl, fallbackUrl, upstreamTile: tile });
      upstream = await fetch(fallbackUrl, { method: "GET" });
    }

    logger.info("MVT_UPSTREAM_STATUS", {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") || null,
      requested: { z, x, y: yClean },
      upstreamTile: tile,
      url: configuredUrl && upstream.url === fallbackUrl ? fallbackUrl : url,
    });

    res.status(upstream.status);

    if (upstream.status === 200) {
      res.set("Content-Type", "application/x-protobuf");
    } else {
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.set("Content-Type", contentType);
    }

    if (!upstream.body) {
      return res.end();
    }

    upstream.body.on("error", (err) => {
      logger.error("MVT_STREAM_ERROR", { error: err });
      if (!res.headersSent) res.status(500).end();
    });
    upstream.body.pipe(res);
  } catch (err) {
    logger.error("MVT_PROXY_ERROR", { error: err });
    if (!res.headersSent) {
      res.status(502).json({ error: "Tile server unavailable" });
    }
  }
});

export default router;
