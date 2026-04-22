/**
 * CP-076 — Middlewares prêts à l’emploi (profils).
 */

import { createRateLimiter } from "./createRateLimiter.js";
import { rateLimitEnv } from "./rateLimit.config.js";
import { keyUserOrIp, keyIpOnly } from "./rateLimit.keys.js";

/** Login : voir loginRateLimit.helper.js + auth.controller (échecs uniquement). */

/** A — Routes sensibles avec utilisateur connecté (priorité user_id) */
export const sensitiveUserRateLimiter = createRateLimiter({
  name: "sensitive_user",
  windowMs: rateLimitEnv.sensitiveWindowMs,
  max: rateLimitEnv.sensitiveMax,
  keyGenerator: (req) => keyUserOrIp(req),
});

/** C — Opérations lourdes authentifiées */
export const heavyUserRateLimiter = createRateLimiter({
  name: "heavy_user",
  windowMs: rateLimitEnv.heavyWindowMs,
  max: rateLimitEnv.heavyMax,
  keyGenerator: (req) => keyUserOrIp(req),
});

/** D — Endpoints publics ou sans JWT mais coûteux (IP uniquement) */
export const publicHeavyRateLimiter = createRateLimiter({
  name: "public_heavy",
  windowMs: rateLimitEnv.publicHeavyWindowMs,
  max: rateLimitEnv.publicHeavyMax,
  keyGenerator: (req) => keyIpOnly(req),
});
