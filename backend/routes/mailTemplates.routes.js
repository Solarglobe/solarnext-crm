/**
 * CP-081 — API templates mail.
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { pool } from "../config/db.js";
import {
  createTemplate,
  deleteTemplate,
  getAvailableTemplates,
  getTemplateById,
  renderStoredTemplate,
  updateTemplate,
} from "../services/mail/mailTemplate.service.js";
import { canConfigureMailAccounts } from "../services/mailAccess.service.js";

const router = express.Router();

function ctx(req) {
  const userId = req.user?.userId ?? req.user?.id;
  const organizationId = req.user?.organizationId ?? req.user?.organization_id;
  return { userId, organizationId };
}

async function assertCanWriteTemplate(req, row) {
  const { userId, organizationId } = ctx(req);
  if (!row || !organizationId || !userId) {
    const err = new Error("Interdit");
    err.statusCode = 403;
    throw err;
  }
  if (req.user?.role === "SUPER_ADMIN") return;
  if (row.user_id) {
    if (row.user_id !== userId) {
      const err = new Error("Interdit");
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const ok = await canConfigureMailAccounts({ userId, organizationId });
  if (!ok) {
    const err = new Error("Réservé aux administrateurs mail");
    err.statusCode = 403;
    throw err;
  }
}

router.get("/templates", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const templates = await getAvailableTemplates({ userId, organizationId });
    return res.json({ success: true, templates });
  } catch (err) {
    console.error("GET /templates:", err);
    return res.status(500).json({ error: "MAIL_TEMPLATES_ERROR" });
  }
});

router.post("/templates", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { name, subjectTemplate, bodyHtmlTemplate, category, kind } = req.body || {};
    if (!kind || !["organization", "user"].includes(kind)) {
      return res.status(400).json({ error: "BAD_REQUEST", code: "KIND_REQUIRED" });
    }
    if (kind === "organization") {
      if (req.user?.role !== "SUPER_ADMIN") {
        const ok = await canConfigureMailAccounts({ userId, organizationId });
        if (!ok) {
          return res.status(403).json({ error: "FORBIDDEN", code: "ORG_TEMPLATE_ADMIN_ONLY" });
        }
      }
    }
    const row = await createTemplate({
      organizationId,
      userId,
      kind,
      name,
      subjectTemplate,
      bodyHtmlTemplate,
      category,
    });
    return res.status(201).json({ success: true, template: row });
  } catch (err) {
    if (err?.code === "VALIDATION") {
      return res.status(400).json({ error: "BAD_REQUEST", message: err.message });
    }
    console.error("POST /templates:", err);
    return res.status(500).json({ error: "MAIL_TEMPLATES_ERROR" });
  }
});

router.patch("/templates/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { id } = req.params;
    const row = await getTemplateById(pool, id, organizationId);
    if (!row) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    await assertCanWriteTemplate(req, row);
    const { name, subjectTemplate, bodyHtmlTemplate, category } = req.body || {};
    const out = await updateTemplate({
      templateId: id,
      organizationId,
      name,
      subjectTemplate,
      bodyHtmlTemplate,
      category,
    });
    return res.json({ success: true, template: out });
  } catch (err) {
    if (err?.code === "VALIDATION") {
      return res.status(400).json({ error: "BAD_REQUEST", message: err.message });
    }
    const status = err.statusCode || (err.code === "NOT_FOUND" ? 404 : 500);
    if (status !== 500) {
      return res.status(status).json({ error: err.message || "FORBIDDEN" });
    }
    console.error("PATCH /templates/:id:", err);
    return res.status(500).json({ error: "MAIL_TEMPLATES_ERROR" });
  }
});

router.delete("/templates/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { id } = req.params;
    const row = await getTemplateById(pool, id, organizationId);
    if (!row) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    await assertCanWriteTemplate(req, row);
    const out = await deleteTemplate({ templateId: id, organizationId });
    return res.json({ success: true, template: out });
  } catch (err) {
    const status = err.statusCode || (err.code === "NOT_FOUND" ? 404 : 500);
    if (status !== 500) {
      return res.status(status).json({ error: err.message || "FORBIDDEN" });
    }
    console.error("DELETE /templates/:id:", err);
    return res.status(500).json({ error: "MAIL_TEMPLATES_ERROR" });
  }
});

router.post("/templates/:id/render", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const { id } = req.params;
    const context = req.body?.context;
    if (context != null && typeof context !== "object") {
      return res.status(400).json({ error: "BAD_REQUEST", code: "CONTEXT_OBJECT" });
    }
    const row = await getTemplateById(pool, id, organizationId);
    if (!row || !row.is_active) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    if (row.user_id && row.user_id !== userId) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    const rendered = renderStoredTemplate({
      templateRow: row,
      context: context && typeof context === "object" ? context : {},
    });
    return res.json({ success: true, rendered });
  } catch (err) {
    console.error("POST /templates/:id/render:", err);
    return res.status(500).json({ error: "MAIL_TEMPLATES_RENDER_ERROR" });
  }
});

export default router;
