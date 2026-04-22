/**
 * CP-076 — Rate limit login : uniquement les échecs (logique dans le contrôleur).
 */

import logger from "../../app/core/logger.js";
import { rateLimitEnv } from "./rateLimit.config.js";
import { getClientIp } from "./rateLimit.keys.js";
import { getRateLimitStore } from "./rateLimitStore.factory.js";
import { RATE_LIMIT_BODY } from "./rateLimit.constants.js";

/**
 * @param {import("express").Request} req
 * @param {string} emailNormalized
 */
export function buildLoginFailureKey(req, emailNormalized) {
  const ip = getClientIp(req);
  return `login_fail:${ip}|${emailNormalized}`;
}

/**
 * Si trop d’échecs dans la fenêtre → envoie 429 et retourne false.
 * @param {import("express").Response} res
 * @returns {Promise<boolean>}
 */
export async function checkLoginFailuresAllowed(req, res, emailNormalized) {
  const store = await getRateLimitStore();
  const key = buildLoginFailureKey(req, emailNormalized);
  const max = rateLimitEnv.loginMax;
  const state = await store.get(key);
  const now = Date.now();
  if (state && state.resetAt > now && state.count >= max) {
    const ttlMs = await store.ttl(key);
    const retry = Math.ceil(ttlMs / 1000) || 1;
    res.setHeader("Retry-After", String(retry));
    logger.warn("RATE_LIMITED", {
      limiter: "login_fail",
      route: req.originalUrl || req.url,
      method: req.method,
      ip: req.ip || req.socket?.remoteAddress,
    });
    res.status(429).json(RATE_LIMIT_BODY);
    return false;
  }
  return true;
}

/** À appeler après chaque échec d’authentification (401). */
export async function recordLoginFailure(req, emailNormalized) {
  const store = await getRateLimitStore();
  const key = buildLoginFailureKey(req, emailNormalized);
  await store.increment(key, rateLimitEnv.loginWindowMs);
}

/** À appeler après login réussi : efface le compteur d’échecs. */
export async function resetLoginFailures(req, emailNormalized) {
  const store = await getRateLimitStore();
  const key = buildLoginFailureKey(req, emailNormalized);
  await store.reset(key);
}
