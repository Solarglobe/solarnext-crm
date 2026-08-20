/**
 * CP-072 — Sync IMAP (lecture seule, idempotent, générique).
 */

import { simpleParser } from "mailparser";
import { pool } from "../../config/db.js";
import { decryptJson } from "../security/encryption.service.js";
import { resolveImapCredentials } from "./mailCredentials.util.js";
import { assertMailAccountCapability, activeSqlPredicate } from "./mailAccountState.service.js";
import { emitEventAsync } from "../core/eventBus.service.js";
import {
  createImapClient,
  ImapErrorCodes,
  syncFoldersFromImap,
} from "./imap.service.js";
import {
  hasSeenFlag,
  normalizeImapFlagsForJsonValue,
} from "./mailImapFlagsProvider.service.js";
import { applyRemoteReadObservationInTransaction } from "./mailFlagMutation.service.js";
import {
  findExistingMessageId,
  normalizeSubject,
  addressesEqual,
  parseReferencesHeader,
  snippetFromBodies,
} from "./mailSyncPersistence.service.js";
import {
  resolveThreadForMessage,
  rebuildThreadMetadata,
  normalizeSubjectForThreading,
} from "./mailThreading.service.js";
import { syncCrmLinkForNewMessage } from "./mailSyncPersistence.service.js";
import { processAttachmentsForMessage } from "./mailAttachments.service.js";
import { importRemoteDraftMessage } from "./mailDraftRemoteImport.service.js";

export const SyncErrorCodes = {
  ...ImapErrorCodes,
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  MAIL_ACCOUNT_STATE_BLOCKED: "MAIL_ACCOUNT_STATE_BLOCKED",
};

/** Limite de sécurité : premiers imports / fenêtre forcée */
export const INITIAL_IMPORT_LIMIT = 150;

const DEFAULT_FOLDER_SYNC_LIMIT = Math.min(Math.max(Number(process.env.MAIL_SYNC_FOLDER_LIMIT) || 25, 1), 250);

/**
 * @param {unknown} err
 * @returns {string}
 */
function syncErrorCode(err) {
  const c = err && typeof err === "object" && "code" in err ? err.code : null;
  if (typeof c === "string" && (Object.values(SyncErrorCodes).includes(c) || Object.values(ImapErrorCodes).includes(c))) {
    return c;
  }
  return SyncErrorCodes.SYNC_FAILED;
}

/**
 * @param {import('imapflow').ImapFlow} client
 * @param {number} uid
 */
async function fetchOneRaw(client, uid) {
  /** @type {import('imapflow').FetchMessageObject | null} */
  let got = null;
  const range = String(uid);
  for await (const m of client.fetch(
    range,
    {
      uid: true,
      envelope: true,
      internalDate: true,
      flags: true,
      modseq: true,
      source: { maxLength: 12_000_000 },
    },
    { uid: true }
  )) {
    got = m;
    break;
  }
  return got;
}

/**
 * @param {import('mailparser').ParsedMail} parsed
 * @returns {Record<string, unknown>}
 */
function headersToJson(parsed) {
  const o = {};
  const h = parsed.headers;
  if (!h) return o;
  if (typeof h.entries === "function") {
    for (const [k, v] of h.entries()) {
      o[String(k).toLowerCase()] = v;
    }
    return o;
  }
  if (typeof h.get === "function" && typeof h.keys === "function") {
    for (const k of h.keys()) {
      o[String(k).toLowerCase()] = h.get(k);
    }
  }
  return o;
}

export function normalizeImapFlagsForJson(flags) {
  if (!flags) return [];
  const list =
    typeof flags === "string"
      ? [flags]
      : typeof flags[Symbol.iterator] === "function"
        ? [...flags]
        : Array.isArray(flags)
          ? flags
          : [];
  return list.map((flag) => String(flag).trim()).filter(Boolean);
}

export function serializeJsonbValue(column, value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch (e) {
    throw new Error(`mail_messages.${column}: valeur JSON non serialisable`, { cause: e });
  }
}

function logMailMessagesJsonbInsert(valuesByColumn) {
  for (const [column, value] of Object.entries(valuesByColumn)) {
    console.info("[mailSync.importImapMessage.jsonb]", {
      table: "mail_messages",
      column,
      typeofValue: typeof value,
      isArray: Array.isArray(value),
      value,
    });
  }
}

/**
 * @param {string | null | undefined} email
 */
function isPlausibleEmail(email) {
  if (!email || typeof email !== "string") return false;
  const t = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/**
 * @param {import('imapflow').MessageEnvelopeObject | undefined} env
 * @param {import('mailparser').ParsedMail} parsed
 * @param {string | null} fromAddr
 * @returns {string[]}
 */
function collectParticipantEmailsForThreading(env, parsed, fromAddr) {
  const out = [];
  if (fromAddr) out.push(fromAddr);
  const pushList = (list) => {
    if (!list) return;
    const arr = Array.isArray(list) ? list : [];
    for (const x of arr) {
      const addr = x?.address ?? (typeof x === "string" ? x : null);
      if (addr && String(addr).includes("@")) out.push(String(addr).trim());
    }
  };
  pushList(env?.to);
  pushList(env?.cc);
  pushList(env?.bcc);
  if (parsed?.to?.value) pushList(parsed.to.value);
  if (parsed?.cc?.value) pushList(parsed.cc.value);
  if (parsed?.bcc?.value) pushList(parsed.bcc.value);
  return [...new Set(out.map((e) => e.toLowerCase()))];
}

/**
 * @param {{
 *   folderType: string,
 *   fromAddr: string | null | undefined,
 *   accountEmail: string,
 * }} p
 * @returns {'INBOUND' | 'OUTBOUND'}
 */
export function resolveDirection(p) {
  const { folderType, fromAddr, accountEmail } = p;
  if (folderType === "SENT") return "OUTBOUND";
  if (addressesEqual(fromAddr, accountEmail)) return "OUTBOUND";
  return "INBOUND";
}

/**
 * @param {import('pg').PoolClient} client
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {{
 *   organizationId: string,
 *   mailAccount: { id: string, email: string },
 *   folder: { id: string, type: string, external_id: string | null, name: string },
 *   uid: number,
 *   uidValidity?: string | null,
 * }} ctx
 */
export async function importImapMessage(client, imapClient, ctx) {
  const { organizationId, mailAccount, folder } = ctx;
  const uid = ctx.uid;

  const raw = await fetchOneRaw(imapClient, uid);
  if (!raw || raw.uid == null) {
    return { skipped: true, reason: "fetch_empty" };
  }

  const sourceBuf = raw.source;
  if (!sourceBuf) {
    return { skipped: true, reason: "no_source" };
  }
  const sourceSizeBytes = Buffer.isBuffer(sourceBuf) ? sourceBuf.length : Buffer.byteLength(String(sourceBuf));

  let parsed;
  try {
    parsed = await simpleParser(sourceBuf);
  } catch {
    return { skipped: true, reason: "parse_failed" };
  }

  const env = raw.envelope;
  const fromAddr = env?.from?.[0]?.address || parsed.from?.value?.[0]?.address || null;
  const fromName = env?.from?.[0]?.name || parsed.from?.value?.[0]?.name || null;

  let messageId =
    (env?.messageId && String(env.messageId).trim()) ||
    (parsed.messageId && String(parsed.messageId).trim()) ||
    null;
  if (!messageId) {
    messageId = `<sg-imap-${mailAccount.id}-${folder.id}-${uid}@sync.local>`;
  }

  const inReplyRaw =
    (env?.inReplyTo && String(env.inReplyTo).trim()) ||
    (parsed.inReplyTo && String(parsed.inReplyTo).trim()) ||
    null;

  let referencesIds = [];
  const refsHeader = parsed.headers?.get("references") || parsed.headers?.get("References");
  if (typeof refsHeader === "string") {
    referencesIds = parseReferencesHeader(refsHeader);
  } else if (Array.isArray(refsHeader)) {
    for (const x of refsHeader) referencesIds.push(...parseReferencesHeader(String(x)));
  }
  if (env?.references != null) {
    if (typeof env.references === "string") {
      referencesIds.push(...parseReferencesHeader(env.references));
    } else {
      const ers = Array.isArray(env.references) ? env.references : [env.references];
      for (const r of ers) {
        if (typeof r === "string") referencesIds.push(...parseReferencesHeader(r));
      }
    }
  }

  const subj = normalizeSubject(env?.subject || parsed.subject || "");

  const existing = await findExistingMessageId(client, {
    organizationId,
    mailAccountId: mailAccount.id,
    folderId: folder.id,
    externalUid: uid,
    externalUidValidity: ctx.uidValidity ?? null,
    messageId,
  });
  if (existing) {
    await applyRemoteReadObservationInTransaction(client, {
      organizationId,
      mailAccountId: mailAccount.id,
      folderId: folder.id,
      uid,
      uidValidity: ctx.uidValidity ?? null,
      modseq: raw.modseq != null ? String(raw.modseq) : null,
      flags: normalizeImapFlagsForJson(raw.flags),
      isRead: hasSeenFlag(raw.flags),
    });
    return { skipped: true, reason: "duplicate_flags_reconciled", messageId: existing };
  }

  const sentAt = env?.date ? new Date(env.date) : parsed.date ? new Date(parsed.date) : null;
  const receivedAt = raw.internalDate ? new Date(raw.internalDate) : new Date();
  const extFlags = normalizeImapFlagsForJson(raw.flags);
  const remoteMoveCandidate = await findMissingMovedMessageCandidate(client, {
    organizationId,
    mailAccountId: mailAccount.id,
    targetFolderId: folder.id,
    messageId,
    subject: subj,
    sentAt,
    internalDate: raw.internalDate ? new Date(raw.internalDate) : null,
    sourceSizeBytes,
  });
  if (remoteMoveCandidate.status === "match") {
    const old = remoteMoveCandidate.message;
    await client.query(
      `UPDATE mail_messages SET
         previous_folder_id = folder_id,
         previous_folder_path = (
           SELECT COALESCE(f.external_id, f.name)
           FROM mail_folders f
           WHERE f.id = mail_messages.folder_id
         ),
         folder_id = $3,
         external_uid = $4,
         external_uid_validity = $5,
         external_modseq = $6,
         external_flags = $7::jsonb,
         external_internal_date = $8,
         external_size_bytes = $9,
         is_read = $10,
         remote_missing_at = NULL,
         remote_deleted_at = NULL,
         move_sync_status = 'SYNCED',
         move_sync_error = NULL,
         move_synced_at = now(),
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [
        old.id,
        organizationId,
        folder.id,
        uid,
        ctx.uidValidity ?? null,
        raw.modseq != null ? String(raw.modseq) : null,
        serializeJsonbValue("external_flags", extFlags),
        raw.internalDate ? new Date(raw.internalDate) : null,
        sourceSizeBytes,
        hasSeenFlag(raw.flags),
      ]
    );
    await rebuildThreadMetadata({ client, threadId: old.mail_thread_id });
    return { skipped: true, reason: "remote_move_reconciled", messageId: old.id, threadId: old.mail_thread_id };
  }
  if (remoteMoveCandidate.status === "ambiguous") {
    await client.query(
      `UPDATE mail_folders SET
         message_sync_status = 'ACTION_REQUIRED',
         last_message_sync_error_at = now(),
         last_message_sync_error_code = 'REMOTE_MOVE_AMBIGUOUS',
         last_message_sync_error_message = 'Deplacement distant ambigu: plusieurs occurrences candidates sans fusion automatique',
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, organizationId]
    );
  }

  const direction = resolveDirection({
    folderType: folder.type,
    fromAddr,
    accountEmail: mailAccount.email,
  });

  const isRead = hasSeenFlag(raw.flags);

  const bodyText = parsed.text || null;
  const bodyHtml = parsed.html || null;
  const snip = snippetFromBodies(bodyText || "", bodyHtml || undefined);

  const participantEmails = collectParticipantEmailsForThreading(env, parsed, fromAddr);
  const pivotDate = receivedAt || sentAt || (raw.internalDate ? new Date(raw.internalDate) : null);

  const resolved = await resolveThreadForMessage(client, {
    organizationId,
    mailAccountId: mailAccount.id,
    accountEmail: mailAccount.email,
    messageId,
    inReplyTo: inReplyRaw,
    referencesIds,
    subject: subj,
    messageDate: pivotDate,
    participantEmails,
  });

  const threadIsRead = direction === "OUTBOUND" ? true : isRead;
  const threadHasUnread = direction === "INBOUND" && !isRead;

  let threadId = resolved.threadId;
  if (!threadId) {
    const ns = normalizeSubjectForThreading(subj);
    const ins = await client.query(
      `INSERT INTO mail_threads (
        organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
      RETURNING id`,
      [organizationId, subj, snip, sentAt || receivedAt, threadIsRead, threadHasUnread, ns]
    );
    threadId = ins.rows[0].id;
  }

  const status = direction === "OUTBOUND" ? "SENT" : "RECEIVED";
  const referencesArray = referencesIds.length ? [...new Set(referencesIds.map((x) => String(x).trim()).filter(Boolean))] : null;

  const rawHeaders = headersToJson(parsed);
  const externalFlagsJson = serializeJsonbValue("external_flags", extFlags);
  const rawHeadersJson = serializeJsonbValue("raw_headers", rawHeaders);
  logMailMessagesJsonbInsert({
    external_flags: extFlags,
    raw_headers: rawHeaders,
  });

  const msgIns = await client.query(
    `INSERT INTO mail_messages (
      organization_id, mail_thread_id, mail_account_id, folder_id,
      message_id, in_reply_to, references_ids,
      subject, body_text, body_html,
      direction, status, sent_at, received_at,
      is_read, has_attachments,
      external_uid, external_flags, external_internal_date, raw_headers, sync_source
      , external_uid_validity, external_modseq, read_sync_status, read_synced_at, external_size_bytes
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10,
      $11::mail_message_direction, $12::mail_message_status, $13, $14,
      $15, $16,
      $17, $18::jsonb, $19, $20::jsonb, COALESCE($21, 'IMAP')
      , $22, $23, 'SYNCED', now(), $24
    )
    RETURNING id`,
    [
      organizationId,
      threadId,
      mailAccount.id,
      folder.id,
      messageId,
      inReplyRaw || null,
      referencesArray,
      subj,
      bodyText,
      bodyHtml,
      direction,
      status,
      sentAt,
      receivedAt,
      isRead,
      (parsed.attachments && parsed.attachments.length > 0) || false,
      uid,
      externalFlagsJson,
      raw.internalDate ? new Date(raw.internalDate) : null,
      rawHeadersJson,
      "IMAP",
      ctx.uidValidity ?? null,
      raw.modseq != null ? String(raw.modseq) : null,
      sourceSizeBytes,
    ]
  );

  const mailMessageId = msgIns.rows[0].id;

  const addrs = {
    from: env?.from || [],
    to: env?.to || [],
    cc: env?.cc || [],
    bcc: env?.bcc || [],
  };

  async function insertParticipants(list, type) {
    for (const a of list) {
      const em = a?.address;
      if (!isPlausibleEmail(em)) continue;
      await client.query(
        `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
         VALUES ($1, $2, $3::mail_participant_type, $4, $5)`,
        [organizationId, mailMessageId, type, em.trim(), a.name || null]
      );
    }
  }

  await insertParticipants(addrs.from, "FROM");
  await insertParticipants(addrs.to, "TO");
  await insertParticipants(addrs.cc, "CC");
  await insertParticipants(addrs.bcc, "BCC");

  if (addrs.from.length === 0 && fromAddr && isPlausibleEmail(fromAddr)) {
    await client.query(
      `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
       VALUES ($1, $2, 'FROM', $3, $4)`,
      [organizationId, mailMessageId, fromAddr.trim(), fromName]
    );
  }

  await syncCrmLinkForNewMessage({ messageId: mailMessageId, dbClient: client });

  if (parsed.attachments?.length) {
    await processAttachmentsForMessage({
      dbClient: client,
      messageId: mailMessageId,
      organizationId,
      parsedMail: parsed,
    });
  }

  await rebuildThreadMetadata({ client, threadId });

  return { skipped: false, messageId: mailMessageId, threadId, direction, organizationId };
}

/**
 * @param {import('imapflow').ImapFlow} client
 * @param {number[]} uids
 * @param {boolean} incremental
 * @param {boolean} forceFull
 * @param {string | null} maxUidDb
 */
export function selectUidsToSync(uids, incremental, forceFull, maxUidDb) {
  const sorted = [...uids].sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  if (incremental && !forceFull && maxUidDb != null) {
    const m = Number(maxUidDb);
    return sorted.filter((u) => u > m);
  }

  return sorted.slice(-INITIAL_IMPORT_LIMIT);
}

function datesNearMinutes(a, b, minutes = 10) {
  if (!a || !b) return false;
  const at = new Date(a).getTime();
  const bt = new Date(b).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return false;
  return Math.abs(at - bt) <= minutes * 60 * 1000;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   targetFolderId: string,
 *   messageId: string | null,
 *   subject: string,
 *   sentAt: Date | null,
 *   internalDate: Date | null,
 *   sourceSizeBytes: number | null,
 * }}
 */
async function findMissingMovedMessageCandidate(client, p) {
  if (!p.messageId) return { status: "none" };
  const r = await client.query(
    `SELECT id, mail_thread_id, subject, sent_at, external_internal_date, external_size_bytes
     FROM mail_messages
     WHERE organization_id = $1
       AND mail_account_id = $2
       AND folder_id IS DISTINCT FROM $3
       AND remote_missing_at IS NOT NULL
       AND remote_deleted_at IS NULL
       AND message_id = $4
     ORDER BY remote_missing_at DESC
     LIMIT 5`,
    [p.organizationId, p.mailAccountId, p.targetFolderId, p.messageId]
  );
  const candidates = r.rows.filter((row) => {
    if (normalizeSubject(row.subject || "") !== normalizeSubject(p.subject || "")) return false;
    const dateMatch =
      datesNearMinutes(row.external_internal_date, p.internalDate) ||
      datesNearMinutes(row.sent_at, p.sentAt) ||
      datesNearMinutes(row.sent_at, p.internalDate);
    if (!dateMatch) return false;
    if (row.external_size_bytes != null && p.sourceSizeBytes != null) {
      return Number(row.external_size_bytes) === Number(p.sourceSizeBytes);
    }
    return true;
  });
  if (candidates.length === 1) return { status: "match", message: candidates[0] };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "none" };
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
function sameRemoteCursor(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

function remoteModseqIncreased(previous, current) {
  if (!previous || !current) return false;
  try {
    return BigInt(String(current)) > BigInt(String(previous));
  } catch {
    return false;
  }
}

/**
 * Fallback borne : on reconcilie les flags des messages locaux les plus recents
 * sans retelecharger leur contenu.
 *
 * @param {import('pg').Pool} pg
 * @param {string} mailAccountId
 * @param {string} folderId
 * @param {number} limit
 */
async function getRecentLocalUidsForFlagRefresh(pg, mailAccountId, folderId, limit) {
  const r = await pg.query(
    `SELECT external_uid::bigint AS uid
     FROM mail_messages
     WHERE mail_account_id = $1
       AND folder_id = $2
       AND external_uid IS NOT NULL
     ORDER BY COALESCE(received_at, sent_at, external_internal_date, created_at) DESC NULLS LAST
     LIMIT $3`,
    [mailAccountId, folderId, limit]
  );
  return r.rows.map((row) => Number(row.uid)).filter((uid) => Number.isFinite(uid));
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {string} range
 * @param {{ changedSince?: string | null }} opts
 */
async function fetchFlagSnapshots(imapClient, range, opts = {}) {
  const out = [];
  const fetchOpts = { uid: true };
  if (opts.changedSince) fetchOpts.changedSince = String(opts.changedSince);
  for await (const msg of imapClient.fetch(
    range,
    { uid: true, flags: true, modseq: true },
    fetchOpts
  )) {
    if (msg.uid == null) continue;
    out.push({
      uid: Number(msg.uid),
      flags: normalizeImapFlagsForJsonValue(msg.flags),
      isRead: hasSeenFlag(msg.flags),
      modseq: msg.modseq != null ? String(msg.modseq) : null,
    });
  }
  return out;
}

/**
 * @param {import('pg').Pool} pg
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {{ id: string, email: string, organization_id: string, user_id?: string | null }} mailAccount
 * @param {{ id: string, type: string, external_id: string | null, name: string, uid_validity?: string | null, highest_modseq?: string | null }} folder
 * @param {{ uidValidity: string | null, highestModseq: string | null }} mailbox
 */
export async function reconcileExistingFlagsForFolder(pg, imapClient, mailAccount, folder, mailbox) {
  const previousUidValidity = folder.uid_validity ?? null;
  if (previousUidValidity && mailbox.uidValidity && previousUidValidity !== mailbox.uidValidity) {
    await pg.query(
      `UPDATE mail_folders SET
         uid_validity = $3,
         highest_modseq = $4,
         flag_sync_error_code = 'UIDVALIDITY_CHANGED',
         flag_sync_error_message = 'UIDVALIDITY distant modifie; reconciliation des anciens UID suspendue',
         flag_sync_error_at = now(),
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, mailAccount.organization_id, mailbox.uidValidity, mailbox.highestModseq]
    );
    return { checked: 0, updated: 0, strategy: "uidvalidity_changed" };
  }

  const canUseModseq =
    sameRemoteCursor(mailbox.uidValidity, previousUidValidity || mailbox.uidValidity) &&
    remoteModseqIncreased(folder.highest_modseq, mailbox.highestModseq);

  let snapshots = [];
  let strategy = "fallback_recent_window";
  if (canUseModseq) {
    snapshots = await fetchFlagSnapshots(imapClient, "1:*", { changedSince: folder.highest_modseq });
    strategy = "condstore_changed_since";
  } else {
    const limit = Math.min(Math.max(Number(process.env.MAIL_FLAG_RECONCILE_RECENT_LIMIT) || 200, 25), 1000);
    const uids = await getRecentLocalUidsForFlagRefresh(pg, mailAccount.id, folder.id, limit);
    if (uids.length > 0) {
      snapshots = await fetchFlagSnapshots(imapClient, uids.join(","), {});
    }
  }

  let updated = 0;
  const db = await pg.connect();
  try {
    for (const snap of snapshots) {
      await db.query("BEGIN");
      try {
        const r = await applyRemoteReadObservationInTransaction(db, {
          organizationId: mailAccount.organization_id,
          mailAccountId: mailAccount.id,
          folderId: folder.id,
          uid: snap.uid,
          uidValidity: mailbox.uidValidity,
          modseq: snap.modseq,
          flags: snap.flags,
          isRead: snap.isRead,
        });
        await db.query("COMMIT");
        if (r.applied) updated += 1;
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    db.release();
  }

  await pg.query(
    `UPDATE mail_folders SET
       uid_validity = COALESCE($3, uid_validity),
       highest_modseq = COALESCE($4, highest_modseq),
       last_flag_sync_at = now(),
       flag_sync_error_code = NULL,
       flag_sync_error_message = NULL,
       flag_sync_error_at = NULL,
       updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [folder.id, mailAccount.organization_id, mailbox.uidValidity, mailbox.highestModseq]
  );

  return { checked: snapshots.length, updated, strategy };
}

/**
 * @param {import('pg').Pool} pg
 * @param {string} mailAccountId
 * @param {string} folderId
 * @returns {Promise<string | null>}
 */
export async function getMaxExternalUidForFolder(pg, mailAccountId, folderId) {
  const r = await pg.query(
    `SELECT MAX(external_uid)::text AS m FROM mail_messages
     WHERE mail_account_id = $1 AND folder_id = $2`,
    [mailAccountId, folderId]
  );
  const v = r.rows[0]?.m;
  return v != null ? v : null;
}

/**
 * Marque les occurrences locales qui ont disparu du dossier distant pendant
 * une synchronisation. Les mutations locales encore en cours restent prioritaires.
 *
 * @param {import('pg').Pool} pg
 * @param {{ organizationId: string, mailAccountId: string, folderId: string, remoteUids: number[], uidValidity?: string | null }}
 */
export async function markMissingLocalMessagesForFolder(pg, p) {
  const db = await pg.connect();
  try {
    await db.query("BEGIN");
    const r = await db.query(
      `UPDATE mail_messages m SET
         remote_missing_at = COALESCE(remote_missing_at, now()),
         move_sync_status = CASE
           WHEN move_sync_status IN ('PENDING_MOVE_SYNC', 'PENDING_DELETE_SYNC') THEN move_sync_status
           ELSE 'REMOTE_MISSING'
         END,
         updated_at = now()
       WHERE m.organization_id = $1
         AND m.mail_account_id = $2
         AND m.folder_id = $3
         AND m.external_uid IS NOT NULL
         AND m.remote_missing_at IS NULL
         AND m.remote_deleted_at IS NULL
         AND ($5::text IS NULL OR m.external_uid_validity IS NULL OR m.external_uid_validity = $5::text)
         AND NOT (m.external_uid = ANY($4::bigint[]))
         AND NOT EXISTS (
           SELECT 1 FROM mail_move_mutations mv
           WHERE mv.mail_message_id = m.id
             AND mv.status IN ('PENDING', 'PROCESSING', 'RETRYING')
         )
       RETURNING m.mail_thread_id`,
      [p.organizationId, p.mailAccountId, p.folderId, p.remoteUids, p.uidValidity ?? null]
    );
    for (const threadId of [...new Set(r.rows.map((row) => row.mail_thread_id).filter(Boolean))]) {
      await rebuildThreadMetadata({ client: db, threadId });
    }
    await db.query("COMMIT");
    return { markedMissing: r.rowCount };
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    db.release();
  }
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {import('pg').Pool} pg
 * @param {{ id: string, email: string, organization_id: string }} mailAccount
 * @param {{ id: string, type: string, external_id: string | null, name: string, uid_validity?: string | null, highest_modseq?: string | null }} folder
 * @param {{ incremental: boolean, forceFull: boolean }}
 */
export async function syncFolderForAccount(imapClient, pg, mailAccount, folder, opts) {
  const path = folder.external_id || folder.name;
  if (!path) {
    return { folderId: folder.id, imported: 0, skipped: 0, error: "missing_path" };
  }

  const lockClient = await pg.connect();
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [
      `mail-folder-sync:${folder.id}`,
    ]);
    if (lock.rows[0]?.locked !== true) {
      return { folderId: folder.id, imported: 0, skipped: 0, error: "locked" };
    }

    await pg.query(
      `UPDATE mail_folders SET message_sync_status = 'SYNCING', updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, mailAccount.organization_id]
    );

    const mailboxRaw = await imapClient.mailboxOpen(path);
    const mailbox = {
      uidValidity: mailboxRaw?.uidValidity != null ? String(mailboxRaw.uidValidity) : null,
      highestModseq: mailboxRaw?.highestModseq != null ? String(mailboxRaw.highestModseq) : null,
    };

    const flagSummary = await reconcileExistingFlagsForFolder(pg, imapClient, mailAccount, folder, mailbox);
    if (flagSummary.strategy === "uidvalidity_changed") {
      await pg.query(
        `UPDATE mail_folders SET
           message_sync_status = 'ACTION_REQUIRED',
           last_message_sync_error_at = now(),
           last_message_sync_error_code = 'UIDVALIDITY_CHANGED',
           last_message_sync_error_message = 'UIDVALIDITY distant modifie; import suspendu pour ce dossier',
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [folder.id, mailAccount.organization_id]
      );
      return { folderId: folder.id, imported: 0, skipped: 0, flags: flagSummary, error: "uidvalidity_changed" };
    }

    const searchRes = await imapClient.search({}, { uid: true });
    const uids = Array.isArray(searchRes) ? searchRes : [];
    const missingSummary = await markMissingLocalMessagesForFolder(pg, {
      organizationId: mailAccount.organization_id,
      mailAccountId: mailAccount.id,
      folderId: folder.id,
      remoteUids: uids,
      uidValidity: mailbox.uidValidity,
    });
    const maxUidDb = await getMaxExternalUidForFolder(pg, mailAccount.id, folder.id);
    const toFetch = selectUidsToSync(uids, opts.incremental, opts.forceFull, maxUidDb);

    let imported = 0;
    let skipped = 0;

    const db = await pg.connect();
    try {
      for (const uid of toFetch) {
        await db.query("BEGIN");
        try {
          let r;
          if (folder.type === "DRAFT" && mailAccount.user_id) {
            const raw = await fetchOneRaw(imapClient, uid);
            r = await importRemoteDraftMessage(db, imapClient, {
              organizationId: mailAccount.organization_id,
              userId: mailAccount.user_id,
              mailAccount: { id: mailAccount.id, email: mailAccount.email },
              folder,
              raw,
              uidValidity: mailbox.uidValidity,
            });
          } else {
            r = await importImapMessage(db, imapClient, {
              organizationId: mailAccount.organization_id,
              mailAccount: { id: mailAccount.id, email: mailAccount.email },
              folder,
              uid,
              uidValidity: mailbox.uidValidity,
            });
          }
          await db.query("COMMIT");
          if (r.skipped) skipped += 1;
          else {
            imported += 1;
            if (r.direction === "INBOUND" && r.messageId && r.threadId) {
              emitEventAsync("MAIL_RECEIVED", {
                messageId: r.messageId,
                threadId: r.threadId,
                organizationId: mailAccount.organization_id,
                mailAccountId: mailAccount.id,
              });
            }
          }
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        }
      }
    } finally {
      db.release();
    }

    await pg.query(
      `UPDATE mail_folders SET
         message_sync_status = 'SYNCED',
         history_sync_status = CASE WHEN $3::boolean THEN 'PARTIAL' ELSE COALESCE(history_sync_status, 'PARTIAL') END,
         history_backfill_status = CASE
           WHEN $3::boolean THEN CASE WHEN history_backfill_status = 'BACKFILLING' THEN 'BACKFILLING' ELSE 'PARTIAL' END
           WHEN history_backfill_status = 'NOT_STARTED' THEN 'PARTIAL'
           ELSE history_backfill_status
         END,
         remote_total_count = $4,
         remote_message_count = $4,
         local_imported_count = (
           SELECT COUNT(*)::int FROM mail_messages m
            WHERE m.organization_id = $2 AND m.mail_account_id = mail_folders.mail_account_id
              AND m.folder_id = mail_folders.id
              AND m.external_uid IS NOT NULL
              AND m.remote_missing_at IS NULL
              AND m.remote_deleted_at IS NULL
         ),
         oldest_imported_uid = (
           SELECT MIN(m.external_uid)::bigint FROM mail_messages m
            WHERE m.organization_id = $2 AND m.mail_account_id = mail_folders.mail_account_id
              AND m.folder_id = mail_folders.id
              AND m.external_uid IS NOT NULL
              AND m.remote_missing_at IS NULL
              AND m.remote_deleted_at IS NULL
         ),
         history_backfill_has_more = $3::boolean,
         last_message_sync_at = now(),
         last_message_sync_error_at = NULL,
         last_message_sync_error_code = NULL,
         last_message_sync_error_message = NULL,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, mailAccount.organization_id, toFetch.length < uids.length, uids.length]
    );

    return {
      folderId: folder.id,
      imported,
      skipped,
      flags: flagSummary,
      missing: missingSummary.markedMissing,
      totalRemoteUids: uids.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pg.query(
      `UPDATE mail_folders SET
         message_sync_status = 'ERROR',
         last_message_sync_error_at = now(),
         last_message_sync_error_code = $3,
         last_message_sync_error_message = $4,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, mailAccount.organization_id, syncErrorCode(err), msg.slice(0, 1000)]
    );
    return { folderId: folder.id, imported: 0, skipped: 0, error: syncErrorCode(err), message: msg.slice(0, 500) };
  } finally {
    try {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`mail-folder-sync:${folder.id}`]);
    } catch {
      // ignore
    }
    lockClient.release();
  }
}

/**
 * @param {{ mailAccountId: string, organizationId: string, forceFull?: boolean, folderId?: string | null }} p
 */
export async function syncMailAccount(p) {
  const { mailAccountId, organizationId, forceFull = false, folderId = null } = p;

  const accRow = await pool.query(
    `SELECT id, organization_id, user_id, email, is_active, lifecycle_state, sync_enabled, reconnect_required,
            imap_host, imap_port, imap_secure, encrypted_credentials,
            last_imap_sync_at, sync_status
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2`,
    [mailAccountId, organizationId]
  );
  if (accRow.rows.length === 0) {
    const e = new Error("Compte mail introuvable");
    e.code = SyncErrorCodes.INVALID_CONFIG;
    throw e;
  }
  const acc = accRow.rows[0];
  assertMailAccountCapability(acc, "canSync");

  const incremental = acc.last_imap_sync_at != null && !forceFull;

  await pool.query(
    `UPDATE mail_accounts SET
       sync_status = 'SYNCING',
       last_sync_attempt_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [mailAccountId]
  );

  let imapClient;
  try {
    const cred = decryptJson(acc.encrypted_credentials);
    const { user: imapUser, password, accessToken } = resolveImapCredentials(acc.email, cred);
    if (!password && !accessToken) {
      const e = new Error("Credentials invalides");
      e.code = SyncErrorCodes.INVALID_CONFIG;
      throw e;
    }

    const cfg = {
      host: acc.imap_host,
      port: acc.imap_port,
      secure: acc.imap_secure !== false,
      auth: { user: imapUser, password, accessToken },
    };

    await syncFoldersFromImap({ mailAccountId, organizationId });

    imapClient = await createImapClient(cfg);

    const folderParams = [organizationId, mailAccountId];
    let folderWhere = "";
    if (folderId) {
      folderParams.push(folderId);
      folderWhere = ` AND id = $${folderParams.length}::uuid`;
    }
    folderParams.push(DEFAULT_FOLDER_SYNC_LIMIT);
    const limitIdx = folderParams.length;
    const foldersRes = await pool.query(
      `SELECT id, type, external_id, name, uid_validity, highest_modseq,
              selectable, is_active, sync_priority, last_message_sync_at
       FROM mail_folders
       WHERE organization_id = $1 AND mail_account_id = $2
         AND is_active = true
         AND selectable = true
         ${folderWhere}
       ORDER BY sync_priority ASC, last_message_sync_at ASC NULLS FIRST, depth ASC, name ASC
       LIMIT $${limitIdx}`,
      folderParams
    );

    const summary = { folders: [], folderBudget: DEFAULT_FOLDER_SYNC_LIMIT };
    for (const folder of foldersRes.rows) {
      const r = await syncFolderForAccount(
        imapClient,
        pool,
        { id: acc.id, email: acc.email, organization_id: acc.organization_id, user_id: acc.user_id },
        folder,
        { incremental, forceFull }
      );
      summary.folders.push(r);
    }

    await pool.query(
      `UPDATE mail_accounts SET
         sync_status = 'IDLE',
         last_imap_sync_at = now(),
         last_sync_at = now(),
         last_successful_sync_at = now(),
         last_error_code = NULL,
         last_error_message = NULL,
         imap_status = 'OK',
         last_imap_error_at = NULL,
         last_imap_error_code = NULL,
         last_imap_error_message = NULL,
         updated_at = now()
       WHERE id = $1`,
      [mailAccountId]
    );

    return { mailAccountId, ok: true, summary };
  } catch (err) {
    const code = syncErrorCode(err);
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE mail_accounts SET
         sync_status = 'ERROR',
         lifecycle_state = CASE WHEN $2 = 'AUTH_FAILED' THEN 'AUTH_REQUIRED'::mail_account_lifecycle_state ELSE lifecycle_state END,
         reconnect_required = CASE WHEN $2 = 'AUTH_FAILED' THEN true ELSE reconnect_required END,
         last_error_code = $2,
         last_error_message = $3,
         imap_status = 'ERROR',
         last_imap_error_at = now(),
         last_imap_error_code = $2,
         last_imap_error_message = $3,
         updated_at = now()
       WHERE id = $1`,
      [mailAccountId, code, msg.slice(0, 4000)]
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
  }
}

export const __test = {
  findMissingMovedMessageCandidate,
  datesNearMinutes,
};

/**
 * @param {{ organizationId?: string | null, limit?: number | null, forceFull?: boolean }} p
 */
export async function syncAllMailAccounts(p = {}) {
  const { organizationId = null, limit = null, forceFull = false } = p;

  let q = `
    SELECT id, organization_id FROM mail_accounts a
    WHERE ${activeSqlPredicate("a", "canSync")}
  `;
  const params = [];
  if (organizationId) {
    params.push(organizationId);
    q += ` AND organization_id = $${params.length}`;
  }
  q += ` ORDER BY last_imap_sync_at NULLS FIRST, email ASC`;
  if (limit != null && Number.isFinite(limit)) {
    params.push(limit);
    q += ` LIMIT $${params.length}`;
  }

  const r = await pool.query(q, params);
  const out = {
    total: r.rows.length,
    ok: 0,
    failed: 0,
    results: [],
    errors: [],
  };

  for (const row of r.rows) {
    try {
      const res = await syncMailAccount({
        mailAccountId: row.id,
        organizationId: row.organization_id,
        forceFull,
      });
      out.ok += 1;
      out.results.push(res);
    } catch (e) {
      out.failed += 1;
      out.errors.push({
        mailAccountId: row.id,
        organizationId: row.organization_id,
        code: syncErrorCode(e),
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return out;
}
