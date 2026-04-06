/**
 * CP-FAR-002 — API /api/horizon-mask
 * CP-FAR-006 — Cache par tuile (horizonMaskCache), multi-tenant safe.
 * CP-FAR-007 — computeHorizonMaskAuto (RELIEF_ONLY | SURFACE_DSM) + dataCoverage.
 */

import express from "express";
import { validateHorizonMaskParams } from "../services/horizon/horizonMaskCore.js";
import { getOrComputeHorizonMask } from "../services/horizon/horizonMaskCache.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";

const router = express.Router();

/**
 * GET /api/horizon-mask?lat=...&lon=...&radius=...&step=...
 */
router.get("/horizon-mask", async (req, res) => {
  let lat, lon, radius, step;
  try {
    const latRaw = req.query.lat;
    const lonRaw = req.query.lon;
    const radiusRaw = req.query.radius;
    const stepRaw = req.query.step;

    if (latRaw === undefined || latRaw === null || latRaw === "") {
      return res.status(400).json({
        error: {
          code: "INVALID_PARAMS",
          message: "lat is required",
          details: { lat: latRaw },
        },
      });
    }
    if (lonRaw === undefined || lonRaw === null || lonRaw === "") {
      return res.status(400).json({
        error: {
          code: "INVALID_PARAMS",
          message: "lon is required",
          details: { lon: lonRaw },
        },
      });
    }

    lat = parseFloat(latRaw);
    lon = parseFloat(lonRaw);
    radius = radiusRaw !== undefined && radiusRaw !== "" ? parseInt(radiusRaw, 10) : 500;
    step = stepRaw !== undefined && stepRaw !== "" ? parseFloat(stepRaw) : 2;

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        error: {
          code: "INVALID_PARAMS",
          message: "lat and lon must be valid numbers",
          details: { lat: latRaw, lon: lonRaw },
        },
      });
    }
    if (isNaN(radius) || isNaN(step) || step < 0.5 || step > 10) {
      return res.status(400).json({
        error: {
          code: "INVALID_PARAMS",
          message: "radius and step must be valid integers",
          details: { radius: radiusRaw, step: stepRaw },
        },
      });
    }

    validateHorizonMaskParams({ lat, lon, radius_m: radius, step_deg: step });
  } catch (err) {
    return res.status(400).json({
      error: {
        code: "INVALID_PARAMS",
        message: err.message || "Invalid parameters",
        details: {
          lat: req.query.lat,
          lon: req.query.lon,
          radius: req.query.radius,
          step: req.query.step,
        },
      },
    });
  }

  const tenantKey = req.user?.organizationId ?? req.user?.organization_id ?? "public";
  const enableHD =
    req.query.hd === "true" || req.query.hd === "1" || process.env.FAR_HORIZON_HD_ENABLE === "true";

  const { value: result, cached } = await getOrComputeHorizonMask(
    { tenantKey, lat, lon, radius_m: radius, step_deg: step, enableHD },
    () =>
      computeHorizonMaskAuto({
        organizationId: tenantKey,
        lat,
        lon,
        radius_m: radius,
        step_deg: step,
        enableHD,
      })
  );

  res.json({
    ...result,
    computedAt: new Date().toISOString(),
    cached,
  });
});

export default router;
