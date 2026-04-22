/**
 * RBAC-HARDENING — Protection centralisée contre l’auto-suppression (contrat API stable).
 */

const MSG = "Vous ne pouvez pas supprimer votre propre compte";
const CODE = "CANNOT_DELETE_SELF";

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function isSameUserId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Envoie 400 CANNOT_DELETE_SELF si tentative de suppression de soi-même.
 * @param {import("express").Response} res
 * @param {unknown} actorUserId
 * @param {unknown} targetUserId
 * @returns {boolean} true si la réponse a été envoyée (appelant doit return)
 */
export function respondIfDeletingOwnAccount(res, actorUserId, targetUserId) {
  if (!res || typeof res.status !== "function") return false;
  if (res.headersSent) return false;
  if (actorUserId == null || actorUserId === "") return false;
  if (!isSameUserId(actorUserId, targetUserId)) return false;
  res.status(400).json({ error: MSG, code: CODE });
  return true;
}
