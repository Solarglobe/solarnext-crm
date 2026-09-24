/**
 * Brouillons mail — CRUD strictement scopé organisation + utilisateur.
 * Un brouillon est personnel : seul son auteur le voit et le modifie.
 */

import { pool } from "../../config/db.js";
import { randomUUID } from "crypto";
import { assertDraftMailAccountAccess } from "./mailDraftAccess.service.js";
import { lockDraftTransaction, draftJobFence } from "./mailDraftFence.service.js";
import { adoptRemoteDraftAttachments } from "./mailDraftRemoteAttachments.service.js";
import {
  DRAFT_SYNC_STATUSES,
  planDraftRemoteDelete,
  planDraftRemoteSave,
  stableDraftMessageId,
} from "./mailDraftSync.service.js";

const BODY_HTML_MAX_LENGTH = 2_000_000;
const FIELD_MAX_LENGTH = 10_000;

function asTrimmedString(v, max = FIELD_MAX_LENGTH) {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

/** Normalise et valide le payload d'écriture. Lève une erreur 400 si invalide. */
export function normalizeDraftPayload(body) {
  const bodyHtml = typeof body?.bodyHtml === "string" ? body.bodyHtml : "";
  if (bodyHtml.length > BODY_HTML_MAX_LENGTH) {
    const err = new Error("Brouillon trop volumineux.");
    err.statusCode = 413;
    throw err;
  }
  return {
    mailAccountId:
      typeof body?.mailAccountId === "string" && body.mailAccountId.trim()
        ? body.mailAccountId.trim()
        : null,
    to: asTrimmedString(body?.to),
    cc: asTrimmedString(body?.cc),
    bcc: asTrimmedString(body?.bcc),
    subject: asTrimmedString(body?.subject),
    bodyText: asTrimmedString(body?.bodyText, BODY_HTML_MAX_LENGTH),
    bodyHtml,
    attachments: Array.isArray(body?.attachments) ? body.attachments.slice(0, 50) : [],
  };
}

function rowToDraft(r) {
  return {
    id: r.id,
    mail_account_id: r.mail_account_id,
    to: r.to_recipients,
    cc: r.cc_recipients,
    bcc: r.bcc_recipients,
    subject: r.subject,
    body_html: r.body_html,
    body_text: r.body_text,
    attachments_json: Array.isArray(r.attachments_json) ? r.attachments_json : [],
    message_id: r.message_id,
    draft_identity: r.draft_identity,
    remote_folder_id: r.remote_folder_id,
    remote_uid: r.remote_uid == null ? null : Number(r.remote_uid),
    remote_uid_validity: r.remote_uid_validity,
    remote_modseq: r.remote_modseq,
    local_version: r.local_version,
    remote_version: r.remote_version,
    sync_status: r.sync_status,
    local_dirty: r.local_dirty,
    last_local_saved_at: r.last_local_saved_at,
    last_remote_saved_at: r.last_remote_saved_at,
    sync_error: r.sync_error,
    conflict_of_draft_id: r.conflict_of_draft_id,
    conflict_reason: r.conflict_reason,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function enqueueDraftSyncJob(client, { organizationId, mailAccountId, draftId, action, payload, idempotencyKey }) {
  if (!mailAccountId) return;
  await client.query(
    `INSERT INTO mail_draft_sync_jobs
       (organization_id, mail_account_id, draft_id, action, status, idempotency_key, payload_json, next_attempt_at)
     VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, now())
     ON CONFLICT (organization_id, idempotency_key)
       DO UPDATE SET payload_json = EXCLUDED.payload_json,
                     status = CASE WHEN mail_draft_sync_jobs.status = 'succeeded' THEN 'queued' ELSE mail_draft_sync_jobs.status END,
                     next_attempt_at = now(),
                     updated_at = now()`,
    [organizationId, mailAccountId, draftId, action, idempotencyKey, JSON.stringify(payload || {})]
  );
}

/** @param {{ userId: string, organizationId: string }} p */
export async function listDrafts({ userId, organizationId }) {
  const { rows } = await pool.query(
    `SELECT id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
            subject, body_text, body_html, attachments_json, message_id, draft_identity, remote_folder_id,
            remote_uid, remote_uid_validity, remote_modseq, local_version, remote_version,
            sync_status, local_dirty, last_local_saved_at, last_remote_saved_at, sync_error,
            conflict_of_draft_id, conflict_reason, created_at, updated_at
       FROM mail_drafts
      WHERE organization_id = $1 AND user_id = $2
      ORDER BY updated_at DESC
      LIMIT 200`,
    [organizationId, userId]
  );
  return rows.map(rowToDraft);
}

/** @param {{ id: string, userId: string, organizationId: string }} p */
export async function getDraftById({ id, userId, organizationId }) {
  const { rows } = await pool.query(
    `SELECT id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
            subject, body_text, body_html, attachments_json, message_id, draft_identity, remote_folder_id,
            remote_uid, remote_uid_validity, remote_modseq, local_version, remote_version,
            sync_status, local_dirty, last_local_saved_at, last_remote_saved_at, sync_error,
            conflict_of_draft_id, conflict_reason, created_at, updated_at
       FROM mail_drafts
      WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [id, organizationId, userId]
  );
  return rows[0] ? rowToDraft(rows[0]) : null;
}

/**
 * @param {{ userId: string, organizationId: string,
 *   draft: ReturnType<typeof normalizeDraftPayload> }} p
 */
export async function createDraft({ userId, organizationId, draft }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertDraftMailAccountAccess(client, { userId, organizationId, mailAccountId: draft.mailAccountId });
    const msgId = stableDraftMessageId({ organizationId });
    const draftIdentity = randomUUID().replace(/-/g, "");
    const { rows } = await client.query(
    `INSERT INTO mail_drafts
       (organization_id, user_id, mail_account_id,
        to_recipients, cc_recipients, bcc_recipients, subject, body_text, body_html,
        attachments_json, message_id, draft_identity, sync_status, local_dirty, last_local_saved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, 'QUEUED', true, now())
     RETURNING id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
               subject, body_text, body_html, attachments_json, message_id, draft_identity, remote_folder_id,
               remote_uid, remote_uid_validity, remote_modseq, local_version, remote_version,
               sync_status, local_dirty, last_local_saved_at, last_remote_saved_at, sync_error,
               conflict_of_draft_id, conflict_reason, created_at, updated_at`,
    [
      organizationId,
      userId,
      draft.mailAccountId,
      draft.to,
      draft.cc,
      draft.bcc,
      draft.subject,
      draft.bodyText,
      draft.bodyHtml,
      JSON.stringify(draft.attachments),
      msgId,
      draftIdentity,
    ]
  );
    const created = rows[0];
    if (draft.mailAccountId) {
      await enqueueDraftSyncJob(client, {
        organizationId,
        mailAccountId: draft.mailAccountId,
        draftId: created.id,
        action: "save",
        payload: { ...planDraftRemoteSave({ draftId: created.id, previousUid: null, draftFolderPath: "Drafts" }), ...draftJobFence(created) },
        idempotencyKey: `draft-save:${created.id}:v1`,
      });
    }
    await client.query("COMMIT");
    return rowToDraft(created);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {{ id: string, userId: string, organizationId: string,
 *   draft: ReturnType<typeof normalizeDraftPayload> }} p
 * @returns brouillon mis à jour, ou null si introuvable / pas à l'utilisateur.
 */
export async function updateDraft({ id, userId, organizationId, draft }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockDraftTransaction(client, { organizationId, draftId: id });
    const current = await client.query(
      `SELECT * FROM mail_drafts
       WHERE id = $1 AND organization_id = $2 AND user_id = $3
       FOR UPDATE`,
      [id, organizationId, userId]
    );
    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    if (current.rows[0].abandoned_at) {
      const error = new Error("Ce brouillon est en cours de suppression.");
      error.statusCode = 409;
      throw error;
    }
    await assertDraftMailAccountAccess(client, { userId, organizationId, mailAccountId: draft.mailAccountId });
    const accountChanged = (current.rows[0].mail_account_id || null) !== (draft.mailAccountId || null);
    const nextVersion = Number(current.rows[0].local_version || 0) + 1;
    const { rows } = await client.query(
    `UPDATE mail_drafts
        SET mail_account_id = $4,
            to_recipients = $5,
            cc_recipients = $6,
            bcc_recipients = $7,
            subject = $8,
            body_text = $9,
            body_html = $10,
            attachments_json = $11::jsonb,
            local_version = $12,
            sync_status = 'QUEUED',
            local_dirty = true,
            last_local_saved_at = now(),
            sync_error = NULL,
            draft_identity = CASE WHEN $13 THEN $14 ELSE draft_identity END,
            message_id = CASE WHEN $13 THEN $15 ELSE message_id END,
            remote_folder_id = CASE WHEN $13 THEN NULL ELSE remote_folder_id END,
            remote_uid = CASE WHEN $13 THEN NULL ELSE remote_uid END,
            remote_uid_validity = CASE WHEN $13 THEN NULL ELSE remote_uid_validity END,
            remote_modseq = CASE WHEN $13 THEN NULL ELSE remote_modseq END,
            remote_version = CASE WHEN $13 THEN NULL ELSE remote_version END,
            last_remote_saved_at = CASE WHEN $13 THEN NULL ELSE last_remote_saved_at END,
            conflict_of_draft_id = CASE WHEN $13 THEN NULL ELSE conflict_of_draft_id END,
            conflict_reason = CASE WHEN $13 THEN NULL ELSE conflict_reason END,
            updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND user_id = $3
      RETURNING id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
                subject, body_text, body_html, attachments_json, message_id, draft_identity, remote_folder_id,
                remote_uid, remote_uid_validity, remote_modseq, local_version, remote_version,
                sync_status, local_dirty, last_local_saved_at, last_remote_saved_at, sync_error,
                conflict_of_draft_id, conflict_reason, created_at, updated_at`,
    [
      id,
      organizationId,
      userId,
      draft.mailAccountId,
      draft.to,
      draft.cc,
      draft.bcc,
      draft.subject,
      draft.bodyText,
      draft.bodyHtml,
      JSON.stringify(draft.attachments),
      nextVersion,
      accountChanged,
      accountChanged ? randomUUID().replace(/-/g, "") : null,
      accountChanged ? stableDraftMessageId({ organizationId }) : null,
    ]
  );
    if (accountChanged) {
      // Local attachment content follows its personal draft. Keep its account
      // scope aligned so a later import can reconcile or detach it correctly.
      await client.query(
        `UPDATE mail_draft_attachments SET mail_account_id = $4, updated_at = now()
         WHERE draft_id = $1 AND organization_id = $2 AND user_id = $3 AND cleanup_status <> 'deleted'`,
        [id, organizationId, userId, draft.mailAccountId]
      );
    }
    if (draft.mailAccountId) {
      await enqueueDraftSyncJob(client, {
        organizationId,
        mailAccountId: draft.mailAccountId,
        draftId: id,
        action: "save",
        payload: { ...planDraftRemoteSave({
          draftId: id,
          previousUid: rows[0].remote_uid,
          draftFolderPath: "Drafts",
        }), ...draftJobFence(rows[0]) },
        idempotencyKey: `draft-save:${id}:v${nextVersion}`,
      });
    }
    await client.query("COMMIT");
    return rows[0] ? rowToDraft(rows[0]) : null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {{ id: string, userId: string, organizationId: string }} p
 * @returns true si supprimé.
 */
export async function deleteDraft({ id, userId, organizationId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockDraftTransaction(client, { organizationId, draftId: id });
    const current = await client.query(
      `SELECT * FROM mail_drafts
       WHERE id = $1 AND organization_id = $2 AND user_id = $3
       FOR UPDATE`,
      [id, organizationId, userId]
    );
    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    const row = current.rows[0];
    await assertDraftMailAccountAccess(client, { userId, organizationId, mailAccountId: row.mail_account_id });
    if (row.mail_account_id && row.remote_uid) {
      await client.query(
        `UPDATE mail_drafts SET sync_status = $4, abandoned_at = now(), updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [id, organizationId, userId, DRAFT_SYNC_STATUSES.DELETE_QUEUED]
      );
      await enqueueDraftSyncJob(client, {
        organizationId,
        mailAccountId: row.mail_account_id,
        draftId: id,
        action: "delete",
        payload: { ...planDraftRemoteDelete({ draftId: id, remoteUid: row.remote_uid, draftFolderPath: "Drafts" }), ...draftJobFence(row) },
        idempotencyKey: `draft-delete:${id}:${row.draft_identity}:v${row.local_version}:${row.remote_uid}`,
      });
    } else {
      await client.query(`DELETE FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3`, [
        id,
        organizationId,
        userId,
      ]);
    }
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function resolveDraftConflict({ id, userId, organizationId, resolution }) {
  const choice = String(resolution || "").trim();
  if (!["use_local", "use_remote", "keep_both"].includes(choice)) {
    const err = new Error("Résolution de conflit invalide");
    err.statusCode = 400;
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Discover the second row, then acquire both draft fences in a stable order.
    // Re-read the relation after locking: it may have changed while we waited.
    const hint = await client.query(
      `SELECT conflict_of_draft_id FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
      [id, organizationId, userId]
    );
    const parentId = choice === "use_remote" ? hint.rows[0]?.conflict_of_draft_id : null;
    for (const draftId of [...new Set([id, parentId].filter(Boolean))].sort()) {
      await lockDraftTransaction(client, { organizationId, draftId });
    }
    // The remote importer locks the original before its conflict copy. Use the
    // same row order even when this request was addressed to the copy.
    const parentResult = parentId ? await client.query(
      `SELECT * FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3 FOR UPDATE`,
      [parentId, organizationId, userId]
    ) : null;
    const current = await client.query(
      `SELECT * FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3 FOR UPDATE`,
      [id, organizationId, userId]
    );
    const row = current.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    await assertDraftMailAccountAccess(client, { userId, organizationId, mailAccountId: row.mail_account_id });
    if (row.abandoned_at || (choice === "use_remote" && (row.conflict_of_draft_id || null) !== (parentId || null))) {
      const error = new Error("Le brouillon a changé. Rechargez-le avant de résoudre le conflit.");
      error.statusCode = 409;
      throw error;
    }
    if (choice === "keep_both") {
      await client.query(
        `UPDATE mail_drafts SET sync_status = CASE WHEN local_dirty THEN 'QUEUED' ELSE 'SYNCED' END,
           local_version = local_version + 1, conflict_reason = NULL, conflict_of_draft_id = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [id, organizationId, userId]
      );
    } else if (choice === "use_remote" && row.conflict_of_draft_id) {
      const remote = row;
      const parent = parentResult?.rows[0];
      if (!parent || parent.abandoned_at || parent.mail_account_id !== remote.mail_account_id ||
          !parent.draft_identity || !remote.draft_identity?.startsWith(`${parent.draft_identity}-remote-`)) {
        const error = new Error("Cette copie distante appartient à une ancienne boîte ou version du brouillon.");
        error.statusCode = 409;
        throw error;
      }
      const attachments = await adoptRemoteDraftAttachments(client, {
        organizationId, userId, sourceDraftId: id, targetDraftId: parentId, mailAccountId: row.mail_account_id,
      });
      await client.query(
        `UPDATE mail_drafts SET
           to_recipients = $4, cc_recipients = $5, bcc_recipients = $6,
           subject = $7, body_text = $8, body_html = $9,
           remote_uid = $10, remote_uid_validity = $11, remote_modseq = $12, remote_version = $13,
           remote_folder_id = $14, message_id = $15, attachments_json = $16::jsonb,
           local_version = local_version + 1, last_remote_saved_at = $17, sync_error = NULL,
           sync_status = CASE WHEN $18 THEN 'QUEUED' ELSE 'SYNCED' END, local_dirty = $18,
           last_local_saved_at = CASE WHEN $18 THEN $19 ELSE last_local_saved_at END,
           conflict_reason = NULL, conflict_of_draft_id = NULL,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [
          row.conflict_of_draft_id,
          organizationId,
          userId,
          remote.to_recipients,
          remote.cc_recipients,
          remote.bcc_recipients,
          remote.subject,
          remote.body_text,
          remote.body_html,
          remote.remote_uid,
          remote.remote_uid_validity,
          remote.remote_modseq,
          remote.remote_version,
          remote.remote_folder_id,
          remote.message_id,
          JSON.stringify(attachments),
          remote.last_remote_saved_at,
          remote.local_dirty === true,
          remote.last_local_saved_at,
        ]
      );
      await client.query(`DELETE FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3`, [id, organizationId, userId]);
    } else {
      await client.query(
        `UPDATE mail_drafts SET sync_status = 'QUEUED', local_dirty = true,
           local_version = local_version + 1, conflict_reason = NULL, conflict_of_draft_id = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
        [id, organizationId, userId]
      );
    }
    const updated = await client.query(
      `SELECT id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
              subject, body_text, body_html, attachments_json, message_id, draft_identity, remote_folder_id,
              remote_uid, remote_uid_validity, remote_modseq, local_version, remote_version,
              sync_status, local_dirty, last_local_saved_at, last_remote_saved_at, sync_error,
              conflict_of_draft_id, conflict_reason, created_at, updated_at
         FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
      [choice === "use_remote" && row.conflict_of_draft_id ? row.conflict_of_draft_id : id, organizationId, userId]
    );
    const resolved = updated.rows[0];
    if (resolved?.mail_account_id && resolved.local_dirty) {
      await enqueueDraftSyncJob(client, {
        organizationId, mailAccountId: resolved.mail_account_id, draftId: resolved.id, action: "save",
        payload: { ...planDraftRemoteSave({ draftId: resolved.id, previousUid: resolved.remote_uid, draftFolderPath: "Drafts" }), ...draftJobFence(resolved) },
        idempotencyKey: `draft-save:${resolved.id}:v${resolved.local_version}`,
      });
    }
    await client.query("COMMIT");
    return updated.rows[0] ? rowToDraft(updated.rows[0]) : null;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
