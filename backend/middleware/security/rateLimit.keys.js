/**
 * CP-076 — Construction des clés de limitation.
 */

/**
 * @param {import("express").Request} req
 */
export function getClientIp(req) {
  if (req.ip) return String(req.ip);
  const s = req.socket ?? req.connection;
  if (s?.remoteAddress) return String(s.remoteAddress);
  return "unknown";
}

/**
 * Utilisateur JWT si présent, sinon IP (routes optionnellement auth ou fallback).
 * @param {import("express").Request} req
 */
export function keyUserOrIp(req) {
  const uid = req.user?.userId ?? req.user?.id;
  if (uid) return `u:${uid}`;
  return `ip:${getClientIp(req)}`;
}

/**
 * @param {import("express").Request} req
 */
export function keyIpOnly(req) {
  return `ip:${getClientIp(req)}`;
}
