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
  const wanted = String(p.messageId || "").replace(/^<|>$/g, "");
  if (!wanted) throw new Error('Message-ID requis pour rechercher Envoyés');
  const mailbox = await client.mailboxOpen(p.folderPath);
  // HEADER search covers the whole folder. Verify exact identity because the
  // server's header search may use substring matching.
  const uids = await client.search({ header: { 'Message-ID': `<${wanted}>` } }, { uid: true });
  if (!Array.isArray(uids)) throw new Error('Recherche Envoyés incomplète');
  for (const uid of [...uids].sort((a, b) => Number(b) - Number(a))) {
    let fetched = false;
    for await (const msg of client.fetch(String(uid), { uid: true, source: { maxLength: 12_000_000 }, flags: true, modseq: true }, { uid: true })) {
      if (!msg?.source || Number(msg.uid) !== Number(uid)) throw new Error('Réponse Envoyés incomplète');
      fetched = true;
      const parsed = await simpleParser(msg.source);
      const mid = String(parsed.messageId || "").replace(/^<|>$/g, "");
      if (mid && mid === wanted) {
        return {
          uid: Number(msg.uid || uid),
          uidValidity: mailbox?.uidValidity != null ? String(mailbox.uidValidity) : null,
          modseq: msg.modseq != null ? String(msg.modseq) : null,
          parsed,
        };
      }
    }
    if (!fetched) throw new Error('Copie Envoyés non vérifiable');
  }
  return null;
}

export async function ensureSentMessageWithClient(client, p) {
  const parsedMime = await simpleParser(p.mime);
  if (String(parsedMime.messageId || '').replace(/^<|>$/g, '') !== String(p.messageId || '').replace(/^<|>$/g, '')) {
    throw Object.assign(new Error('Message-ID différent dans le MIME Envoyés'), { code: 'SENT_IDENTITY_MISMATCH' });
  }
  const before = await findSentMessageWithClient(client, {
    folderPath: p.folderPath,
    messageId: p.messageId,
    limit: p.searchLimit,
  });
  if (before) return { action: "reconciled-existing", uid: before.uid, uidValidity: before.uidValidity, modseq: before.modseq };
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
