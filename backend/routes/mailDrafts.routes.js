/**
 * API brouillons mail (JWT, multi-tenant strict, brouillons personnels).
 *
 * GET    /api/mail/drafts      → liste des brouillons de l'utilisateur
 * POST   /api/mail/drafts      → crée un brouillon
 * PUT    /api/mail/drafts/:id  → met à jour un brouillon
 * DELETE /api/mail/drafts/:id  → supprime un brouillon
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import {
  createDraft,
  deleteDraft,
  getDraftById,
  listDrafts,
  normalizeDraftPayload,
  updateDraft,
} from "../services/mail/mailDraft.service.js";

const router = express.Router();

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

export default router;
