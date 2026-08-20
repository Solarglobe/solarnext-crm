/**
 * API brouillons mail (JWT, multi-tenant strict, brouillons personnels).
 *
 * GET    /api/mail/drafts      → liste des brouillons de l'utilisateur
 * POST   /api/mail/drafts      → crée un brouillon
 * PUT    /api/mail/drafts/:id  → met à jour un brouillon
 * DELETE /api/mail/drafts/:id  → supprime un brouillon
 */

import express from "express";
import multer from "multer";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { heavyUserRateLimiter } from "../middleware/security/rateLimit.presets.js";
import {
  createDraft,
  deleteDraft,
  getDraftById,
  listDrafts,
  normalizeDraftPayload,
  resolveDraftConflict,
  updateDraft,
} from "../services/mail/mailDraft.service.js";
import {
  attachUploadedFileToDraft,
  deleteDraftAttachment,
  getDraftAttachmentForDownload,
  listDraftAttachments,
} from "../services/mail/mailDraftAttachments.service.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.min(Math.max(Number(process.env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES) || 20 * 1024 * 1024, 1), 100 * 1024 * 1024),
    files: 1,
  },
});

function ctx(req) {
  const userId = req.user?.userId ?? req.user?.id;
  const organizationId = req.user?.organizationId ?? req.user?.organization_id;
  return { userId, organizationId };
}

router.get("/drafts", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const drafts = await listDrafts({ userId, organizationId });
    return res.json({ success: true, drafts });
  } catch (err) {
    console.error("GET /drafts:", err);
    return res.status(500).json({ error: "MAIL_DRAFTS_ERROR" });
  }
});

router.get("/drafts/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const draft = await getDraftById({ id: req.params.id, userId, organizationId });
    if (!draft) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ success: true, draft });
  } catch (err) {
    console.error("GET /drafts/:id:", err);
    return res.status(500).json({ error: "MAIL_DRAFTS_ERROR" });
  }
});

router.post("/drafts", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const draft = normalizeDraftPayload(req.body || {});
    const created = await createDraft({ userId, organizationId, draft });
    return res.status(201).json({ success: true, draft: created });
  } catch (err) {
    const status = err?.statusCode ?? 500;
    if (status >= 500) console.error("POST /drafts:", err);
    return res.status(status).json({ error: "MAIL_DRAFTS_ERROR", message: err?.message });
  }
});

router.put("/drafts/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const draft = normalizeDraftPayload(req.body || {});
    const updated = await updateDraft({ id: req.params.id, userId, organizationId, draft });
    if (!updated) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ success: true, draft: updated });
  } catch (err) {
    const status = err?.statusCode ?? 500;
    if (status >= 500) console.error("PUT /drafts/:id:", err);
    return res.status(status).json({ error: "MAIL_DRAFTS_ERROR", message: err?.message });
  }
});

router.delete("/drafts/:id", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const ok = await deleteDraft({ id: req.params.id, userId, organizationId });
    if (!ok) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /drafts/:id:", err);
    return res.status(500).json({ error: "MAIL_DRAFTS_ERROR" });
  }
});

router.post("/drafts/:id/resolve-conflict", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_USER_CONTEXT" });
    }
    const draft = await resolveDraftConflict({
      id: req.params.id,
      userId,
      organizationId,
      resolution: req.body?.resolution,
    });
    if (!draft) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ success: true, draft });
  } catch (err) {
    const status = err?.statusCode ?? 500;
    if (status >= 500) console.error("POST /drafts/:id/resolve-conflict:", err);
    return res.status(status).json({ error: "MAIL_DRAFT_CONFLICT_ERROR", message: err?.message });
  }
});

router.get("/drafts/:id/attachments", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) return res.status(403).json({ error: "FORBIDDEN" });
    const attachments = await listDraftAttachments({ userId, organizationId, draftId: req.params.id });
    return res.json({ success: true, attachments });
  } catch (err) {
    console.error("GET /drafts/:id/attachments:", err);
    return res.status(500).json({ error: "MAIL_DRAFT_ATTACHMENTS_ERROR" });
  }
});

router.post("/drafts/:id/attachments", verifyJWT, requireMailUseStrict(), heavyUserRateLimiter, upload.single("file"), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) return res.status(403).json({ error: "FORBIDDEN" });
    const attachment = await attachUploadedFileToDraft({
      userId,
      organizationId,
      draftId: req.params.id,
      file: req.file,
    });
    return res.status(201).json({ success: true, attachment });
  } catch (err) {
    const status = err?.statusCode ?? (err?.code === "LIMIT_FILE_SIZE" ? 413 : 500);
    if (status >= 500) console.error("POST /drafts/:id/attachments:", err);
    return res.status(status).json({ error: "MAIL_DRAFT_ATTACHMENT_ERROR", message: err?.message });
  }
});

router.delete("/drafts/:id/attachments/:attachmentId", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) return res.status(403).json({ error: "FORBIDDEN" });
    const ok = await deleteDraftAttachment({
      userId,
      organizationId,
      draftId: req.params.id,
      attachmentId: req.params.attachmentId,
    });
    if (!ok) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /drafts/:id/attachments/:attachmentId:", err);
    return res.status(500).json({ error: "MAIL_DRAFT_ATTACHMENT_ERROR" });
  }
});

router.get("/drafts/:id/attachments/:attachmentId/download", verifyJWT, requireMailUseStrict(), heavyUserRateLimiter, async (req, res) => {
  try {
    const { userId, organizationId } = ctx(req);
    if (!userId || !organizationId) return res.status(403).json({ error: "FORBIDDEN" });
    const file = await getDraftAttachmentForDownload({
      userId,
      organizationId,
      draftId: req.params.id,
      attachmentId: req.params.attachmentId,
    });
    if (!file) return res.status(404).json({ error: "NOT_FOUND" });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
    return res.sendFile(file.path);
  } catch (err) {
    const status = err?.statusCode ?? 500;
    if (status >= 500) console.error("GET /drafts/:id/attachments/:attachmentId/download:", err);
    return res.status(status).json({ error: "MAIL_DRAFT_ATTACHMENT_ERROR", code: err?.code, message: err?.message });
  }
});

export default router;
