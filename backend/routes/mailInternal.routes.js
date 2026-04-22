/**
 * CP-084 — Notes internes + tags (JWT + mail.use).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { pool } from "../config/db.js";
import { getAccessibleMailAccountIds } from "../services/mailAccess.service.js";
import {
  assertThreadReadable,
  addThreadNote,
  deleteThreadNote,
  getAllTags,
  assignTagToThread,
  createTag,
  getThreadNotes,
  getThreadTags,
  getNoteRow,
  removeTagFromThread,
  MAX_NOTE_LEN,
} from "../services/mail/mailInternal.service.js";

const router = express.Router();

/**
 * @param {import('express').Request} req
 * @returns {Promise<Set<string>>}
 */
async function resolveAccessibleAccountIds(req) {
  const userId = req.user.userId ?? req.user.id;
  const organizationId = req.user.organizationId ?? req.user.organization_id;
  if (req.user.role === "SUPER_ADMIN") {
    const r = await pool.query(`SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true`, [
      organizationId,
    ]);
    return new Set(r.rows.map((x) => x.id));
  }
  return getAccessibleMailAccountIds({ userId, organizationId });
}

router.get("/threads/:threadId/notes", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const threadId = req.params.threadId;
    const accessible = await resolveAccessibleAccountIds(req);
    const ok = await assertThreadReadable(pool, { organizationId, threadId, accessibleAccountIds: accessible });
    if (!ok) return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    const notes = await getThreadNotes(pool, { organizationId, threadId });
    return res.json({ success: true, notes });
  } catch (err) {
    console.error("GET /mail/threads/:threadId/notes", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.post("/threads/:threadId/notes", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const userId = req.user.userId ?? req.user.id;
    const threadId = req.params.threadId;
    const content = req.body?.content ?? req.body?.text;
    const accessible = await resolveAccessibleAccountIds(req);
    const ok = await assertThreadReadable(pool, { organizationId, threadId, accessibleAccountIds: accessible });
    if (!ok) return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    try {
      const note = await addThreadNote(pool, { organizationId, threadId, userId, content });
      return res.status(201).json({ success: true, note });
    } catch (e) {
      if (e.code === "EMPTY_CONTENT") return res.status(400).json({ success: false, code: "EMPTY_CONTENT" });
      if (e.code === "CONTENT_TOO_LONG") {
        return res.status(400).json({ success: false, code: "CONTENT_TOO_LONG", maxLength: MAX_NOTE_LEN });
      }
      throw e;
    }
  } catch (err) {
    console.error("POST /mail/threads/:threadId/notes", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.delete("/notes/:noteId", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const noteId = req.params.noteId;
    const accessible = await resolveAccessibleAccountIds(req);

    const row = await getNoteRow(pool, { organizationId, noteId });
    if (!row) return res.status(404).json({ success: false, code: "NOTE_NOT_FOUND" });

    const ok = await assertThreadReadable(pool, {
      organizationId,
      threadId: row.thread_id,
      accessibleAccountIds: accessible,
    });
    if (!ok) return res.status(404).json({ success: false, code: "NOTE_NOT_FOUND" });

    await deleteThreadNote(pool, { organizationId, noteId });
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /mail/notes/:noteId", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/tags", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const tags = await getAllTags(pool, organizationId);
    return res.json({ success: true, tags });
  } catch (err) {
    console.error("GET /mail/tags", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.post("/tags", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const name = req.body?.name;
    const color = req.body?.color ?? null;
    try {
      const tag = await createTag(pool, { organizationId, name, color });
      return res.status(201).json({ success: true, tag });
    } catch (e) {
      if (e.code === "INVALID_TAG_NAME") return res.status(400).json({ success: false, code: "INVALID_TAG_NAME" });
      if (e.code === "DUPLICATE_TAG") return res.status(409).json({ success: false, code: "DUPLICATE_TAG" });
      throw e;
    }
  } catch (err) {
    console.error("POST /mail/tags", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/threads/:threadId/tags", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const threadId = req.params.threadId;
    const accessible = await resolveAccessibleAccountIds(req);
    const ok = await assertThreadReadable(pool, { organizationId, threadId, accessibleAccountIds: accessible });
    if (!ok) return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    const tags = await getThreadTags(pool, { organizationId, threadId });
    return res.json({ success: true, tags });
  } catch (err) {
    console.error("GET /mail/threads/:threadId/tags", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.post("/threads/:threadId/tags", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const threadId = req.params.threadId;
    const tagId = req.body?.tagId ?? req.body?.tag_id;
    if (!tagId || typeof tagId !== "string") {
      return res.status(400).json({ success: false, code: "TAG_ID_REQUIRED" });
    }
    const accessible = await resolveAccessibleAccountIds(req);
    const ok = await assertThreadReadable(pool, { organizationId, threadId, accessibleAccountIds: accessible });
    if (!ok) return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    try {
      await assignTagToThread(pool, { organizationId, threadId, tagId: tagId.trim() });
      const tags = await getThreadTags(pool, { organizationId, threadId });
      return res.json({ success: true, tags });
    } catch (e) {
      if (e.code === "TAG_NOT_FOUND") return res.status(404).json({ success: false, code: "TAG_NOT_FOUND" });
      if (e.code === "THREAD_NOT_FOUND") return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
      throw e;
    }
  } catch (err) {
    console.error("POST /mail/threads/:threadId/tags", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.delete("/threads/:threadId/tags/:tagId", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const threadId = req.params.threadId;
    const tagId = req.params.tagId;
    const accessible = await resolveAccessibleAccountIds(req);
    const ok = await assertThreadReadable(pool, { organizationId, threadId, accessibleAccountIds: accessible });
    if (!ok) return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    await removeTagFromThread(pool, { organizationId, threadId, tagId });
    const tags = await getThreadTags(pool, { organizationId, threadId });
    return res.json({ success: true, tags });
  } catch (err) {
    console.error("DELETE /mail/threads/:threadId/tags/:tagId", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

export default router;
