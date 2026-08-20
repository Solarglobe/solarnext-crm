import { simpleParser } from "mailparser";
import { createImapClient } from "./imap.service.js";
import { decryptJson } from "../security/encryption.service.js";
import { resolveImapCredentials } from "./mailCredentials.util.js";
import { assertMailAccountCapability } from "./mailAccountState.service.js";

function uidFromAppendResult(result) {
  if (!result) return null;
  if (result.uid != null) return Number(result.uid);
  if (result.appendUid != null) return Number(result.appendUid);
  if (result.uidMap instanceof Map) {
    const first = [...result.uidMap.values()][0];
    if (first != null) return Number(first);
  }
  return null;
}

async function openFolder(client, folderPath) {
  const mailbox = await client.mailboxOpen(folderPath);
  return {
    uidValidity: mailbox?.uidValidity != null ? String(mailbox.uidValidity) : null,
    highestModseq: mailbox?.highestModseq != null ? String(mailbox.highestModseq) : null,
  };
}

export async function appendDraftWithClient(client, p) {
  const mailbox = await openFolder(client, p.folderPath);
  const result = await client.append(p.folderPath, p.mime, ["\\Draft"], p.internalDate || new Date());
  let uid = uidFromAppendResult(result);
  let requiresReconciliation = !Number.isFinite(uid);
  if (!uid && p.draftIdentity) {
    const found = await findDraftByIdentityWithClient(client, { folderPath: p.folderPath, draftIdentity: p.draftIdentity });
    uid = found?.uid ?? null;
    requiresReconciliation = !uid;
  }
  return {
    uid,
    uidValidity: result?.uidValidity != null ? String(result.uidValidity) : mailbox.uidValidity,
    highestModseq: mailbox.highestModseq,
    requiresReconciliation,
  };
}

export async function findDraftByIdentityWithClient(client, p) {
  await openFolder(client, p.folderPath);
  const uids = await client.search({}, { uid: true });
  const sorted = Array.isArray(uids) ? [...uids].sort((a, b) => Number(b) - Number(a)) : [];
  for (const uid of sorted.slice(0, p.limit || 200)) {
    for await (const msg of client.fetch(String(uid), { uid: true, source: { maxLength: 12_000_000 }, flags: true, modseq: true }, { uid: true })) {
      if (!msg?.source) continue;
      const parsed = await simpleParser(msg.source);
      const identity = parsed.headers?.get("x-solarglobe-draft-id");
      if (String(identity || "").trim() === String(p.draftIdentity || "").trim()) {
        return {
          uid: Number(msg.uid || uid),
          flags: msg.flags,
          modseq: msg.modseq != null ? String(msg.modseq) : null,
          parsed,
        };
      }
    }
  }
  return null;
}

export async function fetchDraftWithClient(client, p) {
  const mailbox = await openFolder(client, p.folderPath);
  for await (const msg of client.fetch(String(p.uid), { uid: true, source: { maxLength: 12_000_000 }, flags: true, modseq: true }, { uid: true })) {
    if (Number(msg.uid) !== Number(p.uid) || !msg.source) continue;
    const parsed = await simpleParser(msg.source);
    return {
      uid: Number(msg.uid),
      uidValidity: mailbox.uidValidity,
      modseq: msg.modseq != null ? String(msg.modseq) : null,
      parsed,
    };
  }
  return null;
}

export async function deleteDraftWithClient(client, p) {
  const mailbox = await openFolder(client, p.folderPath);
  const found = await fetchDraftWithClient(client, p);
  if (!found) return { deleted: false, alreadyGone: true, uidValidity: mailbox.uidValidity };
  await client.messageDelete(String(p.uid), { uid: true });
  return { deleted: true, alreadyGone: false, uidValidity: mailbox.uidValidity };
}

export async function withDraftImapClient(db, p, fn) {
  const acc = await db.query(
    `SELECT email, imap_host, imap_port, imap_secure, encrypted_credentials,
            is_active, lifecycle_state, sync_enabled, reconnect_required
       FROM mail_accounts WHERE id = $1 AND organization_id = $2`,
    [p.mailAccountId, p.organizationId]
  );
  const row = acc.rows[0];
  if (!row) throw new Error("Compte mail introuvable");
  assertMailAccountCapability(row, "canMutate");
  const cred = decryptJson(row.encrypted_credentials);
  const { user, password, accessToken } = resolveImapCredentials(row.email, cred);
  const client = await createImapClient({
    host: row.imap_host,
    port: row.imap_port,
    secure: row.imap_secure !== false,
    auth: { user, password, accessToken },
  });
  try {
    return await fn(client, row);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

