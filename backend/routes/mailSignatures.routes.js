/**
 * CP-080 — API signatures mail (JWT, multi-tenant strict).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import {
  createSignature,
  deleteSignature,
  getAvailableSignatures,
  getDefaultSignature,
  getSignatureById,
  scopeFromRow,
  setDefaultSignature,
  updateSignature,
} from "../services/mail/mailSignature.service.js";
import {
  canConfigureMailAccounts,
  canSendMailAccount,
} from "../services/mailAccess.service.js";
import { pool } from "../config/db.js";

const router = express.Router();

function ctx(req) {
  const userId = req.user?.userId ?? req.user?.id;
  const organizationId = req.user?.organizationId ?? req.user?.organization_id;
  return { userId, organizationId };
}

async function assertCanWriteSignature(req, row) {
  const { userId, organizationId } = ctx(req);
  if (!row || !organizationId || !userId) {
    const err = new Error("Interdit");
    err.statusCode = 403;
    throw err;
  }
  if (req.user?.role === "SUPER_ADMIN") return;

  const scope = scopeFromRow(row);
  if (scope === "organization") {
    const ok = await canConfigureMailAccounts({ userId, organizationId });
    if (!ok) {
      const err = new Error("Réservé aux administrateurs mail");
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  if (scope === "user") {
    if (row.user_id !== userId) {
      const err = new Error("Interdit");
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const ok = await canSendMailAccount({
    userId,
    organizationId,
    mailAccountId: row.mail_account_id,
    action: "send",
  });
  if (!ok) {
    const err = new Error("Accès compte mail refusé");
    err.statusCode = 403;
    throw err;
  }
}

router.get("/signatures", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const mailAccountId =
      typeof req.query.mailAccountId === "string" && req.query.mailAccountId.trim()
        ? req.query.mailAccountId.trim()
        : null;
    const forSettings = req.query.forSettings === "1" || req.query.forSettings === "true";
    const signatures = await getAvailableSignatures({ userId, organizationId, mailAccountId, forSettings });
    const defaultSignature = await getDefaultSignature({ userId, organizationId, mailAccountId });
    return res.json({ success: true, signatures, defaultSignature });
  } catch (err) {
    console.error("GET /signatures:", err);
    return res.status(500).json({ error: "MAIL_SIGNATURES_ERROR" });
  }
});

router.post("/signatures", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { name, signatureHtml, kind, mailAccountId, isDefault } = req.body || {};
    if (!kind || !["organization", "user", "account"].includes(kind)) {
      return res.status(400).json({ error: "BAD_REQUEST", code: "KIND_REQUIRED" });
    }
    if (kind === "organization") {
      if (req.user?.role !== "SUPER_ADMIN") {
        const ok = await canConfigureMailAccounts({ userId, organizationId });
        if (!ok) {
          return res.status(403).json({ error: "FORBIDDEN", code: "ORG_SIGNATURE_ADMIN_ONLY" });
        }
      }
    }
    if (kind === "account") {
      const acc = typeof mailAccountId === "string" ? mailAccountId.trim() : "";
      if (!acc) {
        return res.status(400).json({ error: "BAD_REQUEST", code: "MAIL_ACCOUNT_ID_REQUIRED" });
      }
      if (req.user?.role !== "SUPER_ADMIN") {
        const ok = await canSendMailAccount({
          userId,
          organizationId,
          mailAccountId: acc,
          action: "send",
        });
        if (!ok) {
          return res.status(403).json({ error: "FORBIDDEN", code: "MAIL_ACCOUNT_ACCESS_DENIED" });
        }
      }
    }

    const row = await createSignature({
      organizationId,
      userId,
      kind,
      name,
      signatureHtml,
      mailAccountId: kind === "account" ? mailAccountId : null,
      isDefault: !!isDefault,
    });
    return res.status(201).json({ success: true, signature: row });
  } catch (err) {
    if (err?.code === "VALIDATION") {
      return res.status(400).json({ error: "BAD_REQUEST", message: err.message });
    }
    console.error("POST /signatures:", err);
    return res.status(500).json({ error: "MAIL_SIGNATURES_ERROR" });
  }
});

router.patch("/signatures/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { id } = req.params;
    const row = await getSignatureById(pool, id, organizationId);
    if (!row) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    await assertCanWriteSignature(req, row);

    const { name, signatureHtml } = req.body || {};
    const out = await updateSignature({
      signatureId: id,
      organizationId,
      name,
      signatureHtml,
    });
    return res.json({ success: true, signature: out });
  } catch (err) {
    if (err?.code === "VALIDATION") {
      return res.status(400).json({ error: "BAD_REQUEST", message: err.message });
    }
    const status = err.statusCode || (err.code === "NOT_FOUND" ? 404 : 500);
    if (status !== 500) {
      return res.status(status).json({ error: err.message || "FORBIDDEN" });
    }
    console.error("PATCH /signatures/:id:", err);
    return res.status(500).json({ error: "MAIL_SIGNATURES_ERROR" });
  }
});

router.delete("/signatures/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { id } = req.params;
    const row = await getSignatureById(pool, id, organizationId);
    if (!row) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    await assertCanWriteSignature(req, row);

    const out = await deleteSignature({ signatureId: id, organizationId });
    return res.json({ success: true, signature: out });
  } catch (err) {
    const status = err.statusCode || (err.code === "NOT_FOUND" ? 404 : 500);
    if (status !== 500) {
      return res.status(status).json({ error: err.message || "FORBIDDEN" });
    }
    console.error("DELETE /signatures/:id:", err);
    return res.status(500).json({ error: "MAIL_SIGNATURES_ERROR" });
  }
});

router.post("/signatures/:id/default", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { id } = req.params;
    const row = await getSignatureById(pool, id, organizationId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    await assertCanWriteSignature(req, row);

    const out = await setDefaultSignature({ signatureId: id, organizationId, userId });
    return res.json({ success: true, signature: out });
  } catch (err) {
    const status = err.statusCode || (err.code === "NOT_FOUND" ? 404 : 500);
    if (status !== 500) {
      return res.status(status).json({ error: err.message || "FORBIDDEN" });
    }
    console.error("POST /signatures/:id/default:", err);
    return res.status(500).json({ error: "MAIL_SIGNATURES_ERROR" });
  }
});

export default router;
