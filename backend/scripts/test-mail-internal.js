#!/usr/bin/env node
/**
 * CP-084 — Tests notes + tags internes.
 * Usage : node --env-file=./.env scripts/test-mail-internal.js
 */

import assert from "assert";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";
import {
  addThreadNote,
  assignTagToThread,
  assertThreadReadable,
  createTag,
  deleteThreadNote,
  getAllTags,
  getThreadNotes,
  getThreadTags,
  removeTagFromThread,
} from "../services/mail/mailInternal.service.js";

async function pickContext() {
  const org = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  if (!org.rows.length) return null;
  const organizationId = org.rows[0].id;

  const u = await pool.query(
    `SELECT id FROM users WHERE organization_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
    [organizationId]
  );
  if (!u.rows.length) return null;
  const userId = u.rows[0].id;

  const th = await pool.query(
    `SELECT t.id AS thread_id, m.mail_account_id
     FROM mail_threads t
     INNER JOIN mail_messages m ON m.mail_thread_id = t.id AND m.organization_id = t.organization_id
     WHERE t.organization_id = $1 AND t.archived_at IS NULL
     LIMIT 1`,
    [organizationId]
  );
  if (!th.rows.length) return null;

  return {
    organizationId,
    userId,
    threadId: th.rows[0].thread_id,
    mailAccountId: th.rows[0].mail_account_id,
  };
}

async function main() {
  const ctx = await pickContext();
  if (!ctx) {
    console.log("skip (no org/user/thread)");
    console.log("MAIL INTERNAL OK");
    await pool.end();
    return;
  }

  const { organizationId, userId, threadId, mailAccountId } = ctx;
  const accessible = new Set([mailAccountId]);

  const canRead = await assertThreadReadable(pool, { organizationId, threadId, accessibleAccountIds: accessible });
  assert.strictEqual(canRead, true);

  const tag = await createTag(pool, {
    organizationId,
    name: `TEST_TAG_${Date.now()}`,
    color: "#6366f1",
  });
  assert.ok(tag.id);

  await assignTagToThread(pool, { organizationId, threadId, tagId: tag.id });
  const tags1 = await getThreadTags(pool, { organizationId, threadId });
  assert.ok(tags1.some((t) => t.id === tag.id));

  const note = await addThreadNote(pool, {
    organizationId,
    threadId,
    userId,
    content: "Note interne test CP-084",
  });
  assert.ok(note.id);
  assert.ok(note.content.includes("CP-084"));

  const notes1 = await getThreadNotes(pool, { organizationId, threadId });
  assert.ok(notes1.some((n) => n.id === note.id));

  const removed = await removeTagFromThread(pool, { organizationId, threadId, tagId: tag.id });
  assert.strictEqual(removed, true);
  const tags2 = await getThreadTags(pool, { organizationId, threadId });
  assert.ok(!tags2.some((t) => t.id === tag.id));

  const del = await deleteThreadNote(pool, { organizationId, noteId: note.id });
  assert.strictEqual(del, true);

  await pool.query(`DELETE FROM mail_thread_tags WHERE id = $1`, [tag.id]);

  const all = await getAllTags(pool, organizationId);
  assert.ok(Array.isArray(all));

  console.log("MAIL INTERNAL OK");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
