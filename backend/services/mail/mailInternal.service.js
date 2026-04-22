/**
 * CP-084 — Notes internes + tags sur fils mail (collaboration, jamais exposé au client final).
 */

import { getAccessibleAccountIdArray } from "./mailApi.service.js";
import { emitEventAsync } from "../core/eventBus.service.js";

const MAX_NOTE_LEN = 16_000;

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string, accessibleAccountIds: Set<string> }} p
 */
export async function assertThreadReadable(db, p) {
  const { organizationId, threadId, accessibleAccountIds } = p;
  const accIds = await getAccessibleAccountIdArray(db, organizationId, accessibleAccountIds);
  if (accIds.length === 0) return false;
  const r = await db.query(
    `SELECT 1 FROM mail_threads t
     WHERE t.id = $1 AND t.organization_id = $2
       AND t.archived_at IS NULL
       AND EXISTS (
         SELECT 1 FROM mail_messages m
         WHERE m.mail_thread_id = t.id AND m.mail_account_id = ANY($3::uuid[])
       )
     LIMIT 1`,
    [threadId, organizationId, accIds]
  );
  return r.rows.length > 0;
}

function authorLabel(row) {
  const fn = row.first_name?.trim();
  const ln = row.last_name?.trim();
  if (fn || ln) return [fn, ln].filter(Boolean).join(" ").trim();
  return "Collaborateur";
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string }} p
 */
export async function getThreadNotes(db, p) {
  const { organizationId, threadId } = p;
  const r = await db.query(
    `SELECT n.id, n.content, n.created_at, n.updated_at, n.user_id,
            u.first_name, u.last_name
     FROM mail_thread_notes n
     LEFT JOIN users u ON u.id = n.user_id
     WHERE n.thread_id = $1 AND n.organization_id = $2
     ORDER BY n.created_at ASC`,
    [threadId, organizationId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    content: row.content,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    author: {
      userId: row.user_id,
      displayName: authorLabel(row),
    },
  }));
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string, userId: string, content: string }} p
 */
export async function addThreadNote(db, p) {
  const { organizationId, threadId, userId, content } = p;
  const text = String(content ?? "").trim();
  if (!text) {
    const err = new Error("EMPTY_CONTENT");
    err.code = "EMPTY_CONTENT";
    throw err;
  }
  if (text.length > MAX_NOTE_LEN) {
    const err = new Error("CONTENT_TOO_LONG");
    err.code = "CONTENT_TOO_LONG";
    throw err;
  }

  const ins = await db.query(
    `INSERT INTO mail_thread_notes (organization_id, thread_id, user_id, content)
     VALUES ($1, $2, $3, $4)
     RETURNING id, content, created_at, updated_at, user_id`,
    [organizationId, threadId, userId, text]
  );
  const row = ins.rows[0];
  const u = await db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [userId]);
  const ur = u.rows[0] || {};
  emitEventAsync("NOTE_ADDED", {
    organizationId,
    threadId,
    noteId: row.id,
    userId,
  });
  return {
    id: row.id,
    content: row.content,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    author: {
      userId: row.user_id,
      displayName: authorLabel(ur),
    },
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, noteId: string }} p
 */
export async function getNoteRow(db, p) {
  const r = await db.query(
    `SELECT id, thread_id, organization_id, user_id FROM mail_thread_notes WHERE id = $1 AND organization_id = $2`,
    [p.noteId, p.organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, noteId: string }} p
 */
export async function deleteThreadNote(db, p) {
  const del = await db.query(
    `DELETE FROM mail_thread_notes WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [p.noteId, p.organizationId]
  );
  return del.rows.length > 0;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} organizationId
 */
export async function getAllTags(db, organizationId) {
  const r = await db.query(
    `SELECT id, name, color, created_at FROM mail_thread_tags WHERE organization_id = $1 ORDER BY lower(name) ASC`,
    [organizationId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, name: string, color?: string | null }} p
 */
export async function createTag(db, p) {
  const name = String(p.name ?? "").trim();
  if (!name || name.length > 120) {
    const err = new Error("INVALID_TAG_NAME");
    err.code = "INVALID_TAG_NAME";
    throw err;
  }
  const color = p.color != null && String(p.color).trim() ? String(p.color).trim().slice(0, 32) : null;
  try {
    const ins = await db.query(
      `INSERT INTO mail_thread_tags (organization_id, name, color) VALUES ($1, $2, $3)
       RETURNING id, name, color, created_at`,
      [p.organizationId, name, color]
    );
    const row = ins.rows[0];
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  } catch (e) {
    if (e && e.code === "23505") {
      const err = new Error("DUPLICATE_TAG");
      err.code = "DUPLICATE_TAG";
      throw err;
    }
    throw e;
  }
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string, tagId: string }} p
 */
export async function assignTagToThread(db, p) {
  const { organizationId, threadId, tagId } = p;
  const tag = await db.query(
    `SELECT id FROM mail_thread_tags WHERE id = $1 AND organization_id = $2`,
    [tagId, organizationId]
  );
  if (tag.rows.length === 0) {
    const err = new Error("TAG_NOT_FOUND");
    err.code = "TAG_NOT_FOUND";
    throw err;
  }
  const th = await db.query(`SELECT id FROM mail_threads WHERE id = $1 AND organization_id = $2`, [threadId, organizationId]);
  if (th.rows.length === 0) {
    const err = new Error("THREAD_NOT_FOUND");
    err.code = "THREAD_NOT_FOUND";
    throw err;
  }
  const ins = await db.query(
    `INSERT INTO mail_thread_tag_links (thread_id, tag_id) VALUES ($1, $2)
     ON CONFLICT (thread_id, tag_id) DO NOTHING
     RETURNING thread_id`,
    [threadId, tagId]
  );
  if (ins.rows.length > 0) {
    emitEventAsync("TAG_ASSIGNED", {
      organizationId,
      threadId,
      tagId,
    });
  }
  return { ok: true };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string, tagId: string }} p
 */
export async function removeTagFromThread(db, p) {
  const del = await db.query(
    `DELETE FROM mail_thread_tag_links mtl
     USING mail_thread_tags t
     WHERE mtl.thread_id = $1 AND mtl.tag_id = $2
       AND mtl.tag_id = t.id AND t.organization_id = $3
     RETURNING mtl.thread_id`,
    [p.threadId, p.tagId, p.organizationId]
  );
  return del.rows.length > 0;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string }} p
 */
export async function getThreadTags(db, p) {
  const r = await db.query(
    `SELECT t.id, t.name, t.color, t.created_at
     FROM mail_thread_tag_links mtl
     INNER JOIN mail_thread_tags t ON t.id = mtl.tag_id AND t.organization_id = $2
     WHERE mtl.thread_id = $1
     ORDER BY lower(t.name) ASC`,
    [p.threadId, p.organizationId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, tagId: string }} p
 */
export async function assertTagInOrg(db, p) {
  const r = await db.query(`SELECT 1 FROM mail_thread_tags WHERE id = $1 AND organization_id = $2`, [
    p.tagId,
    p.organizationId,
  ]);
  return r.rows.length > 0;
}

export { MAX_NOTE_LEN };
