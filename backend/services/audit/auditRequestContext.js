/**
 * CP-072 — Contexte HTTP pour audit (Express)
 */

/**
 * @param {import("express").Request} req
 */
export function buildAuditHttpContext(req) {
  if (!req) {
    return {
      method: null,
      route: null,
      ip: null,
      userAgent: null,
      requestId: null,
    };
  }
  const method = req.method || null;
  const route = req.originalUrl || req.url || null;
  const ip =
    (req.headers && (req.headers["x-forwarded-for"] || "").split(",")[0]?.trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = req.get ? req.get("user-agent") : req.headers?.["user-agent"] || null;
  const requestId = req.auditRequestId || null;
  return { method, route, ip, userAgent, requestId };
}
