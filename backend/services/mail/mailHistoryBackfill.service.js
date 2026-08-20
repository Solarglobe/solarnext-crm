import { pool } from "../../config/db.js";
import { createImapClient } from "./imap.service.js";
import { decryptJson } from "../security/encryption.service.js";
import { resolveImapCredentials } from "./mailCredentials.util.js";
import { importImapMessage } from "./mailSync.service.js";
import { assertMailAccountCapability } from "./mailAccountState.service.js";

export const BACKFILL_STATUSES = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  PARTIAL: "PARTIAL",
  BACKFILLING: "BACKFILLING",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
});

export const DEFAULT_BACKFILL_BATCH_SIZE = Math.min(
  Math.max(Number(process.env.MAIL_HISTORY_BACKFILL_BATCH_SIZE) || 50, 1),
  500
);

export function normalizeUidList(uids) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(uids) ? uids : []) {
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function selectOlderUidsForBackfill({ remoteUids, oldestImportedUid, cursorUid, limit }) {
  const normalized = normalizeUidList(remoteUids);
  const ceiling = Number.isSafeInteger(Number(cursorUid))
    ? Number(cursorUid)
    : Number.isSafeInteger(Number(oldestImportedUid))
      ? Number(oldestImportedUid)
      : Number.POSITIVE_INFINITY;
  const older = normalized.filter((uid) => uid < ceiling);
  const batch = older.slice(Math.max(0, older.length - Math.max(1, limit)), older.length).reverse();
  return {
    batch,
    hasMoreOlder: older.length > batch.length,
    nextCursorUid: batch.length ? Math.min(...batch) : null,
    oldestRemoteUid: normalized[0] ?? null,
    remoteTotalCount: normalized.length,
  };
}

export function computeBackfillProgress({ remoteTotalCount, localImportedCount, hasMoreOlder }) {
  const remote = Number(remoteTotalCount) || 0;
  const local = Number(localImportedCount) || 0;
  if (remote <= 0) return { percent: 100, complete: true };
  const percent = Math.max(0, Math.min(100, Math.round((local / remote) * 100)));
  return { percent, complete: !hasMoreOlder && local >= remote };
}

export function resolveUidValidityTransition(previousUidValidity, nextUidValidity) {
  if (!previousUidValidity || !nextUidValidity || String(previousUidValidity) === String(nextUidValidity)) {
    return { changed: false };
  }
  return {
    changed: true,
    reset: {
      history_backfill_status: BACKFILL_STATUSES.NOT_STARTED,
      history_sync_status: "PARTIAL",
      history_backfill_cursor_uid: null,
      oldest_imported_uid: null,
      history_backfill_has_more: true,
    },
  };
}

async function loadAccountAndFolder({ organizationId, mailAccountId, folderId }) {
  const accRes = await pool.query(
    `SELECT id, organization_id, email, is_active, lifecycle_state, sync_enabled, reconnect_required,
            imap_host, imap_port, imap_secure, encrypted_credentials
       FROM mail_accounts
      WHERE id = $1 AND organization_id = $2`,
    [mailAccountId, organizationId]
  );
  const acc = accRes.rows[0];
  if (!acc) throw new Error("Compte mail introuvable");
  assertMailAccountCapability(acc, "canSync");

  const folderRes = await pool.query(
    `SELECT id, organization_id, mail_account_id, type, name, external_id, uid_validity,
            history_backfill_cursor_uid, oldest_imported_uid
       FROM mail_folders
      WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3
        AND selectable = true AND is_active = true`,
    [folderId, organizationId, mailAccountId]
  );
  const folder = folderRes.rows[0];
  if (!folder) throw new Error("Dossier mail introuvable");
  return { acc, folder };
}

async function getLocalHistoryStats({ organizationId, mailAccountId, folderId }) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS local_count,
            MIN(external_uid)::bigint AS oldest_uid,
            MIN(COALESCE(sent_at, received_at, external_internal_date)) AS oldest_date
       FROM mail_messages
      WHERE organization_id = $1 AND mail_account_id = $2 AND folder_id = $3
        AND external_uid IS NOT NULL
        AND remote_missing_at IS NULL
        AND remote_deleted_at IS NULL`,
    [organizationId, mailAccountId, folderId]
  );
  return r.rows[0] || { local_count: 0, oldest_uid: null, oldest_date: null };
}

export async function refreshFolderHistoryStats(pg, p) {
  const stats = await getLocalHistoryStats(p);
  await pg.query(
    `UPDATE mail_folders SET
       local_imported_count = $4,
       oldest_imported_uid = $5,
       oldest_imported_at = $6,
       updated_at = now()
     WHERE id = $3 AND organization_id = $1 AND mail_account_id = $2`,
    [p.organizationId, p.mailAccountId, p.folderId, stats.local_count, stats.oldest_uid, stats.oldest_date]
  );
  return stats;
}

export async function backfillMailFolderHistory({ organizationId, mailAccountId, folderId, batchSize = DEFAULT_BACKFILL_BATCH_SIZE }) {
  const { acc, folder } = await loadAccountAndFolder({ organizationId, mailAccountId, folderId });
  const path = folder.external_id || folder.name;
  const lockClient = await pool.connect();
  let imapClient;
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [
      `mail-history-backfill:${folder.id}`,
    ]);
    if (lock.rows[0]?.locked !== true) {
      return { folderId, imported: 0, skipped: 0, status: "LOCKED" };
    }

    await pool.query(
      `UPDATE mail_folders SET history_backfill_status = 'BACKFILLING',
              history_sync_status = 'PARTIAL',
              history_backfill_started_at = COALESCE(history_backfill_started_at, now()),
              history_backfill_last_error = NULL,
              updated_at = now()
        WHERE id = $1 AND organization_id = $2`,
      [folder.id, organizationId]
    );

    const cred = decryptJson(acc.encrypted_credentials);
    const resolved = resolveImapCredentials(acc.email, cred);
    imapClient = await createImapClient({
      host: acc.imap_host,
      port: acc.imap_port,
      secure: acc.imap_secure !== false,
      auth: { user: resolved.user, password: resolved.password, accessToken: resolved.accessToken },
    });

    const mailboxRaw = await imapClient.mailboxOpen(path);
    const uidValidity = mailboxRaw?.uidValidity != null ? String(mailboxRaw.uidValidity) : null;
    const transition = resolveUidValidityTransition(folder.uid_validity, uidValidity);
    if (transition.changed) {
      await pool.query(
        `UPDATE mail_folders SET
           uid_validity = $3,
           history_backfill_status = 'NOT_STARTED',
           history_sync_status = 'PARTIAL',
           history_backfill_cursor_uid = NULL,
           oldest_imported_uid = NULL,
           history_backfill_has_more = true,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [folder.id, organizationId, uidValidity]
      );
      folder.history_backfill_cursor_uid = null;
      folder.oldest_imported_uid = null;
      folder.uid_validity = uidValidity;
    }

    const searchRes = await imapClient.search({}, { uid: true });
    const localStats = await getLocalHistoryStats({ organizationId, mailAccountId, folderId });
    const selected = selectOlderUidsForBackfill({
      remoteUids: searchRes,
      oldestImportedUid: localStats.oldest_uid ?? folder.oldest_imported_uid,
      cursorUid: folder.history_backfill_cursor_uid,
      limit: batchSize,
    });

    let imported = 0;
    let skipped = 0;
    const db = await pool.connect();
    try {
      for (const uid of selected.batch) {
        await db.query("BEGIN");
        try {
          const r = await importImapMessage(db, imapClient, {
            organizationId,
            mailAccount: { id: mailAccountId, email: acc.email },
            folder,
            uid,
            uidValidity,
          });
          await db.query("COMMIT");
          if (r.skipped) skipped += 1;
          else imported += 1;
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        }
      }
    } finally {
      db.release();
    }

    const newStats = await getLocalHistoryStats({ organizationId, mailAccountId, folderId });
    const complete = selected.oldestRemoteUid == null || Number(newStats.oldest_uid) <= Number(selected.oldestRemoteUid);
    await pool.query(
      `UPDATE mail_folders SET
         history_backfill_status = $4,
         history_sync_status = $5,
         history_backfill_cursor_uid = $6,
         oldest_imported_uid = $7,
         oldest_imported_at = $8,
         remote_total_count = $9,
         local_imported_count = $10,
         history_backfill_has_more = $11,
         history_backfill_last_success_at = now(),
         history_backfill_completed_at = CASE WHEN $4 = 'COMPLETE' THEN now() ELSE history_backfill_completed_at END,
         history_backfill_last_error = NULL,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3`,
      [
        folderId,
        organizationId,
        mailAccountId,
        complete ? BACKFILL_STATUSES.COMPLETE : BACKFILL_STATUSES.PARTIAL,
        complete ? "COMPLETE" : "PARTIAL",
        complete ? null : selected.nextCursorUid,
        newStats.oldest_uid,
        newStats.oldest_date,
        selected.remoteTotalCount,
        newStats.local_count,
        !complete,
      ]
    );
    return {
      folderId,
      imported,
      skipped,
      status: complete ? BACKFILL_STATUSES.COMPLETE : BACKFILL_STATUSES.PARTIAL,
      hasMore: !complete,
      remoteTotalCount: selected.remoteTotalCount,
      localImportedCount: newStats.local_count,
    };
  } catch (err) {
    await pool.query(
      `UPDATE mail_folders SET
         history_backfill_status = 'FAILED',
         history_sync_status = 'PARTIAL',
         history_backfill_last_error = $3,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folderId, organizationId, err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000)]
    );
    throw err;
  } finally {
    if (imapClient) {
      try {
        await imapClient.logout();
      } catch {
        // ignore
      }
    }
    try {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`mail-history-backfill:${folderId}`]);
    } catch {
      // ignore
    }
    lockClient.release();
  }
}
