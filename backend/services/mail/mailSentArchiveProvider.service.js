import { simpleParser } from "mailparser";

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

export async function findSentMessageWithClient(client, p) {
  await client.mailboxOpen(p.folderPath);
  const uids = await client.search({}, { uid: true });
  const wanted = String(p.messageId || "").replace(/^<|>$/g, "");
  for (const uid of (Array.isArray(uids) ? [...uids].sort((a, b) => Number(b) - Number(a)) : []).slice(0, p.limit || 500)) {
    for await (const msg of client.fetch(String(uid), { uid: true, source: { maxLength: 12_000_000 }, flags: true, modseq: true }, { uid: true })) {
      if (!msg?.source) continue;
      const parsed = await simpleParser(msg.source);
      const mid = String(parsed.messageId || "").replace(/^<|>$/g, "");
      if (mid && mid === wanted) {
        return {
          uid: Number(msg.uid || uid),
          modseq: msg.modseq != null ? String(msg.modseq) : null,
          parsed,
        };
      }
    }
  }
  return null;
}

export async function ensureSentMessageWithClient(client, p) {
  const before = await findSentMessageWithClient(client, {
    folderPath: p.folderPath,
    messageId: p.messageId,
    limit: p.searchLimit,
  });
  if (before) return { action: "reconciled-existing", uid: before.uid, modseq: before.modseq };
  const mailbox = await client.mailboxOpen(p.folderPath);
  const result = await client.append(p.folderPath, p.mime, ["\\Seen"], p.sentAt || new Date());
  const appended = {
    uid: uidFromAppendResult(result),
    uidValidity: result?.uidValidity != null ? String(result.uidValidity) : mailbox?.uidValidity != null ? String(mailbox.uidValidity) : null,
    highestModseq: mailbox?.highestModseq != null ? String(mailbox.highestModseq) : null,
  };
  if (appended.uid && client.messageFlagsAdd) {
    await client.messageFlagsAdd(String(appended.uid), ["\\Seen"], { uid: true });
  }
  const after = await findSentMessageWithClient(client, {
    folderPath: p.folderPath,
    messageId: p.messageId,
    limit: p.searchLimit,
  });
  return {
    action: after ? "appended-confirmed" : "appended-reconcile-needed",
    uid: after?.uid ?? appended.uid ?? null,
    uidValidity: appended.uidValidity ?? null,
    modseq: after?.modseq ?? appended.highestModseq ?? null,
    requiresReconciliation: !after,
  };
}
