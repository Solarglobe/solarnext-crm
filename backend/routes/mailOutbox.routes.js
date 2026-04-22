/**
 * File d’envoi — CRUD léger + relance / annulation.
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { pool } from "../config/db.js";
import { getAccessibleMailAccountIds } from "../services/mailAccess.service.js";
import {
  enqueueOutboundMail,
  listMailOutbox,
  cancelMailOutbox,
  retryMailOutbox,
} from "../services/mail/mailOutbox.service.js";
import { SmtpErrorCodes } from "../services/mail/smtp.service.js";

const router = express.Router();

/**
 * @param {import('express').Request} req
 */
async function resolveAccessibleAccountIds(req) {
  const userId = req.user.userId ?? req.user.id;
  const organizationId = req.user.organizationId ?? req.user.organization_id;
  if (req.user.role === "SUPER_ADMIN") {
    const r = await pool.query(
      `SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    );
    return new Set(r.rows.map((x) => x.id));
  }
  return getAccessibleMailAccountIds({ userId, organizationId });
}

function smtpHttpStatus(code) {
  if (code === SmtpErrorCodes.AUTH_FAILED) return 401;
  if (code === SmtpErrorCodes.SMTP_UNAVAILABLE) return 503;
  if (code === SmtpErrorCodes.INVALID_CONFIG) return 400;
  if (code === SmtpErrorCodes.SEND_FAILED) return 502;
  return 500;
}

/**
 * POST /outbox — enregistrer un envoi (file d’attente).
 */
router.post("/outbox", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const result = await enqueueOutboundMail({
      userId,
      organizationId,
      body: req.body || {},
      isSuperAdmin: req.user.role === "SUPER_ADMIN",
    });
    return res.status(201).json({
      success: true,
      outboxId: result.outboxId,
      messageId: result.messageId,
      threadId: result.threadId,
      status: result.status,
    });
  } catch (err) {
    if (err?.code === "MAIL_SEND_DENIED") {
      return res.status(403).json({ success: false, code: err.code, message: err.message });
    }
    if (err?.code && Object.values(SmtpErrorCodes).includes(err.code)) {
      return res.status(smtpHttpStatus(err.code)).json({
        success: false,
        code: err.code,
        message: err.message,
      });
    }
    console.error("POST /mail/outbox", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * GET /outbox — liste (filtres simples).
 */
router.get("/outbox", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const accessible = await resolveAccessibleAccountIds(req);
    const status = typeof req.query.status === "string" ? req.query.status.trim() : null;
    const limit = req.query.limit;
    const offset = req.query.offset;
    const { items, total } = await listMailOutbox({
      organizationId,
      accessibleAccountIds: accessible,
      status,
      limit,
      offset,
    });
    return res.json({ items, total });
  } catch (err) {
    console.error("GET /mail/outbox", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * POST /outbox/:id/retry
 */
router.post("/outbox/:id/retry", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const accessible = await resolveAccessibleAccountIds(req);
    const r = await retryMailOutbox({
      organizationId,
      userId: req.user.userId ?? req.user.id,
      accessibleAccountIds: accessible,
      outboxId: req.params.id,
    });
    if (!r.ok) {
      const code = r.code === "NOT_FOUND" ? 404 : 400;
      return res.status(code).json({ success: false, code: r.code });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /mail/outbox/:id/retry", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * POST /outbox/:id/cancel
 */
router.post("/outbox/:id/cancel", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const accessible = await resolveAccessibleAccountIds(req);
    const r = await cancelMailOutbox({
      organizationId,
      userId: req.user.userId ?? req.user.id,
      accessibleAccountIds: accessible,
      outboxId: req.params.id,
    });
    if (!r.ok) {
      const st = r.code === "NOT_FOUND" ? 404 : 400;
      return res.status(st).json({ success: false, code: r.code });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /mail/outbox/:id/cancel", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

export default router;
