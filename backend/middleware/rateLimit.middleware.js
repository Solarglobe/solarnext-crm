import logger from "../app/core/logger.js";
import { createRateLimiter } from "./security/createRateLimiter.js";
import { rateLimitEnv } from "./security/rateLimit.config.js";
import { getClientIp, keyIpOnly, keyUserOrIp } from "./security/rateLimit.keys.js";

function isAuthenticatedRequest(req) {
  if (req.user?.id || req.user?.userId) return true;
  return String(req.headers.authorization ?? "").startsWith("Bearer ");
}

function keyOrganizationOrIp(req) {
  const orgId = req.user?.organizationId ?? req.user?.organization_id ?? req.headers["x-organization-id"];
  if (orgId) return `org:${orgId}`;
  return keyUserOrIp(req);
}

function skipHealthAndOptions(req) {
  if (req.method === "OPTIONS") return true;
  const path = req.originalUrl?.split("?")[0] ?? req.path ?? "";
  if (path === "/api/auth/login" || path === "/auth/login") return true;
  return path === "/api/metrics" || path.startsWith("/api/health/");
}

export const authStrictRateLimiter = createRateLimiter({
  name: "auth_strict",
  windowMs: rateLimitEnv.loginWindowMs,
  max: rateLimitEnv.loginMax,
  keyGenerator: keyIpOnly,
});

export const registerRateLimiter = createRateLimiter({
  name: "auth_register",
  windowMs: rateLimitEnv.registerWindowMs,
  max: rateLimitEnv.registerMax,
  keyGenerator: keyIpOnly,
});

const authenticatedApiRateLimiter = createRateLimiter({
  name: "api_authenticated",
  windowMs: 60 * 1000,
  max: rateLimitEnv.apiAuthenticatedMax,
  keyGenerator: keyIpOnly,
  skip: (req) => skipHealthAndOptions(req) || !isAuthenticatedRequest(req),
});

const anonymousApiRateLimiter = createRateLimiter({
  name: "api_anonymous",
  windowMs: 60 * 1000,
  max: rateLimitEnv.apiAnonymousMax,
  keyGenerator: keyIpOnly,
  skip: (req) => skipHealthAndOptions(req) || isAuthenticatedRequest(req),
});

export function generalApiRateLimiter(req, res, next) {
  return authenticatedApiRateLimiter(req, res, (err) => {
    if (err) return next(err);
    return anonymousApiRateLimiter(req, res, next);
  });
}

export const shadingCalculationRateLimiter = createRateLimiter({
  name: "shading_calculation_org",
  windowMs: 60 * 1000,
  max: rateLimitEnv.shadingOrgMax,
  keyGenerator: keyOrganizationOrIp,
});

export const financialCalculationRateLimiter = createRateLimiter({
  name: "financial_calculation_org",
  windowMs: 60 * 1000,
  max: rateLimitEnv.financialOrgMax,
  keyGenerator: keyOrganizationOrIp,
});

const pdfConcurrency = {
  active: 0,
  queue: [],
  max: rateLimitEnv.pdfConcurrentMax,
  queueTimeoutMs: rateLimitEnv.pdfQueueTimeoutMs,
};

function releasePdfSlot() {
  pdfConcurrency.active = Math.max(0, pdfConcurrency.active - 1);
  const queued = pdfConcurrency.queue.shift();
  if (queued) queued();
}

function acquirePdfSlot(req, res, next) {
  pdfConcurrency.active += 1;
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    releasePdfSlot();
  };
  res.once("finish", releaseOnce);
  res.once("close", releaseOnce);
  next();
}

export function pdfConcurrencyLimiter(req, res, next) {
  if (req.method !== "POST") return next();
  if (pdfConcurrency.active < pdfConcurrency.max) {
    return acquirePdfSlot(req, res, next);
  }

  logger.warn("PDF_CONCURRENCY_QUEUED", {
    route: req.originalUrl || req.url,
    active: pdfConcurrency.active,
    queued: pdfConcurrency.queue.length,
    organizationId: req.user?.organizationId ?? req.user?.organization_id ?? null,
    userId: req.user?.id ?? req.user?.userId ?? null,
    ip: getClientIp(req),
  });

  let settled = false;
  const run = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    acquirePdfSlot(req, res, next);
  };

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    const idx = pdfConcurrency.queue.indexOf(run);
    if (idx >= 0) pdfConcurrency.queue.splice(idx, 1);
    res.setHeader("Retry-After", "30");
    logger.warn("PDF_CONCURRENCY_REJECTED", {
      route: req.originalUrl || req.url,
      active: pdfConcurrency.active,
      queued: pdfConcurrency.queue.length,
      ip: getClientIp(req),
    });
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Too many PDF generations in progress. Please try again later.",
    });
  }, pdfConcurrency.queueTimeoutMs);
  if (typeof timer.unref === "function") timer.unref();

  pdfConcurrency.queue.push(run);
}
