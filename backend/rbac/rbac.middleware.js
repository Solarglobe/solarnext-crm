/**
 * CP-026 RBAC — Middleware requirePermission
 * Modes : off | enforce | warn (RBAC_ENFORCE)
 */

import { getUserPermissions } from "./rbac.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import { getRbacMode } from "../config/rbacMode.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";
import logger from "../app/core/logger.js";

function logSuperAdminBypass(req, permissionLabel) {
  const payload = {
    permission: permissionLabel,
    path: req?.path,
    method: req?.method,
    userId: req.user?.userId ?? req.user?.id,
    organizationId: req.user?.organizationId ?? req.user?.organization_id,
  };
  logger.warn("RBAC_SUPER_ADMIN_BYPASS", payload);
  if (process.env.AUDIT_SUPER_ADMIN_RBAC === "1" || process.env.AUDIT_SUPER_ADMIN_RBAC === "true") {
    void logAuditEvent({
      action: AuditActions.SUPER_ADMIN_RBAC_BYPASS,
      entityType: "system",
      organizationId: payload.organizationId ?? null,
      userId: payload.userId ?? null,
      req,
      statusCode: 200,
      metadata: { permission: permissionLabel },
    });
  }
}

export function requirePermission(code) {
  return async (req, res, next) => {
    try {
      const mode = getRbacMode();

      if (effectiveSuperAdminRequestBypass(req)) {
        logSuperAdminBypass(req, code);
        return next();
      }

      if (mode === "off") {
        return next();
      }

      const userId = req.user?.userId ?? req.user?.id;
      const organizationId = req.user?.organizationId ?? req.user?.organization_id;

      if (!userId || !organizationId) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "INVALID_USER_CONTEXT",
        });
      }

      const perms = await getUserPermissions({
        userId,
        organizationId,
      });

      if (!perms.has(code)) {
        if (mode === "warn") {
          void logAuditEvent({
            action: AuditActions.RBAC_WARN_MISSING_PERMISSION,
            entityType: "system",
            organizationId,
            userId,
            req,
            statusCode: 200,
            metadata: { permission: code, rbac_mode: "warn" },
          });
          return next();
        }
        void logAuditEvent({
          action: AuditActions.RBAC_DENIED,
          entityType: "system",
          organizationId,
          userId,
          req,
          statusCode: 403,
          metadata: { permission: code },
        });
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MISSING_PERMISSION",
          permission: code,
        });
      }

      return next();
    } catch (err) {
      console.error("RBAC middleware error:", err);
      return res.status(500).json({
        error: "RBAC_ERROR",
      });
    }
  };
}

/**
 * Middleware : exige AU MOINS UNE des permissions pour continuer.
 *
 * @param {string[]} codes — codes permission (ex: ['lead.update.self', 'lead.update.all'])
 */
export function requireAnyPermission(codes) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Non authentifié" });
      }

      const mode = getRbacMode();

      if (effectiveSuperAdminRequestBypass(req)) {
        logSuperAdminBypass(req, codes.join("|"));
        return next();
      }

      if (mode === "off") {
        return next();
      }

      const userId = req.user.userId ?? req.user.id;
      const organizationId = req.user.organizationId ?? req.user.organization_id;

      if (!organizationId) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MISSING_ORGANIZATION",
          permission: codes.join("|"),
        });
      }

      const perms = await getUserPermissions({ userId, organizationId });
      const hasAny = codes.some((c) => perms.has(c));
      if (!hasAny) {
        if (mode === "warn") {
          void logAuditEvent({
            action: AuditActions.RBAC_WARN_MISSING_PERMISSION,
            entityType: "system",
            organizationId,
            userId,
            req,
            statusCode: 200,
            metadata: { permission: codes.join("|"), rbac_mode: "warn" },
          });
          return next();
        }
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MISSING_PERMISSION",
          permission: codes.join("|"),
        });
      }

      next();
    } catch (err) {
      console.error("RBAC requireAnyPermission error:", err);
      return res.status(500).json({
        error: "RBAC_ERROR",
        message: process.env.NODE_ENV === "production" ? undefined : err?.message,
      });
    }
  };
}
