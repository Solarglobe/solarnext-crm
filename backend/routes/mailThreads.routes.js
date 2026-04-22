/**
 * CP-073 — Threads (lecture + maintenance rebuild).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  requireMailUseStrict,
  requireMailAccountsManageStrict,
} from "../middleware/mailAccess.middleware.js";
import { pool } from "../config/db.js";
import { rebuildThreadMetadata, rebuildAllThreads } from "../services/mail/mailThreading.service.js";
import { manualOverrideThreadCrmLink } from "../services/mail/mailCrmLink.service.js";

const router = express.Router();

router.patch("/threads/:threadId/link", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userOrg = req.user.organizationId ?? req.user.organization_id;
    const { organizationId: bodyOrg, clientId, leadId } = req.body || {};
    const organizationId =
      req.user.role === "SUPER_ADMIN" && bodyOrg ? bodyOrg : userOrg;
    const { threadId } = req.params;

    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const th = await pool.query(`SELECT organization_id FROM mail_threads WHERE id = $1`, [threadId]);
    if (!th.rows.length || th.rows[0].organization_id !== organizationId) {
      return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await manualOverrideThreadCrmLink(db, {
        threadId,
        clientId: clientId ?? null,
        leadId: leadId ?? null,
      });
      await db.query("COMMIT");
    } catch (linkErr) {
      try {
        await db.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw linkErr;
    } finally {
      db.release();
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /mail/threads/:threadId/link", err);
    return res.status(500).json({
      success: false,
      code: "CRM_LINK_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/threads/rebuild", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userOrg = req.user.organizationId ?? req.user.organization_id;
    const { threadId, organizationId: bodyOrg, limit } = req.body || {};
    const organizationId =
      req.user.role === "SUPER_ADMIN" && bodyOrg ? bodyOrg : userOrg;

    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    if (threadId) {
      const th = await pool.query(
        `SELECT organization_id FROM mail_threads WHERE id = $1`,
        [threadId]
      );
      if (!th.rows.length || th.rows[0].organization_id !== organizationId) {
        return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
      }
      const client = await pool.connect();
      try {
        await rebuildThreadMetadata({ client, threadId });
      } finally {
        client.release();
      }
      return res.json({ success: true, rebuilt: 1 });
    }

    const summary = await rebuildAllThreads({ organizationId, limit: limit ?? null });
    return res.json({ success: true, ...summary });
  } catch (err) {
    console.error("POST /mail/threads/rebuild", err);
    return res.status(500).json({
      success: false,
      code: "REBUILD_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

/** GET /threads/:threadId — déplacé vers routes/mail.routes.js (CP-076). */

export default router;
