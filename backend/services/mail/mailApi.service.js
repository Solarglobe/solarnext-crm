/**
 * CP-076 — Requêtes API mail (inbox, fil, lecture, archive) — sans N+1 sur la liste.
 */

import { rebuildThreadMetadata } from "./mailThreading.service.js";

const PIVOT_EXPR = `COALESCE(m.received_at, m.sent_at, m.external_internal_date, m.created_at)`;
const MSG_PIVOT_QUAL = `COALESCE(m.received_at, m.sent_at, m.external_internal_date, m.created_at)`;

/**
 * @param {unknown} v
 * @param {number} def
 * @param {number} max
 */
function clampLimit(v, def, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

/**
 * @param {unknown} v
 */
function clampOffset(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Motif ILIKE avec échappement % et _.
 * @param {string} raw
 * @returns {string | null}
 */
function sqlLikeEscapePattern(raw) {
  const t = String(raw ?? "").trim();
  if (t.length < 1) return null;
  const esc = t.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
  return `%${esc}%`;
}

/**
 * Parse barre recherche (from:, to:, has:attachment, client:, lead:) + texte libre pour FTS.
 * @param {string} input
 * @returns {{
 *   freeText: string,
 *   fromPattern: string | null,
 *   toPattern: string | null,
 *   clientPattern: string | null,
 *   leadPattern: string | null,
 *   hasAttachment: boolean,
 *   highlightTerms: string[],
 * }}
 */
export function parseMailSearchQuery(input) {
  const raw = String(input ?? "").trim();
  const result = {
    freeText: "",
    fromPattern: null,
    toPattern: null,
    clientPattern: null,
    leadPattern: null,
    hasAttachment: false,
    highlightTerms: [],
  };
  if (!raw) return result;

  let s = raw.replace(/\bhas:attachment\b/gi, () => {
    result.hasAttachment = true;
    return " ";
  });

  const re = /\b(from|to|client|lead):\s*("[^"]*"|[^\s:]+)/gi;
  s = s.replace(re, (_m, key, rawVal) => {
    const val = String(rawVal ?? "")
      .replace(/^"(.*)"$/, "$1")
      .trim();
    if (!val) return " ";
    const k = String(key).toLowerCase();
    if (k === "from") result.fromPattern = result.fromPattern ? `${result.fromPattern} ${val}` : val;
    else if (k === "to") result.toPattern = result.toPattern ? `${result.toPattern} ${val}` : val;
    else if (k === "client") result.clientPattern = result.clientPattern ? `${result.clientPattern} ${val}` : val;
    else if (k === "lead") result.leadPattern = result.leadPattern ? `${result.leadPattern} ${val}` : val;
    return " ";
  });

  result.freeText = s.replace(/\s+/g, " ").trim();

  const stop = new Set([
    "and",
    "or",
    "the",
    "le",
    "la",
    "les",
    "de",
    "des",
    "du",
    "un",
    "une",
  ]);
  const terms = new Set();
  const pushWords = (str) => {
    for (let w of String(str).toLowerCase().split(/\s+/)) {
      w = w.replace(/^[\("'«»]+|[\)"'«».,;:]+$/g, "");
      if (w.length >= 2 && !stop.has(w)) terms.add(w);
    }
  };
  pushWords(result.freeText);
  if (result.fromPattern) pushWords(result.fromPattern);
  if (result.toPattern) pushWords(result.toPattern);
  if (result.clientPattern) pushWords(result.clientPattern);
  if (result.leadPattern) pushWords(result.leadPattern);
  result.highlightTerms = [...terms].slice(0, 32);
  return result;
}

/**
 * Filtre « boîte » (dossier IMAP typé) sur les fils : au moins un message du fil dans un dossier du type demandé.
 * @param {string | null | undefined} mailbox — inbox|sent|draft|trash|spam
 * @returns {string}
 */
export function sqlMailboxThreadClause(mailbox) {
  const m = (mailbox && String(mailbox).trim().toLowerCase()) || "";
  if (!m || m === "all") return "";

  if (m === "inbox") {
    return ` AND EXISTS (
      SELECT 1 FROM mail_messages mm
      INNER JOIN mail_folders mf ON mf.id = mm.folder_id AND mf.organization_id = t.organization_id
      WHERE mm.mail_thread_id = t.id
        AND mm.mail_account_id = ANY($2::uuid[])
        AND mf.type = 'INBOX'::mail_folder_type
    ) `;
  }
  if (m === "sent") {
    return ` AND EXISTS (
      SELECT 1 FROM mail_messages mm
      INNER JOIN mail_folders mf ON mf.id = mm.folder_id AND mf.organization_id = t.organization_id
      WHERE mm.mail_thread_id = t.id
        AND mm.mail_account_id = ANY($2::uuid[])
        AND mf.type = 'SENT'::mail_folder_type
    ) `;
  }
  if (m === "draft") {
    return ` AND EXISTS (
      SELECT 1 FROM mail_messages mm
      INNER JOIN mail_folders mf ON mf.id = mm.folder_id AND mf.organization_id = t.organization_id
      WHERE mm.mail_thread_id = t.id
        AND mm.mail_account_id = ANY($2::uuid[])
        AND mf.type = 'DRAFT'::mail_folder_type
    ) `;
  }
  if (m === "trash") {
    return ` AND EXISTS (
      SELECT 1 FROM mail_messages mm
      INNER JOIN mail_folders mf ON mf.id = mm.folder_id AND mf.organization_id = t.organization_id
      WHERE mm.mail_thread_id = t.id
        AND mm.mail_account_id = ANY($2::uuid[])
        AND mf.type = 'TRASH'::mail_folder_type
    ) `;
  }
  if (m === "spam") {
    return ` AND EXISTS (
      SELECT 1 FROM mail_messages mm
      INNER JOIN mail_folders mf ON mf.id = mm.folder_id AND mf.organization_id = t.organization_id
      WHERE mm.mail_thread_id = t.id
        AND mm.mail_account_id = ANY($2::uuid[])
        AND mf.type = 'CUSTOM'::mail_folder_type
        AND (
          LOWER(COALESCE(mf.name, '')) LIKE '%spam%'
          OR LOWER(COALESCE(mf.name, '')) LIKE '%junk%'
          OR LOWER(COALESCE(mf.external_id, '')) LIKE '%spam%'
          OR LOWER(COALESCE(mf.external_id, '')) LIKE '%junk%'
        )
    ) `;
  }
  return "";
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} organizationId
 * @param {Set<string>} accessibleAccountIds
 * @returns {Promise<string[]>}
 */
export async function getAccessibleAccountIdArray(db, organizationId, accessibleAccountIds) {
  const ids = [...accessibleAccountIds];
  if (ids.length === 0) return [];
  const r = await db.query(
    `SELECT id FROM mail_accounts
     WHERE organization_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
    [organizationId, ids]
  );
  return r.rows.map((x) => x.id);
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{
 *   organizationId: string,
 *   accessibleAccountIds: Set<string>,
 *   limit?: number,
 *   offset?: number,
 *   filter?: 'unread' | 'all',
 *   attachmentsFilter?: 'all' | 'with',
 *   accountId?: string | null,
 *   clientId?: string | null,
 *   leadId?: string | null,
 *   tagId?: string | null,
 *   dateFrom?: string | null,
 *   dateTo?: string | null,
 *   hasOutboundReply?: boolean | null,
 *   searchQuery?: string | null,
 *   mailbox?: string | null,
 * }} p
 */
export async function listMailInbox(db, p) {
  const organizationId = p.organizationId;
  const accIds = await getAccessibleAccountIdArray(db, organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) {
    return { items: [], total: 0, searchMeta: null };
  }

  const rawSearch = typeof p.searchQuery === "string" ? p.searchQuery.trim() : "";
  const parsedSearch = rawSearch ? parseMailSearchQuery(rawSearch) : null;

  const maxListCap = rawSearch ? 50 : 100;
  const limit = clampLimit(p.limit, 20, maxListCap);
  const offset = clampOffset(p.offset);
  const filterUnread = p.filter === "unread";
  const attachmentsOnly = p.attachmentsFilter === "with";
  const effectiveAttachments = attachmentsOnly || (parsedSearch?.hasAttachment === true);
  const accountFilter = p.accountId && p.accessibleAccountIds.has(p.accountId) ? p.accountId : null;
  const clientId = p.clientId?.trim() || null;
  const leadId = p.leadId?.trim() || null;
  const tagId = p.tagId?.trim() || null;

  const params = [organizationId, accIds];
  let pidx = 3;

  let unreadClause = "";
  if (filterUnread) {
    unreadClause = ` AND t.has_unread = true `;
  }

  let accountClause = "";
  if (accountFilter) {
    params.push(accountFilter);
    accountClause = ` AND EXISTS (
      SELECT 1 FROM mail_messages mx
      WHERE mx.mail_thread_id = t.id AND mx.mail_account_id = $${pidx}::uuid
    ) `;
    pidx += 1;
  }

  let clientClause = "";
  if (clientId) {
    params.push(clientId);
    clientClause = ` AND t.client_id = $${pidx}::uuid `;
    pidx += 1;
  }

  let leadClause = "";
  if (leadId) {
    params.push(leadId);
    leadClause = ` AND t.lead_id = $${pidx}::uuid `;
    pidx += 1;
  }

  let tagClause = "";
  if (tagId) {
    params.push(tagId);
    tagClause = ` AND EXISTS (
      SELECT 1 FROM mail_thread_tag_links mtl
      INNER JOIN mail_thread_tags tt ON tt.id = mtl.tag_id AND tt.organization_id = $1
      WHERE mtl.thread_id = t.id AND tt.id = $${pidx}::uuid
    ) `;
    pidx += 1;
  }

  let attachClause = "";
  if (effectiveAttachments) {
    attachClause = ` AND EXISTS (
      SELECT 1 FROM mail_messages mj
      WHERE mj.mail_thread_id = t.id AND mj.has_attachments = true
    ) `;
  }

  let dateClause = "";
  if (p.dateFrom) {
    params.push(p.dateFrom);
    dateClause = ` AND t.last_message_at >= $${pidx}::timestamptz `;
    pidx += 1;
  }
  if (p.dateTo) {
    params.push(p.dateTo);
    dateClause += ` AND t.last_message_at <= $${pidx}::timestamptz `;
    pidx += 1;
  }

  let outboundClause = "";
  if (p.hasOutboundReply === true) {
    outboundClause = ` AND EXISTS (
      SELECT 1 FROM mail_messages mor
      WHERE mor.mail_thread_id = t.id AND mor.direction = 'OUTBOUND'::mail_message_direction
    ) `;
  } else if (p.hasOutboundReply === false) {
    outboundClause = ` AND NOT EXISTS (
      SELECT 1 FROM mail_messages mor
      WHERE mor.mail_thread_id = t.id AND mor.direction = 'OUTBOUND'::mail_message_direction
    ) `;
  }

  let searchClause = "";
  let selectRankSql = "";
  let orderByMain = "t.last_message_at DESC NULLS LAST";
  /** @type {{ highlightTerms: string[] } | null} */
  let searchMeta = null;

  if (parsedSearch) {
    searchMeta = { highlightTerms: parsedSearch.highlightTerms };
    const hasFts = parsedSearch.freeText.length >= 1;
    const hasKeyFilters =
      !!parsedSearch.fromPattern ||
      !!parsedSearch.toPattern ||
      !!parsedSearch.clientPattern ||
      !!parsedSearch.leadPattern;

    if (!hasFts && !hasKeyFilters && !parsedSearch.hasAttachment) {
      searchClause = ` AND FALSE `;
    } else {
      if (hasFts) {
        params.push(parsedSearch.freeText);
        const ftIdx = pidx;
        pidx += 1;
        searchClause += ` AND EXISTS (
          SELECT 1 FROM mail_messages ms_fts
          WHERE ms_fts.mail_thread_id = t.id
            AND ms_fts.organization_id = $1
            AND ms_fts.mail_account_id = ANY($2::uuid[])
            AND ms_fts.search_vector @@ plainto_tsquery('simple', $${ftIdx})
        ) `;
        selectRankSql = `, COALESCE((
          SELECT MAX(ts_rank(msrk.search_vector, plainto_tsquery('simple', $${ftIdx})))
          FROM mail_messages msrk
          WHERE msrk.mail_thread_id = t.id
            AND msrk.organization_id = $1
            AND msrk.mail_account_id = ANY($2::uuid[])
            AND msrk.search_vector @@ plainto_tsquery('simple', $${ftIdx})
        ), 0)::real AS search_rank`;
        orderByMain = "search_rank DESC NULLS LAST, t.last_message_at DESC NULLS LAST";
      }

      const fromPat = parsedSearch.fromPattern ? sqlLikeEscapePattern(parsedSearch.fromPattern) : null;
      if (fromPat) {
        params.push(fromPat, fromPat);
        const a = pidx;
        const b = pidx + 1;
        pidx += 2;
        searchClause += ` AND EXISTS (
          SELECT 1 FROM mail_messages mf
          INNER JOIN mail_participants pf ON pf.mail_message_id = mf.id AND pf.type = 'FROM'::mail_participant_type
          WHERE mf.mail_thread_id = t.id
            AND mf.organization_id = $1
            AND (pf.email ILIKE $${a} ESCAPE '!' OR COALESCE(pf.name, '') ILIKE $${b} ESCAPE '!')
        ) `;
      }

      const toPat = parsedSearch.toPattern ? sqlLikeEscapePattern(parsedSearch.toPattern) : null;
      if (toPat) {
        params.push(toPat, toPat);
        const a = pidx;
        const b = pidx + 1;
        pidx += 2;
        searchClause += ` AND EXISTS (
          SELECT 1 FROM mail_messages mt
          INNER JOIN mail_participants pt ON pt.mail_message_id = mt.id
            AND pt.type IN ('TO'::mail_participant_type, 'CC'::mail_participant_type, 'BCC'::mail_participant_type)
          WHERE mt.mail_thread_id = t.id
            AND mt.organization_id = $1
            AND (pt.email ILIKE $${a} ESCAPE '!' OR COALESCE(pt.name, '') ILIKE $${b} ESCAPE '!')
        ) `;
      }

      const clientPat = parsedSearch.clientPattern ? sqlLikeEscapePattern(parsedSearch.clientPattern) : null;
      if (clientPat) {
        params.push(clientPat, clientPat, clientPat, clientPat);
        const a = pidx;
        const b = pidx + 1;
        const c = pidx + 2;
        const d = pidx + 3;
        pidx += 4;
        searchClause += ` AND t.client_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM clients cl
          WHERE cl.id = t.client_id
            AND cl.organization_id = $1
            AND (cl.archived_at IS NULL)
            AND (cl.company_name ILIKE $${a} ESCAPE '!'
              OR cl.first_name ILIKE $${b} ESCAPE '!'
              OR cl.last_name ILIKE $${c} ESCAPE '!'
              OR cl.email ILIKE $${d} ESCAPE '!')
        ) `;
      }

      const leadPat = parsedSearch.leadPattern ? sqlLikeEscapePattern(parsedSearch.leadPattern) : null;
      if (leadPat) {
        params.push(leadPat, leadPat, leadPat, leadPat, leadPat);
        const a = pidx;
        const b = pidx + 1;
        const c = pidx + 2;
        const d = pidx + 3;
        const e = pidx + 4;
        pidx += 5;
        searchClause += ` AND t.lead_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM leads ld
          WHERE ld.id = t.lead_id
            AND ld.organization_id = $1
            AND (ld.archived_at IS NULL)
            AND (ld.first_name ILIKE $${a} ESCAPE '!'
              OR ld.last_name ILIKE $${b} ESCAPE '!'
              OR COALESCE(ld.company_name, '') ILIKE $${c} ESCAPE '!'
              OR COALESCE(ld.full_name, '') ILIKE $${d} ESCAPE '!'
              OR ld.email ILIKE $${e} ESCAPE '!')
        ) `;
      }
    }
  }

  const mailboxClause = sqlMailboxThreadClause(p.mailbox);

  const baseWhere = `
    t.organization_id = $1
    AND t.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM mail_messages m0
      WHERE m0.mail_thread_id = t.id
        AND m0.mail_account_id = ANY($2::uuid[])
    )
    ${mailboxClause}
    ${unreadClause}
    ${accountClause}
    ${clientClause}
    ${leadClause}
    ${tagClause}
    ${attachClause}
    ${dateClause}
    ${outboundClause}
    ${searchClause}
  `;

  const countSql = `SELECT COUNT(*)::int AS c FROM mail_threads t WHERE ${baseWhere}`;
  const countRes = await db.query(countSql, params);
  const total = countRes.rows[0]?.c ?? 0;

  const listParams = [...params, limit, offset];
  const limIdx = listParams.length - 1;
  const offIdx = listParams.length;

  const listSql = `
    SELECT
      t.id AS thread_id,
      t.subject,
      t.snippet,
      t.last_message_at,
      t.message_count,
      t.has_unread,
      t.client_id,
      t.lead_id,
      lm.id AS last_msg_id,
      lm.direction AS last_direction,
      lm.mail_account_id AS last_mail_account_id,
      lm.has_attachments AS last_has_attachments,
      (SELECT EXISTS (
        SELECT 1 FROM mail_messages mo
        WHERE mo.mail_thread_id = t.id
          AND mo.direction = 'OUTBOUND'::mail_message_direction
      )) AS has_outbound_reply,
      CASE WHEN c.id IS NOT NULL THEN
        COALESCE(
          NULLIF(TRIM(c.company_name), ''),
          NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
          NULLIF(TRIM(c.email), '')
        )
      END AS client_display_name,
      CASE WHEN le.id IS NOT NULL THEN
        COALESCE(
          NULLIF(TRIM(COALESCE(le.first_name, '') || ' ' || COALESCE(le.last_name, '')), ''),
          NULLIF(TRIM(le.email), '')
        )
      END AS lead_display_name
      ${selectRankSql}
    FROM mail_threads t
    LEFT JOIN clients c ON c.id = t.client_id AND c.organization_id = t.organization_id AND (c.archived_at IS NULL)
    LEFT JOIN leads le ON le.id = t.lead_id AND le.organization_id = t.organization_id AND (le.archived_at IS NULL)
    INNER JOIN LATERAL (
      SELECT m.id, m.direction, m.mail_account_id, m.has_attachments
      FROM mail_messages m
      WHERE m.mail_thread_id = t.id
        AND m.organization_id = t.organization_id
        AND m.mail_account_id = ANY($2::uuid[])
      ORDER BY ${PIVOT_EXPR} DESC NULLS LAST
      LIMIT 1
    ) lm ON true
    WHERE ${baseWhere}
    ORDER BY ${orderByMain}
    LIMIT $${limIdx} OFFSET $${offIdx}
  `;

  const listRes = await db.query(listSql, listParams);
  const rows = listRes.rows;
  if (rows.length === 0) {
    return { items: [], total, searchMeta };
  }

  const threadIds = rows.map((r) => r.thread_id);
  /** @type {Map<string, Array<{ id: string, name: string, color: string | null }>>} */
  const tagsByThread = new Map();
  if (threadIds.length) {
    const tr = await db.query(
      `SELECT mtl.thread_id, t.id AS tag_id, t.name, t.color
       FROM mail_thread_tag_links mtl
       INNER JOIN mail_thread_tags t ON t.id = mtl.tag_id AND t.organization_id = $2
       WHERE mtl.thread_id = ANY($1::uuid[])
       ORDER BY mtl.thread_id, lower(t.name) ASC`,
      [threadIds, organizationId]
    );
    for (const row of tr.rows) {
      const tid = row.thread_id;
      if (!tagsByThread.has(tid)) tagsByThread.set(tid, []);
      tagsByThread.get(tid).push({
        id: row.tag_id,
        name: row.name,
        color: row.color,
      });
    }
  }

  const lastMsgIds = rows.map((r) => r.last_msg_id).filter(Boolean);
  /** @type {Map<string, Array<{ type: string, email: string, name: string | null }>>} */
  const partsByMsg = new Map();
  if (lastMsgIds.length) {
    const pr = await db.query(
      `SELECT mail_message_id, type, email, name
       FROM mail_participants
       WHERE mail_message_id = ANY($1::uuid[])
       ORDER BY mail_message_id, type, email`,
      [lastMsgIds]
    );
    for (const row of pr.rows) {
      const k = row.mail_message_id;
      if (!partsByMsg.has(k)) partsByMsg.set(k, []);
      partsByMsg.get(k).push({
        type: row.type,
        email: row.email,
        name: row.name,
      });
    }
  }

  const items = rows.map((row) => {
    const lp = partsByMsg.get(row.last_msg_id) || [];
    const fromP = lp.find((x) => x.type === "FROM");
    const toList = lp.filter((x) => x.type === "TO" || x.type === "CC" || x.type === "BCC");
    const fromName = fromP?.name && String(fromP.name).trim() ? String(fromP.name).trim() : null;
    return {
      threadId: row.thread_id,
      subject: row.subject,
      snippet: row.snippet,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
      messageCount: row.message_count,
      hasUnread: row.has_unread === true,
      clientId: row.client_id,
      leadId: row.lead_id,
      clientDisplayName: row.client_display_name ?? null,
      leadDisplayName: row.lead_display_name ?? null,
      hasOutboundReply: row.has_outbound_reply === true,
      tags: tagsByThread.get(row.thread_id) ?? [],
      participants: lp.map((x) => ({ type: x.type, email: x.email, name: x.name })),
      lastMessage: {
        direction: row.last_direction,
        from: fromP?.email ?? null,
        fromName,
        to: toList.map((x) => x.email).filter(Boolean).join(", ") || null,
        preview: row.snippet || "",
        hasAttachments: row.last_has_attachments === true,
      },
    };
  });

  return { items, total, searchMeta };
}

/**
 * Compteurs fils non lus (badges sidebar), sans N requêtes côté client.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, accessibleAccountIds: Set<string>, mailbox?: string | null }} p
 * @returns {Promise<{ totalUnread: number, byAccount: Record<string, number> }>}
 */
export async function getInboxUnreadSummary(db, p) {
  const organizationId = p.organizationId;
  const accIds = await getAccessibleAccountIdArray(db, organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) {
    return { totalUnread: 0, byAccount: {} };
  }

  const mailboxClause = sqlMailboxThreadClause(p.mailbox);

  const totalRes = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM mail_threads t
     WHERE t.organization_id = $1
       AND t.archived_at IS NULL
       AND t.has_unread = true
       AND EXISTS (
         SELECT 1 FROM mail_messages m0
         WHERE m0.mail_thread_id = t.id
           AND m0.mail_account_id = ANY($2::uuid[])
       )
       ${mailboxClause}`,
    [organizationId, accIds]
  );
  const totalUnread = totalRes.rows[0]?.c ?? 0;

  const byAcc = await db.query(
    `SELECT m.mail_account_id, COUNT(DISTINCT t.id)::int AS n
     FROM mail_threads t
     INNER JOIN mail_messages m ON m.mail_thread_id = t.id
     WHERE t.organization_id = $1
       AND t.archived_at IS NULL
       AND t.has_unread = true
       AND m.mail_account_id = ANY($2::uuid[])
       ${mailboxClause}
     GROUP BY m.mail_account_id`,
    [organizationId, accIds]
  );

  /** @type {Record<string, number>} */
  const byAccount = {};
  for (const row of byAcc.rows) {
    byAccount[row.mail_account_id] = row.n;
  }
  return { totalUnread, byAccount };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, threadId: string }} p
 * @returns {Promise<object | null>}
 */
export async function getThreadRow(db, p) {
  const r = await db.query(
    `SELECT id, organization_id, subject, snippet, last_message_at, message_count, has_unread,
            is_read, client_id, lead_id, normalized_subject, archived_at, created_at, updated_at
     FROM mail_threads
     WHERE id = $1 AND organization_id = $2`,
    [p.threadId, p.organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{
 *   organizationId: string,
 *   threadId: string,
 *   accessibleAccountIds: Set<string>,
 *   includeArchived?: boolean,
 * }} p
 * @returns {Promise<{ thread: object, messages: object[] } | null>}
 */
export async function getMailThreadDetail(db, p) {
  const th = await getThreadRow(db, { organizationId: p.organizationId, threadId: p.threadId });
  if (!th) return null;
  if (th.archived_at != null && !p.includeArchived) {
    return null;
  }

  const accIds = await getAccessibleAccountIdArray(db, p.organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) return null;

  const check = await db.query(
    `SELECT 1 FROM mail_messages m
     WHERE m.mail_thread_id = $1 AND m.mail_account_id = ANY($2::uuid[])
     LIMIT 1`,
    [p.threadId, accIds]
  );
  if (check.rows.length === 0) return null;

  const msgRes = await db.query(
    `SELECT m.id, m.subject, m.body_text, m.body_html, m.direction, m.status,
            m.sent_at, m.received_at, m.is_read, m.has_attachments, m.message_id,
            m.mail_account_id, m.created_at, m.opened_at, m.clicked_at,
            ${MSG_PIVOT_QUAL} AS pivot_at,
            ox.status AS outbox_status,
            ox.next_attempt_at AS outbox_next_attempt_at,
            ox.attempt_count AS outbox_attempt_count,
            ox.max_attempts AS outbox_max_attempts,
            ox.last_error AS outbox_last_error
     FROM mail_messages m
     LEFT JOIN mail_outbox ox ON ox.mail_message_id = m.id AND ox.organization_id = m.organization_id
     WHERE m.mail_thread_id = $1 AND m.organization_id = $2
     ORDER BY ${MSG_PIVOT_QUAL} ASC NULLS LAST`,
    [p.threadId, p.organizationId]
  );

  const messages = msgRes.rows;
  const msgIds = messages.map((m) => m.id);
  /** @type {Map<string, Array<{ type: string, email: string, name: string | null }>>} */
  const partsByMsg = new Map();
  if (msgIds.length) {
    const pr = await db.query(
      `SELECT mail_message_id, type, email, name
       FROM mail_participants
       WHERE mail_message_id = ANY($1::uuid[])
       ORDER BY mail_message_id, type, email`,
      [msgIds]
    );
    for (const row of pr.rows) {
      if (!partsByMsg.has(row.mail_message_id)) partsByMsg.set(row.mail_message_id, []);
      partsByMsg.get(row.mail_message_id).push({
        type: row.type,
        email: row.email,
        name: row.name,
      });
    }
  }

  /** @type {Map<string, object[]>} */
  const attByMsg = new Map();
  if (msgIds.length) {
    const ar = await db.query(
      `SELECT ma.mail_message_id,
              ma.id,
              ma.file_name,
              ma.mime_type,
              ma.size_bytes,
              ma.is_inline,
              ma.document_id,
              ed.id AS doc_row_id,
              ed.file_name AS doc_file_name,
              ed.mime_type AS doc_mime_type,
              ed.storage_key AS doc_storage_key,
              ed.document_type AS doc_document_type,
              ed.file_size AS doc_file_size
       FROM mail_attachments ma
       LEFT JOIN entity_documents ed ON ed.id = ma.document_id
       WHERE ma.mail_message_id = ANY($1::uuid[])
       ORDER BY ma.mail_message_id, ma.created_at ASC`,
      [msgIds]
    );
    for (const row of ar.rows) {
      if (!attByMsg.has(row.mail_message_id)) attByMsg.set(row.mail_message_id, []);
      const doc =
        row.doc_row_id != null
          ? {
              id: row.doc_row_id,
              fileName: row.doc_file_name,
              mimeType: row.doc_mime_type,
              storageKey: row.doc_storage_key,
              documentType: row.doc_document_type,
              fileSize: row.doc_file_size,
            }
          : null;
      attByMsg.get(row.mail_message_id).push({
        id: row.id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        isInline: row.is_inline === true,
        documentId: row.document_id,
        document: doc,
      });
    }
  }

  const thread = {
    id: th.id,
    subject: th.subject,
    snippet: th.snippet,
    lastMessageAt: th.last_message_at ? new Date(th.last_message_at).toISOString() : null,
    messageCount: th.message_count,
    hasUnread: th.has_unread === true,
    isRead: th.is_read === true,
    clientId: th.client_id,
    leadId: th.lead_id,
    archivedAt: th.archived_at ? new Date(th.archived_at).toISOString() : null,
    createdAt: th.created_at ? new Date(th.created_at).toISOString() : null,
    updatedAt: th.updated_at ? new Date(th.updated_at).toISOString() : null,
  };

  const outMessages = messages.map((m) => ({
    id: m.id,
    subject: m.subject,
    bodyText: m.body_text,
    bodyHtml: m.body_html,
    direction: m.direction,
    status: m.status,
    sentAt: m.pivot_at ? new Date(m.pivot_at).toISOString() : null,
    isRead: m.is_read === true,
    hasAttachments: m.has_attachments === true,
    openedAt: m.opened_at ? new Date(m.opened_at).toISOString() : null,
    clickedAt: m.clicked_at ? new Date(m.clicked_at).toISOString() : null,
    messageId: m.message_id,
    mailAccountId: m.mail_account_id,
    participants: partsByMsg.get(m.id) || [],
    attachments: attByMsg.get(m.id) || [],
    outbox:
      m.outbox_status != null
        ? {
            status: m.outbox_status,
            nextAttemptAt: m.outbox_next_attempt_at
              ? new Date(m.outbox_next_attempt_at).toISOString()
              : null,
            attemptCount: m.outbox_attempt_count,
            maxAttempts: m.outbox_max_attempts,
            lastError: m.outbox_last_error,
          }
        : null,
  }));

  return { thread, messages: outMessages };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, messageId: string, isRead: boolean, accessibleAccountIds: Set<string> }} p
 * @returns {Promise<{ ok: boolean, code?: string }>}
 */
export async function markMessageReadInTransaction(client, p) {
  const accIds = await getAccessibleAccountIdArray(client, p.organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) return { ok: false, code: "MAIL_ACCESS_DENIED" };

  const u = await client.query(
    `UPDATE mail_messages m
     SET is_read = $3
     WHERE m.id = $1 AND m.organization_id = $2
       AND m.mail_account_id = ANY($4::uuid[])
     RETURNING m.mail_thread_id`,
    [p.messageId, p.organizationId, p.isRead, accIds]
  );
  if (u.rows.length === 0) return { ok: false, code: "MESSAGE_NOT_FOUND" };

  const threadId = u.rows[0].mail_thread_id;
  await rebuildThreadMetadata({ client, threadId });
  return { ok: true };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ organizationId: string, threadId: string, accessibleAccountIds: Set<string> }} p
 * @returns {Promise<{ ok: boolean, code?: string }>}
 */
export async function archiveThreadInTransaction(client, p) {
  const accIds = await getAccessibleAccountIdArray(client, p.organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) return { ok: false, code: "MAIL_ACCESS_DENIED" };

  const chk = await client.query(
    `SELECT t.id FROM mail_threads t
     WHERE t.id = $1 AND t.organization_id = $2
       AND EXISTS (
         SELECT 1 FROM mail_messages m
         WHERE m.mail_thread_id = t.id AND m.mail_account_id = ANY($3::uuid[])
       )`,
    [p.threadId, p.organizationId, accIds]
  );
  if (chk.rows.length === 0) return { ok: false, code: "THREAD_NOT_FOUND" };

  await client.query(`UPDATE mail_threads SET archived_at = now(), updated_at = now() WHERE id = $1`, [p.threadId]);
  return { ok: true };
}
