import { summarizeMailSyncOutcome, parseMailSyncOutcome } from "./mailSyncOutcome.service.js";
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
  INVALID_IMAP_RESPONSE: "INVALID_IMAP_RESPONSE",
  MODSEQ_REGRESSED: "MODSEQ_REGRESSED",
  CURSOR_CHANGED: "CURSOR_CHANGED",
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
      size: true,
      envelope: true,
      internalDate: true,
      flags: true,
      modseq: true,
      source: { maxLength: 12_000_000 },
    },
    { uid: true }
  )) {
    if (Number(m.uid) !== Number(uid)) {
      throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "Le message reçu ne correspond pas à l'UID demandé");
    }
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

function folderSyncError(code, message) {
  return Object.assign(new Error(message), { code });
}

function hasUsableModseq(imapClient, mailbox) {
  // ImapFlow only emits FETCH CHANGEDSINCE when CONDSTORE is enabled;
  // QRESYNC alone in enabled does not satisfy its FETCH implementation.
  return imapClient.enabled?.has?.("CONDSTORE") &&
    mailbox.noModseq !== true && /^\d+$/.test(String(mailbox.highestModseq ?? ""));
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
async function getRecentLocalUidsForFlagRefresh(pg, mailAccountId, folderId, limit, uidValidity) {
  const r = await pg.query(
    `SELECT external_uid::bigint AS uid
     FROM mail_messages
     WHERE mail_account_id = $1
       AND folder_id = $2
       AND external_uid IS NOT NULL
       AND external_uid_validity IS NOT DISTINCT FROM $4::text
       AND remote_missing_at IS NULL AND remote_deleted_at IS NULL
     ORDER BY COALESCE(received_at, sent_at, external_internal_date, created_at) DESC NULLS LAST
     LIMIT $3`,
    [mailAccountId, folderId, limit, uidValidity ?? null]
  );
  return r.rows.map((row) => Number(row.uid)).filter((uid) => Number.isFinite(uid));
}

async function getLocalUnreadCountForFolder(pg, mailAccountId, folderId, uidValidity) {
  const r = await pg.query(
    `SELECT COUNT(*)::int AS c
     FROM mail_messages
     WHERE mail_account_id = $1
       AND folder_id = $2
       AND direction = 'INBOUND'::mail_message_direction
       AND is_read = false
       AND external_uid_validity IS NOT DISTINCT FROM $3::text
       AND remote_missing_at IS NULL
       AND remote_deleted_at IS NULL`,
    [mailAccountId, folderId, uidValidity ?? null]
  );
  return Number(r.rows[0]?.c) || 0;
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
    if (!Number.isSafeInteger(Number(msg.uid)) || Number(msg.uid) <= 0 || msg.flags == null) {
      throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "Réponse de flags IMAP incomplète");
    }
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
  const sameNamespace = sameRemoteCursor(mailbox.uidValidity, previousUidValidity);
  const supportsModseq = hasUsableModseq(imapClient, mailbox);
  const hasPreviousModseq = /^\d+$/.test(String(folder.highest_modseq ?? ""));
  if (supportsModseq && sameNamespace && hasPreviousModseq &&
      remoteModseqIncreased(mailbox.highestModseq, folder.highest_modseq)) {
    throw folderSyncError(SyncErrorCodes.MODSEQ_REGRESSED, "Le MODSEQ distant est antérieur au dernier état confirmé");
  }
  if (supportsModseq && sameNamespace && hasPreviousModseq &&
      sameRemoteCursor(folder.highest_modseq, mailbox.highestModseq)) {
    return { checked: 0, updated: 0, strategy: "modseq_unchanged" };
  }
  const canUseModseq = supportsModseq && sameNamespace && hasPreviousModseq;
  const remoteUnreadCount =
    mailbox.remoteUnreadCount != null && Number.isFinite(Number(mailbox.remoteUnreadCount)) ? Number(mailbox.remoteUnreadCount) : null;
  const localUnreadCount = remoteUnreadCount == null
    ? null
    : await getLocalUnreadCountForFolder(pg, mailAccount.id, folder.id, mailbox.uidValidity);
  const hasUnreadMismatch =
    remoteUnreadCount != null && localUnreadCount != null && remoteUnreadCount !== localUnreadCount;

  let snapshots = [];
  let strategy = "fallback_recent_window";
  if (canUseModseq) {
    snapshots = await fetchFlagSnapshots(imapClient, "1:*", { changedSince: folder.highest_modseq });
    strategy = "condstore_changed_since";
  } else if (supportsModseq || (imapClient.enabled?.has?.("QRESYNC") && mailbox.noModseq !== true)) {
    // Establish a complete flags baseline before confirming the first MODSEQ.
    snapshots = await fetchFlagSnapshots(imapClient, "1:*", {});
    const returned = new Set(snapshots.map(snap => snap.uid));
    if (mailbox.remoteUids && mailbox.remoteUids.some(uid => !returned.has(uid))) {
      throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "La réponse de flags IMAP ne couvre pas le dossier observé");
    }
    strategy = supportsModseq ? "condstore_baseline" : "fallback_qresync_without_condstore";
  } else {
    const recentLimit = Math.min(Math.max(Number(process.env.MAIL_FLAG_RECONCILE_RECENT_LIMIT) || 200, 25), 1000);
    const mismatchLimit = Math.min(
      Math.max(Number(process.env.MAIL_FLAG_RECONCILE_MISMATCH_LIMIT) || 5000, recentLimit),
      20000
    );
    const limit = hasUnreadMismatch ? mismatchLimit : recentLimit;
    const recentUids = await getRecentLocalUidsForFlagRefresh(pg, mailAccount.id, folder.id, limit, mailbox.uidValidity);
    const remoteUids = mailbox.remoteUids ? new Set(mailbox.remoteUids) : null;
    const uids = recentUids.filter(uid => !remoteUids || remoteUids.has(uid));
    if (uids.length > 0) {
      snapshots = await fetchFlagSnapshots(imapClient, uids.join(","), {});
      const returned = new Set(snapshots.map(snap => snap.uid));
      if (uids.some(uid => !returned.has(uid))) {
        throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "La réponse de flags IMAP est partielle");
      }
    }
    if (hasUnreadMismatch) {
      strategy = "fallback_unread_mismatch_window";
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

  // Folder cursors and success timestamps belong to syncFolderForAccount's
  // final confirmation, after SEARCH and every requested import succeeded.
  return { checked: snapshots.length, updated, strategy };
}

/**
 * @param {import('pg').Pool} pg
 * @param {string} mailAccountId
 * @param {string} folderId
 * @returns {Promise<string | null>}
 */
export async function getMaxExternalUidForFolder(pg, mailAccountId, folderId, uidValidity = null) {
  const r = await pg.query(
    `SELECT MAX(external_uid)::text AS m FROM mail_messages
     WHERE mail_account_id = $1 AND folder_id = $2
       AND external_uid_validity IS NOT DISTINCT FROM $3::text
       AND remote_missing_at IS NULL AND remote_deleted_at IS NULL`,
    [mailAccountId, folderId, uidValidity]
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
         AND m.external_uid_validity IS NOT DISTINCT FROM $5::text
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

/** Retire incompatible remote references without deleting historical content. */
async function invalidatePreviousUidNamespace(pg, mailAccount, folder, uidValidity) {
  const db = await pg.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query(
      `UPDATE mail_messages SET
         remote_missing_at = COALESCE(remote_missing_at, now()),
         move_sync_status = 'REMOTE_MISSING',
         updated_at = now()
       WHERE organization_id = $1 AND mail_account_id = $2 AND folder_id = $3
         AND external_uid IS NOT NULL
         AND external_uid_validity IS DISTINCT FROM $4::text
         AND remote_missing_at IS NULL AND remote_deleted_at IS NULL
       RETURNING mail_thread_id`,
      [mailAccount.organization_id, mailAccount.id, folder.id, uidValidity]
    );
    for (const threadId of [...new Set(result.rows.map(row => row.mail_thread_id).filter(Boolean))]) {
      await rebuildThreadMetadata({ client: db, threadId });
    }
    await db.query("COMMIT");
    return result.rowCount;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
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
  let path = folder.external_id || folder.name;
  let stage = "folder_lock";
  let imported = 0;
  let skipped = 0;
  let flagSummary = null;
  let hasLock = false;
  let lockAnswered = false;
  const outcome = () => ({ folderId: folder.id, path, stage, imported, skipped, timestamp: new Date().toISOString() });
  if (!path) {
    return { ...outcome(), error: "missing_path", message: "Chemin du dossier IMAP manquant" };
  }

  const lockClient = await pg.connect();
  try {
    const lock = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [
      `mail-folder-sync:${folder.id}`,
    ]);
    lockAnswered = true;
    if (lock.rows[0]?.locked !== true) {
      return { ...outcome(), error: "locked", message: "Une synchronisation de ce dossier est déjà en cours" };
    }
    hasLock = true;
    // The caller may have selected the folder before another sync completed.
    // Capture confirmed cursors only once this attempt owns the folder lock.
    const fresh = await pg.query(
      `SELECT * FROM mail_folders WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3`,
      [folder.id, mailAccount.organization_id, mailAccount.id]
    );
    if (!fresh.rows[0]) throw folderSyncError(SyncErrorCodes.SYNC_FAILED, "Dossier local introuvable");
    folder = fresh.rows[0];
    path = folder.external_id || folder.name;
    if (folder.selectable === false || folder.is_active === false) {
      return { ...outcome(), status: "SKIPPED", reason: "not_selectable_or_inactive" };
    }

    await pg.query(
      `UPDATE mail_folders SET message_sync_status = 'SYNCING', updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, mailAccount.organization_id]
    );

    stage = "mailbox_open";
    const mailboxRaw = await imapClient.mailboxOpen(path);
    if (!mailboxRaw || !/^\d+$/.test(String(mailboxRaw.uidValidity ?? "")) || BigInt(mailboxRaw.uidValidity) <= 0n) {
      throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "Le dossier IMAP ne confirme pas son UIDVALIDITY");
    }
    const mailbox = {
      uidValidity: mailboxRaw?.uidValidity != null ? String(mailboxRaw.uidValidity) : null,
      highestModseq: mailboxRaw?.highestModseq != null ? String(mailboxRaw.highestModseq) : null,
      noModseq: mailboxRaw.noModseq === true,
      remoteUnreadCount: mailboxRaw.unseen != null && Number.isFinite(Number(mailboxRaw.unseen))
        ? Number(mailboxRaw.unseen)
        : (folder.remote_unread_count != null && Number.isFinite(Number(folder.remote_unread_count)) ? Number(folder.remote_unread_count) : null),
    };
    const namespaceChanged = !sameRemoteCursor(folder.uid_validity, mailbox.uidValidity);
    stage = "message_search";
    const searchRes = await imapClient.search({}, { uid: true });
    if (!Array.isArray(searchRes) || searchRes.some(uid => !Number.isSafeInteger(Number(uid)) || Number(uid) <= 0)) {
      throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "La liste des UID IMAP est incomplète ou invalide");
    }
    const uids = [...new Set(searchRes.map(Number))];
    mailbox.remoteUids = uids;
    const observedCount = imapClient.mailbox?.exists ?? mailboxRaw.exists;
    if (observedCount != null && Number.isSafeInteger(Number(observedCount)) && Number(observedCount) !== uids.length) {
      throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, "La liste des UID IMAP ne correspond pas au nombre de messages observé");
    }
    if (namespaceChanged) {
      stage = "uid_namespace";
      await invalidatePreviousUidNamespace(pg, mailAccount, folder, mailbox.uidValidity);
    }
    stage = "flags";
    flagSummary = await reconcileExistingFlagsForFolder(pg, imapClient, mailAccount, folder, mailbox);
    stage = "missing_messages";
    const missingSummary = await markMissingLocalMessagesForFolder(pg, {
      organizationId: mailAccount.organization_id,
      mailAccountId: mailAccount.id,
      folderId: folder.id,
      remoteUids: uids,
      uidValidity: mailbox.uidValidity,
    });
    const maxUidDb = await getMaxExternalUidForFolder(pg, mailAccount.id, folder.id, mailbox.uidValidity);
    const toFetch = selectUidsToSync(uids, opts.incremental && !namespaceChanged, opts.forceFull, maxUidDb);

    stage = "message_import";
    const db = await pg.connect();
    try {
      for (const uid of toFetch) {
        await db.query("BEGIN");
        let r;
        try {
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
          if (r.skipped && ["fetch_empty", "no_source", "parse_failed", "empty"].includes(r.reason)) {
            throw folderSyncError(SyncErrorCodes.INVALID_IMAP_RESPONSE, `Le message UID ${uid} n'a pas été importé : ${r.reason}`);
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
          try {
            await db.query("ROLLBACK");
          } finally {
            const cleanup = r?.cleanupOnRollback || e?.cleanupOnRollback;
            if (typeof cleanup === "function") {
              try { await cleanup(db); }
              catch (cleanupError) { console.warn("[MAIL] Nettoyage des nouveaux fichiers du brouillon non confirmé:", cleanupError.message); }
            }
          }
          throw e;
        }
      }
    } finally {
      db.release();
    }

    stage = "cursor_confirmation";
    const confirmation = await pg.query(
      `UPDATE mail_folders SET
         message_sync_status = 'SYNCED',
         uid_validity = $5,
         highest_modseq = $6,
         last_flag_sync_at = now(),
         flag_sync_error_code = NULL,
         flag_sync_error_message = NULL,
         flag_sync_error_at = NULL,
         history_backfill_cursor_uid = CASE WHEN $7::boolean THEN NULL ELSE history_backfill_cursor_uid END,
         oldest_imported_at = CASE WHEN $7::boolean THEN NULL ELSE oldest_imported_at END,
         history_backfill_completed_at = CASE WHEN $7::boolean THEN NULL ELSE history_backfill_completed_at END,
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
              AND m.external_uid_validity IS NOT DISTINCT FROM $5::text
              AND m.remote_missing_at IS NULL
              AND m.remote_deleted_at IS NULL
         ),
         oldest_imported_uid = (
           SELECT MIN(m.external_uid)::bigint FROM mail_messages m
            WHERE m.organization_id = $2 AND m.mail_account_id = mail_folders.mail_account_id
              AND m.folder_id = mail_folders.id
              AND m.external_uid IS NOT NULL
              AND m.external_uid_validity IS NOT DISTINCT FROM $5::text
              AND m.remote_missing_at IS NULL
              AND m.remote_deleted_at IS NULL
         ),
         history_backfill_has_more = $3::boolean,
         last_message_sync_at = now(),
         last_message_sync_error_at = NULL,
         last_message_sync_error_code = NULL,
         last_message_sync_error_message = NULL,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2
         AND uid_validity IS NOT DISTINCT FROM $8::text
         AND highest_modseq IS NOT DISTINCT FROM $9::text`,
      [folder.id, mailAccount.organization_id, toFetch.length < uids.length, uids.length,
        mailbox.uidValidity, hasUsableModseq(imapClient, mailbox) ? mailbox.highestModseq : null,
        namespaceChanged, folder.uid_validity ?? null, folder.highest_modseq ?? null]
    );
    if (confirmation.rowCount !== 1) {
      throw folderSyncError(SyncErrorCodes.CURSOR_CHANGED, "Les curseurs du dossier ont changé pendant la synchronisation");
    }

    return {
      ...outcome(),
      status: "SUCCESS",
      flags: flagSummary,
      missing: missingSummary.markedMissing,
      totalRemoteUids: uids.length,
    };
  } catch (err) {
    const msg = err?.message ? String(err.message) : String(err);
    if (hasLock) await pg.query(
      `UPDATE mail_folders SET
         message_sync_status = 'ERROR',
         last_message_sync_error_at = now(),
         last_message_sync_error_code = $3,
         last_message_sync_error_message = $4,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [folder.id, mailAccount.organization_id, syncErrorCode(err), msg.slice(0, 1000)]
    );
    return { ...outcome(), flags: flagSummary, error: syncErrorCode(err), message: msg.slice(0, 500) };
  } finally {
    let releaseError = !lockAnswered ? new Error("Résultat du verrou de dossier inconnu") : undefined;
    if (hasLock) {
      try {
        const unlocked = await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1)) AS unlocked`, [`mail-folder-sync:${folder.id}`]);
        if (unlocked.rows[0]?.unlocked !== true) releaseError = new Error("Libération du verrou de dossier non confirmée");
      } catch (error) {
        releaseError = error;
      }
    }
    // Destroy uncertain sessions instead of returning a possible advisory lock
    // to the pool where a later borrower could silently inherit it.
    lockClient.release(releaseError);
  }
}

/**
 * @param {{ mailAccountId: string, organizationId: string, forceFull?: boolean, folderId?: string | null }} p
 */
export async function syncMailAccount(p) {
  const { mailAccountId, organizationId, forceFull = false, folderId = null } = p;
  const lockClient = await pool.connect();
  const lockKey = `mail-account-sync:${String(organizationId).toLowerCase()}:${String(mailAccountId).toLowerCase()}`;
  let acquired = false;
  let lockAnswered = false;
  let attemptStarted = false;
  let imapClient;
  let stage = "lock";
  let expectedFolderCount = 0;
  let previousFailure = null;
  const folders = [];

  // Existing TEXT columns retain structured diagnostics; no new status enum or
  // database model. The IMAP-specific message stays readable for legacy callers.
  async function persistFailure(outcome) {
    // A limited retry cannot clear an earlier failure outside its verified scope.
    // Counts/errors describe this attempt; retained diagnostics keep their own dates.
    const unresolved = new Map();
    for (const error of [...(previousFailure?.unresolvedErrors || []), ...(previousFailure?.errors || []), ...outcome.errors]) {
      unresolved.set(`${error.folderId || "account"}:${error.stage || "sync"}`, error);
    }
    outcome.unresolvedErrors = [...unresolved.values()];
    if (outcome.errors.length === 0 && outcome.unresolvedErrors.length > 0) {
      const previous = outcome.unresolvedErrors[0];
      outcome.message += ` Dernière erreur non levée par une synchronisation complète : ${previous.folderName || "Compte"} : ${previous.message}`;
    }
    const authFailed = outcome.errors.some(error => error.code === "AUTH_FAILED");
    await pool.query(
      `UPDATE mail_accounts SET
         sync_status = 'ERROR',
         lifecycle_state = CASE WHEN $5::boolean THEN 'AUTH_REQUIRED'::mail_account_lifecycle_state ELSE lifecycle_state END,
         reconnect_required = CASE WHEN $5::boolean THEN true ELSE reconnect_required END,
         last_error_code = $2,
         last_error_message = $3,
         imap_status = 'ERROR',
         last_imap_error_at = now(),
         last_imap_error_code = $2,
         last_imap_error_message = $6,
         updated_at = now()
       WHERE id = $1 AND organization_id = $4`,
      [mailAccountId, outcome.code, JSON.stringify({ kind: "mail_sync_outcome_v1", ...outcome }),
        organizationId, authFailed, outcome.message]
    );
  }

  try {
    const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockKey]);
    lockAnswered = true;
    acquired = lock.rows[0]?.locked === true;
    if (!acquired) {
      return { mailAccountId, ok: false, outcome: "SKIPPED", code: "SYNC_ALREADY_RUNNING",
        message: "Une synchronisation de ce compte est déjà en cours.",
        summary: { folders: [], fullSuccess: false, outcome: "SKIPPED", code: "SYNC_ALREADY_RUNNING" } };
    }

    stage = "account";
    const accRow = await pool.query(
      `SELECT id, organization_id, user_id, email, is_active, lifecycle_state, sync_enabled, reconnect_required,
              imap_host, imap_port, imap_secure, encrypted_credentials,
              last_imap_sync_at, sync_status, last_error_code, last_error_message, last_imap_error_at
       FROM mail_accounts WHERE id = $1 AND organization_id = $2`,
      [mailAccountId, organizationId]
    );
    if (accRow.rows.length === 0) {
      const error = new Error("Compte mail introuvable");
      error.code = SyncErrorCodes.INVALID_CONFIG;
      throw error;
    }
    const acc = accRow.rows[0];
    assertMailAccountCapability(acc, "canSync");
    previousFailure = parseMailSyncOutcome(acc.last_error_message);
    if (!previousFailure && acc.last_error_code) {
      previousFailure = { errors: [{ folderId: null, folderName: null, stage: "previous_attempt",
        code: acc.last_error_code, message: acc.last_error_message || acc.last_error_code,
        at: acc.last_imap_error_at ? new Date(acc.last_imap_error_at).toISOString() : null }] };
    }
    const incremental = acc.last_imap_sync_at != null && !forceFull;
    await pool.query(
      `UPDATE mail_accounts SET sync_status = 'SYNCING', last_sync_attempt_at = now(), updated_at = now()
       WHERE id = $1 AND organization_id = $2`, [mailAccountId, organizationId]
    );
    attemptStarted = true;

    stage = "credentials";
    const cred = decryptJson(acc.encrypted_credentials);
    const { user: imapUser, password, accessToken } = resolveImapCredentials(acc.email, cred);
    if (!password && !accessToken) {
      const error = new Error("Credentials invalides");
      error.code = SyncErrorCodes.INVALID_CONFIG;
      throw error;
    }
    const cfg = { host: acc.imap_host, port: acc.imap_port, secure: acc.imap_secure !== false,
      auth: { user: imapUser, password, accessToken } };

    stage = "discovery";
    await syncFoldersFromImap({ mailAccountId, organizationId });
    stage = "connection";
    imapClient = await createImapClient(cfg);
    stage = "selection";
    // Read all metadata so the processing budget cannot hide expected folders.
    const foldersRes = await pool.query(
      `SELECT id, type, external_id, name, uid_validity, highest_modseq, remote_unread_count,
              selectable, is_active, sync_priority, last_message_sync_at
       FROM mail_folders WHERE organization_id = $1 AND mail_account_id = $2 AND is_active = true
       ORDER BY sync_priority ASC, last_message_sync_at ASC NULLS FIRST, depth ASC, name ASC`,
      [organizationId, mailAccountId]
    );
    expectedFolderCount = foldersRes.rows.length;
    const selected = folderId ? foldersRes.rows.filter(folder => String(folder.id).toLowerCase() === String(folderId).toLowerCase()) : foldersRes.rows;
    let processedSelectable = 0;
    stage = "folders";
    for (const folder of selected) {
      if (folder.selectable === false) {
        folders.push({ folderId: folder.id, folderName: folder.external_id || folder.name,
          ignored: true, reason: "NOSELECT", stage: "selection", at: new Date().toISOString() });
        continue;
      }
      if (processedSelectable >= DEFAULT_FOLDER_SYNC_LIMIT) continue;
      processedSelectable += 1;
      const result = await syncFolderForAccount(imapClient, pool,
        { id: acc.id, email: acc.email, organization_id: acc.organization_id, user_id: acc.user_id },
        folder, { incremental, forceFull });
      folders.push({ folderId: folder.id, folderName: folder.external_id || folder.name,
        at: new Date().toISOString(), ...result });
    }
    const outcome = summarizeMailSyncOutcome({ folders, expectedFolderCount, targeted: Boolean(folderId) });
    if (outcome.fullSuccess) {
      await pool.query(
        `UPDATE mail_accounts SET
           sync_status = 'IDLE', last_imap_sync_at = now(), last_sync_at = now(), last_successful_sync_at = now(),
           last_error_code = NULL, last_error_message = NULL, imap_status = 'OK',
           last_imap_error_at = NULL, last_imap_error_code = NULL, last_imap_error_message = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2`, [mailAccountId, organizationId]
      );
    } else {
      await persistFailure(outcome);
    }
    const summary = { ...outcome, folders, folderBudget: DEFAULT_FOLDER_SYNC_LIMIT };
    return { mailAccountId, ok: outcome.fullSuccess, outcome: outcome.outcome,
      code: outcome.code, message: outcome.message, summary };
  } catch (err) {
    if (attemptStarted) {
      const code = syncErrorCode(err);
      const message = err instanceof Error ? err.message : String(err);
      const failedFolders = [...folders, { folderId: null, folderName: null, error: code, message, stage, at: new Date().toISOString() }];
      const outcome = { ...summarizeMailSyncOutcome({ folders: failedFolders,
        expectedFolderCount: Math.max(expectedFolderCount, failedFolders.length), targeted: Boolean(folderId) }), code, message };
      await persistFailure(outcome);
      err.summary = { ...outcome, folders: failedFolders, folderBudget: DEFAULT_FOLDER_SYNC_LIMIT };
    }
    throw err;
  } finally {
    if (imapClient) {
      try { await imapClient.logout(); } catch { /* preserve the synchronization result */ }
    }
    let releaseError = lockAnswered ? null : new Error("Account synchronization lock acquisition was not confirmed");
    if (acquired) {
      try {
        const unlocked = await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
        if (unlocked.rows[0]?.pg_advisory_unlock !== true) releaseError = new Error("Account synchronization lock release was not confirmed");
      } catch (error) { releaseError = error; }
    }
    // Never return a session potentially holding an advisory lock to the pool.
    lockClient.release(releaseError || undefined);
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
      out.results.push(res);
      if (res.ok === true) out.ok += 1;
      else {
        out.failed += 1;
        out.errors.push({ mailAccountId: row.id, organizationId: row.organization_id,
          code: res.code || res.summary?.code || "SYNC_NOT_COMPLETE",
          message: res.message || res.summary?.message || "Synchronisation incomplète", summary: res.summary });
      }
    } catch (e) {
      out.failed += 1;
      out.errors.push({
        mailAccountId: row.id,
        organizationId: row.organization_id,
        code: syncErrorCode(e),
        message: e instanceof Error ? e.message : String(e),
        ...(e?.summary ? { summary: e.summary } : {}),
      });
    }
  }

  return out;
}
