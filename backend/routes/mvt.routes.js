// ======================================================================
// Proxy MVT cadastre — évite CORS en faisant transiter les tuiles par le backend.
// Structure tileserver-gl (doc) : /data/{id}/{z}/{x}/{y}.{format} (format = pbf pour MVT).
// GET /api/mvt/cadastre/:z/:x/:y  →  http://localhost:8080/data/{TILESET}/{z}/{x}/{y}.pbf
// ======================================================================

import express from "express";
import fetch from "node-fetch";
import logger from "../app/core/logger.js";

const router = express.Router();
const MVT_UPSTREAM_BASE =
  process.env.TILESERVER_URL || "https://openmaptiles.data.gouv.fr";
const MVT_PATH = "/data/cadastre";
// Nom du tileset exposé par tileserver-gl (doit correspondre à l’id dans config / mbtiles).
// GET /api/mvt/cadastre/:z/:x/:y  (ex: .../14/12345/6789 ou .../14/12345/6789.pbf)
router.get("/cadastre/:z/:x/:y", async (req, res) => {
  const { z, x, y } = req.params;
  const yClean = y.endsWith(".pbf") ? y.replace(/\.pbf$/, "") : y;
  const url = `${MVT_UPSTREAM_BASE}${MVT_PATH}/${z}/${x}/${yClean}.pbf`;

  logger.info("MVT_GET_TILE", { url });

  try {
    const upstream = await fetch(url, { method: "GET" });

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
