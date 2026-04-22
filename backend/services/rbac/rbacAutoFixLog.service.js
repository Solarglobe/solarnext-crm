/**
 * RBAC-HARDENING — Logs structurés pour auto-corrections RBAC (hors production).
 */

import logger from "../../app/core/logger.js";

/**
 * @param {{
 *   userId: string;
 *   organizationId: string;
 *   roleDetected: string;
 *   action: string;
 *   adminRoleId?: string;
 *   detail?: string;
 * }} payload
 */
export function logRbacAutoFixStructured(payload) {
  if (process.env.NODE_ENV === "production") return;

  const entry = {
    event: "RBAC_AUTO_FIX",
    userId: payload.userId,
    organizationId: payload.organizationId,
    roleDetected: payload.roleDetected,
    action: payload.action,
    timestamp: new Date().toISOString(),
    ...(payload.adminRoleId != null ? { adminRoleId: payload.adminRoleId } : {}),
    ...(payload.detail != null ? { detail: payload.detail } : {}),
  };

  logger.warn(entry);
}
