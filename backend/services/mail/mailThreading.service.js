/**
 * CP-073 — Moteur de threading conversations (déterministe, relançable, prudent).
 *
 * Règles anti-faux regroupements (fallback sujet) :
 * - Sujets « faibles » (ok, merci, bonjour, test, vide, etc.) : pas de fallback automatique,
 *   sauf si intersection forte de participants (≥2 emails distincts hors compte) ET fenêtre ≤ 2 jours.
 * - Sinon : sujet normalisé identique, même organisation + compte mail, fenêtre ≤ SUBJECT_FALLBACK_MAX_DAYS,
 *   et au moins 1 email en commun entre le nouveau message et un message du fil (participants).
 *
 * Ordre de résolution : in_reply_to → references (du plus récent au plus ancien) → message_id → sujet borné → nouveau fil.
 *
 * Date pivot message (partout) : COALESCE(received_at, sent_at, external_internal_date, created_at)
 */

import { normalizeSubject, snippetFromBodies } from "./mailSyncPersistence.service.js";

export const MESSAGE_PIVOT_SQL = `COALESCE(received_at, sent_at, external_internal_date, created_at)`;

/** Fenêtre max (jours) pour fallback sujet « normal » */
export const SUBJECT_FALLBACK_MAX_DAYS = 14;

/** Fenêtre stricte (jours) si sujet faible + participants forts */
export const WEAK_SUBJECT_WINDOW_DAYS = 2;

const WEAK_SUBJECTS = new Set([
  "ok",
  "oui",
  "non",
  "merci",
  "thanks",
  "thank you",
  "bonjour",
  "hello",
  "hi",
  "salut",
  "coucou",
  "test",
  "tests",
  "hey",
  "re",
  "fwd",
]);

/**
 * Normalisation sujet pour comparaison : trim, espaces, boucle Re:/Fwd:/Forward: (insensible à la casse).
 * @param {string | undefined | null} subject
 * @returns {string}
 */
export function normalizeSubjectForThreading(subject) {
  let t = (subject ?? "").replace(/\s+/g, " ").trim();
  for (;;) {
    const m = /^(re|fwd|fw|forward)\s*[:：]\s*/i.exec(t);
    if (!m) break;
    t = t.slice(m[0].length).trim();
  }
  return t.toLowerCase();
}

/**
 * Sujet trop générique pour fusionner sans preuve forte (participants + fenêtre courte).
 * @param {string} normalized
 */
export function isWeakThreadingSubject(normalized) {
  const n = (normalized ?? "").trim();
  if (n.length <= 2) return true;
  const bare = n.replace(/^\(+|\)+$/g, "").trim();
  if (bare === "sans objet" || n === "(sans objet)") return true;
  if (WEAK_SUBJECTS.has(n)) return true;
  return false;
}

/**
 * @param {string | null | undefined} mid
 */
function normMsgId(mid) {
  if (!mid) return "";
  const t = String(mid).trim();
  if (!t) return "";
  if (t.startsWith("<") && t.endsWith(">")) return t;
  return `<${t.replace(/^<|>$/g, "")}>`;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, mailAccountId: string, messageId: string | null }} p
 * @returns {Promise<string | null>}
 */
export async function findThreadByMessageId(client, p) {
  const { organizationId, mailAccountId, messageId } = p;
  if (!messageId || !String(messageId).trim()) return null;
  const mid = String(messageId).trim();
  const bare = mid.replace(/^<|>$/g, "");
  const q = await client.query(
    `SELECT mail_thread_id FROM mail_messages
     WHERE organization_id = $1 AND mail_account_id = $2
       AND message_id IS NOT NULL
       AND (
         message_id = $3 OR message_id = $4
         OR TRIM(BOTH '<>' FROM message_id) = $5
       )
     ORDER BY ${MESSAGE_PIVOT_SQL} DESC NULLS LAST
     LIMIT 1`,
    [organizationId, mailAccountId, mid, `<${bare}>`, bare]
  );
  return q.rows[0]?.mail_thread_id ?? null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, mailAccountId: string, inReplyTo: string | null }} p
 * @returns {Promise<string | null>}
 */
export async function findThreadByInReplyTo(client, p) {
  const { organizationId, mailAccountId, inReplyTo } = p;
  const ir = normMsgId(inReplyTo);
  if (!ir) return null;
  const bare = ir.replace(/^<|>$/g, "");
  const q = await client.query(
    `SELECT mail_thread_id FROM mail_messages
     WHERE organization_id = $1 AND mail_account_id = $2
       AND message_id IS NOT NULL
       AND (
         message_id = $3 OR message_id = $4
         OR TRIM(BOTH '<>' FROM message_id) = $5
       )
     ORDER BY ${MESSAGE_PIVOT_SQL} DESC NULLS LAST
     LIMIT 1`,
    [organizationId, mailAccountId, ir, `<${bare}>`, bare]
  );
  return q.rows[0]?.mail_thread_id ?? null;
}

/**
 * Parcourt references du plus récent au plus ancien (fin de liste = parent le plus proche dans le fil RFC).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, mailAccountId: string, referencesIds: string[] }} p
 * @returns {Promise<string | null>}
 */
export async function findThreadByReferences(client, p) {
  const { organizationId, mailAccountId, referencesIds } = p;
  if (!referencesIds?.length) return null;
  const ordered = [...referencesIds].reverse();
  for (const raw of ordered) {
    const tid = await findThreadByMessageId(client, {
      organizationId,
      mailAccountId,
      messageId: raw,
    });
    if (tid) return tid;
  }
  return null;
}

/**
 * @param {string} e
 */
function normEmail(e) {
  return String(e ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} threadId
 * @param {string} mailAccountId
 * @returns {Promise<Set<string>>}
 */
async function collectThreadParticipantEmails(client, threadId, mailAccountId) {
  const q = await client.query(
    `SELECT DISTINCT LOWER(TRIM(mp.email)) AS e
     FROM mail_participants mp
     INNER JOIN mail_messages mm ON mm.id = mp.mail_message_id
     WHERE mm.mail_thread_id = $1 AND mm.mail_account_id = $2`,
    [threadId, mailAccountId]
  );
  return new Set(q.rows.map((r) => r.e).filter(Boolean));
}

/**
 * Fallback sujet borné + cohérence participants légère.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   accountEmail: string,
 *   normalizedSubject: string,
 *   messageDate: Date | null,
 *   participantEmails: string[],
 * }} p
 * @returns {Promise<string | null>}
 */
export async function findThreadByNormalizedSubject(client, p) {
  const { organizationId, mailAccountId, accountEmail, normalizedSubject, messageDate, participantEmails } = p;

  const ns = (normalizedSubject ?? "").trim();
  if (ns.length < 3) return null;

  const weak = isWeakThreadingSubject(ns);
  const windowDays = weak ? WEAK_SUBJECT_WINDOW_DAYS : SUBJECT_FALLBACK_MAX_DAYS;

  const pivot = messageDate instanceof Date && !Number.isNaN(messageDate.getTime()) ? messageDate : new Date();

  const incoming = new Set(
    participantEmails.map(normEmail).filter((e) => e.includes("@") && e !== normEmail(accountEmail))
  );

  const q = await client.query(
    `SELECT t.id, t.last_message_at
     FROM mail_threads t
     WHERE t.organization_id = $1
       AND t.normalized_subject = $2
       AND t.last_message_at IS NOT NULL
       AND t.last_message_at > $3::timestamptz - ($4::integer * INTERVAL '1 day')
       AND EXISTS (
         SELECT 1 FROM mail_messages m
         WHERE m.mail_thread_id = t.id AND m.mail_account_id = $5
       )
     ORDER BY t.last_message_at DESC
     LIMIT 25`,
    [organizationId, ns, pivot.toISOString(), windowDays, mailAccountId]
  );

  for (const row of q.rows) {
    const threadEmails = await collectThreadParticipantEmails(client, row.id, mailAccountId);
    let overlap = 0;
    for (const e of incoming) {
      if (threadEmails.has(e)) overlap += 1;
    }

    if (weak) {
      if (overlap >= 2) return row.id;
      continue;
    }

    if (overlap >= 1) return row.id;
  }

  return null;
}

/**
 * @typedef {'IN_REPLY_TO' | 'REFERENCES' | 'MESSAGE_ID' | 'SUBJECT_FALLBACK' | 'NEW_THREAD'} ThreadResolution
 */

/**
 * Résolution centralisée (sans insertion).
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   accountEmail: string,
 *   messageId: string | null,
 *   inReplyTo: string | null,
 *   referencesIds: string[],
 *   subject: string,
 *   messageDate: Date | null,
 *   participantEmails: string[],
 * }} input
 * @returns {Promise<{ threadId: string | null, resolution: ThreadResolution }>}
 */
export async function resolveThreadForMessage(client, input) {
  const {
    organizationId,
    mailAccountId,
    accountEmail,
    messageId,
    inReplyTo,
    referencesIds = [],
    subject,
    messageDate,
    participantEmails = [],
  } = input;

  const subjNorm = normalizeSubjectForThreading(subject);

  const ir = await findThreadByInReplyTo(client, {
    organizationId,
    mailAccountId,
    inReplyTo,
  });
  if (ir) return { threadId: ir, resolution: "IN_REPLY_TO" };

  const refT = await findThreadByReferences(client, {
    organizationId,
    mailAccountId,
    referencesIds,
  });
  if (refT) return { threadId: refT, resolution: "REFERENCES" };

  if (messageId && String(messageId).trim()) {
    const byMid = await findThreadByMessageId(client, {
      organizationId,
      mailAccountId,
      messageId,
    });
    if (byMid) return { threadId: byMid, resolution: "MESSAGE_ID" };
  }

  const subT = await findThreadByNormalizedSubject(client, {
    organizationId,
    mailAccountId,
    accountEmail: accountEmail ?? "",
    normalizedSubject: subjNorm,
    messageDate,
    participantEmails,
  });
  if (subT) return { threadId: subT, resolution: "SUBJECT_FALLBACK" };

  return { threadId: null, resolution: "NEW_THREAD" };
}

/**
 * Recalcule les métadonnées du fil à partir des messages réels (pivot date unifié).
 *
 * @param {{ client: import('pg').PoolClient, threadId: string }} p
 */
export async function rebuildThreadMetadata(p) {
  const { client, threadId } = p;

  const cnt = await client.query(
    `SELECT COUNT(*)::int AS c FROM mail_messages WHERE mail_thread_id = $1`,
    [threadId]
  );
  const messageCount = cnt.rows[0].c;

  const unread = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM mail_messages m
       WHERE m.mail_thread_id = $1
         AND m.direction = 'INBOUND'::mail_message_direction
         AND m.is_read = false
     ) AS u`,
    [threadId]
  );
  const hasUnread = unread.rows[0].u === true;

  const last = await client.query(
    `SELECT id,
            subject,
            body_text,
            body_html,
            ${MESSAGE_PIVOT_SQL} AS t
     FROM mail_messages
     WHERE mail_thread_id = $1
     ORDER BY ${MESSAGE_PIVOT_SQL} DESC NULLS LAST
     LIMIT 1`,
    [threadId]
  );
  const row = last.rows[0];
  const lastMessageId = row?.id ?? null;
  const lastAt = row?.t ?? null;

  const snip = snippetFromBodies(row?.body_text, row?.body_html);
  const subj = normalizeSubject(row?.subject);
  const ns = normalizeSubjectForThreading(row?.subject);

  await client.query(
    `UPDATE mail_threads SET
       message_count = $2,
       has_unread = $3,
       is_read = NOT $3,
       last_message_id = $4,
       last_message_at = $5,
       snippet = $6,
       subject = COALESCE(NULLIF($7::text, ''), subject),
       normalized_subject = COALESCE(NULLIF($8::text, ''), normalized_subject),
       updated_at = now()
     WHERE id = $1`,
    [threadId, messageCount, hasUnread, lastMessageId, lastAt, snip, subj, ns]
  );
}

/**
 * @param {{ organizationId?: string | null, limit?: number | null, pool?: import('pg').Pool }} p
 */
export async function rebuildAllThreads(p = {}) {
  const { organizationId = null, limit = null } = p;
  const { pool } = await import("../../config/db.js");
  const db = p.pool ?? pool;

  const params = [];
  let sql = `SELECT id FROM mail_threads`;
  if (organizationId) {
    params.push(organizationId);
    sql += ` WHERE organization_id = $${params.length}`;
  }
  sql += ` ORDER BY updated_at ASC`;
  if (limit != null && Number.isFinite(Number(limit))) {
    params.push(Number(limit));
    sql += ` LIMIT $${params.length}`;
  }

  const r = await db.query(sql, params);
  let rebuilt = 0;
  const errors = [];

  const client = await db.connect();
  try {
    for (const row of r.rows) {
      try {
        await client.query("BEGIN");
        await rebuildThreadMetadata({ client, threadId: row.id });
        await client.query("COMMIT");
        rebuilt += 1;
      } catch (e) {
        await client.query("ROLLBACK");
        errors.push({ threadId: row.id, message: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    client.release();
  }

  return { total: r.rows.length, rebuilt, errors };
}
