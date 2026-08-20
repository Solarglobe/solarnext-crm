/**
 * Read model for accessible real IMAP folders.
 */

import { getAccessibleAccountIdArray } from "./mailApi.service.js";

/**
 * @param {number | null | undefined} n
 */
function intOrZero(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, accessibleAccountIds: Set<string> }}
 */
export async function listAccessibleMailFolders(db, p) {
  const accIds = await getAccessibleAccountIdArray(db, p.organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) return { accounts: [] };

  const res = await db.query(
    `SELECT
       a.id AS account_id,
       a.email AS account_email,
       a.display_name AS account_display_name,
       f.id,
       f.name,
       f.type,
       f.external_id,
       f.parent_id,
       f.parent_path,
       f.delimiter,
       f.depth,
       f.special_use,
       f.selectable,
       f.subscribed,
       f.is_active,
       f.remote_message_count,
       f.remote_unread_count,
       f.message_sync_status,
       f.history_sync_status,
       f.history_backfill_status,
       f.history_backfill_cursor_uid,
       f.oldest_imported_uid,
       f.remote_total_count,
       f.local_imported_count,
       f.oldest_imported_at,
       f.history_backfill_last_success_at,
       f.history_backfill_last_error,
       f.history_backfill_has_more,
       f.last_discovered_at,
       f.last_message_sync_at,
       f.last_message_sync_error_code,
       f.last_message_sync_error_message,
       COALESCE(local_counts.total_local, 0)::int AS total_local,
       COALESCE(local_counts.unread_local, 0)::int AS unread_local
     FROM mail_accounts a
     INNER JOIN mail_folders f ON f.mail_account_id = a.id AND f.organization_id = a.organization_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS total_local,
         COUNT(*) FILTER (
           WHERE m.direction = 'INBOUND'::mail_message_direction AND m.is_read = false
         )::int AS unread_local
       FROM mail_messages m
       WHERE m.organization_id = f.organization_id
         AND m.mail_account_id = f.mail_account_id
         AND m.folder_id = f.id
         AND m.remote_missing_at IS NULL
         AND m.remote_deleted_at IS NULL
     ) local_counts ON true
     WHERE a.organization_id = $1
       AND a.is_active = true
       AND a.id = ANY($2::uuid[])
       AND f.is_active = true
     ORDER BY a.email ASC, f.sync_priority ASC, f.depth ASC, lower(f.name) ASC`,
    [p.organizationId, accIds]
  );

  const byAccount = new Map();
  for (const row of res.rows) {
    if (!byAccount.has(row.account_id)) {
      byAccount.set(row.account_id, {
        id: row.account_id,
        email: row.account_email,
        displayName: row.account_display_name,
        folders: [],
      });
    }
    byAccount.get(row.account_id).folders.push({
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      type: row.type,
      externalId: row.external_id,
      parentId: row.parent_id,
      parentPath: row.parent_path,
      delimiter: row.delimiter,
      depth: intOrZero(row.depth),
      specialUse: row.special_use,
      selectable: row.selectable === true,
      subscribed: row.subscribed,
      canOpen: row.selectable === true,
      unreadCount: intOrZero(row.unread_local),
      totalLocal: intOrZero(row.total_local),
      remoteUnreadCount: row.remote_unread_count == null ? null : intOrZero(row.remote_unread_count),
      remoteMessageCount: row.remote_message_count == null ? null : intOrZero(row.remote_message_count),
      syncStatus: row.message_sync_status,
      historySyncStatus: row.history_sync_status,
      historyBackfillStatus: row.history_backfill_status,
      historyBackfillCursorUid: row.history_backfill_cursor_uid == null ? null : Number(row.history_backfill_cursor_uid),
      oldestImportedUid: row.oldest_imported_uid == null ? null : Number(row.oldest_imported_uid),
      remoteTotalCount: row.remote_total_count == null ? null : intOrZero(row.remote_total_count),
      localImportedCount: row.local_imported_count == null ? intOrZero(row.total_local) : intOrZero(row.local_imported_count),
      oldestImportedAt: row.oldest_imported_at ? new Date(row.oldest_imported_at).toISOString() : null,
      historyBackfillLastSuccessAt: row.history_backfill_last_success_at
        ? new Date(row.history_backfill_last_success_at).toISOString()
        : null,
      historyBackfillLastError: row.history_backfill_last_error,
      historyBackfillHasMore: row.history_backfill_has_more !== false && row.history_sync_status !== "COMPLETE",
      isHistoryPartial: row.history_sync_status !== "COMPLETE",
      lastDiscoveredAt: row.last_discovered_at ? new Date(row.last_discovered_at).toISOString() : null,
      lastMessageSyncAt: row.last_message_sync_at ? new Date(row.last_message_sync_at).toISOString() : null,
      lastErrorCode: row.last_message_sync_error_code,
      lastErrorMessage: row.last_message_sync_error_message,
    });
  }

  return { accounts: [...byAccount.values()] };
}
