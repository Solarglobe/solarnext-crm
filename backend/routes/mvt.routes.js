import express from "express";
import axios from "axios";
import http from "node:http";
import https from "node:https";
import logger from "../app/core/logger.js";

const router = express.Router();

const IGN_MVT_BASE =
  "https://data.geopf.fr/tms/1.0.0/CADASTRALPARCELS.PARCELLAIRE_EXPRESS";

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function parseTileCoords(zRaw, xRaw, yRaw) {
  const z = Number.parseInt(String(zRaw), 10);
  const x = Number.parseInt(String(xRaw), 10);
  const y = Number.parseInt(String(yRaw), 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { z, x, y };
}

function isOutOfBounds(tile) {
  if (!tile) return true;
  if (tile.z < 0) return true;
  const n = 2 ** tile.z;
  return tile.x < 0 || tile.y < 0 || tile.x >= n || tile.y >= n;
}

function xyzToTmsY(z, y) {
  return 2 ** z - 1 - y;
}

async function handleCadastreProxy(req, res) {
  const { z, x, y } = req.params;
  const tile = parseTileCoords(z, x, y);
  if (!tile || isOutOfBounds(tile)) {
    return res.status(204).end();
  }

  const tmsY = xyzToTmsY(tile.z, tile.y);
  const upstreamUrl = `${IGN_MVT_BASE}/${tile.z}/${tile.x}/${tmsY}.pbf`;

  logger.info("MVT_GET_TILE", {
    requested: tile,
    converted: { z: tile.z, x: tile.x, y: tmsY },
    source: "IGN_TMS_PCI",
    url: upstreamUrl,
  });

  try {
    const upstream = await axios.get(upstreamUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
      validateStatus: () => true,
      httpAgent,
      httpsAgent,
    });

    logger.info("MVT_UPSTREAM_STATUS", {
      status: upstream.status,
      url: upstreamUrl,
      contentEncoding: upstream.headers?.["content-encoding"] || null,
      contentType: upstream.headers?.["content-type"] || null,
    });

    if (upstream.status === 404) {
      return res.status(204).end();
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      return res.status(502).json({ error: "Tile server unavailable" });
    }

    res.set("Content-Type", "application/x-protobuf");
    res.set("Cache-Control", "public, max-age=86400");
    const enc = upstream.headers?.["content-encoding"];
    if (enc) {
      res.set("Content-Encoding", String(enc));
    }

    return res.status(200).send(Buffer.from(upstream.data));
  } catch (err) {
    logger.error("MVT_PROXY_ERROR", {
      url: upstreamUrl,
      error: err?.message || String(err),
    });
    return res.status(502).json({ error: "Tile server unavailable" });
  }
}

// Endpoint demandé
router.get("/cadastre/:z/:x/:y.pbf", handleCadastreProxy);
// Compat descendante (si certains clients n'envoient pas le suffixe .pbf)
router.get("/cadastre/:z/:x/:y", handleCadastreProxy);

export default router;
