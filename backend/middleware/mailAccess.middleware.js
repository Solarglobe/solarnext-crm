/**
 * CP-069 — Middlewares mail : enforcement strict (évite les fuites si RBAC_ENFORCE=0 sur le reste).
 */

import { getUserPermissions } from "../rbac/rbac.service.js";
import { canAccessMailAccount, canConfigureMailAccounts, MAIL_PERMISSIONS } from "../services/mailAccess.service.js";

function ctx(req) {
  const userId = req.user?.userId ?? req.user?.id;
  const organizationId = req.user?.organizationId ?? req.user?.organization_id;
  return { userId, organizationId };
}

/**
 * Toujours exiger mail.use (sauf SUPER_ADMIN), indépendamment de RBAC_ENFORCE.
 */
export function requireMailUseStrict() {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "SUPER_ADMIN") {
        return next();
      }
      const { userId, organizationId } = ctx(req);
      if (!userId || !organizationId) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "INVALID_USER_CONTEXT",
        });
      }
      const perms = await getUserPermissions({ userId, organizationId });
      if (!perms.has(MAIL_PERMISSIONS.USE)) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MAIL_USE_REQUIRED",
        });
      }
      return next();
    } catch (err) {
      console.error("requireMailUseStrict:", err);
      return res.status(500).json({ error: "MAIL_RBAC_ERROR" });
    }
  };
}

/**
 * Toujours exiger mail.accounts.manage pour routes d’administration des connecteurs.
 */
export function requireMailAccountsManageStrict() {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "SUPER_ADMIN") {
        return next();
      }
      const { userId, organizationId } = ctx(req);
      if (!userId || !organizationId) {
        return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
      }
      const ok = await canConfigureMailAccounts({ userId, organizationId });
      if (!ok) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MAIL_ACCOUNTS_MANAGE_REQUIRED",
        });
      }
      return next();
    } catch (err) {
      console.error("requireMailAccountsManageStrict:", err);
      return res.status(500).json({ error: "MAIL_RBAC_ERROR" });
    }
  };
}

/**
 * @param {'read' | 'send' | 'manage_delegations'} action
 */
export function requireMailAccountAccessStrict(action) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "SUPER_ADMIN") {
        return next();
      }
      const { userId, organizationId } = ctx(req);
      const mailAccountId =
        req.params.mailAccountId ?? req.body?.mail_account_id ?? req.query?.mail_account_id;
      if (!userId || !organizationId || !mailAccountId) {
        return res.status(400).json({
          error: "BAD_REQUEST",
          code: "MAIL_ACCOUNT_ID_REQUIRED",
        });
      }
      const ok = await canAccessMailAccount({
        userId,
        organizationId,
        mailAccountId,
        action,
      });
      if (!ok) {
        return res.status(403).json({
          error: "FORBIDDEN",
          code: "MAIL_ACCOUNT_ACCESS_DENIED",
          action,
        });
      }
      return next();
    } catch (err) {
      console.error("requireMailAccountAccessStrict:", err);
      return res.status(500).json({ error: "MAIL_ACCESS_ERROR" });
    }
  };
}
