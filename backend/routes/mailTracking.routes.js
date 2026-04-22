/**
 * CP-082 — Tracking ouverture / clic (public, sans JWT).
 */

import express from "express";
import {
  getTrackingPixelPngBuffer,
  isValidTrackingUuid,
  registerClickEvent,
  registerOpenEvent,
  sanitizeRedirectUrl,
} from "../services/mail/mailTracking.service.js";

const router = express.Router();

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim().slice(0, 128) || null;
  }
  const ra = req.socket?.remoteAddress || req.ip;
  return ra ? String(ra).slice(0, 128) : null;
}

function userAgent(req) {
  const ua = req.headers["user-agent"];
  return ua ? String(ua).slice(0, 2000) : null;
}

router.get("/track/open/:trackingId", async (req, res) => {
  try {
    const { trackingId } = req.params;
    if (!isValidTrackingUuid(trackingId)) {
      return res.status(400).end();
    }
    await registerOpenEvent({
      trackingId,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    const buf = getTrackingPixelPngBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Content-Length", String(buf.length));
    return res.status(200).send(buf);
  } catch (e) {
    console.error("GET /track/open:", e);
    return res.status(500).end();
  }
});

router.get("/track/click/:trackingId", async (req, res) => {
  try {
    const { trackingId } = req.params;
    if (!isValidTrackingUuid(trackingId)) {
      return res.status(400).send("Bad request");
    }
    let rawUrl = req.query.url;
    if (Array.isArray(rawUrl)) rawUrl = rawUrl[0];
    if (rawUrl == null) {
      return res.status(400).send("Missing url");
    }
    let decoded;
    try {
      decoded = decodeURIComponent(String(rawUrl));
    } catch {
      return res.status(400).send("Invalid url");
    }
    const safe = sanitizeRedirectUrl(decoded);
    if (!safe) {
      return res.status(400).send("Invalid redirect");
    }
    const result = await registerClickEvent({
      trackingId,
      url: safe,
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") return res.status(404).send("Not found");
      return res.status(400).send("Bad request");
    }
    return res.redirect(302, result.redirectUrl);
  } catch (e) {
    console.error("GET /track/click:", e);
    return res.status(500).send("Error");
  }
});

export default router;
