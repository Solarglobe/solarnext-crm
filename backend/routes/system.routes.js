/**
 * CP-FAR-IGN-06 — Endpoint interne capacités shading (claim technique).
 * GET /ign-metrics : métriques IGN Dynamic (SUPER_ADMIN uniquement).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { getMetrics } from "../services/dsmDynamic/ignMetrics.js";
import { getIgnCacheRoot } from "../services/dsmDynamic/paths.js";
import { getIgnCacheSizeBytes } from "../services/dsmDynamic/ignCacheCleanup.js";

const router = express.Router();

router.get("/ign-metrics", verifyJWT, (req, res) => {
  if (req.user?.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const metrics = getMetrics();
  const cacheRoot = getIgnCacheRoot();
  const cacheSizeBytes = getIgnCacheSizeBytes(cacheRoot);
  const cacheSizeMb = Math.round((cacheSizeBytes / (1024 * 1024)) * 100) / 100;
  res.json({
    ...metrics,
    cacheSizeMb,
  });
});

router.get("/shading-capabilities", (req, res) => {
  const providerType = (process.env.DSM_PROVIDER_TYPE || "STUB").toUpperCase();
  const hdEnabled = process.env.FAR_HORIZON_HD_ENABLE === "true" || process.env.FAR_HORIZON_HD_MAX_DIST_M != null;
  res.json({
    farProviders: ["RELIEF_ONLY", "HTTP_GEOTIFF", "IGN_RGE_ALTI"],
    defaultProvider: providerType === "STUB" ? "RELIEF_ONLY" : providerType,
    ignResolution: 1,
    ignCRS: "EPSG:2154",
    hdSupported: true,
  });
});

export default router;
