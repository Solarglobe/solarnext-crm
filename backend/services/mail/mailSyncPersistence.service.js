/**
 * CP-072 — Persistance sync IMAP : threads, messages, participants, agrégats.
 * CP-085 — L’événement MAIL_RECEIVED est émis depuis mailSync.service.js après COMMIT (import IMAP).
 */

/**
 * @param {string | undefined} s
 */
export function normalizeSubject(s) {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t || "(Sans objet)";
}

/**
 * @param {string | undefined} a
 * @param {string | undefined} b
 */
export function addressesEqual(a, b) {
  return String(a ?? "")
    .trim()
    .toLowerCase() === String(b ?? "")
      .trim()
      .toLowerCase();
}

/**
 * @param {string | undefined} bodyText
 * @param {string | null | undefined} bodyHtml
 */
export function snippetFromBodies(bodyText, bodyHtml) {
  const t = bodyText?.trim() || "";
  if (t) return t.length > 240 ? `${t.slice(0, 237)}…` : t;
  if (bodyHtml) {
    const stripped = String(bodyHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return stripped.length > 240 ? `${stripped.slice(0, 237)}…` : stripped;
  }
  return "";
}

/**
 * @param {string} raw
 */
export function parseReferencesHeader(raw) {
  if (!raw || typeof raw !== "string") return [];
  const out = [];
  const re = /<[^>\s]+@[^>]+>/g;
  let m;
  while ((m = re.exec(raw))) {
    out.push(m[0]);
  }
  if (out.length) return out;
  for (const part of raw.split(/[\s,;]+/)) {
    const t = part.trim();
    if (t.includes("@") && t.length > 3) {
      const bare = t.replace(/^<|>$/g, "");
      out.push(bare.includes("<") ? bare : `<${bare}>`);
    }
  }
  return [...new Set(out)];
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   folderId: string,
 *   externalUid: number,
 *   messageId: string | null,
 * }} p
 * @returns {Promise<string | null>}
 */
export async function findExistingMessageId(client, p) {
  const { organizationId, mailAccountId, folderId, externalUid, messageId } = p;
  const byUid = await client.query(
    `SELECT id FROM mail_messages
     WHERE organization_id = $1 AND mail_account_id = $2 AND folder_id = $3 AND external_uid = $4
     LIMIT 1`,
    [organizationId, mailAccountId, folderId, externalUid]
  );
  if (byUid.rows[0]) return byUid.rows[0].id;

  if (messageId) {
    const mid = String(messageId).trim();
    if (mid) {
      const bare = mid.replace(/^<|>$/g, "");
      const q = await client.query(
        `SELECT id FROM mail_messages
         WHERE organization_id = $1 AND mail_account_id = $2
           AND message_id IS NOT NULL
           AND (
             message_id = $3 OR message_id = $4
             OR TRIM(BOTH '<>' FROM message_id) = $5
           )
         LIMIT 1`,
        [organizationId, mailAccountId, mid, `<${bare}>`, bare]
      );
      if (q.rows[0]) return q.rows[0].id;
    }
  }
  return null;
}

/**
 * Recalcule les agrégats du fil (délègue au moteur CP-073).
 * @param {import('pg').PoolClient} client
 * @param {string} threadId
 */
export async function refreshMailThreadAggregates(client, threadId) {
  const { rebuildThreadMetadata } = await import("./mailThreading.service.js");
  await rebuildThreadMetadata({ client, threadId });
}

/** CP-074 — point d’entrée unique pour rattachement CRM après persistance message (sync / SMTP). */
export { syncCrmLinkForNewMessage } from "./mailCrmLink.service.js";
