/**
 * IMAP folder discovery. Does not fetch message bodies.
 */

import { collectMailboxesFromList } from "./imap.mailbox-map.js";

/**
 * @param {unknown} err
 */
function sanitizeDiscoveryError(err) {
  return (err instanceof Error ? err.message : String(err))
    .replace(/pass(word)?=[^\s&]+/gi, "password=[redacted]")
    .slice(0, 1000);
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {string} path
 */
async function safeMailboxStatus(imapClient, path) {
  try {
    const status = await imapClient.status(path, {
      messages: true,
      unseen: true,
      uidValidity: true,
      highestModseq: true,
    });
    if (!status || typeof status !== "object") return {};
    return {
      uidValidity: status.uidValidity != null ? String(status.uidValidity) : null,
      highestModseq: status.highestModseq != null ? String(status.highestModseq) : null,
      remoteMessageCount: Number.isFinite(Number(status.messages)) ? Number(status.messages) : null,
      remoteUnreadCount: Number.isFinite(Number(status.unseen)) ? Number(status.unseen) : null,
      statusError: null,
    };
  } catch (err) {
    return {
      uidValidity: null,
      highestModseq: null,
      remoteMessageCount: null,
      remoteUnreadCount: null,
      statusError: sanitizeDiscoveryError(err),
    };
  }
}

/**
 * @param {import('imapflow').ImapFlow} imapClient
 * @param {{ statusLimit?: number }} [opts]
 */
export async function discoverImapFoldersWithStatus(imapClient, opts = {}) {
  const raw = await imapClient.list();
  const folders = collectMailboxesFromList(raw);
  const statusLimit = Math.min(Math.max(Number(opts.statusLimit) || 250, 1), 1000);

  let statusCount = 0;
  const out = [];
  for (const folder of folders) {
    if (!folder.selectable || statusCount >= statusLimit) {
      out.push({
        ...folder,
        uidValidity: null,
        highestModseq: null,
        remoteMessageCount: null,
        remoteUnreadCount: null,
        statusError: folder.selectable ? "STATUS_SKIPPED_BUDGET" : null,
      });
      continue;
    }
    statusCount += 1;
    const status = await safeMailboxStatus(imapClient, folder.path);
    out.push({ ...folder, ...status });
  }

  return {
    folders: out,
    total: folders.length,
    statusChecked: statusCount,
    statusBudgetExhausted: folders.filter((f) => f.selectable).length > statusCount,
  };
}
