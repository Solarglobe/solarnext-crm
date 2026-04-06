/**
 * CP-026 RBAC — Middleware requirePermission
 */

import { getUserPermissions } from "./rbac.service.js";

const RBAC_ENFORCE = process.env.RBAC_ENFORCE === "1" || process.env.RBAC_ENFORCE === "true";

export function requirePermission(code) {
  return async (req, res, next) => {
    try {
      const enforce = process.env.RBAC_ENFORCE === "1";

      // SUPER_ADMIN bypass
      if (req.user?.role === "SUPER_ADMIN") {
        return next();
      }

      // Si enforcement désactivé → laisser passer
      if (!enforce) {
        return next();
      }

      const userId = req.user?.userId ?? req.user?.id;
      const organizationId = req.user?.organizationId;

      if (!userId || !organizationId) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "INVALID_USER_CONTEXT"
        });
      }

      const perms = await getUserPermissions({
        userId,
        organizationId
      });

      if (!perms.has(code)) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MISSING_PERMISSION",
          permission: code
        });
      }

      return next();
    } catch (err) {
      console.error("RBAC middleware error:", err);
      return res.status(500).json({
        error: "RBAC_ERROR"
      });
    }
  };
}

/**
 * Middleware : exige AU MOINS UNE des permissions pour continuer.
 * Utile pour les routes self/all (ex: lead.update.self OU lead.update.all).
 *
 * @param {string[]} codes — codes permission (ex: ['lead.update.self', 'lead.update.all'])
 */
export function requireAnyPermission(codes) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    if (req.user.role === "SUPER_ADMIN") {
      return next();
    }

    if (!RBAC_ENFORCE) {
      return next();
    }

    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;

    if (!organizationId) {
      return res.status(403).json({
        error: "FORBIDDEN",
        code: "MISSING_ORGANIZATION",
        permission: codes.join("|")
      });
    }

    const perms = await getUserPermissions({ userId, organizationId });
    const hasAny = codes.some((c) => perms.has(c));
    if (!hasAny) {
      return res.status(403).json({
        error: "FORBIDDEN",
        code: "MISSING_PERMISSION",
        permission: codes.join("|")
      });
    }

    next();
  };
}
