/**
 * CP-072 — Sync IMAP (lecture seule, idempotent, générique).
 */

import { simpleParser } from "mailparser";
import { pool } from "../../config/db.js";
import { decryptJson } from "../security/encryption.service.js";
import { resolveImapCredentials } from "./mailCredentials.util.js";
import { emitEventAsync } from "../core/eventBus.service.js";
import {
  createImapClient,
  ImapErrorCodes,
  syncFoldersFromImap,
} from "./imap.service.js";
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

export const SyncErrorCodes = {
  ...ImapErrorCodes,
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
};

/** Limite de sécurité : premiers imports / fenêtre forcée */
export const INITIAL_IMPORT_LIMIT = 150;

const FOLDER_TYPES_TO_SYNC = ["INBOX", "SENT"];

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
    messageId,
  });
  if (existing) {
    return { skipped: true, reason: "duplicate", messageId: existing };
  }

  const direction = resolveDirection({
    folderType: folder.type,
    fromAddr,
    accountEmail: mailAccount.email,
  });

  const isRead = raw.flags ? raw.flags.has("\\Seen") : false;

  const sentAt = env?.date ? new Date(env.date) : parsed.date ? new Date(parsed.date) : null;
  const receivedAt = raw.internalDate ? new Date(raw.internalDate) : new Date();
  const extFlags = raw.flags ? [...raw.flags] : [];

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

  const msgIns = await client.query(
    `INSERT INTO mail_messages (
      organization_id, mail_thread_id, mail_account_id, folder_id,
      message_id, in_reply_to, references_ids,
      subject, body_text, body_html,
      direction, status, sent_at, received_at,
      is_read, has_attachments,
      external_uid, external_flags, external_internal_date, raw_headers, sync_source
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10,
      $11::mail_message_direction, $12::mail_message_status, $13, $14,
      $15, $16,
      $17, $18::jsonb, $19, $20::jsonb, COALESCE($21, 'IMAP')
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
      extFlags,
      raw.internalDate ? new Date(raw.internalDate) : null,
      headersToJson(parsed),
      "IMAP",
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
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {import('pg').Pool} pg
 * @param {{ id: string, email: string, organization_id: string }} mailAccount
 * @param {{ id: string, type: string, external_id: string | null, name: string }} folder
 * @param {{ incremental: boolean, forceFull: boolean }}
 */
export async function syncFolderForAccount(imapClient, pg, mailAccount, folder, opts) {
  const path = folder.external_id || folder.name;
  if (!path) {
    return { folderId: folder.id, imported: 0, skipped: 0, error: "missing_path" };
  }

  await imapClient.mailboxOpen(path);

  const searchRes = await imapClient.search({}, { uid: true });
  const uids = Array.isArray(searchRes) ? searchRes : [];
  const maxUidDb = await getMaxExternalUidForFolder(pg, mailAccount.id, folder.id);
  const toFetch = selectUidsToSync(uids, opts.incremental, opts.forceFull, maxUidDb);

  let imported = 0;
  let skipped = 0;

  const db = await pg.connect();
  try {
    for (const uid of toFetch) {
      await db.query("BEGIN");
      try {
        const r = await importImapMessage(db, imapClient, {
          organizationId: mailAccount.organization_id,
          mailAccount: { id: mailAccount.id, email: mailAccount.email },
          folder,
          uid,
        });
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

  return { folderId: folder.id, imported, skipped };
}

/**
 * @param {{ mailAccountId: string, organizationId: string, forceFull?: boolean }} p
 */
export async function syncMailAccount(p) {
  const { mailAccountId, organizationId, forceFull = false } = p;

  const accRow = await pool.query(
    `SELECT id, organization_id, email, is_active,
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
  if (!acc.is_active) {
    const e = new Error("Compte inactif");
    e.code = SyncErrorCodes.ACCOUNT_INACTIVE;
    throw e;
  }

  const incremental = acc.last_imap_sync_at != null && !forceFull;

  await pool.query(
    `UPDATE mail_accounts SET
       sync_status = 'SYNCING',
       updated_at = now()
     WHERE id = $1`,
    [mailAccountId]
  );

  let imapClient;
  try {
    const cred = decryptJson(acc.encrypted_credentials);
    const { user: imapUser, password } = resolveImapCredentials(acc.email, cred);
    if (!password) {
      const e = new Error("Credentials invalides");
      e.code = SyncErrorCodes.INVALID_CONFIG;
      throw e;
    }

    const cfg = {
      host: acc.imap_host,
      port: acc.imap_port,
      secure: acc.imap_secure !== false,
      auth: { user: imapUser, password },
    };

    await syncFoldersFromImap({ mailAccountId, organizationId });

    imapClient = await createImapClient(cfg);

    const foldersRes = await pool.query(
      `SELECT id, type, external_id, name
       FROM mail_folders
       WHERE organization_id = $1 AND mail_account_id = $2
         AND type = ANY($3::mail_folder_type[])`,
      [organizationId, mailAccountId, FOLDER_TYPES_TO_SYNC]
    );

    const summary = { folders: [] };
    for (const folder of foldersRes.rows) {
      const r = await syncFolderForAccount(
        imapClient,
        pool,
        { id: acc.id, email: acc.email, organization_id: acc.organization_id },
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

/**
 * @param {{ organizationId?: string | null, limit?: number | null, forceFull?: boolean }} p
 */
export async function syncAllMailAccounts(p = {}) {
  const { organizationId = null, limit = null, forceFull = false } = p;

  let q = `
    SELECT id, organization_id FROM mail_accounts
    WHERE is_active = true
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
