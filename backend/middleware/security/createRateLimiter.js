/**
 * CP-076 — Factory middleware Express rate limit (store injecté : memory | redis).
 */

import logger from "../../app/core/logger.js";
import { getRateLimitStore } from "./rateLimitStore.factory.js";
import { RATE_LIMIT_BODY } from "./rateLimit.constants.js";

/**
 * @param {object} opts
 * @param {string} opts.name — identifiant pour logs (ex. sensitive_user, public_heavy)
 * @param {number} opts.windowMs
 * @param {number} opts.max
 * @param {(req: import("express").Request) => string} opts.keyGenerator
 * @param {(req: import("express").Request) => boolean} [opts.skip]
 */
export function createRateLimiter({ name, windowMs, max, keyGenerator, skip }) {
  if (!name || !windowMs || !max || !keyGenerator) {
    throw new Error("createRateLimiter: name, windowMs, max, keyGenerator requis");
  }

  return async function rateLimiterMiddleware(req, res, next) {
    if (skip?.(req)) return next();
    try {
      const store = await getRateLimitStore();
      const sub = keyGenerator(req);
      const key = `${name}:${sub}`;
      const result = await store.consumeQuota(key, windowMs, max);
      if (!result.allowed) {
        const retry = Math.ceil((result.retryAfterMs ?? 0) / 1000) || 1;
        res.setHeader("Retry-After", String(retry));
        logger.warn("RATE_LIMITED", {
          limiter: name,
          route: req.originalUrl || req.url,
          method: req.method,
          ip: req.ip || req.socket?.remoteAddress,
          userId: req.user?.userId ?? req.user?.id ?? null,
        });
        return res.status(429).json(RATE_LIMIT_BODY);
      }
      return next();
    } catch (e) {
      logger.error("RATE_LIMIT_MIDDLEWARE_ERROR", { message: e?.message });
      return next(e);
    }
  };
}
