/**
 * CP-072 — Pilotage sync IMAP.
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  requireMailUseStrict,
  requireMailAccountsManageStrict,
} from "../middleware/mailAccess.middleware.js";
import { pool } from "../config/db.js";
import { getAccessibleMailAccountIds } from "../services/mailAccess.service.js";
import { syncMailAccount, syncAllMailAccounts } from "../services/mail/mailSync.service.js";
import { backfillMailFolderHistory } from "../services/mail/mailHistoryBackfill.service.js";
import { activeSqlPredicate, publicMailAccount } from "../services/mail/mailAccountState.service.js";
import { getMailHealthOverview } from "../services/mail/mailHealth.service.js";

const router = express.Router();

router.post("/sync/run", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userOrg = req.user.organizationId ?? req.user.organization_id;
    const { mailAccountId, folderId = null, organizationId: bodyOrg, forceFull = false } = req.body || {};
    const organizationId =
      req.user.role === "SUPER_ADMIN" && bodyOrg ? bodyOrg : userOrg;

    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    if (mailAccountId) {
      const r = await syncMailAccount({
        mailAccountId,
        organizationId,
        forceFull: !!forceFull,
        folderId: typeof folderId === "string" && folderId.trim() ? folderId.trim() : null,
      });
      return res.json({ success: true, ...r });
    }

    const r = await syncAllMailAccounts({
      organizationId,
      forceFull: !!forceFull,
    });
    return res.json({ success: true, summary: r });
  } catch (err) {
    console.error("POST /mail/sync/run", err);
    const code = err?.code && typeof err.code === "string" ? err.code : "SYNC_FAILED";
    return res.status(500).json({
      success: false,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/sync/backfill", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const userOrg = req.user.organizationId ?? req.user.organization_id;
    const { mailAccountId, folderId, batchSize = undefined, organizationId: bodyOrg } = req.body || {};
    const organizationId = req.user.role === "SUPER_ADMIN" && bodyOrg ? bodyOrg : userOrg;
    if (!organizationId || !mailAccountId || !folderId) {
      return res.status(400).json({ success: false, code: "MAIL_BACKFILL_ARGUMENTS_REQUIRED" });
    }
    if (req.user.role !== "SUPER_ADMIN") {
      const userId = req.user.userId ?? req.user.id;
      const accessible = await getAccessibleMailAccountIds({ userId, organizationId });
      if (!accessible.has(String(mailAccountId))) {
        return res.status(403).json({ success: false, code: "MAIL_ACCOUNT_FORBIDDEN" });
      }
    }
    const r = await backfillMailFolderHistory({
      organizationId,
      mailAccountId: String(mailAccountId),
      folderId: String(folderId),
      batchSize: batchSize == null ? undefined : Number(batchSize),
    });
    return res.json({ success: true, backfill: r });
  } catch (err) {
    console.error("POST /mail/sync/backfill", err);
    return res.status(500).json({
      success: false,
      code: "MAIL_BACKFILL_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/sync/status", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    let rows;
    if (req.user.role === "SUPER_ADMIN") {
      const r = await pool.query(
        `SELECT id, email, display_name, is_active, lifecycle_state, sync_enabled,
                is_default_send_account, provider, auth_method, reconnect_required,
                last_imap_sync_at, sync_status,
                last_imap_error_at, last_imap_error_code, last_imap_error_message,
                last_successful_sync_at, next_sync_attempt_at, imap_status, smtp_status
         FROM mail_accounts ma
         WHERE organization_id = $1 AND ${activeSqlPredicate("ma", "canDisplay")}
         ORDER BY email ASC`,
        [organizationId]
      );
      rows = r.rows;
    } else {
      const ids = await getAccessibleMailAccountIds({ userId, organizationId });
      if (ids.size === 0) {
        return res.json({ success: true, accounts: [] });
      }
      const r = await pool.query(
        `SELECT id, email, display_name, is_active, lifecycle_state, sync_enabled,
                is_default_send_account, provider, auth_method, reconnect_required,
                last_imap_sync_at, sync_status,
                last_imap_error_at, last_imap_error_code, last_imap_error_message,
                last_successful_sync_at, next_sync_attempt_at, imap_status, smtp_status
         FROM mail_accounts ma
         WHERE organization_id = $1 AND ${activeSqlPredicate("ma", "canDisplay")}
           AND id = ANY($2::uuid[])
         ORDER BY email ASC`,
        [organizationId, [...ids]]
      );
      rows = r.rows;
    }

    return res.json({ success: true, accounts: rows.map(publicMailAccount) });
  } catch (err) {
    console.error("GET /mail/sync/status", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/sync/health", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const health = await getMailHealthOverview({ organizationId });
    return res.json({ success: true, health });
  } catch (err) {
    console.error("GET /mail/sync/health", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

export default router;
