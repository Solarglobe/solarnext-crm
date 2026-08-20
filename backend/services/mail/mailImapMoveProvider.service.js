/**
 * IMAP provider for targeted move/delete operations.
 */

import { createImapClient } from "./imap.service.js";
import { decryptJson } from "../security/encryption.service.js";
import { resolveImapCredentials } from "./mailCredentials.util.js";
import { assertMailAccountCapability } from "./mailAccountState.service.js";

export const MailMoveProviderErrorCodes = {
  UIDVALIDITY_CHANGED: "UIDVALIDITY_CHANGED",
  REMOTE_MESSAGE_NOT_FOUND: "REMOTE_MESSAGE_NOT_FOUND",
  TARGET_FOLDER_REQUIRED: "TARGET_FOLDER_REQUIRED",
  UNSAFE_HARD_DELETE_FOLDER: "UNSAFE_HARD_DELETE_FOLDER",
  UNSAFE_UID_EXPUNGE_UNSUPPORTED: "UNSAFE_UID_EXPUNGE_UNSUPPORTED",
  AUTH_FAILED: "AUTH_FAILED",
  CONNECTION_TIMEOUT: "CONNECTION_TIMEOUT",
  TEMPORARY_REMOTE_ERROR: "TEMPORARY_REMOTE_ERROR",
  REMOTE_OPERATION_FAILED: "REMOTE_OPERATION_FAILED",
};

function providerError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function looksTemporary(err) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("temporar") ||
    msg.includes("try again") ||
    msg.includes("rate") ||
    msg.includes("throttl")
  );
}

export function isTemporaryMoveProviderError(err) {
  const code = err && typeof err === "object" && "code" in err ? err.code : null;
  if (code === MailMoveProviderErrorCodes.TEMPORARY_REMOTE_ERROR) return true;
  if (code === MailMoveProviderErrorCodes.CONNECTION_TIMEOUT) return true;
  return looksTemporary(err);
}

export function sanitizeMoveProviderError(err) {
  const code =
    err && typeof err === "object" && "code" in err && typeof err.code === "string"
      ? err.code
      : looksTemporary(err)
        ? MailMoveProviderErrorCodes.TEMPORARY_REMOTE_ERROR
        : MailMoveProviderErrorCodes.REMOTE_OPERATION_FAILED;
  const raw = err instanceof Error ? err.message : String(err);
  return { code, message: raw.slice(0, 500) };
}

function isMoveUnsupportedError(err) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("move") &&
    (msg.includes("not supported") ||
      msg.includes("unsupported") ||
      msg.includes("unknown command") ||
      msg.includes("bad command"))
  );
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {number} uid
 */
async function fetchSourceSnapshot(imapClient, uid) {
  for await (const msg of imapClient.fetch(String(uid), { uid: true, flags: true, modseq: true }, { uid: true })) {
    if (Number(msg.uid) === Number(uid)) return msg;
  }
  return null;
}

function uidFromMap(result, sourceUid) {
  if (!result || !result.uidMap) return null;
  const direct = result.uidMap.get(sourceUid);
  if (direct != null) return Number(direct);
  const str = result.uidMap.get(String(sourceUid));
  return str != null ? Number(str) : null;
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {{
 *   sourcePath: string,
 *   sourceUid: number,
 *   expectedUidValidity?: string | null,
 *   targetPath?: string | null,
 *   hardDelete?: boolean,
 *   sourceIsTrash?: boolean,
 * }} p
 */
export async function applyMoveWithClient(imapClient, p) {
  const mailboxRaw = await imapClient.mailboxOpen(p.sourcePath);
  const sourceUidValidity = mailboxRaw?.uidValidity != null ? String(mailboxRaw.uidValidity) : null;
  const sourceHighestModseq = mailboxRaw?.highestModseq != null ? String(mailboxRaw.highestModseq) : null;
  if (p.expectedUidValidity && sourceUidValidity && String(p.expectedUidValidity) !== sourceUidValidity) {
    throw providerError(
      MailMoveProviderErrorCodes.UIDVALIDITY_CHANGED,
      "UIDVALIDITY distant modifie pour le dossier source"
    );
  }

  if (p.hardDelete) {
    if (p.sourceIsTrash !== true) {
      throw providerError(
        MailMoveProviderErrorCodes.UNSAFE_HARD_DELETE_FOLDER,
        "Suppression definitive refusee hors corbeille"
      );
    }
    if (!imapClient.capabilities?.has?.("UIDPLUS")) {
      throw providerError(
        MailMoveProviderErrorCodes.UNSAFE_UID_EXPUNGE_UNSUPPORTED,
        "Suppression definitive refusee: UID EXPUNGE cible indisponible"
      );
    }
    const source = await fetchSourceSnapshot(imapClient, p.sourceUid);
    if (!source) {
      return {
        operation: "HARD_DELETE",
        source: { uidValidity: sourceUidValidity, highestModseq: sourceHighestModseq },
        destination: null,
        resultUid: null,
        resultUidValidity: null,
        requiresReconciliation: false,
        alreadyGone: true,
      };
    }
    await imapClient.messageDelete(String(p.sourceUid), { uid: true });
    return {
      operation: "HARD_DELETE",
      source: { uidValidity: sourceUidValidity, highestModseq: sourceHighestModseq },
      destination: null,
      resultUid: null,
      resultUidValidity: null,
      requiresReconciliation: false,
    };
  }

  const source = await fetchSourceSnapshot(imapClient, p.sourceUid);
  if (!source) {
    throw providerError(MailMoveProviderErrorCodes.REMOTE_MESSAGE_NOT_FOUND, "Message distant introuvable dans le dossier source");
  }

  if (!p.targetPath) {
    throw providerError(MailMoveProviderErrorCodes.TARGET_FOLDER_REQUIRED, "Dossier cible requis");
  }

  let moved;
  let usedFallback = false;
  const supportsMove = imapClient.capabilities?.has?.("MOVE") === true;
  if (supportsMove) {
    moved = await imapClient.messageMove(String(p.sourceUid), p.targetPath, { uid: true });
    if (moved === false) {
      throw providerError(MailMoveProviderErrorCodes.REMOTE_OPERATION_FAILED, "MOVE IMAP refuse par le serveur");
    }
  } else {
    if (!imapClient.capabilities?.has?.("UIDPLUS")) {
      throw providerError(
        MailMoveProviderErrorCodes.UNSAFE_UID_EXPUNGE_UNSUPPORTED,
        "Fallback COPY+EXPUNGE refuse: UID EXPUNGE cible indisponible"
      );
    }
    try {
      usedFallback = true;
      moved = await imapClient.messageCopy(String(p.sourceUid), p.targetPath, { uid: true });
      await imapClient.messageDelete(String(p.sourceUid), { uid: true });
    } catch (err) {
      if (!isMoveUnsupportedError(err)) throw err;
      throw providerError(MailMoveProviderErrorCodes.REMOTE_OPERATION_FAILED, "Fallback MOVE IMAP refuse par le serveur", err);
    }
  }
  const resultUid = uidFromMap(moved, p.sourceUid);
  const resultUidValidity = moved?.uidValidity != null ? String(moved.uidValidity) : null;
  return {
    operation: usedFallback ? "COPY_DELETE" : "MOVE",
    source: { uidValidity: sourceUidValidity, highestModseq: sourceHighestModseq },
    destination: {
      path: moved?.destination || p.targetPath,
      uidValidity: resultUidValidity,
    },
    resultUid,
    resultUidValidity,
    requiresReconciliation: !Number.isFinite(resultUid),
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   sourcePath: string,
 *   sourceUid: number,
 *   expectedUidValidity?: string | null,
 *   targetPath?: string | null,
 *   hardDelete?: boolean,
 *   sourceIsTrash?: boolean,
 * }} p
 */
export async function applyMove(db, p) {
  const acc = await db.query(
    `SELECT email, imap_host, imap_port, imap_secure, encrypted_credentials,
            is_active, lifecycle_state, sync_enabled, reconnect_required
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2`,
    [p.mailAccountId, p.organizationId]
  );
  const row = acc.rows[0];
  if (!row) {
    throw providerError(MailMoveProviderErrorCodes.AUTH_FAILED, "Compte mail introuvable ou inactif");
  }
  assertMailAccountCapability(row, "canMutate");
  const cred = decryptJson(row.encrypted_credentials);
  const { user, password, accessToken } = resolveImapCredentials(row.email, cred);
  if (!password && !accessToken) {
    throw providerError(MailMoveProviderErrorCodes.AUTH_FAILED, "Credentials IMAP invalides");
  }
  const creds = {
    host: row.imap_host,
    port: row.imap_port,
    secure: row.imap_secure !== false,
    auth: { user, password, accessToken },
  };
  const imapClient = await createImapClient(creds);
  try {
    return await applyMoveWithClient(imapClient, p);
  } finally {
    try {
      await imapClient.logout();
    } catch {
      // ignore
    }
  }
}
