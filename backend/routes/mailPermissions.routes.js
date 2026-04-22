/**
 * CP-083 — API matrice permissions mail (admin boîtes).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailAccountsManageStrict } from "../middleware/mailAccess.middleware.js";
import {
  fetchMailPermissionsMatrix,
  isUuid,
  upsertMailAccountPermission,
} from "../services/mail/mailPermissions.service.js";
import { isJwtSuperAdmin } from "../lib/superAdminUserGuards.js";

const router = express.Router();

router.get("/permissions/matrix", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const data = await fetchMailPermissionsMatrix(organizationId, {
      excludeSuperAdminUsers: !isJwtSuperAdmin(req),
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error("GET /mail/permissions/matrix", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.patch("/permissions", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const body = req.body || {};
    const mailAccountId = body.mailAccountId ?? body.mail_account_id;
    const userId = body.userId ?? body.user_id;
    const canRead = body.canRead ?? body.can_read;
    const canSend = body.canSend ?? body.can_send;
    const canManage = body.canManage ?? body.can_manage;

    if (!isUuid(mailAccountId) || !isUuid(userId)) {
      return res.status(400).json({ success: false, code: "INVALID_IDS" });
    }
    if (typeof canRead !== "boolean" || typeof canSend !== "boolean" || typeof canManage !== "boolean") {
      return res.status(400).json({ success: false, code: "INVALID_FLAGS" });
    }

    try {
      const result = await upsertMailAccountPermission({
        organizationId,
        mailAccountId: mailAccountId.trim(),
        userId: userId.trim(),
        canRead,
        canSend,
        canManage,
      });
      return res.json({ success: true, ...result });
    } catch (e) {
      if (e.code === "NOT_FOUND") {
        return res.status(404).json({ success: false, code: "NOT_FOUND" });
      }
      if (e.code === "OWNER_LOCKED") {
        return res.status(409).json({ success: false, code: "OWNER_LOCKED", message: "Le propriétaire de la boîte a un accès implicite." });
      }
      if (e.code === "VIEW_ALL_LOCKED") {
        return res.status(409).json({
          success: false,
          code: "VIEW_ALL_LOCKED",
          message: "Cet utilisateur a déjà l’accès global mail (RBAC).",
        });
      }
      throw e;
    }
  } catch (err) {
    console.error("PATCH /mail/permissions", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

export default router;
