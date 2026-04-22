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

const router = express.Router();

router.post("/sync/run", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userOrg = req.user.organizationId ?? req.user.organization_id;
    const { mailAccountId, organizationId: bodyOrg, forceFull = false } = req.body || {};
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
        `SELECT id, email, display_name, is_active,
                last_imap_sync_at, sync_status,
                last_imap_error_at, last_imap_error_code, last_imap_error_message
         FROM mail_accounts
         WHERE organization_id = $1 AND is_active = true
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
        `SELECT id, email, display_name, is_active,
                last_imap_sync_at, sync_status,
                last_imap_error_at, last_imap_error_code, last_imap_error_message
         FROM mail_accounts
         WHERE organization_id = $1 AND is_active = true
           AND id = ANY($2::uuid[])
         ORDER BY email ASC`,
        [organizationId, [...ids]]
      );
      rows = r.rows;
    }

    return res.json({ success: true, accounts: rows });
  } catch (err) {
    console.error("GET /mail/sync/status", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

export default router;
