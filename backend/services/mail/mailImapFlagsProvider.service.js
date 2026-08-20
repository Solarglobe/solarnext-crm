/**
 * Testable IMAP flag provider. Routes and queue code should depend on this
 * boundary instead of calling ImapFlow directly.
 */

import { decryptJson } from "../security/encryption.service.js";
import { resolveImapCredentials } from "./mailCredentials.util.js";
import { createImapClient, mapImapError } from "./imap.service.js";
import { assertMailAccountCapability } from "./mailAccountState.service.js";

export const MailFlagProviderErrorCodes = {
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  INVALID_CONFIG: "INVALID_CONFIG",
  AUTH_FAILED: "AUTH_FAILED",
  CONNECTION_TIMEOUT: "CONNECTION_TIMEOUT",
  TEMPORARY_IMAP_ERROR: "TEMPORARY_IMAP_ERROR",
  PERMANENT_IMAP_ERROR: "PERMANENT_IMAP_ERROR",
  REMOTE_MESSAGE_NOT_FOUND: "REMOTE_MESSAGE_NOT_FOUND",
  UIDVALIDITY_CHANGED: "UIDVALIDITY_CHANGED",
  FOLDER_NOT_FOUND: "FOLDER_NOT_FOUND",
};

const TEMPORARY_CODES = new Set([
  MailFlagProviderErrorCodes.CONNECTION_TIMEOUT,
  MailFlagProviderErrorCodes.TEMPORARY_IMAP_ERROR,
]);

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 */
export function createMailFlagProviderError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  err.permanent = !TEMPORARY_CODES.has(code);
  if (cause) err.cause = cause;
  return err;
}

/**
 * @param {unknown} err
 */
export function normalizeMailFlagProviderError(err) {
  if (err?.code && Object.values(MailFlagProviderErrorCodes).includes(err.code)) return err;
  try {
    mapImapError(err);
  } catch (mapped) {
    if (mapped?.code === "CONNECTION_TIMEOUT") {
      return createMailFlagProviderError(MailFlagProviderErrorCodes.CONNECTION_TIMEOUT, mapped.message, err);
    }
    if (mapped?.code === "AUTH_FAILED") {
      return createMailFlagProviderError(MailFlagProviderErrorCodes.AUTH_FAILED, mapped.message, err);
    }
    if (mapped?.code === "INVALID_CONFIG") {
      return createMailFlagProviderError(MailFlagProviderErrorCodes.INVALID_CONFIG, mapped.message, err);
    }
    return createMailFlagProviderError(MailFlagProviderErrorCodes.TEMPORARY_IMAP_ERROR, mapped.message, err);
  }
  return createMailFlagProviderError(
    MailFlagProviderErrorCodes.TEMPORARY_IMAP_ERROR,
    err instanceof Error ? err.message : String(err),
    err
  );
}

/**
 * @param {unknown} flags
 */
export function normalizeImapFlagsForJsonValue(flags) {
  if (!flags) return [];
  const list =
    typeof flags === "string"
      ? [flags]
      : typeof flags?.[Symbol.iterator] === "function"
        ? [...flags]
        : Array.isArray(flags)
          ? flags
          : [];
  return list.map((flag) => String(flag).trim()).filter(Boolean);
}

/**
 * @param {unknown} flags
 */
export function hasSeenFlag(flags) {
  if (!flags) return false;
  if (typeof flags.has === "function") return flags.has("\\Seen") || flags.has("\\SEEN");
  const list = normalizeImapFlagsForJsonValue(flags).map((f) => f.toLowerCase());
  return list.includes("\\seen");
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, mailAccountId: string }}
 */
export async function loadActiveMailAccountWithImapCredentials(db, p) {
  const r = await db.query(
    `SELECT id, organization_id, email, is_active, lifecycle_state, sync_enabled, reconnect_required,
            imap_host, imap_port, imap_secure, encrypted_credentials
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2`,
    [p.mailAccountId, p.organizationId]
  );
  if (r.rows.length === 0) {
    throw createMailFlagProviderError(MailFlagProviderErrorCodes.INVALID_CONFIG, "Compte mail introuvable");
  }
  const acc = r.rows[0];
  assertMailAccountCapability(acc, "canMutate");
  const cred = decryptJson(acc.encrypted_credentials);
  const { user, password, accessToken } = resolveImapCredentials(acc.email, cred);
  if (!password && !accessToken) {
    throw createMailFlagProviderError(MailFlagProviderErrorCodes.INVALID_CONFIG, "Credentials IMAP invalides");
  }
  return {
    acc,
    imapConfig: {
      host: acc.imap_host,
      port: acc.imap_port,
      secure: acc.imap_secure !== false,
      auth: { user, password, accessToken },
    },
  };
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {string} folderPath
 */
export async function openMailboxForFlags(imapClient, folderPath) {
  try {
    const mailbox = await imapClient.mailboxOpen(folderPath);
    if (!mailbox) {
      throw createMailFlagProviderError(MailFlagProviderErrorCodes.FOLDER_NOT_FOUND, "Dossier distant introuvable");
    }
    return {
      uidValidity: mailbox.uidValidity != null ? String(mailbox.uidValidity) : null,
      highestModseq: mailbox.highestModseq != null ? String(mailbox.highestModseq) : null,
    };
  } catch (err) {
    throw normalizeMailFlagProviderError(err);
  }
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {number} uid
 */
export async function fetchRemoteFlagsByUid(imapClient, uid) {
  try {
    for await (const msg of imapClient.fetch(String(uid), { uid: true, flags: true, modseq: true }, { uid: true })) {
      if (Number(msg.uid) !== Number(uid)) continue;
      return {
        uid: Number(msg.uid),
        flags: normalizeImapFlagsForJsonValue(msg.flags),
        isRead: hasSeenFlag(msg.flags),
        modseq: msg.modseq != null ? String(msg.modseq) : null,
      };
    }
    return null;
  } catch (err) {
    throw normalizeMailFlagProviderError(err);
  }
}

/**
 * @param {{
 *   imapClient: import('imapflow').ImapFlow,
 *   folderPath: string,
 *   uid: number,
 *   desiredIsRead: boolean,
 *   expectedUidValidity?: string | null,
 * }}
 */
export async function applyReadStateWithClient(p) {
  const mailbox = await openMailboxForFlags(p.imapClient, p.folderPath);
  if (p.expectedUidValidity && mailbox.uidValidity && String(p.expectedUidValidity) !== String(mailbox.uidValidity)) {
    throw createMailFlagProviderError(
      MailFlagProviderErrorCodes.UIDVALIDITY_CHANGED,
      "UIDVALIDITY du dossier distant modifie"
    );
  }

  const before = await fetchRemoteFlagsByUid(p.imapClient, p.uid);
  if (!before) {
    throw createMailFlagProviderError(MailFlagProviderErrorCodes.REMOTE_MESSAGE_NOT_FOUND, "Message distant introuvable");
  }

  try {
    if (p.desiredIsRead) {
      await p.imapClient.messageFlagsAdd(String(p.uid), ["\\Seen"], { uid: true });
    } else {
      await p.imapClient.messageFlagsRemove(String(p.uid), ["\\Seen"], { uid: true });
    }
  } catch (err) {
    throw normalizeMailFlagProviderError(err);
  }

  const confirmed = await fetchRemoteFlagsByUid(p.imapClient, p.uid);
  if (!confirmed) {
    throw createMailFlagProviderError(MailFlagProviderErrorCodes.REMOTE_MESSAGE_NOT_FOUND, "Message distant introuvable apres mutation");
  }
  if (confirmed.isRead !== p.desiredIsRead) {
    throw createMailFlagProviderError(
      MailFlagProviderErrorCodes.TEMPORARY_IMAP_ERROR,
      "Etat distant non confirme apres mutation"
    );
  }

  return { mailbox, before, confirmed };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   folderPath: string,
 *   uid: number,
 *   desiredIsRead: boolean,
 *   expectedUidValidity?: string | null,
 * }}
 */
export async function applyReadState(db, p) {
  const { imapConfig } = await loadActiveMailAccountWithImapCredentials(db, p);
  const imapClient = await createImapClient(imapConfig);
  try {
    return await applyReadStateWithClient({
      imapClient,
      folderPath: p.folderPath,
      uid: p.uid,
      desiredIsRead: p.desiredIsRead,
      expectedUidValidity: p.expectedUidValidity,
    });
  } finally {
    try {
      await imapClient.logout();
    } catch {
      // ignore logout errors
    }
  }
}

/**
 * @param {unknown} err
 */
export function isTemporaryFlagProviderError(err) {
  if (err?.permanent === true) return false;
  if (err?.permanent === false) return true;
  return true;
}

/**
 * @param {unknown} err
 */
export function sanitizeFlagProviderError(err) {
  const code =
    err?.code && typeof err.code === "string"
      ? err.code
      : MailFlagProviderErrorCodes.TEMPORARY_IMAP_ERROR;
  const raw = err instanceof Error ? err.message : String(err);
  return {
    code,
    message: raw.replace(/pass(word)?=[^\s&]+/gi, "password=[redacted]").slice(0, 2000),
  };
}
